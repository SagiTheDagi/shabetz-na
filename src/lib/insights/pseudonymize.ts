/**
 * INSIGHTS_PSEUDONYMIZE=true: worker names and ids become stable aliases in
 * everything sent to Anthropic (the user's message, the rebuilt history, tool
 * results), and are mapped back before anything reaches the client or the DB.
 *
 *  - alias = "W-" + first 8 hex chars of HMAC(secret, worker_id), extended
 *    one char at a time for workers whose prefix collides. Never list order.
 *    8 chars so a collision (which would lengthen an existing worker's alias
 *    and orphan it in older history) is ~1 in 10^4 at 1000 workers. Accepted:
 *    aliases only live within one chat (history isn't persisted).
 *  - secret = INSIGHTS_ALIAS_SECRET, else SESSION_SECRET. Rotating it changes
 *    every alias: only open chats are affected (saved views store real ids in
 *    their literals, and a column alias stays consistent with its spec keys).
 *  - Tool inputs: aliases in model-written args are mapped back to real ids
 *    before querying. In SQL only aliases inside '…' string literals are
 *    mapped (a small lexer skips comments, "…", `…` and […] identifiers).
 *    A double-quoted "W-…" is always an identifier: better-sqlite3 builds
 *    SQLite without double-quoted string literals, so a "W-…" meant as a value
 *    fails with "no such column" (the model retries with quotes) instead of
 *    silently matching nothing, and an AS "W-…" pivot column stays a column
 *    wherever it's used (WHERE "W-…" > 2).
 *  - Results: in worker id columns (worker_id, *_worker_id, *_by) a value equal to a
 *    worker id becomes its alias, whatever its length. Other entities' id
 *    columns (rank_id, quarter_id, id, …) are left as is. Everything else gets
 *    the free-text rules, so short values ("12" as a month) are never taken
 *    for worker ids. Limit: a short worker id renamed by the model's SQL
 *    (worker_id AS wid) is sent as is; the prompt asks to keep the name.
 *  - Result keys (column names, e.g. COUNT(*) FILTER (WHERE worker_id='…'),
 *    AS "אבי כהן") get the free-text rules too, deduped (hideKeys). render_*
 *    keys the model copies from them map back to the stored column via
 *    resolveKey, which inverts hideKeys; an unknown key's error lists only
 *    the hidden names.
 *  - Numbers: an integer in a worker id column becomes the alias
 *    (CAST(worker_id AS INT)). Elsewhere numbers are kept: a count or sum may
 *    equal an id. Limit: a renamed numeric id column is sent as is.
 *  - Client: aliases become names, except in worker_id fields (→ real id),
 *    column references ("key", a query summary's "columns": they must match
 *    the row keys and come back next turn as is) and "sql" (saved-view source:
 *    its column names must keep matching those keys).
 *  - Workers sharing a name are shown as "name (2)", "name (3)" (by worker id
 *    order), and those labels map back to their own alias on the next turn.
 *  - Free-text columns (notes, constraints, exemption reasons) are never
 *    exposed by the ai_* views or the domain tools in the first place.
 *  - Text: the client gets the alias→name map and replaces aliases on the
 *    joined text (an alias can be split across stream chunks).
 *  - Tool-call args reach the client as the model wrote them (aliases kept):
 *    they come back in the next turn's history, and revealing names there is
 *    lossy (two workers with one name would both map to the first alias).
 *  - Worker name columns (name, *_worker_name) whose row holds the matching
 *    worker id column (worker_id, *_worker_id) get that worker's alias, so
 *    two workers sharing a name each keep their own alias.
 *  - Single-word names ("טל", "אור") are common words too: they're aliased
 *    only in such a row-paired name column, never in free text or other
 *    columns (a rank named "אור" stays). Limit: a single-word name typed in a
 *    question, or a lone first name in the model's earlier answer, is sent as is.
 *  - Names match as whole words. Multi-word names may also follow attached
 *    Hebrew prefix letters (ו/ה/ב/כ/ל/מ/ש, up to 3: "ולאבי כהן" → "ול" +
 *    alias). Stored names are trimmed and any
 *    whitespace run matches between their words.
 *  - Limit: exact matches only; nicknames or misspellings in a question are
 *    sent as typed.
 *  - Built once per worker set: createPseudonymizer reuses the last instance
 *    while the worker ids/names and the secret are unchanged.
 */
import { createHmac } from "crypto";
import type { Database } from "better-sqlite3";
import type { ClientMessage } from "./prompt";
import type { ChatEvent } from "./chat-loop";
import { ALIAS_RE, aliasSecret, pseudonymizeEnabled } from "./config";
import { ToolError } from "./errors";

export interface Pseudonymizer {
  /** alias → real name, for the client. */
  aliasNames: Record<string, string>;
  aliasOf(workerId: string): string | undefined;
  mapClientMessages(messages: ClientMessage[]): ClientMessage[];
  mapToolInput(name: string, input: unknown): unknown;
  mapForModel(value: unknown): unknown;
  mapForClient(value: unknown): unknown;
  /** render_* column key → the stored column it names (the key itself, else with aliases revealed). */
  resolveKey(key: string, columns: readonly string[]): string;
  /** alias → name for the known aliases in text (skipping those in `skip`); null when none. */
  aliasNamesIn(text: string, skip?: ReadonlySet<string>): Record<string, string> | null;
}

/** Ids shorter than this are only replaced in structured fields, never inside free text (avoids "2026" etc.). */
const MIN_FREE_TEXT_ID_LENGTH = 5;

/** Hebrew one-letter prefixes written attached to the next word (and, the, in, as, to, from, that). */
const HEBREW_PREFIX = "[והבכלמש]";

/** Columns holding worker ids: worker_id, shift_worker_id, assigned_by, created_by, … */
const isWorkerIdKey = (key: string) => /(^|_)worker_id$|_by$/.test(key);
/** Worker name column → the id column in the same row naming that worker ("name" → "worker_id"). */
const pairedIdKey = (key: string) => (key === "name" ? "worker_id" : /(^|_)worker_name$/.test(key) ? key.replace(/name$/, "id") : null);
/** Id columns of non-worker entities: their values are never worker ids, even when equal to one. */
const isOtherIdKey = (key: string) => (key === "id" || key.endsWith("_id")) && !isWorkerIdKey(key);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** "  אבי   כהן " → "אבי כהן". */
const normalizeName = (s: string) => s.trim().replace(/\s+/g, " ");

export const ALIAS_HEX_LENGTH = 8;

/** Stable aliases for every worker id. Pure given the secret and the id set. */
export function computeAliases(workerIds: string[], secret: string, minLength = ALIAS_HEX_LENGTH): Map<string, string> {
  const hex = new Map(workerIds.map((id) => [id, createHmac("sha256", secret).update(id).digest("hex")]));
  const len = new Map(workerIds.map((id) => [id, minLength]));
  for (;;) {
    const byAlias = new Map<string, string[]>();
    for (const id of workerIds) {
      const a = hex.get(id)!.slice(0, len.get(id)!);
      byAlias.set(a, [...(byAlias.get(a) ?? []), id]);
    }
    const colliding = [...byAlias.values()].filter((ids) => ids.length > 1).flat();
    if (!colliding.length) break;
    for (const id of colliding) len.set(id, len.get(id)! + 1);
  }
  return new Map(workerIds.map((id) => [id, `W-${hex.get(id)!.slice(0, len.get(id)!)}`]));
}

type Obj = Record<string, unknown>;
type Mapper = (v: string | number, key?: string, parent?: Obj) => unknown;
/**
 * Maps every string (and, when `numbers`, every number); fn gets the field key
 * and the object holding it (row context). `mapKeys` also renames object keys
 * and the strings of a "columns" array (result column names), so both match.
 */
function deepMap(v: unknown, fn: Mapper, opts: { numbers?: boolean; mapKeys?: (keys: string[]) => string[] } = {}, key?: string, parent?: Obj): unknown {
  if (typeof v === "string" || (opts.numbers && typeof v === "number")) return fn(v, key, parent);
  if (Array.isArray(v)) {
    if (opts.mapKeys && key === "columns" && v.every((x) => typeof x === "string")) return opts.mapKeys(v as string[]);
    return v.map((x) => deepMap(x, fn, opts, key, parent));
  }
  if (v && typeof v === "object") {
    const o = v as Obj;
    const entries = Object.entries(o);
    const keys = opts.mapKeys ? opts.mapKeys(entries.map(([k]) => k)) : entries.map(([k]) => k);
    return Object.fromEntries(entries.map(([k, x], i) => [keys[i], deepMap(x, fn, opts, k, o)]));
  }
  return v;
}
const deepMapStrings = (v: unknown, fn: (s: string, key?: string, parent?: Obj) => string) =>
  deepMap(v, fn as Mapper);

/**
 * Splits SQL into string literals ('…') and everything else, skipping
 * comments and quoted identifiers ("…", `…`, […]) so an apostrophe inside
 * them (a Hebrew geresh in "-- צ'ק") never opens a fake literal.
 */
export function mapSqlStringLiterals(sql: string, fn: (literal: string) => string): string {
  const token = /'(?:[^']|'')*'?|"(?:[^"]|"")*"?|`[^`]*`?|\[[^\]]*\]?|--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/g;
  return sql.replace(token, (m) => (m.startsWith("'") ? fn(m) : m));
}

export function buildPseudonymizer(workers: { worker_id: string; name: string }[], secret: string): Pseudonymizer {
  const aliases = computeAliases(workers.map((w) => w.worker_id), secret);
  const idByAlias = new Map([...aliases].map(([id, a]) => [a, id]));
  // Display label per worker: the name, or "name (n)" for the n-th worker
  // sharing it (worker id order), so the client text maps back to the same
  // alias. A worker without a name stays an alias on screen; revealing its raw
  // id would send a short id back unaliased on the next turn.
  const labelById = new Map<string, string>();
  const nameById = new Map(workers.map((w) => [w.worker_id, normalizeName(w.name ?? "")]));
  const seen = new Map<string, number>();
  for (const w of [...workers].sort((a, b) => (a.worker_id < b.worker_id ? -1 : a.worker_id > b.worker_id ? 1 : 0))) {
    const name = (w.name ?? "").trim();
    if (!name) continue;
    const n = (seen.get(normalizeName(name)) ?? 0) + 1;
    seen.set(normalizeName(name), n);
    labelById.set(w.worker_id, n === 1 ? name : `${name} (${n})`);
  }
  const aliasNames = Object.fromEntries([...aliases].map(([id, a]) => [a, labelById.get(id) ?? a]));

  // Longest labels first so "אבי כהן (2)" wins over "אבי כהן".
  // A bare shared name typed by the user maps to the first worker with it.
  // Single-word labels are left out (see header); "טל (2)" has a space and stays.
  const byName = new Map<string, string>();
  const labels = [...labelById]
    .map(([id, label]) => [id, normalizeName(label)] as const)
    .filter(([, label]) => label.includes(" "));
  for (const [id, label] of labels.sort((a, b) => b[1].length - a[1].length)) {
    if (!byName.has(label)) byName.set(label, aliases.get(id)!);
  }
  const namePattern = (n: string) => n.split(" ").map(escapeRe).join("\\s+");
  const multi = [...byName.keys()].map(namePattern);
  // Whole word (no letter/digit on either side; \b doesn't work for Hebrew),
  // optionally after attached prefix letters, kept in front of the alias.
  const nameRe = multi.length
    ? new RegExp(`(?<![\\p{L}\\p{N}])(${HEBREW_PREFIX}{0,3})(${multi.join("|")})(?![\\p{L}\\p{N}])`, "gu")
    : null;
  const longIds = workers.map((w) => w.worker_id).filter((id) => id.length >= MIN_FREE_TEXT_ID_LENGTH);
  const idRe = longIds.length ? new RegExp(`(?<![\\w-])(?:${longIds.map(escapeRe).join("|")})(?![\\w-])`, "g") : null;

  /**
   * Real names / long ids in free text → aliases. Runs over every string of
   * every result, so the big regexes are skipped when they can't match: a
   * whole-value name (the "name" column) is a Map lookup, text without letters
   * can't hold a name, and text shorter than any aliased id can't hold one.
   */
  const hideText = (s: string) => {
    const exact = byName.get(normalizeName(s));
    if (exact) return exact;
    let out = nameRe && /\p{L}/u.test(s)
      ? s.replace(nameRe, (_m, prefix: string, name: string) => prefix + byName.get(normalizeName(name))!)
      : s;
    if (idRe && out.length >= MIN_FREE_TEXT_ID_LENGTH) out = out.replace(idRe, (m) => aliases.get(m)!);
    return out;
  };
  /**
   * Structured value, by column: worker id → alias, other entity id → as is,
   * a worker name next to its own worker id → that worker's alias (shared
   * names stay apart), anything else → free-text rules.
   */
  const hideValue = (v: string | number, key?: string, row?: Obj): unknown => {
    if (typeof v === "number") {
      // Only in worker id columns: elsewhere a number is a count/sum that may just equal an id.
      return key && isWorkerIdKey(key) && Number.isInteger(v) ? (aliases.get(String(v)) ?? v) : v;
    }
    const s = v;
    if (key && isWorkerIdKey(key)) return aliases.get(s) ?? hideText(s);
    if (key && isOtherIdKey(key)) return s;
    const idKey = key && pairedIdKey(key);
    if (idKey && row) {
      // The id may already be an alias (history sent back by the client holds real ids, but be lenient).
      const raw = row[idKey];
      const id = typeof raw === "string" ? (aliases.has(raw) ? raw : idByAlias.get(raw)) : typeof raw === "number" ? String(raw) : undefined;
      if (id !== undefined && aliases.has(id)) {
        const n = normalizeName(s);
        if (n && (n === nameById.get(id) || n === normalizeName(labelById.get(id) ?? ""))) return aliases.get(id)!;
      }
    }
    return hideText(s);
  };
  /** Aliases → real ids (structured tool inputs). */
  const revealIds = (s: string) => s.replace(ALIAS_RE, (m) => idByAlias.get(m) ?? m);
  /** SQL: aliases → real ids inside '…' string literals only (see header). */
  const revealSql = (sql: string) =>
    mapSqlStringLiterals(sql, (lit) => lit.replace(ALIAS_RE, (m) => idByAlias.get(m)?.replace(/'/g, "''") ?? m));
  /** Aliases → real names (titles, labels, text), ids for id fields, untouched in column references. */
  const revealForClient = (s: string, key?: string) => {
    if (key === "key" || key === "columns" || key === "sql") return s;
    if (key && isWorkerIdKey(key)) return revealIds(s);
    return s.replace(ALIAS_RE, (m) => aliasNames[m] ?? m);
  };

  /**
   * Column names as the model sees them: free-text rules, and a name that
   * would clash with another column's ("אבי כהן" and "1234567" both → alias)
   * gets " (2)", " (3)" in sorted original-name order. Sorted, not given
   * order, so a row object (integer-like keys first) and the result's
   * "columns" array map the same way. resolveKey inverts this.
   */
  const hideKeys = (keys: string[]): string[] => {
    const hidden = new Map(keys.map((k) => [k, hideText(k)]));
    const original = new Set(keys);
    const used = new Set<string>();
    const out = new Map<string, string>();
    // Unchanged names first: they keep their own name.
    const order = [...keys].sort((a, b) => Number(hidden.get(a) !== a) - Number(hidden.get(b) !== b) || (a < b ? -1 : a > b ? 1 : 0));
    for (const k of order) {
      const base = hidden.get(k)!;
      let name = base;
      for (let n = 2; used.has(name) || (name !== k && original.has(name)); n++) name = `${base} (${n})`;
      used.add(name);
      out.set(k, name);
    }
    return keys.map((k) => out.get(k)!);
  };
  /** Everything bound for the model: values by column, numbers included, and column names (row keys, "columns"). */
  const hideDeep = (v: unknown) => deepMap(v, hideValue, { numbers: true, mapKeys: hideKeys });

  return {
    aliasNames,
    aliasOf: (id) => aliases.get(id),
    mapClientMessages: (messages) =>
      messages.map((m) => ({
        ...m,
        content: m.content.map((p) =>
          p.type === "text"
            ? { ...p, text: hideText(p.text) }
            : { ...p, args: hideDeep(p.args), result: hideDeep(p.result) },
        ),
      })),
    mapToolInput: (_name, input) => deepMapStrings(input, (s, key) => (key === "sql" ? revealSql(s) : revealIds(s))),
    mapForModel: (value) => {
      if (typeof value !== "string") return hideDeep(value);
      // Tool results are JSON strings: map each string value; plain error text gets free-text rules.
      try {
        return JSON.stringify(hideDeep(JSON.parse(value)));
      } catch {
        return hideText(value);
      }
    },
    mapForClient: (value) => deepMapStrings(value, revealForClient),
    resolveKey: (key, columns) => {
      const shown = hideKeys([...columns]);
      const i = shown.indexOf(key);
      if (i >= 0) return columns[i];
      // Only names the model saw: real columns may hold names or short ids.
      throw new ToolError(`Unknown column "${key}". Available columns: ${shown.join(", ")}.`);
    },
    aliasNamesIn: (text, skip) => {
      let out: Record<string, string> | null = null;
      for (const [m] of text.matchAll(ALIAS_RE)) {
        if (m in aliasNames && !skip?.has(m)) (out ??= {})[m] = aliasNames[m];
      }
      return out;
    },
  };
}

/**
 * Sends alias → name entries only for aliases that show up in streamed text,
 * each once, just before the text that uses it (not the whole worker map).
 * The previous text's tail is rescanned so an alias split across deltas is found.
 * An alias run at the very end of the text is held back until the next event:
 * it may still grow ("W-3fa91c2d" + "7" is another worker, extended on collision).
 */
export function withAliases(emit: (e: ChatEvent) => void, pseudo: Pseudonymizer): (e: ChatEvent) => void {
  const sent = new Set<string>();
  let tail = "";
  const scan = (text: string) => {
    const map = pseudo.aliasNamesIn(text, sent);
    if (map) {
      for (const a of Object.keys(map)) sent.add(a);
      emit({ type: "aliases", map });
    }
  };
  return (e) => {
    if (e.type === "text") {
      const text = tail + e.delta;
      tail = text.slice(-80);
      scan(text.replace(/W-[0-9a-f]*$/, ""));
    } else if (tail) {
      scan(tail); // text ended (tool call, done, …): the held-back alias is complete
      tail = "";
    }
    emit(e);
  };
}

/** null when INSIGHTS_PSEUDONYMIZE is off. */
export function createPseudonymizer(db: Database): Pseudonymizer | null {
  if (!pseudonymizeEnabled()) return null;
  const secret = aliasSecret();
  if (!secret) throw new Error("INSIGHTS_PSEUDONYMIZE requires INSIGHTS_ALIAS_SECRET or SESSION_SECRET");
  const workers = db.prepare("SELECT worker_id, name FROM Worker ORDER BY worker_id").all() as { worker_id: string; name: string }[];
  // One cheap SELECT per request; the HMACs and regexes are rebuilt only when a worker id/name changes.
  const key = `${secret}\u0000${workers.map((w) => `${w.worker_id}\u0001${w.name}`).join("\u0000")}`;
  if (cached?.key !== key) cached = { key, p: buildPseudonymizer(workers, secret) };
  return cached.p;
}

let cached: { key: string; p: Pseudonymizer } | null = null;

/** Tests only. */
export function resetPseudonymizerCache(): void {
  cached = null;
}
