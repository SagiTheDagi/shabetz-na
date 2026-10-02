/**
 * Justice chart: aggregation against an in-memory SQLite DB, plus the pure
 * filter. Run: npm test
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  buildChartData,
  filterJusticeEntries,
  getJusticePeriod,
  recomputeJusticeChart,
} from "./justice-chart";
import type { JusticeChartEntry } from "./types";

// Fixed "today"; window is 2025-06-15 .. 2026-06-15 inclusive.
const NOW = new Date(2026, 5, 15, 12, 0, 0);

let db: Database.Database;
let seq = 0;

/** Minimal mirror of the tables used by justice-chart.ts (see scripts/migrate.ts). */
function createSchema(d: Database.Database) {
  d.exec(`
    CREATE TABLE Rank (rank_id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE ShiftType (shift_type_id TEXT PRIMARY KEY, name TEXT NOT NULL, display_order INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE Worker (
      worker_id TEXT PRIMARY KEY, name TEXT NOT NULL, rank_id TEXT NOT NULL,
      is_exempt INTEGER NOT NULL DEFAULT 0,
      receives_shift_allocation INTEGER NOT NULL DEFAULT 1,
      is_archived INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE ShiftDate (shift_date_id TEXT PRIMARY KEY, date TEXT NOT NULL, shift_type_id TEXT NOT NULL);
    CREATE TABLE ShiftHistory (
      history_id TEXT PRIMARY KEY, worker_id TEXT NOT NULL,
      shift_date_id TEXT NOT NULL, was_weekend INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE JusticeChart (
      worker_id TEXT NOT NULL, shift_type_id TEXT NOT NULL,
      total_shifts INTEGER NOT NULL DEFAULT 0, weekend_shifts INTEGER NOT NULL DEFAULT 0,
      period_start TEXT NOT NULL, period_end TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (worker_id, shift_type_id)
    );
  `);
}

function addWorker(
  id: string,
  name: string,
  opts: { rank?: string; exempt?: number; allocation?: number; archived?: number } = {}
) {
  db.prepare("INSERT INTO Worker VALUES (?, ?, ?, ?, ?, ?)").run(
    id, name, opts.rank ?? "R1", opts.exempt ?? 0, opts.allocation ?? 1, opts.archived ?? 0
  );
}

function addShift(workerId: string, date: string, shiftType: string, weekend = 0) {
  const sd = `sd${++seq}`;
  db.prepare("INSERT INTO ShiftDate VALUES (?, ?, ?)").run(sd, date, shiftType);
  db.prepare("INSERT INTO ShiftHistory VALUES (?, ?, ?, ?)").run(`h${seq}`, workerId, sd, weekend);
}

beforeEach(() => {
  seq = 0;
  db = new Database(":memory:");
  createSchema(db);
  db.prepare("INSERT INTO Rank VALUES ('R1', 'סגן'), ('R2', 'סרן')").run();
  db.prepare("INSERT INTO ShiftType VALUES ('A', 'תורן', 1), ('B', 'שער', 2)").run();
});

describe("getJusticePeriod", () => {
  it("is the trailing year in local calendar dates", () => {
    assert.deepEqual(getJusticePeriod(NOW), { periodStart: "2025-06-15", periodEnd: "2026-06-15" });
  });

  it("does not shift the day just after local midnight (regression: toISOString)", () => {
    const justAfterMidnight = new Date(2026, 5, 15, 0, 30, 0);
    assert.equal(getJusticePeriod(justAfterMidnight).periodEnd, "2026-06-15");
  });
});

describe("recomputeJusticeChart: who is included", () => {
  it("excludes archived, exempt and non-allocation workers", () => {
    addWorker("1", "פעיל");
    addWorker("2", "ארכיון", { archived: 1 });
    addWorker("3", "פטור", { exempt: 1 });
    addWorker("4", "ללא הקצאה", { allocation: 0 });
    const { entries } = recomputeJusticeChart(db, NOW);
    assert.deepEqual(entries.map((e) => e.worker_id), ["1"]);
  });

  it("gives a zero row for every shift type to a worker with no history", () => {
    addWorker("1", "פעיל");
    const rows = db.prepare("SELECT shift_type_id, total_shifts FROM JusticeChart ORDER BY shift_type_id").all();
    assert.deepEqual(rows, []); // nothing before recompute
    recomputeJusticeChart(db, NOW);
    const after = db.prepare("SELECT shift_type_id, total_shifts FROM JusticeChart ORDER BY shift_type_id").all();
    assert.deepEqual(after, [
      { shift_type_id: "A", total_shifts: 0 },
      { shift_type_id: "B", total_shifts: 0 },
    ]);
  });
});

describe("recomputeJusticeChart: counting", () => {
  it("counts per shift type and sums weekend shifts", () => {
    addWorker("1", "אור");
    addShift("1", "2026-01-01", "A");
    addShift("1", "2026-01-02", "A", 1);
    addShift("1", "2026-01-03", "B", 1);
    const [e] = recomputeJusticeChart(db, NOW).entries;
    assert.deepEqual(e.shift_counts, { A: 2, B: 1 });
    assert.equal(e.total_shifts, 3);
    assert.equal(e.weekend_shifts, 2);
  });

  it("ignores history outside the window, includes both boundary days", () => {
    addWorker("1", "אור");
    addShift("1", "2025-06-14", "A"); // one day too old
    addShift("1", "2025-06-15", "A"); // start boundary, in
    addShift("1", "2026-06-15", "A"); // end boundary, in
    addShift("1", "2026-06-16", "A"); // future, out
    const [e] = recomputeJusticeChart(db, NOW).entries;
    assert.equal(e.total_shifts, 2);
  });

  it("does not count other workers' shifts", () => {
    addWorker("1", "אור");
    addWorker("2", "בן");
    addShift("2", "2026-01-01", "A");
    const entries = recomputeJusticeChart(db, NOW).entries;
    assert.equal(entries.find((e) => e.worker_id === "1")!.total_shifts, 0);
    assert.equal(entries.find((e) => e.worker_id === "2")!.total_shifts, 1);
  });

  it("stores the period on every row", () => {
    addWorker("1", "אור");
    const [e] = recomputeJusticeChart(db, NOW).entries;
    assert.equal(e.period_start, "2025-06-15");
    assert.equal(e.period_end, "2026-06-15");
  });

  it("replaces the previous snapshot instead of accumulating", () => {
    addWorker("1", "אור");
    addShift("1", "2026-01-01", "A");
    recomputeJusticeChart(db, NOW);
    recomputeJusticeChart(db, NOW);
    assert.deepEqual(db.prepare("SELECT COUNT(*) AS n FROM JusticeChart").get(), { n: 2 });
    assert.equal(buildChartData(db).entries[0].total_shifts, 1);
  });

  it("drops workers that became ineligible since the last snapshot", () => {
    addWorker("1", "אור");
    addWorker("2", "בן");
    assert.equal(recomputeJusticeChart(db, NOW).entries.length, 2);
    db.prepare("UPDATE Worker SET is_archived = 1 WHERE worker_id = '2'").run();
    assert.deepEqual(recomputeJusticeChart(db, NOW).entries.map((e) => e.worker_id), ["1"]);
  });
});

describe("buildChartData", () => {
  it("returns shift types in display order", () => {
    db.prepare("UPDATE ShiftType SET display_order = 9 WHERE shift_type_id = 'A'").run();
    assert.deepEqual(buildChartData(db).shift_types.map((s) => s.shift_type_id), ["B", "A"]);
  });

  it("sorts by total desc, then name (Hebrew collation)", () => {
    addWorker("1", "בן");
    addWorker("2", "אור");
    addWorker("3", "גל");
    addShift("3", "2026-01-01", "A");
    addShift("3", "2026-01-02", "A");
    addShift("1", "2026-01-03", "A");
    addShift("2", "2026-01-04", "A");
    const { entries } = recomputeJusticeChart(db, NOW);
    assert.deepEqual(entries.map((e) => e.name), ["גל", "אור", "בן"]);
  });

  it("includes rank name", () => {
    addWorker("1", "אור", { rank: "R2" });
    assert.equal(recomputeJusticeChart(db, NOW).entries[0].rank_name, "סרן");
  });

  it("is empty before any recompute", () => {
    addWorker("1", "אור");
    assert.deepEqual(buildChartData(db).entries, []);
  });
});

describe("filterJusticeEntries", () => {
  const mk = (name: string, rank_name: string, total_shifts: number): JusticeChartEntry => ({
    worker_id: name, name, rank_name, total_shifts, weekend_shifts: 0,
    shift_counts: {}, period_start: "", period_end: "", updated_at: "",
  });
  const entries = [mk("Alice Cohen", "סגן", 5), mk("bob levi", "סרן", 2), mk("אור כהן", "סגן", 0)];
  const names = (r: JusticeChartEntry[]) => r.map((e) => e.name);

  it("returns everything with no filters", () => {
    assert.equal(filterJusticeEntries(entries, {}).length, 3);
  });

  it("matches name case-insensitively as a substring, trimmed", () => {
    assert.deepEqual(names(filterJusticeEntries(entries, { name: "  ALICE " })), ["Alice Cohen"]);
    assert.deepEqual(names(filterJusticeEntries(entries, { name: "כהן" })), ["אור כהן"]);
  });

  it("returns nothing for a non-matching name", () => {
    assert.deepEqual(filterJusticeEntries(entries, { name: "zzzzqq" }), []);
  });

  it("matches any selected rank", () => {
    assert.deepEqual(names(filterJusticeEntries(entries, { ranks: ["סרן"] })), ["bob levi"]);
    assert.equal(filterJusticeEntries(entries, { ranks: ["סרן", "סגן"] }).length, 3);
  });

  it("applies minTotal inclusively", () => {
    assert.deepEqual(names(filterJusticeEntries(entries, { minTotal: 2 })), ["Alice Cohen", "bob levi"]);
  });

  it("ANDs all filters", () => {
    assert.deepEqual(names(filterJusticeEntries(entries, { name: "co", ranks: ["סגן"], minTotal: 1 })), ["Alice Cohen"]);
  });

  it("does not mutate the input", () => {
    filterJusticeEntries(entries, { minTotal: 99 });
    assert.equal(entries.length, 3);
  });
});
