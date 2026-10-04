/**
 * Test-only: stubs `next/headers` so getSession() works outside a request.
 * Needs `--experimental-test-module-mocks` (set in the npm test script) and
 * must be imported BEFORE anything that imports ./auth, which is why auth is
 * loaded lazily inside asUser. Use `asUser(...)` / `asGuest()` to choose who
 * the next handler call sees.
 */
import { mock } from "node:test";

let token: string | undefined;

mock.module("next/headers", {
  exports: {
    cookies: async () => ({
      get: () => (token ? { value: token } : undefined),
      set: (_n: string, v: string) => { token = v; },
      delete: () => { token = undefined; },
    }),
  },
} as never);

export async function asUser(worker_id: string, is_admin = false) {
  const { createSession } = await import("../auth");
  token = await createSession({ worker_id, name: `w${worker_id}`, is_admin } as never);
}
/** The cookie the handlers last set (login) or cleared (logout). */
export const currentToken = () => token;
export function asGuest() { token = undefined; }
