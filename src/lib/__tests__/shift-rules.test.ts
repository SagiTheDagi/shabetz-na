/** Assignment suggestions + warnings against an in-memory DB. Run: npm test */
import { resetTestDb } from "./test-db";
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type Database from "better-sqlite3";
import { getWorkerWarnings, getSortedWorkers } from "../shift-rules";

let db: Database.Database;
let seq = 0;

function addWorker(id: string, o: Partial<{ rank: string; exempt: number; reason: string; branch: string | null; archived: number; name: string }> = {}) {
  db.prepare(
    "INSERT INTO Worker (worker_id, name, rank_id, is_exempt, exemption_reason, branch, is_archived) VALUES (?,?,?,?,?,?,?)"
  ).run(id, o.name ?? `w${id}`, o.rank ?? "R1", o.exempt ?? 0, o.reason ?? null, o.branch ?? null, o.archived ?? 0);
}
function addShiftDate(id: string, date: string, o: { type?: string; weekend?: number; quarter?: string } = {}) {
  db.prepare("INSERT INTO ShiftDate VALUES (?,?,?,?,?)").run(id, o.quarter ?? "2026-Q3", date, o.type ?? "PATROL", o.weekend ?? 0);
}
function assign(shiftDateId: string, workerId: string, role = "shift") {
  db.prepare("INSERT INTO ShiftAssignment (assignment_id, shift_date_id, worker_id, assigned_by, role) VALUES (?,?,?,?,?)")
    .run(`a${++seq}`, shiftDateId, workerId, "admin", role);
}
function history(workerId: string, shiftDateId: string, quarter: string, weekend = 0) {
  db.prepare("INSERT INTO ShiftHistory VALUES (?,?,?,?,?)").run(`h${++seq}`, workerId, quarter, shiftDateId, weekend);
}
function avail(workerId: string, date: string, status: string, note: string | null = null) {
  db.prepare("INSERT INTO WorkerAvailability (availability_id, worker_id, quarter_id, date, status, note) VALUES (?,?,?,?,?,?)")
    .run(`v${++seq}`, workerId, "2026-Q3", date, status, note);
}
const types = (w: ReturnType<typeof getWorkerWarnings>) => w.map((x) => x.type);

beforeEach(() => {
  db = resetTestDb();
  db.exec(`
    INSERT INTO Rank (rank_id,name,display_order) VALUES ('R1','א',1),('R2','ב',2);
    INSERT INTO ShiftType (shift_type_id,name) VALUES ('PATROL','סיור'),('GUARD','שמירה');
    INSERT INTO RankShiftEligibility VALUES ('R1','PATROL',1),('R1','GUARD',1),('R2','PATROL',2);
    INSERT INTO Quarter VALUES ('2026-Q3','2026-07-01','2026-09-30','draft',datetime('now'));
    INSERT INTO Quarter VALUES ('2026-Q2','2026-04-01','2026-06-30','draft',datetime('now'));
    INSERT INTO Worker (worker_id,name,rank_id,is_admin) VALUES ('admin','admin','R1',1);
  `);
  addShiftDate("S1", "2026-07-10");
});

describe("getWorkerWarnings", () => {
  it("returns no warnings for a clean eligible worker", () => {
    addWorker("1");
    assert.deepEqual(getWorkerWarnings("1", "S1"), []);
  });
  it("returns [] for unknown worker or shift date", () => {
    addWorker("1");
    assert.deepEqual(getWorkerWarnings("nope", "S1"), []);
    assert.deepEqual(getWorkerWarnings("1", "nope"), []);
  });
  it("exempt -> red with reason, fallback text without", () => {
    addWorker("1", { exempt: 1, reason: "לימודים" });
    addWorker("2", { exempt: 1 });
    const w1 = getWorkerWarnings("1", "S1").find((w) => w.type === "exempt")!;
    assert.equal(w1.severity, "red");
    assert.match(w1.message, /לימודים/);
    assert.match(getWorkerWarnings("2", "S1").find((w) => w.type === "exempt")!.message, /ללא סיבה/);
  });
  it("ineligible rank for shift type -> red", () => {
    addWorker("1", { rank: "R2" });
    addShiftDate("S2", "2026-07-11", { type: "GUARD" });
    assert.deepEqual(types(getWorkerWarnings("1", "S2")), ["ineligible"]);
  });
  it("unavailable red / prefer_not orange, includes note", () => {
    addWorker("1"); addWorker("2");
    avail("1", "2026-07-10", "unavailable", "חתונה");
    avail("2", "2026-07-10", "prefer_not_work");
    const a = getWorkerWarnings("1", "S1")[0];
    assert.equal(a.type, "unavailable"); assert.equal(a.severity, "red"); assert.match(a.message, /חתונה/);
    const b = getWorkerWarnings("2", "S1")[0];
    assert.equal(b.type, "prefer_not"); assert.equal(b.severity, "orange");
  });
  it("prefer_work and other-date availability produce no warning", () => {
    addWorker("1");
    avail("1", "2026-07-10", "prefer_work");
    avail("1", "2026-07-11", "unavailable");
    assert.deepEqual(getWorkerWarnings("1", "S1"), []);
  });
  it("already assigned this quarter: shift counts, reserve does not, other quarter does not", () => {
    addWorker("1"); addWorker("2"); addWorker("3");
    addShiftDate("S2", "2026-07-20");
    addShiftDate("OLD", "2026-05-01", { quarter: "2026-Q2" });
    assign("S2", "1", "shift");
    assign("S2", "2", "reserve");
    assign("OLD", "3", "shift");
    assert.deepEqual(types(getWorkerWarnings("1", "S1")), ["already_assigned_quarter"]);
    assert.deepEqual(getWorkerWarnings("2", "S1"), []);
    assert.deepEqual(getWorkerWarnings("3", "S1"), []);
  });
  it("weekend limit: second weekend in same year is red; other year and GUARD exempt; non-weekend ignored", () => {
    addWorker("1");
    addShiftDate("W1", "2026-08-07", { weekend: 1 });
    addShiftDate("W2", "2026-09-04", { weekend: 1 });
    addShiftDate("WG", "2026-09-11", { type: "GUARD", weekend: 1 });
    addShiftDate("H0", "2025-12-12");
    history("1", "H0", "2025-Q4", 1);
    assert.deepEqual(getWorkerWarnings("1", "W1"), [], "last year's weekend does not count");
    history("1", "W1", "2026-Q3", 1);
    assert.deepEqual(types(getWorkerWarnings("1", "W2")), ["weekend_limit"]);
    assert.deepEqual(getWorkerWarnings("1", "WG"), [], "GUARD exempt");
    assert.deepEqual(getWorkerWarnings("1", "S1"), [], "weekday shift not limited");
  });
  it("weekend limit counts unpublished assignments in the same year, excluding the shift itself", () => {
    addWorker("1");
    addShiftDate("W1", "2026-08-07", { weekend: 1 });
    addShiftDate("W2", "2026-09-04", { weekend: 1 });
    addShiftDate("WG", "2026-09-11", { type: "GUARD", weekend: 1 });
    assign("W1", "1");
    assert.ok(types(getWorkerWarnings("1", "W2")).includes("weekend_limit"));
    assert.ok(!types(getWorkerWarnings("1", "W1")).includes("weekend_limit"), "no self-warning on its own shift");
    assert.ok(!types(getWorkerWarnings("1", "WG")).includes("weekend_limit"), "GUARD exempt");
    db.prepare("UPDATE ShiftAssignment SET role='reserve'").run();
    assert.deepEqual(getWorkerWarnings("1", "W2"), [], "reserve does not count");
  });
  it("same worker as shift and reserve on one date -> red", () => {
    addWorker("1"); addWorker("2");
    assign("S1", "1", "shift");
    assert.ok(types(getWorkerWarnings("1", "S1", "reserve")).includes("same_worker_both_roles"));
    assert.deepEqual(types(getWorkerWarnings("2", "S1", "reserve")), []);
  });
  it("branch mismatch is amber; null branch on either side is ignored; checks the opposite role", () => {
    addWorker("1", { branch: "A" }); addWorker("2", { branch: "B" }); addWorker("3", { branch: null });
    assign("S1", "1", "shift");
    const r = getWorkerWarnings("2", "S1", "reserve");
    assert.deepEqual(types(r), ["branch_mismatch"]);
    assert.equal(r[0].severity, "amber");
    assert.deepEqual(getWorkerWarnings("3", "S1", "reserve"), []);
    // role=shift looks at existing *reserve*, which is empty
    assert.deepEqual(getWorkerWarnings("2", "S1", "shift"), []);
  });
  it("same branch -> no warning", () => {
    addWorker("1", { branch: "A" }); addWorker("2", { branch: "A" });
    assign("S1", "1", "shift");
    assert.deepEqual(getWorkerWarnings("2", "S1", "reserve"), []);
  });
});

describe("getSortedWorkers", () => {
  it("returns [] for unknown shift date", () => assert.deepEqual(getSortedWorkers("nope"), []));

  it("excludes archived workers", () => {
    addWorker("1"); addWorker("2", { archived: 1 });
    assert.deepEqual(getSortedWorkers("S1").map((w) => w.worker_id).filter((i) => i !== "admin"), ["1"]);
  });

  const order = () => getSortedWorkers("S1").map((w) => w.worker_id).filter((i) => i !== "admin");

  it("exempt last, ineligible before… exempt but after eligible", () => {
    addWorker("ex", { exempt: 1 }); addWorker("ok"); addWorker("inel", { rank: "R2" });
    addShiftDate("SG", "2026-07-12", { type: "GUARD" });
    const g = getSortedWorkers("SG").map((w) => w.worker_id).filter((i) => i !== "admin");
    assert.deepEqual(g, ["ok", "inel", "ex"]);
  });
  it("unavailable sinks below available within the same eligibility", () => {
    addWorker("a"); addWorker("b");
    avail("a", "2026-07-10", "unavailable");
    assert.deepEqual(order(), ["b", "a"]);
  });
  it("lower priority number first", () => {
    addWorker("lo", { rank: "R2" }); addWorker("hi", { rank: "R1" });
    assert.deepEqual(order(), ["hi", "lo"]);
  });
  it("not-yet-assigned this quarter before assigned", () => {
    addWorker("a"); addWorker("b");
    addShiftDate("S2", "2026-07-20");
    assign("S2", "a");
    assert.deepEqual(order(), ["b", "a"]);
  });
  it("longer since last shift first; never-worked first of all", () => {
    addWorker("recent"); addWorker("old"); addWorker("never");
    addShiftDate("H1", "2026-07-01"); addShiftDate("H2", "2026-01-01");
    history("recent", "H1", "2026-Q3"); history("old", "H2", "2026-Q1");
    assert.deepEqual(order(), ["never", "old", "recent"]);
    const r = getSortedWorkers("S1").find((w) => w.worker_id === "recent")!;
    assert.equal(r.days_since_last_shift, 9);
    assert.equal(getSortedWorkers("S1").find((w) => w.worker_id === "never")!.days_since_last_shift, null);
  });
  it("prefer_work before neutral before prefer_not as final tiebreak", () => {
    addWorker("n"); addWorker("p"); addWorker("x");
    avail("p", "2026-07-10", "prefer_work"); avail("x", "2026-07-10", "prefer_not_work");
    assert.deepEqual(order(), ["p", "n", "x"]);
  });
  it("exposes eligibility, availability note/source and assigned flag", () => {
    addWorker("1");
    avail("1", "2026-07-10", "prefer_not_work", "דוקטור");
    const w = getSortedWorkers("S1").find((x) => x.worker_id === "1")!;
    assert.equal(w.is_eligible, true);
    assert.equal(w.eligibility_priority, 1);
    assert.equal(w.availability_status, "prefer_not_work");
    assert.equal(w.availability_note, "דוקטור");
    assert.equal(w.availability_source, "worker");
    assert.equal(w.assigned_this_quarter, false);
  });
});
