import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import {
  hashPassword, verifyPassword, createSession, verifySession,
  checkRateLimit, recordFailedLogin, clearLoginAttempts,
} from "../auth";

describe("passwords", () => {
  it("round-trips and rejects wrong password", async () => {
    const h = await hashPassword("s3cret");
    assert.notEqual(h, "s3cret");
    assert.equal(await verifyPassword("s3cret", h), true);
    assert.equal(await verifyPassword("S3cret", h), false);
  });
  it("salts: same password hashes differently", async () => {
    assert.notEqual(await hashPassword("a"), await hashPassword("a"));
  });
});

describe("sessions", () => {
  const payload = { worker_id: "1001", name: "א", is_admin: true } as never;

  it("round-trips payload", async () => {
    const t = await createSession(payload);
    const s = (await verifySession(t)) as unknown as Record<string, unknown>;
    assert.equal(s.worker_id, "1001");
    assert.equal(s.is_admin, true);
  });
  it("rejects garbage and tampered tokens", async () => {
    assert.equal(await verifySession("nope"), null);
    const t = await createSession(payload);
    assert.equal(await verifySession(t.slice(0, -2) + "xx"), null);
  });
  it("rejects a token signed with another secret", async () => {
    const forged = await new SignJWT({ worker_id: "1", is_admin: true })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("other-secret"));
    assert.equal(await verifySession(forged), null);
  });
  it("rejects an expired token", async () => {
    const expired = await new SignJWT({ worker_id: "1", is_admin: true })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(process.env.SESSION_SECRET || "fallback-dev-secret"));
    assert.equal(await verifySession(expired), null);
  });
});

describe("login rate limit", () => {
  beforeEach(() => clearLoginAttempts("w"));

  it("allows unknown workers and up to 4 failures", () => {
    assert.equal(checkRateLimit("w").allowed, true);
    for (let i = 0; i < 4; i++) recordFailedLogin("w");
    assert.equal(checkRateLimit("w").allowed, true);
  });
  it("locks on the 5th failure with remaining time", () => {
    for (let i = 0; i < 5; i++) recordFailedLogin("w");
    const r = checkRateLimit("w");
    assert.equal(r.allowed, false);
    assert.ok(r.remainingMs! > 14 * 60 * 1000 && r.remainingMs! <= 15 * 60 * 1000);
  });
  it("is per worker", () => {
    for (let i = 0; i < 5; i++) recordFailedLogin("w");
    assert.equal(checkRateLimit("other").allowed, true);
  });
  it("clearLoginAttempts unlocks", () => {
    for (let i = 0; i < 5; i++) recordFailedLogin("w");
    clearLoginAttempts("w");
    assert.equal(checkRateLimit("w").allowed, true);
  });
  it("unlocks after lockout expires and resets the counter", (t) => {
    const real = Date.now;
    t.after(() => { Date.now = real; });
    for (let i = 0; i < 5; i++) recordFailedLogin("w");
    Date.now = () => real() + 16 * 60 * 1000;
    assert.equal(checkRateLimit("w").allowed, true);
    // counter was reset: one more failure must not re-lock immediately
    recordFailedLogin("w");
    assert.equal(checkRateLimit("w").allowed, true);
  });
});
