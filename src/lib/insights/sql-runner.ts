/**
 * Runs guarded SQL in a short-lived child process with its own read-only
 * connection. better-sqlite3 has no statement timeout, and a worker thread
 * can't be stopped while SQLite is inside a native step (an aggregate over a
 * huge join never returns to JS), so the parent SIGKILLs the child after
 * SQL_TIMEOUT_MS. Rows are read with iterate() and reading stops at
 * SQL_ROW_LIMIT rows or SQL_MAX_BYTES of JSON.
 *
 * The child runs an inline script (`node -e`) rather than a separate file so
 * it survives Next's standalone bundling; it loads better-sqlite3 from the
 * cwd's node_modules, where the standalone build keeps external packages. It
 * gets an empty environment, so no secrets reach the process running
 * model-written SQL.
 */
import { spawn } from "child_process";
import { z } from "zod";
import { resolveDbPath } from "../db";
import { ToolError } from "./errors";
import { guardSql, SQL_ROW_LIMIT } from "./sql-guard";
import { defineTool, type QueryOutput } from "./tools";
import type { Row } from "./result-store";

export const SQL_TIMEOUT_MS = 3000;
export const SQL_MAX_BYTES = 512 * 1024;
export const SQL_TIMEOUT_MESSAGE = "השאילתה ארכה זמן רב מדי";

const CHILD_SOURCE = `
const { createRequire } = require("module");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { input += c; });
process.stdin.on("end", () => {
  const reply = (obj) => process.stdout.write(JSON.stringify(obj), () => process.exit(0));
  let db;
  try {
    const { dbPath, sql, maxRows, maxBytes } = JSON.parse(input);
    const Database = createRequire(process.cwd() + "/")("better-sqlite3");
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    db.pragma("query_only = 1");
    const stmt = db.prepare(sql).raw(true);
    // Unique already: guardSql's SELECT * FROM (...) wrapper makes SQLite rename duplicates (a, a:1).
    const columns = stmt.columns().map((c) => c.name);
    const rows = [];
    let bytes = 0;
    let truncated = false;
    for (const raw of stmt.iterate()) {
      if (rows.length >= maxRows) { truncated = true; break; }
      const row = {};
      for (let i = 0; i < columns.length; i++) {
        const v = raw[i];
        row[columns[i]] = v === null || typeof v === "number" || typeof v === "string" ? v : String(v);
      }
      bytes += JSON.stringify(row).length;
      if (bytes > maxBytes) { truncated = true; break; }
      rows.push(row);
    }
    db.close();
    reply({ ok: true, columns, rows, truncated });
  } catch (e) {
    try { if (db) db.close(); } catch {}
    reply({ ok: false, error: String((e && e.message) || e) });
  }
});
`;

type ChildReply =
  | { ok: true; columns: string[]; rows: Row[]; truncated: boolean }
  | { ok: false; error: string };

export interface SqlRunResult {
  columns: string[];
  rows: Row[];
  truncated: boolean;
}

/** Run already-guarded SQL in a child process. Rejects with ToolError on SQL errors, timeout and abort. */
export function runSqlIsolated(
  sql: string,
  opts: { dbPath?: string; timeoutMs?: number; maxRows?: number; maxBytes?: number; signal?: AbortSignal } = {},
): Promise<SqlRunResult> {
  const { dbPath = resolveDbPath(), timeoutMs = SQL_TIMEOUT_MS, maxRows = SQL_ROW_LIMIT, maxBytes = SQL_MAX_BYTES, signal } = opts;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", CHILD_SOURCE], {
      cwd: process.cwd(),
      env: {} as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (child.exitCode === null) child.kill("SIGKILL");
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new ToolError(SQL_TIMEOUT_MESSAGE))), timeoutMs);
    const onAbort = () => finish(() => reject(new ToolError("Aborted.")));
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort);

    child.stdout.setEncoding("utf8").on("data", (c: string) => { out += c; });
    child.stderr.setEncoding("utf8").on("data", (c: string) => { err += c; });
    child.on("error", (e) => finish(() => reject(new ToolError(`SQL runner failed: ${e.message}`))));
    child.on("close", (code) =>
      finish(() => {
        let msg: ChildReply;
        try {
          msg = JSON.parse(out);
        } catch {
          return reject(new ToolError(`SQL runner exited (${code}): ${err.slice(0, 300)}`));
        }
        if (msg.ok) resolve({ columns: msg.columns, rows: msg.rows, truncated: msg.truncated });
        else reject(new ToolError(`SQL error: ${msg.error}`));
      }),
    );
    // EPIPE when the child dies or fails to spawn before reading stdin: 'error'/'close' above settle the promise.
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ dbPath, sql, maxRows, maxBytes }));
  });
}

const sqlSchema = z.strictObject({ sql: z.string().min(1) });

export const runReadonlySql = defineTool({
  name: "run_readonly_sql",
  description:
    "Fallback when no domain tool fits: one read-only SQLite SELECT over these views only: " +
    "ai_workers(worker_id, name, rank_id, rank_name, is_admin, is_exempt, receives_shift_allocation, is_archived, release_date, branch, team), " +
    "ai_shifts(shift_date_id, quarter_id, date, shift_type_id, shift_type_name, is_weekend, is_weekend_date), " +
    "ai_assignments(assignment_id, shift_date_id, quarter_id, date, shift_type_id, is_weekend, is_weekend_date, worker_id, role, is_forced, assigned_by, assigned_at), " +
    "ai_availability(worker_id, quarter_id, date, status, source), " +
    "ai_history(history_id, worker_id, quarter_id, shift_date_id, date, shift_type_id, was_weekend). " +
    "is_weekend / was_weekend count toward the weekend rule (GUARD shifts are 0); is_weekend_date is the raw calendar flag. " +
    "Booleans are 0/1, dates are 'YYYY-MM-DD' text. Give every output column a distinct name (AS). " +
    "Max 1000 rows, 3 s. No recursive CTEs.",
  schema: sqlSchema,
  async run({ sql }, { db, signal }) {
    const guarded = guardSql(sql, db);
    const res = await runSqlIsolated(guarded, { dbPath: db.name, signal });
    const out: QueryOutput = { columns: res.columns, rows: res.rows };
    if (res.truncated) out.note = "Result was truncated (row or size limit). Aggregate in SQL instead of listing rows.";
    return out;
  },
});
