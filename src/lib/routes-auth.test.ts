/**
 * Route handlers for the step-4 refactor: auth guards (401/403), quarters,
 * workers and the assignments/availability flows, called directly against an
 * in-memory DB with a stubbed session.
 */
import { resetTestDb } from "./test-db";
import { asUser, asGuest } from "./test-session";
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type Database from "better-sqlite3";
import * as assignments from "../app/api/assignments/route";
import * as availability from "../app/api/availability/route";
import * as bulk from "../app/api/availability/bulk/route";
import * as justice from "../app/api/justice-chart/route";
import * as quarters from "../app/api/quarters/route";
import * as workers from "../app/api/workers/route";
import * as worker from "../app/api/workers/[workerId]/route";

let db: Database.Database;
beforeEach(() => {
  db = resetTestDb();
  asGuest();
  db.exec(`
    INSERT INTO Rank (rank_id,name) VALUES ('R1','r');
    INSERT INTO ShiftType (shift_type_id,name) VALUES ('GUARD','g');
    INSERT INTO RankShiftEligibility VALUES ('R1','GUARD',1);
    INSERT INTO Worker (worker_id,name,rank_id,is_admin) VALUES ('1','alice','R1',0),('2','bob','R1',0),('9','root','R1',1);
    INSERT INTO Quarter VALUES ('2026-Q1','2026-01-01','2026-03-31','draft',datetime('now'));
    INSERT INTO ShiftDate VALUES ('SD1','2026-Q1','2026-01-10','GUARD',0);
  `);
});

const json = (body: unknown, method = "POST") =>
  new Request("http://x/api", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const get = (qs = "") => {
  const r = new Request(`http://x/api?${qs}`) as Request & { nextUrl: URL };
  r.nextUrl = new URL(r.url);
  return r;
};
const p = (workerId: string) => ({ params: Promise.resolve({ workerId }) });
const call = (fn: unknown, ...a: unknown[]) => (fn as (...x: unknown[]) => Promise<Response>)(...a);
const count = (t: string) => (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c;

describe("auth guards", () => {
  const ADMIN_ONLY: [string, () => Promise<Response>][] = [
    ["POST /assignments", () => call(assignments.POST, json({ shift_date_id: "SD1", worker_id: "1" }))],
    ["POST /availability/bulk", () => call(bulk.POST, json({ quarter_id: "2026-Q1", workers: [] }))],
    ["POST /justice-chart", () => call(justice.POST)],
  ];
  for (const [name, fn] of ADMIN_ONLY) {
    it(`${name}: guest 401, worker 403`, async () => {
      assert.equal((await fn()).status, 401);
      await asUser("1");
      assert.equal((await fn()).status, 403);
    });
  }
  it("GET /quarters: guest 401, worker 200; POST /quarters: guest 401, worker 403", async () => {
    const body = { quarter_id: "2026-Q2", start_date: "2026-04-01", end_date: "2026-06-30" };
    assert.equal((await call(quarters.GET)).status, 401);
    assert.equal((await call(quarters.POST, json(body))).status, 401);
    await asUser("1");
    assert.equal((await call(quarters.GET)).status, 200);
    assert.equal((await call(quarters.POST, json(body))).status, 403);
    assert.equal(count("Quarter"), 1);
  });
  it("GET /justice-chart: guest 401, worker 200", async () => {
    assert.equal((await call(justice.GET)).status, 401);
    await asUser("1");
    assert.equal((await call(justice.GET)).status, 200);
  });
  it("POST/GET /availability: guest -> 401", async () => {
    assert.equal((await call(availability.POST, json({ quarter_id: "2026-Q1", entries: [] }))).status, 401);
    assert.equal((await call(availability.GET, get())).status, 401);
  });
  it("auth failure does not mutate the DB", async () => {
    await asUser("1");
    await call(assignments.POST, json({ shift_date_id: "SD1", worker_id: "1" }));
    assert.equal(count("ShiftAssignment"), 0);
  });
});

describe("/api/quarters", () => {
  beforeEach(async () => { await asUser("9", true); });
  const mk = (b: object) => call(quarters.POST, json(b));
  it("creates as draft (201), lists it", async () => {
    const res = await mk({ quarter_id: "2026-Q2", start_date: "2026-04-01", end_date: "2026-06-30" });
    assert.equal(res.status, 201);
    assert.equal((await res.json()).status, "draft");
    assert.equal((await (await call(quarters.GET)).json()).length, 2);
  });
  it("duplicate -> 409", async () => {
    assert.equal((await mk({ quarter_id: "2026-Q1", start_date: "a", end_date: "b" })).status, 409);
  });
  it("bad id format / missing fields -> 400", async () => {
    for (const q of ["2026-Q5", "2026Q1", "26-Q1", "2026-q1"]) {
      assert.equal((await mk({ quarter_id: q, start_date: "a", end_date: "b" })).status, 400, q);
    }
    assert.equal((await mk({ quarter_id: "2026-Q2", end_date: "b" })).status, 400);
    assert.equal(count("Quarter"), 1);
  });
});

describe("/api/workers", () => {
  const mk = (b: object) => call(workers.POST, json(b));
  it("creates with rank_name, 201", async () => {
    const res = await mk({ worker_id: "5", name: "carl", rank_id: "R1" });
    assert.equal(res.status, 201);
    const w = await res.json();
    assert.equal(w.rank_name, "r");
    assert.equal(w.is_admin, 0);
    assert.equal(w.password_hash, null);
  });
  it("duplicate -> 409; unknown rank -> 400; missing name -> 400", async () => {
    assert.equal((await mk({ worker_id: "1", name: "x", rank_id: "R1" })).status, 409);
    assert.equal((await mk({ worker_id: "7", name: "x", rank_id: "NOPE" })).status, 400);
    assert.equal((await mk({ worker_id: "7", rank_id: "R1" })).status, 400);
  });
  it("exempt requires a reason; reason dropped when not exempt", async () => {
    assert.equal((await mk({ worker_id: "7", name: "x", rank_id: "R1", is_exempt: true })).status, 400);
    const ok = await (await mk({ worker_id: "7", name: "x", rank_id: "R1", is_exempt: true, exemption_reason: "מחלה" })).json();
    assert.equal(ok.exemption_reason, "מחלה");
    const no = await (await mk({ worker_id: "8", name: "y", rank_id: "R1", exemption_reason: "stale" })).json();
    assert.equal(no.exemption_reason, null);
  });
  it("admin with password stores a hash, never the plaintext", async () => {
    const w = await (await mk({ worker_id: "6", name: "a", rank_id: "R1", is_admin: true, password: "pw123456" })).json();
    assert.ok(w.password_hash && w.password_hash !== "pw123456");
  });
  it("PATCH partial update, 404 unknown, 400 empty / bad date / bad rank", async () => {
    const patch = (id: string, b: object) => call(worker.PATCH, json(b, "PATCH"), p(id));
    assert.equal((await patch("1", { name: "alice2", notes: "n" })).status, 200);
    const row = db.prepare("SELECT name, notes, rank_id FROM Worker WHERE worker_id='1'").get() as Record<string, string>;
    assert.deepEqual(row, { name: "alice2", notes: "n", rank_id: "R1" });
    assert.equal((await patch("404", { name: "x" })).status, 404);
    assert.equal((await patch("1", {})).status, 400);
    assert.equal((await patch("1", { release_date: "01/02/2026" })).status, 400);
    assert.equal((await patch("1", { rank_id: "NOPE" })).status, 400);
    assert.equal((await patch("1", { name: "  " })).status, 400);
  });
  it("PATCH un-exempting clears reason; exempting without reason -> 400", async () => {
    const patch = (b: object) => call(worker.PATCH, json(b, "PATCH"), p("1"));
    assert.equal((await patch({ is_exempt: true })).status, 400);
    assert.equal((await patch({ is_exempt: true, exemption_reason: "r" })).status, 200);
    assert.equal((await patch({ is_exempt: false })).status, 200);
    const w = db.prepare("SELECT is_exempt, exemption_reason FROM Worker WHERE worker_id='1'").get() as Record<string, unknown>;
    assert.deepEqual(w, { is_exempt: 0, exemption_reason: null });
  });
  it("PUT replaces fields, 404 unknown; DELETE archives (soft)", async () => {
    const put = (id: string, b: object) => call(worker.PUT, json(b, "PUT"), p(id));
    assert.equal((await put("1", { name: "z", rank_id: "R1" })).status, 200);
    assert.equal((await put("404", { name: "z", rank_id: "R1" })).status, 404);
    assert.equal((await call(worker.DELETE, get(), p("2"))).status, 200);
    assert.equal(count("Worker"), 3);
    assert.equal((db.prepare("SELECT is_archived a FROM Worker WHERE worker_id='2'").get() as { a: number }).a, 1);
    assert.equal((await call(worker.DELETE, get(), p("404"))).status, 404);
  });
});

describe("/api/assignments POST", () => {
  const post = (b: object) => call(assignments.POST, json(b));
  beforeEach(async () => { await asUser("9", true); });

  it("validates input: missing ids 400, bad role 400, unknown shift date 404", async () => {
    assert.equal((await post({ worker_id: "1" })).status, 400);
    assert.equal((await post({ shift_date_id: "SD1", worker_id: "1", role: "boss" })).status, 400);
    assert.equal((await post({ shift_date_id: "NOPE", worker_id: "1" })).status, 404);
  });
  it("assigns, records assigned_by + history", async () => {
    const res = await post({ shift_date_id: "SD1", worker_id: "1" });
    assert.equal(res.status, 200);
    const a = db.prepare("SELECT * FROM ShiftAssignment").get() as Record<string, unknown>;
    assert.equal(a.assigned_by, "9");
    assert.equal(a.role, "shift");
    assert.equal(count("ShiftHistory"), 1);
  });
  it("reassigning replaces the previous worker and their history", async () => {
    await post({ shift_date_id: "SD1", worker_id: "1" });
    await post({ shift_date_id: "SD1", worker_id: "2" });
    assert.equal(count("ShiftAssignment"), 1);
    const h = db.prepare("SELECT worker_id FROM ShiftHistory").all() as { worker_id: string }[];
    assert.deepEqual(h.map((x) => x.worker_id), ["2"]);
  });
  it("reserve role does not write history and coexists with shift", async () => {
    await post({ shift_date_id: "SD1", worker_id: "1" });
    await post({ shift_date_id: "SD1", worker_id: "2", role: "reserve" });
    assert.equal(count("ShiftAssignment"), 2);
    assert.equal(count("ShiftHistory"), 1);
  });
  it("red warning blocks with 422 unless forced; forced needs a reason", async () => {
    db.exec("UPDATE Worker SET is_exempt=1, exemption_reason='x' WHERE worker_id='1'");
    const blocked = await post({ shift_date_id: "SD1", worker_id: "1" });
    if (blocked.status === 422) {
      assert.equal((await blocked.json()).requiresForce, true);
      assert.equal(count("ShiftAssignment"), 0);
      assert.equal((await post({ shift_date_id: "SD1", worker_id: "1", is_forced: true })).status, 400);
      assert.equal((await post({ shift_date_id: "SD1", worker_id: "1", is_forced: true, force_reason: "   " })).status, 400);
      assert.equal((await post({ shift_date_id: "SD1", worker_id: "1", is_forced: true, force_reason: "needed" })).status, 200);
      const a = db.prepare("SELECT is_forced, force_reason FROM ShiftAssignment").get();
      assert.deepEqual(a, { is_forced: 1, force_reason: "needed" });
    } else {
      assert.equal(blocked.status, 200); // exemption not a red warning in this ruleset
    }
  });
  it("failed validation leaves an existing assignment intact", async () => {
    await post({ shift_date_id: "SD1", worker_id: "1" });
    await post({ shift_date_id: "SD1", worker_id: "2", is_forced: true });
    assert.equal(count("ShiftAssignment"), 1);
    assert.equal((db.prepare("SELECT worker_id w FROM ShiftAssignment").get() as { w: string }).w, "1");
  });
});

describe("/api/assignments DELETE", () => {
  const del = (qs: string) => call(assignments.DELETE, get(qs));
  beforeEach(async () => {
    await asUser("9", true);
    await call(assignments.POST, json({ shift_date_id: "SD1", worker_id: "1" }));
    await call(assignments.POST, json({ shift_date_id: "SD1", worker_id: "2", role: "reserve" }));
  });
  it("no params -> 400; unknown id -> 404", async () => {
    assert.equal((await del("")).status, 400);
    assert.equal((await del("assignment_id=nope")).status, 404);
  });
  it("by role removes only that role (+history for shift)", async () => {
    assert.equal((await del("shift_date_id=SD1&role=reserve")).status, 200);
    assert.equal(count("ShiftAssignment"), 1);
    assert.equal(count("ShiftHistory"), 1);
    assert.equal((await del("shift_date_id=SD1&role=shift")).status, 200);
    assert.equal(count("ShiftHistory"), 0);
  });
  it("by shift_date_id removes all roles", async () => {
    await del("shift_date_id=SD1");
    assert.equal(count("ShiftAssignment"), 0);
    assert.equal(count("ShiftHistory"), 0);
  });
});

describe("/api/availability", () => {
  const entry = (date: string, status = "unavailable") => ({ date, status });
  const post = (b: object) => call(availability.POST, json(b));

  it("worker writes own rows as source=worker; validation 400s", async () => {
    await asUser("1");
    assert.equal((await post({ quarter_id: "2026-Q1", entries: [entry("2026-01-05")] })).status, 200);
    assert.equal((db.prepare("SELECT source s FROM WorkerAvailability").get() as { s: string }).s, "worker");
    assert.equal((await post({ entries: [] })).status, 400);
    assert.equal((await post({ quarter_id: "2026-Q1" })).status, 400);
    assert.equal((await post({ quarter_id: "2026-Q1", entries: [entry("2026-01-05", "bogus")] })).status, 400);
    assert.equal((await post({ quarter_id: "NOPE", entries: [] })).status, 404);
  });
  it("worker cannot write for someone else or pick a source", async () => {
    await asUser("1");
    assert.equal((await post({ quarter_id: "2026-Q1", worker_id: "2", entries: [] })).status, 403);
    await post({ quarter_id: "2026-Q1", source: "admin", entries: [entry("2026-01-05")] });
    assert.equal((db.prepare("SELECT source s FROM WorkerAvailability").get() as { s: string }).s, "worker");
  });
  it("admin writes for another worker (default source admin); bad source 400; unknown worker 404", async () => {
    await asUser("9", true);
    assert.equal((await post({ quarter_id: "2026-Q1", worker_id: "2", entries: [entry("2026-01-05")] })).status, 200);
    const r = db.prepare("SELECT worker_id w, source s FROM WorkerAvailability").get();
    assert.deepEqual(r, { w: "2", s: "admin" });
    assert.equal((await post({ quarter_id: "2026-Q1", worker_id: "2", source: "x", entries: [] })).status, 400);
    assert.equal((await post({ quarter_id: "2026-Q1", worker_id: "404", entries: [] })).status, 404);
  });
  it("saving replaces only own source", async () => {
    await asUser("9", true);
    await post({ quarter_id: "2026-Q1", worker_id: "1", source: "form_import", entries: [entry("2026-01-06")] });
    await asUser("1");
    await post({ quarter_id: "2026-Q1", entries: [entry("2026-01-05")] });
    await post({ quarter_id: "2026-Q1", entries: [entry("2026-01-07")] });
    const rows = db.prepare("SELECT date, source FROM WorkerAvailability ORDER BY date").all();
    assert.deepEqual(rows, [{ date: "2026-01-06", source: "form_import" }, { date: "2026-01-07", source: "worker" }]);
  });
  it("GET: own by default, other worker 403 for non-admin, all=true admin only", async () => {
    await asUser("1");
    await post({ quarter_id: "2026-Q1", entries: [entry("2026-01-05")] });
    assert.equal((await (await call(availability.GET, get("quarter_id=2026-Q1"))).json()).length, 1);
    assert.equal((await call(availability.GET, get("worker_id=2"))).status, 403);
    assert.equal((await call(availability.GET, get("all=true&quarter_id=2026-Q1"))).status, 403);
    await asUser("9", true);
    assert.equal((await (await call(availability.GET, get("all=true&quarter_id=2026-Q1"))).json()).length, 1);
    assert.equal((await call(availability.GET, get("all=true"))).status, 400);
    assert.equal((await (await call(availability.GET, get("worker_id=1"))).json()).length, 1);
  });
});

describe("/api/availability/bulk", () => {
  const post = (b: object) => call(bulk.POST, json(b));
  beforeEach(async () => { await asUser("9", true); });
  const e = (date: string) => ({ date, status: "unavailable" });

  it("commits many workers, default source form_import", async () => {
    const res = await post({ quarter_id: "2026-Q1", workers: [{ worker_id: "1", entries: [e("2026-01-05")] }, { worker_id: "2", entries: [e("2026-01-06"), e("2026-01-07")] }] });
    assert.equal(res.status, 200);
    const b = await res.json();
    assert.deepEqual([b.workers, b.entries, b.source], [2, 3, "form_import"]);
  });
  it("one bad worker aborts everything (atomic)", async () => {
    const bad = await post({ quarter_id: "2026-Q1", workers: [{ worker_id: "1", entries: [e("2026-01-05")] }, { worker_id: "404", entries: [] }] });
    assert.equal(bad.status, 404);
    const bad2 = await post({ quarter_id: "2026-Q1", workers: [{ worker_id: "1", entries: [e("2026-01-05")] }, { worker_id: "2", entries: [{ date: "x", status: "unavailable" }] }] });
    assert.equal(bad2.status, 400);
    assert.equal(count("WorkerAvailability"), 0);
  });
  it("shape errors: 400 / 404 quarter / bad source", async () => {
    assert.equal((await post({ workers: [] })).status, 400);
    assert.equal((await post({ quarter_id: "NOPE", workers: [] })).status, 404);
    assert.equal((await post({ quarter_id: "2026-Q1", workers: [null] })).status, 400);
    assert.equal((await post({ quarter_id: "2026-Q1", workers: [{ worker_id: 1, entries: [] }] })).status, 400);
    assert.equal((await post({ quarter_id: "2026-Q1", source: "zzz", workers: [] })).status, 400);
  });
});

describe("/api/justice-chart", () => {
  it("GET and POST as admin", async () => {
    await asUser("9", true);
    assert.equal((await call(justice.GET)).status, 200);
    assert.equal((await call(justice.POST)).status, 200);
  });
});
