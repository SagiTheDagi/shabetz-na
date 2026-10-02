export type FetchJsonResult<T> = { ok: true; data: T } | { ok: false };

/** GET `url` and parse JSON. Never throws: non-2xx, network and parse errors all yield `{ ok: false }`. */
export async function fetchJson<T>(
  url: string,
  fetchImpl: typeof fetch = fetch
): Promise<FetchJsonResult<T>> {
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return { ok: false };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false };
  }
}
