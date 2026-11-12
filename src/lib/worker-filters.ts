/** Sentinel value for "no branch/team set" in multi-select filters. */
export const NONE_VALUE = "__none__";

/** Distinct non-empty values of a field, sorted (Hebrew locale). */
export function distinctValues<T>(items: T[], get: (item: T) => string | null | undefined): string[] {
  const set = new Set<string>();
  for (const item of items) {
    const v = get(item)?.trim();
    if (v) set.add(v);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "he"));
}

/**
 * [value, label] options for a multi-select over a free-text field.
 * Adds a "none" option when some items lack a value, and keeps any selected
 * values that no longer exist (e.g. stale URL) so they can be unchecked.
 */
export function filterOptions<T>(
  items: T[],
  get: (item: T) => string | null | undefined,
  noneLabel: string,
  selected: string[] = []
): [string, string][] {
  const values = distinctValues(items, get);
  const opts: [string, string][] = values.map((v) => [v, v]);
  for (const s of selected) {
    if (s !== NONE_VALUE && !values.includes(s)) opts.push([s, s]);
  }
  if ((values.length > 0 && items.some((i) => !get(i)?.trim())) || selected.includes(NONE_VALUE)) {
    opts.push([NONE_VALUE, noneLabel]);
  }
  return opts;
}

/** True if `value` passes a multi-select filter (empty selection = pass all). */
export function matchesMulti(selected: string[], value: string | null | undefined): boolean {
  if (selected.length === 0) return true;
  const v = value?.trim();
  return v ? selected.includes(v) : selected.includes(NONE_VALUE);
}

export type WorkerStatus = "active" | "exempt" | "archived";

export const STATUS_OPTIONS: { value: WorkerStatus; label: string }[] = [
  { value: "active", label: "פעיל" },
  { value: "exempt", label: "פטור" },
  { value: "archived", label: "ארכיון" },
];

export const DEFAULT_STATUSES: readonly WorkerStatus[] = Object.freeze(["active", "exempt"] as WorkerStatus[]);

/** Single status per worker: archived wins over exempt, else active (in the shift rotation). */
export function workerStatus(w: { is_archived?: number; is_exempt: number }): WorkerStatus {
  if (w.is_archived === 1) return "archived";
  if (w.is_exempt === 1) return "exempt";
  return "active";
}

export function sameStatuses(a: readonly WorkerStatus[], b: readonly WorkerStatus[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((s) => sb.has(s));
}

/** Parse a comma-separated status list (e.g. from URL); unknown/duplicate entries dropped. */
export function parseStatuses(raw: string | null | undefined): WorkerStatus[] {
  const valid = new Set<string>(STATUS_OPTIONS.map((o) => o.value));
  const out = [...new Set(raw?.split(",") ?? [])].filter((s): s is WorkerStatus => valid.has(s));
  return out.length ? out : [...DEFAULT_STATUSES];
}

/** Click a status: toggle it; if all were selected, isolate the clicked one. Never leaves none selected. */
export function nextStatuses(current: WorkerStatus[], s: WorkerStatus): WorkerStatus[] {
  if (new Set(current).size === STATUS_OPTIONS.length) return [s];
  const next = current.includes(s) ? current.filter((x) => x !== s) : [...current, s];
  return next.length ? next : [s];
}

// ---------------------------------------------------------------------------
// Full filter state + URL (de)serialization, shared by desktop and mobile.

export type WhatsappFilter = "all" | "in" | "out";

export interface WorkerFilterState {
  search: string;
  statuses: WorkerStatus[];
  whatsapp: WhatsappFilter;
  ranks: string[];
  branches: string[];
  teams: string[];
}

export const DEFAULT_FILTERS: Readonly<WorkerFilterState> = {
  search: "",
  statuses: [...DEFAULT_STATUSES],
  whatsapp: "all",
  ranks: [],
  branches: [],
  teams: [],
};

const WHATSAPP_PARAM: Record<Exclude<WhatsappFilter, "all">, string> = {
  in: "in-whatsapp",
  out: "no-whatsapp",
};

const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];

/** Read filters from URL params. Multi-value fields use repeated params (?branch=a&branch=b). */
export function readFilters(params: { get(k: string): string | null; getAll(k: string): string[] }): WorkerFilterState {
  const wa = params.get("filter");
  return {
    search: params.get("search") ?? "",
    statuses: parseStatuses(params.get("status")),
    whatsapp: wa === WHATSAPP_PARAM.out ? "out" : wa === WHATSAPP_PARAM.in ? "in" : "all",
    ranks: uniq(params.getAll("rank")),
    branches: uniq(params.getAll("branch")),
    teams: uniq(params.getAll("team")),
  };
}

/** Write filters into URL params in place; defaults are omitted. Other params are untouched. */
export function writeFilters(state: WorkerFilterState, params: URLSearchParams): void {
  for (const k of ["search", "status", "filter", "rank", "branch", "team"]) params.delete(k);
  if (state.search) params.set("search", state.search);
  if (!sameStatuses(state.statuses, DEFAULT_STATUSES)) params.set("status", state.statuses.join(","));
  if (state.whatsapp !== "all") params.set("filter", WHATSAPP_PARAM[state.whatsapp]);
  for (const r of state.ranks) params.append("rank", r);
  for (const b of state.branches) params.append("branch", b);
  for (const t of state.teams) params.append("team", t);
}

/** Canonical query string for the filter part of the URL (used to detect external URL changes). */
export function filtersToQuery(state: WorkerFilterState): string {
  const p = new URLSearchParams();
  writeFilters(state, p);
  return p.toString();
}

/** Number of non-default filters (search excluded). */
export function activeFilterCount(state: WorkerFilterState): number {
  return (
    state.ranks.length +
    state.branches.length +
    state.teams.length +
    (sameStatuses(state.statuses, DEFAULT_STATUSES) ? 0 : 1) +
    (state.whatsapp === "all" ? 0 : 1)
  );
}

export interface FilterableWorker {
  worker_id: string;
  name: string;
  phone: string | null;
  rank_id?: string;
  branch: string | null;
  team?: string | null;
  in_whatsapp_group?: number;
  is_exempt: number;
  is_archived?: number;
}

export function applyFilters<T extends FilterableWorker>(workers: T[], state: WorkerFilterState): T[] {
  const q = state.search.trim().toLowerCase();
  return workers.filter((w) => {
    if (!state.statuses.includes(workerStatus(w))) return false;
    if (state.whatsapp === "in" && w.in_whatsapp_group !== 1) return false;
    if (state.whatsapp === "out" && w.in_whatsapp_group === 1) return false;
    if (state.ranks.length > 0 && !(w.rank_id && state.ranks.includes(w.rank_id))) return false;
    if (!matchesMulti(state.branches, w.branch)) return false;
    if (!matchesMulti(state.teams, w.team)) return false;
    if (!q) return true;
    return (
      w.name.toLowerCase().includes(q) || w.worker_id.toLowerCase().includes(q) || !!w.phone?.includes(q)
    );
  });
}

/** Add `v` to the list if absent, remove it if present. */
export function toggleValue(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}
