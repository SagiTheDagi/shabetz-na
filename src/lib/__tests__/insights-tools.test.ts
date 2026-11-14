/**
 * Insights foundation: read-only connection, ai_* view column allowlist,
 * ResultStore, and the domain query tools against a known seed.
 */
import { resetTestDb } from "./test-db";
import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { z } from "zod";
import { openReadonlyDb } from "../insights/readonly-db";
import { applyInsightsSchema, ensureInsightsSchema, AI_VIEW_NAMES, AI_VIEW_COLUMN_ALLOWLIST } from "../insights/views";
import { ResultStore } from "../insights/result-store";
import {
  executeQueryTool, ToolError, listReference, shiftsPerWorker, weekendShiftsPerWorker,
  quarterCoverage, availabilitySummary, workerHistory, justiceChart, toAnthropicTool, DOMAIN_TOOLS,
  type QueryTool, type ToolCtx,
} from "../insights/tools";

let db: Database.Database;
let store: ResultStore;
let ctx: ToolCtx;

function seed(d: Database.Database) {
  d.exec(`
    INSERT INTO Rank VALUES ('R1','דרגה 1',1,datetime('now')),('R2','דרגה 2',2,datetime('now'));
    INSERT INTO ShiftType VALUES ('OFFICER','קצין',1,datetime('now')),('GUARD','שמירה',2,datetime('now'));
    INSERT INTO Worker (worker_id,name,rank_id,password_hash) VALUES
      ('1','אבי','R1','secret-hash'),('2','בני','R1',NULL),('3','גדי','R2',NULL);
    INSERT INTO Worker (worker_id,name,rank_id,is_archived) VALUES ('4','דני','R2',1);
    INSERT INTO Quarter (quarter_id,start_date,end_date,status) VALUES
      ('2026-Q1','2026-01-01','2026-03-31','published'),('2025-Q4','2025-10-01','2025-12-31','published');
    INSERT INTO ShiftDate VALUES
      ('s1','2026-Q1','2026-01-08','OFFICER',1),
      ('s2','2026-Q1','2026-01-12','OFFICER',0),
      ('s3','2026-Q1','2026-01-15','GUARD',1),
      ('s4','2025-Q4','2025-11-06','OFFICER',1);
    INSERT INTO ShiftAssignment (assignment_id,shift_date_id,worker_id,assigned_by,role) VALUES
      ('a1','s1','1','1','shift'),('a2','s1','2','1','reserve'),
      ('a3','s2','1','1','shift'),
      ('a4','s3','3','1','shift'),
      ('a5','s4','2','1','shift');
    INSERT INTO ShiftHistory VALUES
      ('h1','1','2026-Q1','s1',1),('h2','1','2026-Q1','s2',0),('h3','3','2026-Q1','s3',0),('h4','2','2025-Q4','s4',1);
    INSERT INTO WorkerAvailability (availability_id,worker_id,quarter_id,date,status) VALUES
      ('v1','1','2026-Q1','2026-01-08','prefer_work'),
      ('v2','2','2026-Q1','2026-01-08','unavailable'),
      ('v3','2','2026-Q1','2026-01-12','unavailable'),
      ('v4','3','2026-Q1','2026-01-12','prefer_not_work');
    INSERT INTO JusticeChart VALUES
      ('1','OFFICER',2,1,'2025-11-14','2026-11-14','2026-11-14 10:00:00'),
      ('1','GUARD',0,0,'2025-11-14','2026-11-14','2026-11-14 10:00:00'),
      ('3','GUARD',1,0,'2025-11-14','2026-11-14','2026-11-14 10:00:00');
  `);
}

beforeEach(() => {
  db = resetTestDb();
  applyInsightsSchema(db);
  seed(db);
  store = new ResultStore();
  ctx = { db, store };
});

const run = (tool: QueryTool, args: unknown) => executeQueryTool(tool as QueryTool, args, ctx);
const rowsOf = async (tool: QueryTool, args: unknown) => store.get((await run(tool, args)).result_id)!.rows;

// --- T1.1 read-only connection ----------------------------------------------

describe("read-only connection", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "insights-ro-"));
  const file = path.join(dir, "ro.db");
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("rejects INSERT and UPDATE", () => {
    const w = new Database(file);
    w.exec("CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (1);");
    w.close();
    const ro = openReadonlyDb(file);
    assert.equal((ro.prepare("SELECT x FROM t").get() as { x: number }).x, 1);
    assert.throws(() => ro.prepare("INSERT INTO t VALUES (2)").run());
    assert.throws(() => ro.prepare("UPDATE t SET x = 3").run());
    assert.throws(() => ro.exec("CREATE TABLE u (y)"));
    assert.equal(ro.pragma("query_only", { simple: true }), 1);
    ro.close();
  });
});

// --- T1.4 view security ------------------------------------------------------

describe("ai_* views", () => {
  it("expose only allowlisted columns, never password_hash", () => {
    const views = (db.prepare("SELECT name FROM sqlite_master WHERE type='view' AND name LIKE 'ai\\_%' ESCAPE '\\'").all() as { name: string }[])
      .map((v) => v.name).sort();
    assert.deepEqual(views, [...AI_VIEW_NAMES].sort());
    for (const v of views) {
      const cols = (db.prepare(`PRAGMA table_info(${v})`).all() as { name: string }[]).map((c) => c.name);
      assert.ok(cols.length > 0, v);
      for (const c of cols) {
        assert.notEqual(c, "password_hash", v);
        assert.ok(AI_VIEW_COLUMN_ALLOWLIST[v]?.includes(c), `${v}.${c} not in allowlist`);
      }
    }
  });
  it("is_weekend follows the weekend rule (GUARD = 0); is_weekend_date keeps the calendar flag", () => {
    const guard = db.prepare("SELECT is_weekend, is_weekend_date FROM ai_assignments WHERE shift_date_id = 's3'").get();
    assert.deepEqual({ ...(guard as object) }, { is_weekend: 0, is_weekend_date: 1 });
    const officer = db.prepare("SELECT is_weekend, is_weekend_date FROM ai_shifts WHERE shift_date_id = 's1'").get();
    assert.deepEqual({ ...(officer as object) }, { is_weekend: 1, is_weekend_date: 1 });
  });

  it("deleting a worker who saved a view keeps the view (created_by → NULL)", () => {
    db.prepare("INSERT INTO SavedInsight (insight_id,title,question,spec_json,source_json,schema_version,created_by) VALUES ('v','t','q','{}','{}',1,'4')").run();
    db.prepare("DELETE FROM Worker WHERE worker_id = '4'").run();
    assert.equal(db.prepare("SELECT created_by FROM SavedInsight WHERE insight_id = 'v'").pluck().get(), null);
  });

  it("ensureInsightsSchema applies the schema to the app DB once", () => {
    db.exec("DROP VIEW ai_workers");
    (globalThis as { __insightsSchemaApplied?: boolean }).__insightsSchemaApplied = false;
    ensureInsightsSchema();
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'ai_workers'").get());
    // Later calls only re-apply when something is missing (e.g. a DB restored from an old backup).
    db.exec("DROP TABLE InsightUsage");
    ensureInsightsSchema();
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'InsightUsage'").get());
  });

  it("can be applied twice", () => {
    applyInsightsSchema(db);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM ai_assignments").get() as { n: number }).n, 5);
  });
});

// --- T1.5 ResultStore ----------------------------------------------------------

describe("ResultStore", () => {
  const entry = { source: { tool: "t", args: {} }, columns: ["a"], rows: [{ a: 1 }] };

  it("expires entries after the TTL", () => {
    let t = 0;
    const s = new ResultStore(() => t, 1000);
    const id = s.put(entry);
    t = 1000;
    assert.ok(s.get(id));
    t = 2001;
    assert.equal(s.get(id), null);
  });
  it("evicts the least recently used entry past the cap; get() refreshes recency", () => {
    const s = new ResultStore(Date.now, 60_000, 200);
    const ids = Array.from({ length: 200 }, () => s.put(entry));
    s.get(ids[0]); // ids[1] is now the least recently used
    s.put(entry);
    assert.equal(s.size, 200);
    assert.ok(s.get(ids[0]));
    assert.equal(s.get(ids[1]), null);
  });
  it("unknown id returns null", () => {
    assert.equal(new ResultStore().get("nope"), null);
  });
  it("ids are full UUIDs and scoped to their owner", () => {
    const s = new ResultStore();
    const id = s.put(entry, "admin-a");
    assert.match(id, /^r_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal(s.get(id, "admin-b"), null);
    assert.equal(s.get(id), null);
    assert.ok(s.get(id, "admin-a"));
  });
});

// --- T1.6 / T1.7 domain tools --------------------------------------------------

describe("domain tools", () => {
  it("schema stripping keeps argument names that look like keywords", () => {
    const def = toAnthropicTool({
      name: "t", description: "d",
      schema: z.strictObject({ maximum: z.number().max(5), maxLength: z.string().min(1) }),
    });
    const props = (def.input_schema as { properties: Record<string, Record<string, unknown>> }).properties;
    assert.deepEqual(Object.keys(props), ["maximum", "maxLength"]);
    assert.equal(props.maximum.maximum, undefined);
    assert.equal(props.maxLength.minLength, undefined);
    assert.deepEqual(def.input_schema.required, ["maximum", "maxLength"]);
  });

  it("every tool converts to a strict Anthropic tool without $schema", () => {
    for (const t of DOMAIN_TOOLS) {
      const def = toAnthropicTool(t);
      assert.equal(def.strict, true);
      assert.equal(def.input_schema.type, "object");
      assert.equal((def.input_schema as Record<string, unknown>).additionalProperties, false, t.name);
      assert.equal((def.input_schema as Record<string, unknown>).$schema, undefined);
    }
  });

  it("result shape: result_id, columns, row_count, preview ≤ 20", async () => {
    const res = await run(listReference, { kind: "workers" });
    assert.match(res.result_id, /^r_/);
    assert.deepEqual(res.columns, ["worker_id", "name", "rank_name", "is_exempt", "is_archived"]);
    assert.equal(res.row_count, 4);
    assert.equal(res.preview.length, 4);
    assert.deepEqual(store.get(res.result_id)!.source, { tool: "list_reference", args: { kind: "workers" } });
  });

  it("invalid args become a ToolError", async () => {
    await assert.rejects(run(listReference, { kind: "nope" }), ToolError);
    await assert.rejects(run(listReference, { kind: "ranks", extra: 1 }), ToolError);
    await assert.rejects(run(weekendShiftsPerWorker, { year: "2026" }), ToolError);
  });

  it("list_reference: ranks, shift types, quarters", async () => {
    assert.deepEqual((await rowsOf(listReference, { kind: "ranks" })).map((r) => r.rank_id), ["R1", "R2"]);
    assert.deepEqual((await rowsOf(listReference, { kind: "shift_types" })).map((r) => r.shift_type_id), ["OFFICER", "GUARD"]);
    assert.deepEqual((await rowsOf(listReference, { kind: "quarters" })).map((r) => r.quarter_id), ["2025-Q4", "2026-Q1"]);
  });

  it("shifts_per_worker: primary shifts in a quarter, zeros included, archived excluded", async () => {
    const rows = await rowsOf(shiftsPerWorker, { quarter_id: "2026-Q1" });
    assert.deepEqual(rows, [
      { worker_id: "1", name: "אבי", rank_name: "דרגה 1", shifts: 2, weekend_shifts: 1 },
      { worker_id: "3", name: "גדי", rank_name: "דרגה 2", shifts: 1, weekend_shifts: 0 }, // GUARD weekend doesn't count
      { worker_id: "2", name: "בני", rank_name: "דרגה 1", shifts: 0, weekend_shifts: 0 },
    ]);
  });

  it("shifts_per_worker: weekend_shifts never counts reserves, whatever the role filter", async () => {
    // worker 2 is reserve on s1 (OFFICER weekend)
    const any = await rowsOf(shiftsPerWorker, { quarter_id: "2026-Q1", role: "any" });
    assert.deepEqual(any.find((r) => r.worker_id === "2"), { worker_id: "2", name: "בני", rank_name: "דרגה 1", shifts: 1, weekend_shifts: 0 });
    const reserve = await rowsOf(shiftsPerWorker, { quarter_id: "2026-Q1", role: "reserve" });
    assert.equal(reserve.find((r) => r.worker_id === "2")!.weekend_shifts, 0);
  });

  it("shifts_per_worker: role, shift type and date filters", async () => {
    const reserve = await rowsOf(shiftsPerWorker, { quarter_id: "2026-Q1", role: "reserve" });
    assert.equal(reserve.find((r) => r.worker_id === "2")!.shifts, 1);
    const any = await rowsOf(shiftsPerWorker, { role: "any" });
    assert.equal(any.find((r) => r.worker_id === "2")!.shifts, 2);
    const officer = await rowsOf(shiftsPerWorker, { shift_type_id: "OFFICER" });
    assert.equal(officer.find((r) => r.worker_id === "3")!.shifts, 0);
    const range = await rowsOf(shiftsPerWorker, { from: "2026-01-10", to: "2026-01-31" });
    assert.equal(range.find((r) => r.worker_id === "1")!.shifts, 1);
  });

  it("weekend_shifts_per_worker: counts history weekends in the year", async () => {
    const y26 = await rowsOf(weekendShiftsPerWorker, { year: 2026 });
    assert.deepEqual(y26.map((r) => [r.worker_id, r.weekend_shifts]), [["1", 1], ["2", 0], ["3", 0]]);
    const y25 = await rowsOf(weekendShiftsPerWorker, { year: 2025 });
    assert.equal(y25.find((r) => r.worker_id === "2")!.weekend_shifts, 1);
  });

  it("weekend_shifts_per_worker: the year comes from the quarter, like the weekend rule", async () => {
    // a 2025-Q4 quarter whose shift falls on 2026-01-01
    db.exec(`INSERT INTO ShiftDate VALUES ('s5','2025-Q4','2026-01-01','OFFICER',1);
             INSERT INTO ShiftHistory VALUES ('h5','3','2025-Q4','s5',1);`);
    assert.equal((await rowsOf(weekendShiftsPerWorker, { year: 2025 })).find((r) => r.worker_id === "3")!.weekend_shifts, 1);
    assert.equal((await rowsOf(weekendShiftsPerWorker, { year: 2026 })).find((r) => r.worker_id === "3")!.weekend_shifts, 0);
  });

  it("weekend_shifts_per_worker: counts primaries without history (JSON import), once", async () => {
    // imported weekend primary for worker 3, no history row; reserve and GUARD imports don't count
    db.exec(`INSERT INTO ShiftDate VALUES ('s6','2026-Q1','2026-02-05','OFFICER',1),('s7','2026-Q1','2026-02-12','GUARD',1);
             INSERT INTO ShiftAssignment (assignment_id,shift_date_id,worker_id,assigned_by,role) VALUES
               ('a6','s6','3','1','shift'),('a7','s6','2','1','reserve'),('a8','s7','2','1','shift');`);
    const y26 = await rowsOf(weekendShiftsPerWorker, { year: 2026 });
    // worker 1: a1 has history h1 -> counted once
    assert.deepEqual(y26.map((r) => [r.worker_id, r.weekend_shifts]), [["1", 1], ["3", 1], ["2", 0]]);
  });

  it("quarter_coverage: status per date", async () => {
    const rows = await rowsOf(quarterCoverage, { quarter_id: "2026-Q1" });
    assert.deepEqual(rows.map((r) => r.is_weekend), [1, 0, 0]); // s3 is a GUARD weekend
    assert.deepEqual(rows.map((r) => [r.date, r.status, r.shift_worker_name, r.reserve_worker_name]), [
      ["2026-01-08", "assigned", "אבי", "בני"],
      ["2026-01-12", "reserve_missing", "אבי", null],
      ["2026-01-15", "reserve_missing", "גדי", null],
    ]);
    await assert.rejects(run(quarterCoverage, { quarter_id: "2030-Q1" }), ToolError);
  });

  it("availability_summary: by rank, worker and date", async () => {
    const byRank = await rowsOf(availabilitySummary, { quarter_id: "2026-Q1", group_by: "rank" });
    assert.deepEqual(byRank, [
      { rank_id: "R1", rank_name: "דרגה 1", unavailable: 2, prefer_not_work: 0, prefer_work: 1 },
      { rank_id: "R2", rank_name: "דרגה 2", unavailable: 0, prefer_not_work: 1, prefer_work: 0 },
    ]);
    const byWorker = await rowsOf(availabilitySummary, { quarter_id: "2026-Q1", group_by: "worker" });
    assert.equal(byWorker[0].worker_id, "2");
    assert.equal(byWorker[0].unavailable, 2);
    const byDate = await rowsOf(availabilitySummary, { quarter_id: "2026-Q1", group_by: "date" });
    assert.deepEqual(byDate.map((r) => [r.date, r.unavailable, r.prefer_work]), [["2026-01-08", 1, 1], ["2026-01-12", 1, 0]]);
  });

  it("worker_history: newest first; unknown worker errors", async () => {
    const rows = await rowsOf(workerHistory, { worker_id: "1" });
    assert.deepEqual(rows.map((r) => [r.date, r.shift_type_name, r.was_weekend]), [
      ["2026-01-12", "קצין", 0],
      ["2026-01-08", "קצין", 1],
    ]);
    await assert.rejects(run(workerHistory, { worker_id: "999" }), ToolError);
  });

  it("justice_chart: reads the stored chart, filters by rank, never writes", async () => {
    const before = db.prepare("SELECT * FROM JusticeChart ORDER BY worker_id, shift_type_id").all();
    const res = await run(justiceChart, {});
    assert.deepEqual(res.columns, ["worker_id", "name", "rank_name", "total_shifts", "weekend_shifts", "st_OFFICER", "st_GUARD"]);
    const rows = store.get(res.result_id)!.rows;
    assert.deepEqual(rows[0], { worker_id: "1", name: "אבי", rank_name: "דרגה 1", total_shifts: 2, weekend_shifts: 1, st_OFFICER: 2, st_GUARD: 0 });
    assert.match(res.note!, /last recomputed 2026-11-14 10:00:00/);
    const r2 = await rowsOf(justiceChart, { rank_ids: ["R2"] });
    assert.deepEqual(r2.map((r) => r.worker_id), ["3"]);
    // a second rank with the same display name must not merge into R2
    db.exec(`INSERT INTO Rank VALUES ('R3','דרגה 2',3,datetime('now'));
             UPDATE Worker SET rank_id = 'R3' WHERE worker_id = '1';`);
    assert.deepEqual((await rowsOf(justiceChart, { rank_ids: ["R2"] })).map((r) => r.worker_id), ["3"]);
    assert.deepEqual((await rowsOf(justiceChart, { rank_ids: ["R3"] })).map((r) => r.worker_id), ["1"]);
    await assert.rejects(run(justiceChart, { rank_ids: ["NOPE"] }), /Unknown rank_id\(s\): NOPE/);
    assert.deepEqual(db.prepare("SELECT * FROM JusticeChart ORDER BY worker_id, shift_type_id").all(), before);
  });
});

