import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";
import { createSession } from "./auth";

const run = async (path: string, who?: "worker" | "admin", method = "GET") => {
  const headers: Record<string, string> = {};
  if (who) {
    const t = await createSession({ worker_id: "1", name: "n", is_admin: who === "admin" } as never);
    headers.cookie = `shabetz_session=${t}`;
  }
  return middleware(new NextRequest(`http://x${path}`, { method, headers }));
};
const passes = (r: Response) => r.headers.get("x-middleware-next") === "1";

describe("middleware: API login is always enforced", () => {
  const API = ["/api/quarters", "/api/justice-chart", "/api/availability", "/api/workers", "/api/unknown-new-route"];
  for (const path of API) {
    it(`${path}: guest -> 401`, async () => {
      assert.equal((await run(path)).status, 401);
    });
  }
  it("/api/auth stays public", async () => {
    assert.ok(passes(await run("/api/auth", undefined, "POST")));
  });
  it("worker may GET /api/quarters but not POST", async () => {
    assert.ok(passes(await run("/api/quarters", "worker")));
    assert.equal((await run("/api/quarters", "worker", "POST")).status, 403);
    assert.ok(passes(await run("/api/quarters", "admin", "POST")));
  });
  it("worker blocked from admin APIs, allowed on availability/justice", async () => {
    for (const p of ["/api/workers", "/api/assignments", "/api/ranks", "/api/shifts"]) {
      assert.equal((await run(p, "worker")).status, 403, p);
    }
    assert.ok(passes(await run("/api/availability", "worker")));
    assert.ok(passes(await run("/api/justice-chart", "worker")));
  });
  it("page routes redirect guests; worker can't enter /admin", async () => {
    assert.equal((await run("/worker")).status, 307);
    assert.equal((await run("/admin/assign", "worker")).status, 307);
    assert.ok(passes(await run("/admin/assign", "admin")));
  });
});
