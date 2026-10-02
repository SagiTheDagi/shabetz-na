/**
 * Route handlers behind SimpleCrudTable (ranks + shift types), called directly
 * against an in-memory DB. Locks the contract the shared component relies on.
 */
import { resetTestDb } from "./test-db";
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type Database from "better-sqlite3";
import * as ranks from "../app/api/ranks/route";
import * as rank from "../app/api/ranks/[rankId]/route";
import * as types from "../app/api/shift-types/route";
import * as type from "../app/api/shift-types/[shiftTypeId]/route";

let db: Database.Database;
beforeEach(() => { db = resetTestDb(); });

const json = (body: unknown, method = "POST") =>
  new Request("http://x/api", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const p = <T extends string>(k: T, v: string) => ({ params: Promise.resolve({ [k]: v } as Record<T, string>) });
// handlers take NextRequest; a plain Request is sufficient at runtime
const call = (fn: unknown, ...a: unknown[]) => (fn as (...x: unknown[]) => Promise<Response>)(...a);

const CASES = [
  { name: "ranks", idKey: "rank_id", list: ranks.GET, post: ranks.POST, put: rank.PUT, del: rank.DELETE, param: "rankId", table: "Rank", other: "OL5" },
  { name: "shift-types", idKey: "shift_type_id", list: types.GET, post: types.POST, put: type.PUT, del: type.DELETE, param: "shiftTypeId", table: "ShiftType", other: "PATROL" },
] as const;

for (const c of CASES) {
  describe(`/api/${c.name}`, () => {
    const add = (id: string, name = "n", order = 1) => call(c.post, json({ [c.idKey]: id, name, display_order: order }));

    it("POST creates (201), GET lists ordered by display_order", async () => {
      assert.equal((await add("B", "second", 2)).status, 201);
      assert.equal((await add("A", "first", 1)).status, 201);
      const rows = await (await call(c.list)).json();
      assert.deepEqual(rows.map((r: Record<string, string>) => r[c.idKey]), ["A", "B"]);
    });
    it("POST trims id and name", async () => {
      const res = await call(c.post, json({ [c.idKey]: "  X ", name: " שם ", display_order: 1 }));
      const row = await res.json();
      assert.equal(row[c.idKey], "X"); assert.equal(row.name, "שם");
    });
    it("POST duplicate id -> 409", async () => {
      await add("A");
      const res = await add("A");
      assert.equal(res.status, 409);
      assert.ok((await res.json()).error);
    });
    it("POST validation: missing id / name / bad order -> 400", async () => {
      for (const body of [{ name: "n" }, { [c.idKey]: "A" }, { [c.idKey]: "A", name: "n", display_order: "x" }, { [c.idKey]: "a".repeat(31), name: "n" }]) {
        assert.equal((await call(c.post, json(body))).status, 400, JSON.stringify(body));
      }
    });
    it("POST defaults display_order to 0", async () => {
      const row = await (await call(c.post, json({ [c.idKey]: "A", name: "n" }))).json();
      assert.equal(row.display_order, 0);
    });
    it("PUT updates name+order; 404 for unknown; 400 for blank name", async () => {
      await add("A", "old", 1);
      const ok = await call(c.put, json({ name: "new", display_order: 5 }, "PUT"), p(c.param, "A"));
      assert.equal(ok.status, 200);
      assert.deepEqual([(await ok.json()).name], ["new"]);
      assert.equal((await call(c.put, json({ name: "n" }, "PUT"), p(c.param, "ZZ"))).status, 404);
      assert.equal((await call(c.put, json({ name: " " }, "PUT"), p(c.param, "A"))).status, 400);
    });
    it("PUT does not change the id", async () => {
      await add("A");
      await call(c.put, json({ [c.idKey]: "HACK", name: "n" }, "PUT"), p(c.param, "A"));
      assert.equal((db.prepare(`SELECT COUNT(*) c FROM ${c.table} WHERE ${c.idKey}='A'`).get() as { c: number }).c, 1);
    });
    it("DELETE removes; 404 when missing", async () => {
      await add("A");
      assert.equal((await call(c.del, new Request("http://x", { method: "DELETE" }), p(c.param, "A"))).status, 200);
      assert.equal((await call(c.del, new Request("http://x", { method: "DELETE" }), p(c.param, "A"))).status, 404);
    });
  });
}

describe("delete is blocked while referenced (409)", () => {
  it("rank with workers", async () => {
    db.exec("INSERT INTO Rank (rank_id,name) VALUES ('R1','a'); INSERT INTO Worker (worker_id,name,rank_id) VALUES ('1','w','R1')");
    const res = await call(rank.DELETE, new Request("http://x", { method: "DELETE" }), p("rankId", "R1"));
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /1 עובדים/);
    assert.equal((db.prepare("SELECT COUNT(*) c FROM Rank").get() as { c: number }).c, 1);
  });
  it("shift type with shift dates", async () => {
    db.exec(`INSERT INTO ShiftType (shift_type_id,name) VALUES ('P','p');
      INSERT INTO Quarter VALUES ('Q','2026-07-01','2026-09-30','draft',datetime('now'));
      INSERT INTO ShiftDate VALUES ('S','Q','2026-07-10','P',0)`);
    const res = await call(type.DELETE, new Request("http://x", { method: "DELETE" }), p("shiftTypeId", "P"));
    assert.equal(res.status, 409);
    assert.equal((db.prepare("SELECT COUNT(*) c FROM ShiftType").get() as { c: number }).c, 1);
  });
});
