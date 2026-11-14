import { useSyncExternalStore } from "react";

/** Open state of the desktop assistant panel, shared by the admin header toggle and the panel. Remembered per browser. */
const KEY = "insightsPanelOpen";
const EVENT = "shabetz:insights-panel";

function getOpen(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setAssistantOpen(open: boolean) {
  try {
    localStorage.setItem(KEY, open ? "1" : "0");
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

export function useAssistantOpen(): boolean {
  return useSyncExternalStore(subscribe, getOpen, () => false);
}
