import { resetTestDb } from "./test-db";
import { asUser, asGuest } from "./test-session";
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { getDb } from "../db";
import { requireSession, requireAdmin, AuthError } from "../auth";
import { ValidationError } from "../validation";
import { withApiErrors, insertOrConflict, updateOrNotFound, deleteOrNotFound } from "../api-helpers";

beforeEach(() => { resetTestDb(); asGuest(); });

describe("requireSession / requireAdmin", () => {
  it("no cookie -> AuthError 401", async () => {
    await assert.rejects(requireSession(), (e: AuthError) => e instanceof AuthError && e.status === 401);
    await assert.rejects(requireAdmin(), (e: AuthError) => e.status === 401);
  });
  it("worker passes requireSession, fails requireAdmin with 403", async () => {
    await asUser("1", false);
    assert.equal((await requireSession()).worker_id, "1");
    await assert.rejects(requireAdmin(), (e: AuthError) => e instanceof AuthError && e.status === 403);
  });
  it("admin passes both", async () => {
    await asUser("9", true);
    assert.equal((await requireAdmin()).worker_id, "9");
  });
});

describe("withApiErrors", () => {
  const run = (fn: () => Promise<Response>) => withApiErrors(fn)();
  it("passes the response and arguments through", async () => {
    const h = withApiErrors(async (a: number, b: number) => Response.json({ s: a + b }, { status: 201 }));
    const res = await h(2, 3);
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { s: 5 });
  });
  it("ValidationError -> 400 with message", async () => {
    const res = await run(async () => { throw new ValidationError("bad"); });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "bad" });
  });
  it("AuthError -> its status", async () => {
    for (const s of [401, 403] as const) {
      const res = await run(async () => { throw new AuthError("no", s); });
      assert.equal(res.status, s);
    }
  });
  it("unknown errors are rethrown", async () => {
    await assert.rejects(run(async () => { throw new TypeError("boom"); }), TypeError);
  });
  it("malformed JSON body is rethrown, not a silent 200", async () => {
    const h = withApiErrors(async (r: Request) => Response.json(await r.json()));
    await assert.rejects(h(new Request("http://x", { method: "POST", body: "{nope" })));
  });
});

describe("CRUD helpers", () => {
  const ins = (id: string, name = "n") =>
    insertOrConflict({ table: "Rank", idColumn: "rank_id", row: { rank_id: id, name, display_order: 1 }, conflictMessage: "dup" });

  it("insertOrConflict: 201 then 409 leaving the original untouched", async () => {
    const a = ins("A", "first");
    assert.equal(a.status, 201);
    assert.equal((await a.json()).name, "first");
    const b = ins("A", "second");
    assert.equal(b.status, 409);
    assert.deepEqual(await b.json(), { error: "dup" });
    assert.equal((getDb().prepare("SELECT name FROM Rank WHERE rank_id='A'").get() as { name: string }).name, "first");
  });
  it("insertOrConflict binds values (no SQL injection via values)", async () => {
    const res = ins("A", "x'); DROP TABLE Rank;--");
    assert.equal(res.status, 201);
    assert.equal((await res.json()).name, "x'); DROP TABLE Rank;--");
  });
  it("updateOrNotFound: updates and returns row; 404 when missing", async () => {
    ins("A");
    const ok = updateOrNotFound({ table: "Rank", idColumn: "rank_id", id: "A", set: { name: "z", display_order: 7 }, notFoundMessage: "nf" });
    assert.equal(ok.status, 200);
    const row = await ok.json();
    assert.equal(row.name, "z");
    assert.equal(row.display_order, 7);
    assert.equal(row.rank_id, "A");
    const miss = updateOrNotFound({ table: "Rank", idColumn: "rank_id", id: "ZZ", set: { name: "z" }, notFoundMessage: "nf" });
    assert.equal(miss.status, 404);
    assert.deepEqual(await miss.json(), { error: "nf" });
  });
  it("deleteOrNotFound: ok then 404 on repeat", async () => {
    ins("A");
    const args = { table: "Rank", idColumn: "rank_id", id: "A", notFoundMessage: "nf" };
    assert.equal(deleteOrNotFound(args).status, 200);
    assert.equal(deleteOrNotFound(args).status, 404);
  });
});

