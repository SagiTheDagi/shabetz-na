import { useSyncExternalStore } from "react";

/** Selected-quarter storage shared by the admin header and pages. Broadcasts changes within the tab. */
const KEY = "selectedQuarter";
const EVENT = "shabetz:quarter";

export function getStoredQuarter(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setStoredQuarter(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {}
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: id }));
}

export function subscribeQuarter(cb: (id: string) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<string>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

/** Currently selected quarter id (null on the server / when unset). */
export function useSelectedQuarter(): string | null {
  return useSyncExternalStore(
    (cb) => subscribeQuarter(cb),
    getStoredQuarter,
    () => null
  );
}
