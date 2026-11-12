"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  DEFAULT_FILTERS,
  FilterableWorker,
  WorkerFilterState,
  filterOptions,
  filtersToQuery,
  readFilters,
  writeFilters,
} from "@/lib/worker-filters";

/**
 * Worker-list filter state, initialized from and mirrored to the URL.
 * Lives in the page so it survives desktop↔mobile layout switches.
 */
export function useWorkerFilters() {
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<WorkerFilterState>(() => readFilters(searchParams));

  // State → URL
  useEffect(() => {
    const url = new URL(window.location.href);
    writeFilters(filters, url.searchParams);
    if (url.href !== window.location.href) window.history.replaceState(null, "", url);
  }, [filters]);

  // URL → state, for external navigation (e.g. a nav link to the same route with other params).
  // Our own writes produce an identical query, so they're a no-op here.
  // Done during render (not in an effect) per React's "adjusting state on prop change" pattern.
  const queryKey = searchParams.toString();
  const [seenQuery, setSeenQuery] = useState(queryKey);
  if (queryKey !== seenQuery) {
    setSeenQuery(queryKey);
    const fromUrl = readFilters(searchParams);
    if (filtersToQuery(fromUrl) !== filtersToQuery(filters)) setFilters(fromUrl);
  }

  const update = (patch: Partial<WorkerFilterState>) => setFilters((prev) => ({ ...prev, ...patch }));
  const reset = () => setFilters({ ...DEFAULT_FILTERS, statuses: [...DEFAULT_FILTERS.statuses] });

  return { filters, update, reset };
}

export type WorkerFiltersApi = ReturnType<typeof useWorkerFilters>;

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
