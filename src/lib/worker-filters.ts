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

export const DEFAULT_STATUSES: WorkerStatus[] = ["active", "exempt"];

/** Single status per worker: archived wins over exempt, else active (in the shift rotation). */
export function workerStatus(w: { is_archived?: number; is_exempt: number }): WorkerStatus {
  if (w.is_archived === 1) return "archived";
  if (w.is_exempt === 1) return "exempt";
  return "active";
}

export function sameStatuses(a: WorkerStatus[], b: WorkerStatus[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((s) => sb.has(s));
}

/** Parse a comma-separated status list (e.g. from URL); unknown/duplicate entries dropped. */
export function parseStatuses(raw: string | null | undefined): WorkerStatus[] {
  const valid = new Set<string>(STATUS_OPTIONS.map((o) => o.value));
  const out = [...new Set(raw?.split(",") ?? [])].filter((s): s is WorkerStatus => valid.has(s));
  return out.length ? out : DEFAULT_STATUSES;
}

/** Click a status: toggle it; if all were selected, isolate the clicked one. Never leaves none selected. */
export function nextStatuses(current: WorkerStatus[], s: WorkerStatus): WorkerStatus[] {
  if (new Set(current).size === STATUS_OPTIONS.length) return [s];
  const next = current.includes(s) ? current.filter((x) => x !== s) : [...current, s];
  return next.length ? next : [s];
}
