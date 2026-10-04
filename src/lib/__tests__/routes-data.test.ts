/** shifts, eligibility, export/import, workers import/auto-archive/potential routes. */
import { resetTestDb } from "./test-db";
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type Database from "better-sqlite3";
import * as shifts from "../../app/api/shifts/route";
import * as shift from "../../app/api/shifts/[shiftDateId]/route";
import * as elig from "../../app/api/eligibility/route";
import * as exp from "../../app/api/export/route";
import * as wimport from "../../app/api/workers/import/route";
import * as archive from "../../app/api/workers/auto-archive/route";
import * as potential from "../../app/api/workers/potential/route";

let db: Database.Database;
const json = (body: unknown, method = "POST") =>
  new Request("http://x/api", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const get = (qs = "") => {
  const r = new Request(`http://x/api?${qs}`) as Request & { nextUrl: URL };
  r.nextUrl = new URL(r.url);
  return r;
};
const call = (fn: unknown, ...a: unknown[]) => (fn as (...x: unknown[]) => Promise<Response>)(...a);
const sp = (shiftDateId: string) => ({ params: Promise.resolve({ shiftDateId }) });
const count = (t: string, w = "1=1") => (db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE ${w}`).get() as { c: number }).c;

beforeEach(() => {
  db = resetTestDb();
  db.exec(`
    INSERT INTO Rank (rank_id,name,display_order) VALUES ('R1','a',1),('R2','b',2);
    INSERT INTO ShiftType (shift_type_id,name,display_order) VALUES ('GUARD','g',1),('PATROL','p',2);
    INSERT INTO Quarter VALUES ('2026-Q1','2026-01-01','2026-03-31','draft',datetime('now'));
  `);
});

describe("/api/shifts", () => {
  const post = (b: object) => call(shifts.POST, json(b));
  const d = (date: string, shift_type_id = "GUARD", is_weekend = false) => ({ date, shift_type_id, is_weekend });

  it("POST inserts, returns the quarter's shifts sorted with type name (201)", async () => {
    const res = await post({ quarter_id: "2026-Q1", dates: [d("2026-01-09", "GUARD", true), d("2026-01-02", "PATROL")] });
    assert.equal(res.status, 201);
    const rows = await res.json();
    assert.deepEqual(rows.map((r: { date: string }) => r.date), ["2026-01-02", "2026-01-09"]);
    assert.equal(rows[1].shift_type_name, "g");
    assert.equal(rows[1].is_weekend, 1);
  });
  it("POST validation: empty list / missing quarter 400, unknown quarter 404", async () => {
    assert.equal((await post({ quarter_id: "2026-Q1", dates: [] })).status, 400);
    assert.equal((await post({ dates: [d("2026-01-02")] })).status, 400);
    assert.equal((await post({ quarter_id: "NOPE", dates: [d("2026-01-02")] })).status, 404);
  });
  it("POST is all-or-nothing when one shift type is unknown", async () => {
    const res = await post({ quarter_id: "2026-Q1", dates: [d("2026-01-02"), d("2026-01-03", "NOPE")] });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /NOPE/);
    assert.equal(count("ShiftDate"), 0);
  });
  it("GET filters by quarter and lists all without a filter", async () => {
    db.exec(`INSERT INTO Quarter VALUES ('2026-Q2','2026-04-01','2026-06-30','draft',datetime('now'));
      INSERT INTO ShiftDate VALUES ('a','2026-Q1','2026-01-02','GUARD',0),('b','2026-Q2','2026-04-02','GUARD',0)`);
    assert.equal((await (await call(shifts.GET, get("quarter_id=2026-Q1"))).json()).length, 1);
    assert.equal((await (await call(shifts.GET, get())).json()).length, 2);
  });
  // KNOWN GAP: POST does not reject malformed/out-of-range/duplicate dates (PUT does).
  it("POST currently accepts a duplicate date+type (documents gap)", async () => {
    await post({ quarter_id: "2026-Q1", dates: [d("2026-01-02")] });
    const res = await post({ quarter_id: "2026-Q1", dates: [d("2026-01-02")] });
    assert.equal(res.status, 201);
    assert.equal(count("ShiftDate"), 2);
  });
});

describe("/api/shifts/[id]", () => {
  beforeEach(() => {
    db.exec(`INSERT INTO ShiftDate VALUES ('a','2026-Q1','2026-01-07','GUARD',1),('b','2026-Q1','2026-01-08','GUARD',0);
      INSERT INTO Worker (worker_id,name,rank_id) VALUES ('1','w','R1');
      INSERT INTO ShiftHistory VALUES ('h','1','2026-Q1','a',1)`);
  });
  const put = (id: string, b: object) => call(shift.PUT, json(b, "PUT"), sp(id));

  it("PUT moves date/type and recomputes is_weekend on the shift and its history", async () => {
    assert.equal((await put("a", { date: "2026-01-06", shift_type_id: "PATROL" })).status, 200); // Tuesday
    assert.deepEqual(db.prepare("SELECT date,shift_type_id,is_weekend FROM ShiftDate WHERE shift_date_id='a'").get(),
      { date: "2026-01-06", shift_type_id: "PATROL", is_weekend: 0 });
    assert.equal(count("ShiftHistory", "was_weekend=0"), 1);
  });
  it("PUT rejects bad date, out of range, duplicate, unknown type; 404 unknown id", async () => {
    for (const [b, re] of [
      [{ date: "2026-1-6", shift_type_id: "GUARD" }, /תאריך לא תקין/],
      [{ date: "2026-02-30", shift_type_id: "GUARD" }, /תאריך לא תקין|טווח/],
      [{ date: "2025-12-31", shift_type_id: "GUARD" }, /טווח/],
      [{ date: "2026-01-08", shift_type_id: "GUARD" }, /כבר קיימת/],
      [{ date: "2026-01-09", shift_type_id: "NOPE" }, /סוג משמרת/],
    ] as [object, RegExp][]) {
      const res = await put("a", b);
      assert.equal(res.status, 400, JSON.stringify(b));
      assert.match((await res.json()).error, re);
    }
    assert.equal((await put("zzz", { date: "2026-01-09", shift_type_id: "GUARD" })).status, 404);
    assert.equal((db.prepare("SELECT date FROM ShiftDate WHERE shift_date_id='a'").get() as { date: string }).date, "2026-01-07");
  });
  it("PUT keeping its own date is not a duplicate of itself", async () => {
    assert.equal((await put("a", { date: "2026-01-07", shift_type_id: "GUARD" })).status, 200);
  });
  it("DELETE cascades assignments + history; 404 on repeat", async () => {
    db.exec("INSERT INTO ShiftAssignment (assignment_id,shift_date_id,worker_id,assigned_by) VALUES ('x','a','1','9')");
    assert.equal((await call(shift.DELETE, get(), sp("a"))).status, 200);
    assert.equal(count("ShiftAssignment"), 0);
    assert.equal(count("ShiftHistory"), 0);
    assert.equal((await call(shift.DELETE, get(), sp("a"))).status, 404);
  });
});

describe("/api/eligibility", () => {
  it("PUT replaces the whole matrix; null priority kept; GET joined + ordered", async () => {
    await call(elig.PUT, json({ entries: [{ rank_id: "R1", shift_type_id: "GUARD", priority: 1 }] }, "PUT"));
    const res = await call(elig.PUT, json({ entries: [{ rank_id: "R2", shift_type_id: "PATROL", priority: null }, { rank_id: "R1", shift_type_id: "PATROL", priority: 2 }] }, "PUT"));
    const rows = await res.json();
    assert.deepEqual(rows.map((r: { rank_id: string; shift_type_id: string }) => `${r.rank_id}/${r.shift_type_id}`), ["R1/PATROL", "R2/PATROL"]);
    assert.equal(rows[1].priority, null);
    assert.equal(rows[0].rank_name, "a");
    assert.equal((await (await call(elig.GET)).json()).length, 2);
  });
  it("PUT non-array -> 400 and matrix untouched", async () => {
    await call(elig.PUT, json({ entries: [{ rank_id: "R1", shift_type_id: "GUARD", priority: 1 }] }, "PUT"));
    assert.equal((await call(elig.PUT, json({ entries: "x" }, "PUT"))).status, 400);
    assert.equal(count("RankShiftEligibility"), 1);
  });
  it("PUT with an unknown rank rolls back, leaving the old matrix", async () => {
    await call(elig.PUT, json({ entries: [{ rank_id: "R1", shift_type_id: "GUARD", priority: 1 }] }, "PUT"));
    await assert.rejects(call(elig.PUT, json({ entries: [{ rank_id: "NOPE", shift_type_id: "GUARD", priority: 1 }] }, "PUT")));
    assert.equal(count("RankShiftEligibility"), 1);
  });
});

describe("/api/export", () => {
  beforeEach(() => {
    db.exec(`INSERT INTO Worker (worker_id,name,rank_id) VALUES ('1','w','R1');
      INSERT INTO ShiftDate VALUES ('a','2026-Q1','2026-01-07','GUARD',1);
      INSERT INTO ShiftAssignment (assignment_id,shift_date_id,worker_id,assigned_by,is_forced,force_reason,role) VALUES ('x','a','1','9',1,'why','shift');
      INSERT INTO WorkerAvailability VALUES ('v','1','2026-Q1','2026-01-08','unavailable','admin','n');
      INSERT INTO RankShiftEligibility VALUES ('R1','GUARD',1)`);
  });
  it("GET: 400 without quarter, 404 unknown, v4 payload otherwise", async () => {
    assert.equal((await call(exp.GET, get())).status, 400);
    assert.equal((await call(exp.GET, get("quarter_id=NOPE"))).status, 404);
    const data = await (await call(exp.GET, get("quarter_id=2026-Q1"))).json();
    assert.equal(data.version, 4);
    assert.equal(data.assignments[0].is_forced, true);
    assert.equal(data.worker_availability[0].source, "admin");
    assert.equal(data.shift_dates.length, 1);
  });
  it("round trip: export, wipe quarter data, import restores it", async () => {
    const data = await (await call(exp.GET, get("quarter_id=2026-Q1"))).json();
    db.exec("DELETE FROM ShiftAssignment; DELETE FROM ShiftDate; DELETE FROM WorkerAvailability");
    const res = await call(exp.POST, json(data));
    assert.equal(res.status, 200);
    const again = await (await call(exp.GET, get("quarter_id=2026-Q1"))).json();
    assert.deepEqual(again.shift_dates, data.shift_dates);
    assert.deepEqual(again.worker_availability, data.worker_availability);
    assert.deepEqual(again.assignments.map((a: { worker_id: string; role: string }) => [a.worker_id, a.role]), [["1", "shift"]]);
  });
  it("POST: invalid file -> 400", async () => {
    assert.equal((await call(exp.POST, json({}))).status, 400);
    assert.equal((await call(exp.POST, json({ version: 4 }))).status, 400);
  });
  it("POST: failing import (unknown worker) rolls back, previous data intact", async () => {
    const data = await (await call(exp.GET, get("quarter_id=2026-Q1"))).json();
    data.assignments[0].worker_id = "ghost";
    const res = await call(exp.POST, json(data));
    assert.equal(res.status, 400);
    assert.equal(count("ShiftDate"), 1);
    assert.equal(count("ShiftAssignment", "worker_id='1'"), 1);
  });
  it("POST: pre-v4 availability without source defaults to worker", async () => {
    const data = await (await call(exp.GET, get("quarter_id=2026-Q1"))).json();
    delete data.worker_availability[0].source;
    await call(exp.POST, json(data));
    assert.equal((db.prepare("SELECT source s FROM WorkerAvailability").get() as { s: string }).s, "worker");
  });
});

describe("/api/workers/import", () => {
  const imp = (workers: unknown) => call(wimport.POST, json({ workers }));
  const w = (id: string, extra: object = {}) => ({ worker_id: id, name: `n${id}`, rank_id: "R1", is_exempt: 0, exemption_reason: null, receives_shift_allocation: 1, ...extra });

  it("empty / non-array list -> 400", async () => {
    assert.equal((await imp([])).status, 400);
    assert.equal((await imp("x")).status, 400);
  });
  it("creates new, updates existing, reports counts", async () => {
    db.exec("INSERT INTO Worker (worker_id,name,rank_id) VALUES ('1','old','R1')");
    const res = await (await imp([w("1", { name: "new" }), w("2")])).json();
    assert.deepEqual([res.created, res.updated, res.archived, res.errors], [1, 1, 0, []]);
    assert.equal((db.prepare("SELECT name FROM Worker WHERE worker_id='1'").get() as { name: string }).name, "new");
  });
  it("null fields don't wipe existing values (COALESCE)", async () => {
    db.exec("INSERT INTO Worker (worker_id,name,rank_id,notes,branch) VALUES ('1','old','R1','keep','B')");
    await imp([w("1", { notes: null, branch: null })]);
    assert.deepEqual(db.prepare("SELECT notes,branch FROM Worker WHERE worker_id='1'").get(), { notes: "keep", branch: "B" });
  });
  it("collects row errors (missing data, unknown rank) and still imports valid rows", async () => {
    const res = await (await imp([w("1"), { worker_id: "2", rank_id: "R1" }, w("3", { rank_id: "NOPE" })])).json();
    assert.equal(res.created, 1);
    assert.equal(res.errors.length, 2);
  });
  it("archives active non-admin workers missing from the file, never admins; restores returning ones", async () => {
    db.exec(`INSERT INTO Worker (worker_id,name,rank_id) VALUES ('1','a','R1'),('2','b','R1');
      INSERT INTO Worker (worker_id,name,rank_id,is_admin) VALUES ('9','root','R1',1);
      INSERT INTO Worker (worker_id,name,rank_id,is_archived) VALUES ('3','c','R1',1)`);
    const res = await (await imp([w("1"), w("3")])).json();
    assert.equal(res.archived, 1);
    assert.equal(count("Worker", "worker_id='2' AND is_archived=1"), 1);
    assert.equal(count("Worker", "worker_id='9' AND is_archived=0"), 1);
    assert.equal(count("Worker", "worker_id='3' AND is_archived=0"), 1);
  });
  it("new worker with is_exempt/receives_shift_allocation omitted still imports", async () => {
    // spreadsheet rows may leave these columns out; DB columns are NOT NULL
    const res = await imp([{ worker_id: "5", name: "n", rank_id: "R1" }]);
    assert.equal(res.status, 200);
    assert.deepEqual(db.prepare("SELECT is_exempt, receives_shift_allocation FROM Worker WHERE worker_id='5'").get(), { is_exempt: 0, receives_shift_allocation: 1 });
  });
});

describe("/api/workers/auto-archive", () => {
  it("archives only active workers released more than 3 months ago", async () => {
    const iso = (months: number) => { const t = new Date(); t.setMonth(t.getMonth() + months); return t.toISOString().slice(0, 10); };
    const ins = db.prepare("INSERT INTO Worker (worker_id,name,rank_id,release_date,is_archived) VALUES (?,?,?,?,?)");
    ins.run("old", "o", "R1", iso(-5), 0);
    ins.run("recent", "r", "R1", iso(-1), 0);
    ins.run("future", "f", "R1", iso(2), 0);
    ins.run("none", "n", "R1", null, 0);
    ins.run("done", "d", "R1", iso(-9), 1);
    const res = await (await call(archive.POST)).json();
    assert.equal(res.archived, 1);
    assert.equal(count("Worker", "is_archived=1"), 2);
    assert.equal(count("Worker", "worker_id='old' AND is_archived=1"), 1);
    assert.equal((await (await call(archive.POST)).json()).archived, 0);
  });
});

describe("/api/workers/potential", () => {
  it("400 without quarter; counts shifts/weekends per active worker, excludes archived", async () => {
    assert.equal((await call(potential.GET, get())).status, 400);
    db.exec(`INSERT INTO Worker (worker_id,name,rank_id) VALUES ('1','a','R1'),('2','b','R2');
      INSERT INTO Worker (worker_id,name,rank_id,is_archived) VALUES ('3','c','R1',1);
      INSERT INTO ShiftDate VALUES ('s1','2026-Q1','2026-01-07','GUARD',1),('s2','2026-Q1','2026-01-08','GUARD',0);
      INSERT INTO ShiftHistory VALUES ('h1','1','2026-Q1','s1',1),('h2','1','2026-Q1','s2',0);
      INSERT INTO ShiftHistory VALUES ('h3','2','2026-Q4','s1',1)`);
    const rows = await (await call(potential.GET, get("quarter_id=2026-Q1"))).json();
    assert.deepEqual(rows.map((r: { worker_id: string; shifts: number; weekends: number }) => [r.worker_id, r.shifts, r.weekends]), [["1", 2, 1], ["2", 0, 0]]);
  });
});
