"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  DEFAULT_FILTERS,
  FilterableWorker,
  WorkerFilterState,
  filterOptions,
  filtersToQuery,
  readFilters,
  writeFilters,
} from "@/lib/worker-filters";

interface UrlState {
  filters: WorkerFilterState;
  selectedId: string | null;
}

const WORKER_PARAM = "worker";

/** Canonical string for comparing URL states (filters + selected worker). */
function urlStateKey(params: URLSearchParams): string {
  return `${filtersToQuery(readFilters(params))}#${params.get(WORKER_PARAM) ?? ""}`;
}
function stateKey(s: UrlState): string {
  return `${filtersToQuery(s.filters)}#${s.selectedId ?? ""}`;
}
function readUrlState(params: URLSearchParams): UrlState {
  return { filters: readFilters(params), selectedId: params.get(WORKER_PARAM) };
}
/** replaceState with the given param changes. Returns false if the browser refused it. */
function replaceUrl(mutate: (p: URLSearchParams) => void): boolean {
  const url = new URL(window.location.href);
  mutate(url.searchParams);
  if (url.href === window.location.href) return true;
  try {
    window.history.replaceState(null, "", url);
    return true;
  } catch {
    return false; // Safari throttles replaceState (~100 calls / 10s)
  }
}
const WRITE_RETRY_MS = 1000;
/** The browser's real current params (inside effects, always up to date). */
function realParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

/**
 * Workers-page state that lives in the URL: list filters + the selected worker (`?worker=`).
 * This hook is the only writer of those params. Kept in the page component so it survives
 * desktop↔mobile layout switches.
 *
 * State is the source of truth and is written to the URL (replaceState) on every change.
 * URL → state handles external navigation (e.g. a nav link to this route with other params).
 *
 * Echo handling: Next delivers `useSearchParams` updates asynchronously after replaceState, so
 * an update can be a lagging echo of an older write of ours. Our latest write is always in
 * `window.location` (React flushes pending effects — our writes — before rendering a later
 * update), so an update that doesn't match the real URL is an echo and is ignored.
 * Covered by scripts/e2e-workers.mjs (incl. CPU-throttled runs).
 */
export function useWorkersUrlState() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [state, setState] = useState<UrlState>(() =>
    readUrlState(new URLSearchParams(searchParams.toString()))
  );
  const stateRef = useRef(state);
  // Set when URL → state adopts a navigation, so the same commit's write effect doesn't
  // write the pre-navigation state back over it.
  const skipNextWrite = useRef(false);
  // A refused write leaves the real URL behind state, so URL updates can't be told apart
  // from stale echoes; until a write succeeds, URL → state is paused and writes are retried.
  const writeFailed = useRef(false);

  // Effects run in declaration order: keep the ref current, then read the URL, then write it.
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // URL → state. Keyed on the params object (new per navigation), not its string, so a
  // navigation that lands on the same query as the last delivered snapshot is still seen.
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    const key = urlStateKey(params);
    if (writeFailed.current) return; // real URL is behind state; see writeFailed
    if (key !== urlStateKey(realParams())) return; // lagging echo of our own write
    if (key === stateKey(stateRef.current)) return; // already in sync
    const next = readUrlState(params);
    stateRef.current = next;
    skipNextWrite.current = true;
    // Syncing from the router (an external system) is what this effect is for
    setState(next);
  }, [searchParams]);

  // State → URL
  useEffect(() => {
    if (skipNextWrite.current) {
      skipNextWrite.current = false;
      return;
    }
    let retry: ReturnType<typeof setTimeout> | undefined;
    const write = () => {
      // Never write onto another route's URL (e.g. right after navigating away)
      if (window.location.pathname !== pathname) return;
      const latest = stateRef.current;
      const ok = replaceUrl((p) => {
        writeFilters(latest.filters, p);
        if (latest.selectedId) p.set(WORKER_PARAM, latest.selectedId);
        else p.delete(WORKER_PARAM);
      });
      writeFailed.current = !ok;
      if (!ok) retry = setTimeout(write, WRITE_RETRY_MS);
    };
    write();
    return () => clearTimeout(retry);
  }, [state, pathname]);

  const update = useCallback(
    (patch: Partial<WorkerFilterState>) =>
      setState((prev) => ({ ...prev, filters: { ...prev.filters, ...patch } })),
    []
  );
  const reset = useCallback(
    () =>
      setState((prev) => ({
        ...prev,
        filters: { ...DEFAULT_FILTERS, statuses: [...DEFAULT_FILTERS.statuses] },
      })),
    []
  );
  const setSelectedId = useCallback(
    (selectedId: string | null) => setState((prev) => ({ ...prev, selectedId })),
    []
  );
  /** Clear the selection and remove `?worker=` from the URL right now (e.g. before navigating away). */
  const clearSelectionNow = useCallback(() => {
    replaceUrl((p) => p.delete(WORKER_PARAM));
    stateRef.current = { ...stateRef.current, selectedId: null };
    setState((prev) => ({ ...prev, selectedId: null }));
  }, []);

  return {
    filters: state.filters,
    update,
    reset,
    selectedId: state.selectedId,
    setSelectedId,
    clearSelectionNow,
  };
}

export type WorkersUrlStateApi = ReturnType<typeof useWorkersUrlState>;

/** Branch/team [value, label] options for the current workers + selection. */
export function useFilterOptions(workers: FilterableWorker[], filters: WorkerFilterState) {
  const branchOptions = useMemo(
    () => filterOptions(workers, (w) => w.branch, "ללא ענף", filters.branches),
    [workers, filters.branches]
  );
  const teamOptions = useMemo(
    () => filterOptions(workers, (w) => w.team, "ללא צוות", filters.teams),
    [workers, filters.teams]
  );
  return { branchOptions, teamOptions };
}
