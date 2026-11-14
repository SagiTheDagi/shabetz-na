/**
 * Output tools: render_chart / render_table. No DB access. The model sends a
 * spec that references a result_id; the server validates the keys against the
 * stored columns and joins the rows, so the numbers on screen always come from
 * the query. The client gets the full spec (with data + source); the model
 * gets only a short confirmation.
 */
import { z } from "zod";
import { ToolError } from "./errors";
import type { ResultStore, Row, ResultSource } from "./result-store";

export const MAX_RENDER_ROWS = 500;

export const CHART_KINDS = ["bar", "stacked_bar", "line", "area", "pie"] as const;

export const chartSpecInputSchema = z.strictObject({
  result_id: z.string(),
  kind: z.enum(CHART_KINDS),
  title: z.string().min(1),
  x: z.strictObject({
    key: z.string(),
    label: z.string(),
    type: z.enum(["category", "date", "number"]),
  }),
  series: z.array(z.strictObject({ key: z.string(), label: z.string() })).min(1),
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

/** Join rows into a chart spec. Pure given the store. */
export function renderChart(raw: unknown, store: ResultStore, owner = ""): RenderOutput<ChartSpec> {
  const { result_id, ...rest } = parse(chartSpecInputSchema, raw, "render_chart");
  const result = lookup(store, result_id, owner);
  checkKeys([rest.x.key, ...rest.series.map((s) => s.key)], result.columns);
  if (rest.kind === "pie" && rest.series.length !== 1) throw new ToolError("A pie chart takes exactly one series.");
  const truncated = result.rows.length > MAX_RENDER_ROWS;
  const data = result.rows.slice(0, MAX_RENDER_ROWS);
  return {
    spec: { ...rest, data, source: result.source, ...(truncated ? { truncated } : {}) },
    forModel: { rendered: true, rows: data.length, ...(truncated ? { truncated } : {}) },
  };
}

/** Join rows into a table spec. Columns default to every result column. */
export function renderTable(raw: unknown, store: ResultStore, owner = ""): RenderOutput<TableSpec> {
  const { result_id, title, columns } = parse(tableSpecInputSchema, raw, "render_table");
  const result = lookup(store, result_id, owner);
  const cols = columns && columns.length ? columns : result.columns.map((c) => ({ key: c, label: c }));
  checkKeys(cols.map((c) => c.key), result.columns);
  const truncated = result.rows.length > MAX_RENDER_ROWS;
  const data = result.rows.slice(0, MAX_RENDER_ROWS);
  return {
    spec: { title, columns: cols, data, source: result.source, ...(truncated ? { truncated } : {}) },
    forModel: { rendered: true, rows: data.length, ...(truncated ? { truncated } : {}) },
  };
}

export const RENDER_TOOLS = [
  {
    name: "render_chart",
    description:
      "Show a chart of a stored query result to the user. Reference the result by result_id; never copy data. " +
      "x.key and every series[].key must be columns of that result. Titles and labels in Hebrew. " +
      "kind: bar | stacked_bar | line | area | pie (exactly one series).",
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
