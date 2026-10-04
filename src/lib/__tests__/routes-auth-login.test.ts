/** /api/auth: login, lockout, logout, session probe. */
import { resetTestDb } from "./test-db";
import { asGuest, currentToken } from "./test-session";
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as authRoute from "../../app/api/auth/route";
import { hashPassword, clearLoginAttempts, verifySession } from "../auth";

const json = (body: unknown) =>
  new Request("http://x/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const login = (b: unknown) => (authRoute.POST as unknown as (r: Request) => Promise<Response>)(json(b));

beforeEach(async () => {
  const db = resetTestDb();
  asGuest();
  for (const id of ["1", "9", "8", "7", "404", "x"]) clearLoginAttempts(id);
  db.exec(`INSERT INTO Rank (rank_id,name) VALUES ('R1','r');
    INSERT INTO Worker (worker_id,name,rank_id,is_admin) VALUES ('1','alice','R1',0);
    INSERT INTO Worker (worker_id,name,rank_id,is_admin) VALUES ('8','nopw','R1',1);
    INSERT INTO Worker (worker_id,name,rank_id,is_admin,is_archived) VALUES ('7','gone','R1',0,1);`);
  db.prepare("INSERT INTO Worker (worker_id,name,rank_id,is_admin,password_hash) VALUES ('9','root','R1',1,?)").run(await hashPassword("secret"));
});

describe("POST /api/auth", () => {
  it("worker logs in with id only; cookie holds a valid session", async () => {
    const res = await login({ worker_id: "1" });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { worker_id: "1", name: "alice", is_admin: false });
    const s = await verifySession(currentToken()!);
    assert.equal(s?.worker_id, "1");
    assert.equal(s?.is_admin, false);
  });
  it("invalid ids -> 400 (missing, non-string, too long)", async () => {
    for (const b of [{}, { worker_id: 5 }, { worker_id: "" }, { worker_id: "1".repeat(51) }]) {
      assert.equal((await login(b)).status, 400, JSON.stringify(b));
    }
  });
  it("unknown and archived workers -> 401, no cookie", async () => {
    assert.equal((await login({ worker_id: "404" })).status, 401);
    assert.equal((await login({ worker_id: "7" })).status, 401);
    assert.equal(currentToken(), undefined);
  });
  it("admin: no password -> 401 requiresPassword; wrong -> 401; right -> 200 admin", async () => {
    const none = await login({ worker_id: "9" });
    assert.equal(none.status, 401);
    assert.equal((await none.json()).requiresPassword, true);
    assert.equal((await login({ worker_id: "9", password: "nope" })).status, 401);
    assert.equal(currentToken(), undefined);
    const ok = await login({ worker_id: "9", password: "secret" });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).is_admin, true);
  });
  it("admin without stored hash -> 500, never logs in", async () => {
    assert.equal((await login({ worker_id: "8", password: "x" })).status, 500);
    assert.equal(currentToken(), undefined);
  });
  it("5 failures lock the account (429) even for the right password; other ids unaffected", async () => {
    for (let i = 0; i < 5; i++) assert.equal((await login({ worker_id: "9", password: "bad" })).status, 401);
    const locked = await login({ worker_id: "9", password: "secret" });
    assert.equal(locked.status, 429);
    assert.match((await locked.json()).error, /דקות/);
    assert.equal((await login({ worker_id: "1" })).status, 200);
  });
  it("a successful login resets the failure counter", async () => {
    for (let i = 0; i < 4; i++) await login({ worker_id: "9", password: "bad" });
    assert.equal((await login({ worker_id: "9", password: "secret" })).status, 200);
    for (let i = 0; i < 4; i++) assert.equal((await login({ worker_id: "9", password: "bad" })).status, 401);
  });
  it("unknown ids count toward lockout too", async () => {
    for (let i = 0; i < 5; i++) await login({ worker_id: "404" });
    assert.equal((await login({ worker_id: "404" })).status, 429);
  });
});

describe("GET / DELETE /api/auth", () => {
  it("GET: 401 as guest, session after login", async () => {
    assert.equal((await authRoute.GET()).status, 401);
    await login({ worker_id: "1" });
    const res = await authRoute.GET();
    assert.equal(res.status, 200);
    assert.equal((await res.json()).worker_id, "1");
  });
  it("DELETE clears the session", async () => {
    await login({ worker_id: "1" });
    assert.equal((await authRoute.DELETE()).status, 200);
    assert.equal((await authRoute.GET()).status, 401);
  });
});
