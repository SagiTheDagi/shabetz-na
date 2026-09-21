/**
 * Integration tests for the availability write path, against a real in-memory
 * SQLite database.
 *
 * The headline invariant: replaces are scoped by `source`, so the two write
 * channels (worker self-service, admin form import) cannot clobber each other.
 * Regressing that would silently destroy data, which is why it is tested at the
 * SQL level rather than mocked.
 *
 * Run: npm test
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  readAvailability,
  replaceAvailability,
  validateEntries,
  type AvailabilityEntry,
} from "./availability-repo";
import type { AvailabilitySource, WorkerAvailability } from "./types";

const QUARTER = "2026-Q3";
const WORKER = "1001";

let db: Database.Database;

/** Mirrors the WorkerAvailability shape created by scripts/migrate.ts. */
function createSchema(d: Database.Database) {
  d.exec(`
    CREATE TABLE WorkerAvailability (
      availability_id TEXT PRIMARY KEY,
      worker_id  TEXT NOT NULL,
      quarter_id TEXT NOT NULL,
      date   TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('unavailable', 'prefer_work', 'prefer_not_work')),
      source TEXT NOT NULL DEFAULT 'worker',
      note   TEXT,
      UNIQUE(worker_id, quarter_id, date)
    );
  `);
}

function write(source: AvailabilitySource, entries: AvailabilityEntry[]) {
  return replaceAvailability(db, {
    workerId: WORKER,
    quarterId: QUARTER,
    source,
    entries,
  });
}

function rows(): WorkerAvailability[] {
  return readAvailability(db, WORKER, QUARTER) as WorkerAvailability[];
}

function datesFor(source: AvailabilitySource): string[] {
  return rows()
    .filter((r) => r.source === source)
    .map((r) => r.date);
}

beforeEach(() => {
  db = new Database(":memory:");
  createSchema(db);
});

// ---------------------------------------------------------------------------

describe("source scoping", () => {
  it("a worker save does not wipe imported constraints", () => {
    write("form_import", [
      { date: "2026-07-11", status: "unavailable", note: "אירוע משפחתי" },
      { date: "2026-07-12", status: "unavailable", note: "אירוע משפחתי" },
    ]);

    // Worker later fills in their own calendar.
    write("worker", [{ date: "2026-08-01", status: "prefer_work" }]);

    assert.deepEqual(datesFor("form_import"), ["2026-07-11", "2026-07-12"]);
    assert.deepEqual(datesFor("worker"), ["2026-08-01"]);
    assert.equal(rows().length, 3);
  });

  it("re-running an import does not wipe the worker's own entries", () => {
    write("worker", [
      { date: "2026-08-01", status: "prefer_work" },
      { date: "2026-08-02", status: "prefer_not_work" },
    ]);

    write("form_import", [{ date: "2026-07-11", status: "unavailable" }]);
    write("form_import", [{ date: "2026-07-20", status: "unavailable" }]);

    assert.deepEqual(datesFor("worker"), ["2026-08-01", "2026-08-02"]);
    assert.deepEqual(datesFor("form_import"), ["2026-07-20"]);
  });

  it("replaces only its own rows when the same source writes again", () => {
    write("form_import", [
      { date: "2026-07-11", status: "unavailable" },
      { date: "2026-07-12", status: "unavailable" },
    ]);
    write("form_import", [{ date: "2026-09-01", status: "unavailable" }]);

    assert.deepEqual(datesFor("form_import"), ["2026-09-01"]);
  });

  it("keeps the three sources independent", () => {
    write("worker", [{ date: "2026-07-01", status: "prefer_work" }]);
    write("form_import", [{ date: "2026-07-02", status: "unavailable" }]);
    write("admin", [{ date: "2026-07-03", status: "prefer_not_work" }]);

    assert.equal(rows().length, 3);
    assert.deepEqual(datesFor("worker"), ["2026-07-01"]);
    assert.deepEqual(datesFor("form_import"), ["2026-07-02"]);
    assert.deepEqual(datesFor("admin"), ["2026-07-03"]);
  });

  it("clears its own rows when handed an empty list", () => {
    write("form_import", [{ date: "2026-07-11", status: "unavailable" }]);
    write("worker", [{ date: "2026-08-01", status: "prefer_work" }]);

    write("form_import", []);

    assert.deepEqual(datesFor("form_import"), []);
    assert.deepEqual(datesFor("worker"), ["2026-08-01"]);
  });
});

describe("same-date collisions", () => {
  it("last write wins and takes ownership of the row", () => {
    write("worker", [{ date: "2026-07-11", status: "prefer_work" }]);
    write("form_import", [
      { date: "2026-07-11", status: "unavailable", note: "חתונה" },
    ]);

    const all = rows();
    assert.equal(all.length, 1, "the UNIQUE constraint permits only one row per date");
    assert.equal(all[0].status, "unavailable");
    assert.equal(all[0].source, "form_import");
    assert.equal(all[0].note, "חתונה");
  });

  it("does not throw on a conflicting insert", () => {
    write("worker", [{ date: "2026-07-11", status: "prefer_work" }]);
    assert.doesNotThrow(() => {
      write("admin", [{ date: "2026-07-11", status: "unavailable" }]);
    });
  });
});

describe("persistence", () => {
  it("stores the originating free text", () => {
    write("form_import", [
      { date: "2026-07-11", status: "unavailable", note: "אירוע משפחתי" },
    ]);
    assert.equal(rows()[0].note, "אירוע משפחתי");
  });

  it("defaults note to null when absent", () => {
    write("worker", [{ date: "2026-07-11", status: "unavailable" }]);
    assert.equal(rows()[0].note, null);
  });

  it("returns the number of rows written", () => {
    const n = write("form_import", [
      { date: "2026-07-11", status: "unavailable" },
      { date: "2026-07-12", status: "unavailable" },
    ]);
    assert.equal(n, 2);
  });

  it("returns rows ordered by date", () => {
    write("form_import", [
      { date: "2026-09-01", status: "unavailable" },
      { date: "2026-07-11", status: "unavailable" },
      { date: "2026-08-05", status: "unavailable" },
    ]);
    assert.deepEqual(rows().map((r) => r.date), [
      "2026-07-11",
      "2026-08-05",
      "2026-09-01",
    ]);
  });
});

describe("validateEntries", () => {
  it("accepts a well-formed batch", () => {
    assert.equal(
      validateEntries([
        { date: "2026-07-11", status: "unavailable" },
        { date: "2026-07-12", status: "prefer_work" },
      ]),
      null
    );
  });

  it("accepts an empty batch", () => {
    assert.equal(validateEntries([]), null);
  });

  it("rejects a malformed date", () => {
    const err = validateEntries([{ date: "11/07/2026", status: "unavailable" }]);
    assert.match(err ?? "", /תאריך לא תקין/);
  });

  it("rejects an unknown status", () => {
    const err = validateEntries([
      { date: "2026-07-11", status: "maybe" as never },
    ]);
    assert.match(err ?? "", /סטטוס לא תקין/);
  });

  it("rejects duplicate dates", () => {
    const err = validateEntries([
      { date: "2026-07-11", status: "unavailable" },
      { date: "2026-07-11", status: "prefer_work" },
    ]);
    assert.match(err ?? "", /תאריך כפול/);
  });

  it("prefixes the error with the worker label", () => {
    const err = validateEntries([{ date: "nope", status: "unavailable" }], "1001");
    assert.match(err ?? "", /^1001: /);
  });
});

describe("bulk transaction semantics", () => {
  it("rolls back every worker when one write throws", () => {
    const commit = db.transaction((batch: Array<{ id: string; entries: AvailabilityEntry[] }>) => {
      for (const b of batch) {
        replaceAvailability(db, {
          workerId: b.id,
          quarterId: QUARTER,
          source: "form_import",
          entries: b.entries,
        });
      }
    });

    assert.throws(() =>
      commit([
        { id: "1001", entries: [{ date: "2026-07-11", status: "unavailable" }] },
        // CHECK constraint rejects this status at the SQL layer.
        { id: "1002", entries: [{ date: "2026-07-12", status: "bogus" as never }] },
      ])
    );

    const total = db.prepare("SELECT COUNT(*) AS c FROM WorkerAvailability").get() as { c: number };
    assert.equal(total.c, 0, "the first worker's rows must not survive the rollback");
  });
});
