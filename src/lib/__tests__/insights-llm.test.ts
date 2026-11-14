/**
 * Insights LLM-loop building blocks (no network): pricing, budget
 * reservations, SQL guard and the worker-thread SQL runner.
 */
import { resetTestDb } from "./test-db";
import { describe, it, beforeEach, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { applyInsightsSchema } from "../insights/views";
import { computeCost, estimateCost, estimateTextTokens, PRICE_TIERS } from "../insights/pricing";
import { Budget, currentMonth } from "../insights/budget";
import { guardSql, tokenize } from "../insights/sql-guard";
import { runSqlIsolated, runReadonlySql, SQL_TIMEOUT_MESSAGE } from "../insights/sql-runner";
import { ToolError } from "../insights/errors";
import { ResultStore } from "../insights/result-store";
import { executeQueryTool } from "../insights/tools";
import { openReadonlyDb } from "../insights/readonly-db";

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);

describe("pricing", () => {
  it("standard tier", () => {
    close(computeCost({ input_tokens: 10_000, output_tokens: 1_000 }), 10_000 * 0.1e-6 + 1_000 * 0.5e-6);
  });
  it("cache write ×1.25, cache read ×0.1", () => {
    close(
      computeCost({ input_tokens: 0, cache_creation_input_tokens: 4_000, cache_read_input_tokens: 20_000, output_tokens: 0 }),
      4_000 * 0.1e-6 * 1.25 + 20_000 * 0.1e-6 * 0.1,
    );
  });
  it("switches to the long tier above 100K total input", () => {
    const atLimit = computeCost({ input_tokens: 50_000, cache_read_input_tokens: 50_000, output_tokens: 100 });
    close(atLimit, 50_000 * 0.1e-6 + 50_000 * 0.1e-6 * 0.1 + 100 * 0.5e-6);
    const over = computeCost({ input_tokens: 50_001, cache_read_input_tokens: 50_000, output_tokens: 100 });
    close(over, 50_001 * PRICE_TIERS.long.input + 50_000 * PRICE_TIERS.long.input * 0.1 + 100 * PRICE_TIERS.long.output);
  });
  it("estimate = input tokens + max_tokens output", () => {
    close(estimateCost(1_000, 4096), 1_000 * 0.1e-6 + 4096 * 0.5e-6);
  });
  it("token estimate: ASCII at 3 chars/token, Hebrew a token per char", () => {
    assert.equal(estimateTextTokens("abcdef"), 2);
    assert.equal(estimateTextTokens("שלום"), 4);
    assert.equal(estimateTextTokens("ab שלום"), 5); // "ab " → 1, 4 Hebrew chars → 4
  });
});

describe("budget reservations", () => {
  let db: Database.Database;
  const now = () => new Date(2026, 10, 14);
  beforeEach(() => {
    db = resetTestDb();
    applyInsightsSchema(db);
  });

  it("two parallel reservations near the cap: only one goes through", () => {
    db.prepare("INSERT INTO InsightUsage (month, cost_usd) VALUES (?, ?)").run("2026-11", 4.99);
    const b = new Budget(db, 5, now);
    const a = b.reserve(0.006);
    const c = b.reserve(0.006);
    assert.equal(a.ok, true);
    assert.equal(c.ok, false);
  });

  it("settle releases pending and upserts actual usage; double settle is a no-op", () => {
    const b = new Budget(db, 5, now);
    const r = b.reserve(0.01);
    assert.ok(r.ok);
    close(b.pending, 0.01);
    const cost = b.settle(r.reservation, { input_tokens: 1000, output_tokens: 200 });
    assert.equal(b.pending, 0);
    close(b.monthCost("2026-11"), cost);
    assert.equal(b.settle(r.reservation, { input_tokens: 1000, output_tokens: 200 }), 0);
    const r2 = b.reserve(0.01);
    assert.ok(r2.ok);
    b.settle(r2.reservation, { input_tokens: 500, cache_read_input_tokens: 100, output_tokens: 10 });
    const row = db.prepare("SELECT * FROM InsightUsage WHERE month='2026-11'").get() as Record<string, number>;
    assert.equal(row.input_tokens, 1500);
    assert.equal(row.cache_read_tokens, 100);
    assert.equal(row.output_tokens, 210);
  });

  it("settling after an abort still records the tokens used", () => {
    const b = new Budget(db, 5, now);
    const r = b.reserve(0.01);
    assert.ok(r.ok);
    // stream aborted mid-way: partial usage is what the SDK reported so far
    b.settle(r.reservation, { input_tokens: 2000, output_tokens: 37 });
    assert.ok(b.monthCost("2026-11") > 0);
    assert.equal(b.pending, 0);
  });

  it("currentMonth pads", () => {
    assert.equal(currentMonth(new Date(2026, 0, 5)), "2026-01");
  });
});

describe("SQL guard", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = resetTestDb();
    applyInsightsSchema(db);
  });
  const rejects = (sql: string, re?: RegExp) =>
    assert.throws(() => guardSql(sql, db), (e: unknown) => e instanceof ToolError && (!re || re.test((e as Error).message)), sql);

  it("rejects writes, multiple statements, recursion, base tables and internals", () => {
    rejects("DELETE FROM ai_workers");
    rejects("SELECT 1 FROM ai_workers; DELETE FROM Worker");
    rejects("SELECT 1; SELECT 2");
    rejects("WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT x FROM c", /RECURSIVE/);
    rejects("SELECT * FROM Worker", /not accessible/);
    rejects('SELECT password_hash FROM "Worker"', /not accessible/);
    rejects("SELECT * FROM [worker]", /not accessible/);
    rejects("SELECT * FROM sqlite_master");
    rejects("SELECT * FROM pragma_table_info('ai_workers')");
    rejects("PRAGMA table_info(ai_workers)");
    rejects("SELECT load_extension('x')");
    rejects("SELECT * FROM ai_nope", /SQL error/);
    rejects("   ");
    rejects(" ; ");
  });

  it("rejects self-referencing CTEs without RECURSIVE, and huge blobs", () => {
    rejects("WITH c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT count(*) FROM c", /Recursive CTE "c"/);
    rejects("WITH a AS (SELECT 1 AS x), c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT count(*) FROM c", /Recursive CTE "c"/);
    rejects("SELECT * FROM ai_workers WHERE worker_id IN (WITH c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM \"C\") SELECT x FROM c)", /Recursive/);
    rejects("SELECT length(randomblob(1000000000))", /randomblob/);
    rejects("SELECT length(zeroblob(1000000000))", /zeroblob/);
    rejects('SELECT length("randomblob"(2000000000)) FROM ai_workers', /randomblob/);
    rejects("SELECT length([zeroblob](5))", /zeroblob/);
    rejects("SELECT `load_extension`('x')", /load_extension/);
  });

  it("table-named functions and aliases are fine; table position is not", () => {
    const ok = (sql: string) => assert.doesNotThrow(() => db.prepare(guardSql(sql, db)).all(), sql);
    ok("SELECT worker_id, RANK() OVER (ORDER BY name) FROM ai_workers");
    ok("SELECT worker_id, rank() OVER (ORDER BY name) AS rank FROM ai_workers ORDER BY rank");
    rejects("SELECT 1 AS worker FROM ai_workers, worker", /base table/);
    rejects("SELECT 1 AS worker FROM ai_workers JOIN worker", /base table/);
    rejects("SELECT 1 AS worker FROM (worker)", /base table/);
    rejects("SELECT 1 AS worker FROM main.worker", /base table/);
    rejects("SELECT 1 AS worker FROM ai_workers WHERE worker_id IN worker", /base table/);
  });

  it("single-quoted table names are table names to SQLite", () => {
    rejects("SELECT * FROM 'Worker'", /base table/);
    rejects("SELECT * FROM ai_workers JOIN 'worker'", /base table/);
    rejects("SELECT * FROM ai_workers, 'Worker'", /base table/);
    rejects("SELECT * FROM ('Worker')", /base table/);
    rejects("SELECT * FROM main.'Worker'", /base table/);
    rejects("SELECT * FROM 'sqlite_master'", /base table/);
    rejects("SELECT 1 FROM ai_workers WHERE worker_id IN 'Worker'", /base table/);
    // Ordinary string values stay fine.
    assert.doesNotThrow(() => db.prepare(guardSql("SELECT * FROM ai_workers WHERE name IN ('אבי', 'worker x')", db)).all());
  });

  it("trailing comments and semicolons don't break the wrapper", () => {
    for (const sql of [
      "SELECT worker_id, COUNT(*) FROM ai_assignments GROUP BY worker_id -- per worker",
      "SELECT 1; -- x",
      "SELECT 1 /* note */ ;;",
      "SELECT 1 -- a\n-- b\n",
    ]) {
      assert.doesNotThrow(() => db.prepare(guardSql(sql, db)).all(), sql);
    }
  });

  it("accepts a valid query against ai_shifts and wraps it in a LIMIT", () => {
    const sql = guardSql("SELECT quarter_id, COUNT(*) AS n FROM ai_shifts GROUP BY quarter_id;", db);
    assert.equal(sql, "SELECT * FROM (\nSELECT quarter_id, COUNT(*) AS n FROM ai_shifts GROUP BY quarter_id\n) LIMIT 1001");
    assert.doesNotThrow(() => db.prepare(sql).all());
  });

  it("table names inside strings and comments are ignored", () => {
    assert.doesNotThrow(() => guardSql("SELECT 'Worker' AS t FROM ai_workers -- Worker", db));
    assert.deepEqual(tokenize("a 'it''s' \"Q\"").map((t) => t.text), ["a", "'str'", "q"]);
  });

  it("non-recursive CTEs are fine", () => {
    assert.doesNotThrow(() => guardSql("WITH x AS (SELECT worker_id FROM ai_workers) SELECT COUNT(*) FROM x", db));
  });
});

describe("SQL runner (child process)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "insights-sql-"));
  const file = path.join(dir, "db.sqlite");
  before(() => {
    process.env.DATABASE_PATH = ":memory:"; // keep getDb() off the file
    const w = new Database(file);
    w.exec(`
      CREATE TABLE Rank (rank_id TEXT PRIMARY KEY, name TEXT NOT NULL, display_order INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE ShiftType (shift_type_id TEXT PRIMARY KEY, name TEXT NOT NULL, display_order INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE Worker (worker_id TEXT PRIMARY KEY, name TEXT NOT NULL, rank_id TEXT NOT NULL, is_admin INTEGER DEFAULT 0,
        password_hash TEXT, is_exempt INTEGER DEFAULT 0, receives_shift_allocation INTEGER DEFAULT 1,
        is_archived INTEGER DEFAULT 0, release_date TEXT, branch TEXT, team TEXT);
      CREATE TABLE ShiftDate (shift_date_id TEXT PRIMARY KEY, quarter_id TEXT, date TEXT, shift_type_id TEXT, is_weekend INTEGER);
      CREATE TABLE ShiftAssignment (assignment_id TEXT, shift_date_id TEXT, worker_id TEXT, role TEXT, is_forced INTEGER,
        assigned_by TEXT, assigned_at TEXT);
      CREATE TABLE WorkerAvailability (worker_id TEXT, quarter_id TEXT, date TEXT, status TEXT, source TEXT);
      CREATE TABLE ShiftHistory (history_id TEXT, worker_id TEXT, quarter_id TEXT, shift_date_id TEXT, was_weekend INTEGER);
      CREATE TABLE Quarter (quarter_id TEXT);
      INSERT INTO Rank VALUES ('R1', 'r', 1);
    `);
    applyInsightsSchema(w);
    const ins = w.prepare("INSERT INTO Worker (worker_id, name, rank_id) VALUES (?, ?, 'R1')");
    w.transaction(() => { for (let i = 0; i < 1500; i++) ins.run(String(i), `w${i}`); })();
    w.close();
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("returns rows; the guard's wrapper keeps duplicate column names distinct", async () => {
    const ro = openReadonlyDb(file);
    const sql = guardSql("SELECT a.name, b.name FROM ai_workers a JOIN ai_workers b ON a.worker_id = b.worker_id WHERE a.worker_id = '7'", ro);
    ro.close();
    const res = await runSqlIsolated(sql, { dbPath: file });
    assert.deepEqual(res.columns, ["name", "name:1"]);
    assert.deepEqual(res.rows, [{ name: "w7", "name:1": "w7" }]);
    assert.equal(res.truncated, false);
  });

  it("stops at the row limit and flags truncation", async () => {
    const ro = openReadonlyDb(file);
    const res = await runSqlIsolated(guardSql("SELECT worker_id FROM ai_workers", ro), { dbPath: file });
    ro.close();
    assert.equal(res.rows.length, 1000);
    assert.equal(res.truncated, true);
  });

  it("stops at the byte limit", async () => {
    const res = await runSqlIsolated("SELECT worker_id, name FROM ai_workers", { dbPath: file, maxBytes: 1000 });
    assert.ok(res.rows.length < 100);
    assert.equal(res.truncated, true);
  });

  it("times out a slow query and kills the child", async () => {
    const t0 = Date.now();
    await assert.rejects(
      runSqlIsolated("SELECT COUNT(*) FROM ai_workers a, ai_workers b, ai_workers c", { dbPath: file, timeoutMs: 300 }),
      (e: unknown) => e instanceof ToolError && (e as Error).message === SQL_TIMEOUT_MESSAGE,
    );
    assert.ok(Date.now() - t0 < 2000);
  });

  it("the read-only connection refuses writes even if handed one", async () => {
    await assert.rejects(runSqlIsolated("DELETE FROM Worker", { dbPath: file }), ToolError);
  });

  it("run_readonly_sql tool stores the result", async () => {
    const ro = openReadonlyDb(file);
    const store = new ResultStore();
    const res = await executeQueryTool(runReadonlySql, { sql: "SELECT COUNT(*) AS n FROM ai_workers" }, { db: ro, store });
    assert.deepEqual(res.preview, [{ n: 1500 }]);
    assert.deepEqual(store.get(res.result_id)!.source, { tool: "run_readonly_sql", args: { sql: "SELECT COUNT(*) AS n FROM ai_workers" } });
    await assert.rejects(executeQueryTool(runReadonlySql, { sql: "SELECT * FROM Worker" }, { db: ro, store }), ToolError);
    ro.close();
  });
});
