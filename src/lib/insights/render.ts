/**
 * Output tools: render_chart / render_table. No DB access. The model sends a
 * spec that references a result_id; the server validates the keys against the
 * stored columns and joins the rows, so the numbers on screen always come from
 * the query. The client gets the full spec (with data + source); the model
 * gets only a short confirmation.
 */
import { z } from "zod";
import { ToolError } from "./errors";
import { daysBetween, isIsoDate } from "../date-utils";
import type { ResultStore, Row, ResultSource, StoredResult } from "./result-store";
import { MAX_CHART_SERIES, MAX_HEATMAP_DAYS, MAX_RENDER_ROWS } from "./config";

export const CHART_KINDS = ["bar", "stacked_bar", "line", "area", "pie", "heatmap_calendar"] as const;

export const chartSpecInputSchema = z.strictObject({
  result_id: z.string(),
  kind: z.enum(CHART_KINDS),
  title: z.string().min(1),
  x: z.strictObject({
    key: z.string(),
    label: z.string(),
    type: z.enum(["category", "date", "number"]),
  }),
  // More series than palette colors would repeat colors.
  series: z.array(z.strictObject({ key: z.string(), label: z.string() })).min(1).max(MAX_CHART_SERIES),
});

export const tableSpecInputSchema = z.strictObject({
  result_id: z.string(),
  title: z.string().min(1),
  columns: z
    .array(z.strictObject({ key: z.string(), label: z.string() }))
    .optional(),
});

export type ChartSpecInput = z.infer<typeof chartSpecInputSchema>;
export type TableSpecInput = z.infer<typeof tableSpecInputSchema>;

export type ChartSpec = Omit<ChartSpecInput, "result_id"> & {
  data: Row[];
  source: ResultSource;
  truncated?: boolean;
};

export type TableSpec = {
  title: string;
  columns: { key: string; label: string }[];
  /** No columns were chosen: they are every result column. Saving then omits them, so re-runs follow the result. */
  columns_default?: true;
  data: Row[];
  source: ResultSource;
  truncated?: boolean;
};

export interface RenderOutput<S> {
  /** Sent to the client. */
  spec: S;
  /** Sent back to the model. */
  forModel: { rendered: true; rows: number; truncated?: boolean };
}

function lookup(store: ResultStore, id: string, owner: string) {
  const r = store.get(id, owner);
  if (!r) throw new ToolError(`result_id "${id}" is unknown or expired. Re-run the query tool to get a new result_id.`);
  return r;
}

function checkKeys(keys: string[], columns: string[]) {
  const missing = keys.filter((k) => !columns.includes(k));
  if (missing.length) {
    throw new ToolError(`Unknown column(s): ${missing.join(", ")}. Available columns: ${columns.join(", ")}.`);
  }
}

function parse<T>(schema: z.ZodType<T>, raw: unknown, name: string): T {
  const p = schema.safeParse(raw ?? {});
  if (!p.success) throw new ToolError(`Invalid input for ${name}: ${z.prettifyError(p.error)}`);
  return p.data;
}

/** The client calendar only places YYYY-MM-DD days; anything else would render an empty calendar with no error. */
function checkHeatmapDates(key: string, rows: Row[]) {
  const bad = rows.some((r) => { const v = r[key]; return v !== null && v !== undefined && v !== "" && !isIsoDate(String(v)); });
  if (bad) {
    // The value is left out: x could be a worker id column, and short ids aren't aliased in free text.
    throw new ToolError(`heatmap_calendar needs x values as real YYYY-MM-DD dates; column "${key}" has other values. Use date(column) in SQL, or another chart kind.`);
  }
}

/** New charts only: saved views over growing history must keep re-running (the client clips those). */
function checkHeatmapSpan(key: string, rows: Row[]) {
  const dates = rows.map((r) => String(r[key] ?? "")).filter(isIsoDate).sort();
  if (dates.length && daysBetween(dates[0], dates[dates.length - 1]) > MAX_HEATMAP_DAYS) {
    throw new ToolError(`heatmap_calendar spans ${dates[0]}..${dates[dates.length - 1]}; at most ${MAX_HEATMAP_DAYS} days. Filter the date range in SQL, or aggregate by month with another chart kind.`);
  }
}

type ResultRows = Pick<StoredResult, "source" | "columns" | "rows">;

/**
 * A saved heatmap over growing history: rows summed per date (as the calendar
 * does), then the latest MAX_RENDER_ROWS days. One row per day, so a day is
 * never split by the cut and the result is never empty.
 */
function latestDays(rows: Row[], xKey: string, vKey: string): Row[] {
  const sums = new Map<string, number | null>();
  for (const r of rows) {
    const d = String(r[xKey] ?? "");
    const raw = r[vKey];
    const v = raw === null || raw === undefined || raw === "" ? NaN : Number(raw);
    const prev = sums.get(d) ?? null;
    sums.set(d, Number.isFinite(v) ? (prev ?? 0) + v : prev);
  }
  return [...sums]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .slice(0, MAX_RENDER_ROWS)
    .map(([d, v]) => ({ [xKey]: d, [vKey]: v }));
}

/** Maps a key the model wrote to the stored column it names (pseudonymization: aliases in column names). */
export type KeyResolver = (key: string, columns: readonly string[]) => string;
const sameKey: KeyResolver = (k) => k;

/** Join rows into a chart spec. Pure given the store. */
export function renderChart(raw: unknown, store: ResultStore, owner = "", resolveKey: KeyResolver = sameKey): RenderOutput<ChartSpec> {
  const { result_id, ...input } = parse(chartSpecInputSchema, raw, "render_chart");
  const result = lookup(store, result_id, owner);
  const k = (key: string) => resolveKey(key, result.columns);
  const rest = { ...input, x: { ...input.x, key: k(input.x.key) }, series: input.series.map((s) => ({ ...s, key: k(s.key) })) };
  // New charts only: saved views made before this check must keep re-running.
  if (rest.series.some((s) => s.key === rest.x.key)) throw new ToolError("A series key can't be the x key.");
  if (rest.kind === "heatmap_calendar") {
    if (rest.series.length !== 1) throw new ToolError("A heatmap_calendar takes exactly one series.");
    if (result.rows.length > MAX_RENDER_ROWS) {
      throw new ToolError(`heatmap_calendar takes at most ${MAX_RENDER_ROWS} rows; got ${result.rows.length}. GROUP BY date in SQL.`);
    }
    checkHeatmapSpan(rest.x.key, result.rows);
  }
  return chartFromResult(rest, result);
}

/** Join a result's rows into an already-parsed chart spec (saved-view re-runs skip the store). */
export function chartFromResult(rest: Omit<ChartSpecInput, "result_id">, result: ResultRows): RenderOutput<ChartSpec> {
  checkKeys([rest.x.key, ...rest.series.map((s) => s.key)], result.columns);
  if (rest.kind === "pie" && rest.series.length !== 1) throw new ToolError("A pie chart takes exactly one series.");
  if (rest.kind === "heatmap_calendar") checkHeatmapDates(rest.x.key, result.rows);
  const truncated = result.rows.length > MAX_RENDER_ROWS;
  const data = truncated && rest.kind === "heatmap_calendar"
    ? latestDays(result.rows, rest.x.key, rest.series[0].key)
    : result.rows.slice(0, MAX_RENDER_ROWS);
  return {
    spec: { ...rest, data, source: result.source, ...(truncated ? { truncated } : {}) },
    forModel: { rendered: true, rows: data.length, ...(truncated ? { truncated } : {}) },
  };
}

/** Join rows into a table spec. Columns default to every result column. */
export function renderTable(raw: unknown, store: ResultStore, owner = "", resolveKey: KeyResolver = sameKey): RenderOutput<TableSpec> {
  const { result_id, ...rest } = parse(tableSpecInputSchema, raw, "render_table");
  const result = lookup(store, result_id, owner);
  const columns = rest.columns?.map((c) => ({ ...c, key: resolveKey(c.key, result.columns) }));
  return tableFromResult({ ...rest, ...(columns ? { columns } : {}) }, result);
}

/** Join a result's rows into an already-parsed table spec (saved-view re-runs skip the store). */
export function tableFromResult({ title, columns }: Omit<TableSpecInput, "result_id">, result: ResultRows): RenderOutput<TableSpec> {
  const chosen = !!columns?.length;
  const cols = chosen ? columns! : result.columns.map((c) => ({ key: c, label: c }));
  checkKeys(cols.map((c) => c.key), result.columns);
  const truncated = result.rows.length > MAX_RENDER_ROWS;
  const data = result.rows.slice(0, MAX_RENDER_ROWS);
  return {
    spec: {
      title,
      columns: cols,
      ...(chosen ? {} : { columns_default: true as const }),
      data,
      source: result.source,
      ...(truncated ? { truncated } : {}),
    },
    forModel: { rendered: true, rows: data.length, ...(truncated ? { truncated } : {}) },
  };
}

export const RENDER_TOOLS = [
  {
    name: "render_chart",
    description:
      "Show a chart of a stored query result to the user. Reference the result by result_id; never copy data. " +
      "x.key and every series[].key must be columns of that result. Titles and labels in Hebrew. " +
      "kind: bar | stacked_bar | line | area | pie (exactly one series) | heatmap_calendar (x = date column).",
    schema: chartSpecInputSchema,
  },
  {
    name: "render_table",
    description:
      "Show a stored query result as a sortable table. Optional columns picks and labels (Hebrew) a subset; " +
      "omit to show all columns.",
    schema: tableSpecInputSchema,
  },
] as const;
