/**
 * guardSql: the single gate for model-written (and saved) SQL.
 *
 *  - SELECT / WITH only, exactly one statement (better-sqlite3's prepare()
 *    rejects multiple statements);
 *  - stmt.readonly must be true;
 *  - every identifier that names a real table/view must be an ai_* view; no
 *    sqlite_* / pragma_* objects, no ATTACH / PRAGMA / load_extension. A name
 *    is exempt only where it can't read a table: a function call (RANK()), or
 *    an "AS x" alias used outside table position (after FROM/JOIN/IN/,/(/.);
 *  - no recursive CTEs: neither WITH RECURSIVE nor a CTE whose body names
 *    itself (SQLite recurses on that even without the keyword);
 *  - no randomblob/zeroblob (huge allocations before the timeout fires);
 *  - trailing comments and ';' are cut, then the query is wrapped in an outer
 *    LIMIT on its own lines (1000 rows kept, +1 to detect truncation).
 *
 * The connection that runs the query is read-only as well (query_only), so
 * this is defence in depth, not the only line.
 */
import type { Database } from "better-sqlite3";
import { ToolError } from "./errors";

export const SQL_ROW_LIMIT = 1000;

const FORBIDDEN_WORDS = new Set([
  "pragma", "attach", "detach", "load_extension", "vacuum", "reindex", "analyze", "randomblob", "zeroblob",
]);
/** Tokens after which a name is in table position. */
const TABLE_POSITION_PREV = new Set(["from", "join", "in", ",", "(", "."]); // "x IN tbl" reads tbl

interface Token {
  kind: "word" | "ident" | "other";
  text: string; // lower-cased for word/ident
  end: number; // offset just past the token in the source
  /** For '...' literals: the lower-cased content. SQLite reads FROM 'Worker' as a table name. */
  value?: string;
}

/** Minimal SQLite tokenizer: skips comments and '...' literals, unquotes "x", `x`, [x]. */
export function tokenize(sql: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? sql.length : nl + 1;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    if (c === "'") {
      i++;
      let value = "";
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { value += "'"; i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        value += sql[i++];
      }
      out.push({ kind: "other", text: "'str'", end: i, value: value.toLowerCase() });
      continue;
    }
    if (c === '"' || c === "`" || c === "[") {
      const close = c === "[" ? "]" : c;
      let j = i + 1;
      let text = "";
      while (j < sql.length) {
        if (sql[j] === close && close !== "]" && sql[j + 1] === close) { text += close; j += 2; continue; }
        if (sql[j] === close) { j++; break; }
        text += sql[j++];
      }
      out.push({ kind: "ident", text: text.toLowerCase(), end: j });
      i = j;
      continue;
    }
    if (/[A-Za-z_\u0080-￿]/.test(c)) {
      let j = i;
      while (j < sql.length && /[A-Za-z0-9_$\u0080-￿]/.test(sql[j])) j++;
      out.push({ kind: "word", text: sql.slice(i, j).toLowerCase(), end: j });
      i = j;
      continue;
    }
    out.push({ kind: "other", text: c, end: i + 1 });
    i++;
  }
  return out;
}

/** Index of the ')' matching the '(' at tokens[open], or -1. */
function matchParen(tokens: Token[], open: number): number {
  let depth = 0;
  for (let k = open; k < tokens.length; k++) {
    if (tokens[k].kind !== "other") continue;
    if (tokens[k].text === "(") depth++;
    else if (tokens[k].text === ")" && --depth === 0) return k;
  }
  return -1;
}

/** Throws if any CTE in a WITH list starting at tokens[w] references itself. */
function checkCtes(tokens: Token[], w: number): void {
  let j = w + 1;
  if (tokens[j]?.text === "recursive") throw new ToolError("WITH RECURSIVE is not allowed.");
  for (;;) {
    const name = tokens[j];
    if (!name || name.kind === "other") return;
    j++;
    if (tokens[j]?.text === "(") j = matchParen(tokens, j) + 1;
    if (tokens[j]?.text !== "as") return;
    j++;
    if (tokens[j]?.text === "not") j++;
    if (tokens[j]?.text === "materialized") j++;
    if (tokens[j]?.text !== "(") return;
    const close = matchParen(tokens, j);
    if (close < 0) return;
    for (let k = j + 1; k < close; k++) {
      if (tokens[k].kind !== "other" && tokens[k].text === name.text) {
        throw new ToolError(`Recursive CTE "${name.text}" is not allowed.`);
      }
    }
    j = close + 1;
    if (tokens[j]?.text !== ",") return;
    j++;
  }
}

export function guardSql(rawSql: string, db: Database): string {
  const all = tokenize(rawSql);
  // Cut trailing ';' tokens; slicing at the last real token also drops trailing comments.
  let last = all.length - 1;
  while (last >= 0 && all[last].kind === "other" && all[last].text === ";") last--;
  if (last < 0) throw new ToolError("Empty SQL.");
  const sql = rawSql.slice(0, all[last].end).trim();
  const tokens = all.slice(0, last + 1);
  const first = tokens[0]?.text;
  if (first !== "select" && first !== "with") {
    throw new ToolError("Only SELECT queries (optionally starting with WITH) are allowed.");
  }

  const schemaObjects = db
    .prepare("SELECT lower(name) AS name FROM sqlite_master WHERE type IN ('table', 'view')")
    .all() as { name: string }[];
  const forbiddenObjects = new Set(schemaObjects.map((o) => o.name).filter((n) => !n.startsWith("ai_")));

  const asAliases = new Set<string>();
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i - 1].text === "as" && tokens[i].kind !== "other") asAliases.add(tokens[i].text);
  }

  const isHidden = (name: string) => name.startsWith("sqlite_") || name.startsWith("pragma_") || forbiddenObjects.has(name);

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.value !== undefined) {
      // A string literal in table position is a table name to SQLite: FROM 'Worker' reads Worker.
      const prev = tokens[i - 1]?.text;
      if (prev !== undefined && TABLE_POSITION_PREV.has(prev) && isHidden(t.value)) {
        throw new ToolError(`'${t.value}' is a base table and is not accessible. Query only the ai_* views.`);
      }
      continue;
    }
    if (t.kind === "other") continue;
    if (t.kind === "word" && t.text === "with") checkCtes(tokens, i);
    // Quoted names too: SQLite calls "randomblob"(n) and [zeroblob](n) like the bare names.
    if (FORBIDDEN_WORDS.has(t.text)) {
      throw new ToolError(`"${t.text}" is not allowed.`);
    }
    if (t.text.startsWith("sqlite_") || t.text.startsWith("pragma_")) {
      throw new ToolError(`"${t.text}" is not accessible. Query only the ai_* views.`);
    }
    if (forbiddenObjects.has(t.text)) {
      const prev = tokens[i - 1]?.text;
      const inTablePosition = prev !== undefined && TABLE_POSITION_PREV.has(prev);
      // A table can't be read through name(...) (only virtual tables, caught above), so calls are safe.
      const isCall = t.kind === "word" && tokens[i + 1]?.text === "(";
      const isAlias = prev === "as" || (asAliases.has(t.text) && !inTablePosition);
      if (!isCall && !isAlias) {
        throw new ToolError(`"${t.text}" is a base table and is not accessible. Query only the ai_* views.`);
      }
    }
  }

  let stmt;
  try {
    stmt = db.prepare(sql);
  } catch (e) {
    throw new ToolError(`SQL error: ${(e as Error).message}`);
  }
  if (!stmt.readonly || !stmt.reader) {
    throw new ToolError("Only read-only queries that return rows are allowed.");
  }

  // One extra row lets the runner tell "exactly 1000" from "truncated".
  return `SELECT * FROM (\n${sql}\n) LIMIT ${SQL_ROW_LIMIT + 1}`;
}
