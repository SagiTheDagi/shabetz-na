import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchJson } from "../fetch-json";

const resp = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("fetchJson", () => {
  it("returns parsed data on 2xx", async () => {
    assert.deepEqual(await fetchJson("/x", resp({ a: 1 })), { ok: true, data: { a: 1 } });
  });
  it("returns ok:false on non-2xx", async () => {
    assert.deepEqual(await fetchJson("/x", resp({ error: "no" }, 500)), { ok: false });
    assert.deepEqual(await fetchJson("/x", resp({}, 401)), { ok: false });
  });
  it("returns ok:false on network error", async () => {
    const f = (async () => { throw new TypeError("net"); }) as unknown as typeof fetch;
    assert.deepEqual(await fetchJson("/x", f), { ok: false });
  });
  it("returns ok:false on invalid JSON", async () => {
    const f = (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch;
    assert.deepEqual(await fetchJson("/x", f), { ok: false });
  });
  it("passes the url through", async () => {
    let seen = "";
    const f = (async (u: string) => { seen = u; return new Response("[]"); }) as unknown as typeof fetch;
    await fetchJson("/api/ranks", f);
    assert.equal(seen, "/api/ranks");
  });
});
