/**
 * Saved insight views: shared between admins. Only the spec (without data)
 * and the source {tool, args} are stored; opening a view re-runs the source
 * directly, without the model, so it is free and current.
 *
 * Stored SQL is never trusted: saves and re-runs go through the tool's run(),
 * which calls guardSql and the isolated runner every time.
 */
import { z } from "zod";
import { randomUUID } from "crypto";
import type { Database } from "better-sqlite3";
import { ToolError } from "./errors";
import { AI_VIEWS_VERSION } from "./views";
import { parseArgs, type RunCtx } from "./tools";
import { QUERY_TOOL_MAP } from "./query-tools";
import { chartSpecInputSchema, tableSpecInputSchema, chartFromResult, tableFromResult, type ChartSpec, type TableSpec } from "./render";
import type { SavedInsight } from "../types";

export const OUTDATED_MESSAGE = "התצוגה נשמרה לפני שינוי מבנה הנתונים, יש ליצור אותה מחדש";

// Top level strips unknown keys (e.g. data, source) instead of rejecting them.
const chartSpecSaved = z.object(chartSpecInputSchema.omit({ result_id: true }).shape);
const tableSpecSaved = z.object(tableSpecInputSchema.omit({ result_id: true }).shape);

export const saveRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("chart"),
    title: z.string().trim().min(1).max(120),
    question: z.string().max(2000).default(""),
    spec: chartSpecSaved,
    source: z.object({ tool: z.string(), args: z.unknown() }),
  }),
  z.object({
    kind: z.literal("table"),
    title: z.string().trim().min(1).max(120),
    question: z.string().max(2000).default(""),
    spec: tableSpecSaved,
    source: z.object({ tool: z.string(), args: z.unknown() }),
  }),
]);
export type SaveRequest = z.infer<typeof saveRequestSchema>;

export interface SavedView {
  insight_id: string;
  title: string;
  question: string;
  kind: "chart" | "table";
  spec: Record<string, unknown>;
  source: { tool: string; args: unknown };
  /** Informational: AI_VIEWS_VERSION at save time. Staleness is decided per view on re-run. */
  schema_version: number;
  /** Row JSON couldn't be parsed; the view can only be deleted. */
  corrupt: boolean;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
}

/**
 * The view's source tool, args or spec keys no longer match the data shape
 * (tool removed, args schema changed, column dropped/renamed), or its row is
 * corrupt. Decided per view, not by a global version, so a change to one
 * ai_* view only affects the saved views that use it.
 */
export class OutdatedViewError extends Error {}

type SpecInput = { kind: "chart" | "table"; spec: Record<string, unknown> };
type RerunResult = { kind: "chart"; spec: ChartSpec } | { kind: "table"; spec: TableSpec };

type ParsedSpec =
  | { kind: "chart"; spec: z.infer<typeof chartSpecSaved> }
  | { kind: "table"; spec: z.infer<typeof tableSpecSaved> };

/** A stored spec that no longer fits the render schema counts as outdated. */
function parseSpec({ kind, spec }: SpecInput): ParsedSpec {
  const p = (kind === "chart" ? chartSpecSaved : tableSpecSaved).safeParse(spec);
  if (!p.success) throw new OutdatedViewError(`spec no longer valid: ${z.prettifyError(p.error)}`);
  return { kind, spec: p.data } as ParsedSpec;
}

function specKeys(v: ParsedSpec): string[] {
  if (v.kind === "chart") return [v.spec.x.key, ...v.spec.series.map((s) => s.key)];
  return (v.spec.columns ?? []).map((c) => c.key);
}

/**
 * Runs the source and renders the spec against fresh rows. The tool's run()
 * guards SQL itself, so stored SQL is re-checked every time. Throws
 * OutdatedViewError for a shape mismatch, ToolError for anything else.
 */
async function runView(view: SpecInput & { source: { tool: string; args: unknown } }, ctx: RunCtx) {
  const tool = QUERY_TOOL_MAP.get(view.source.tool);
  if (!tool) throw new OutdatedViewError(`unknown source tool ${view.source.tool}`);
  let args: Record<string, unknown>;
  try {
    args = parseArgs(tool, view.source.args);
  } catch (e) {
    if (e instanceof ToolError) throw new OutdatedViewError(e.message);
    throw e;
  }
  const parsed = parseSpec(view);
  const out = await tool.run(args, ctx);
  const missing = specKeys(parsed).filter((k) => !out.columns.includes(k));
  if (missing.length) throw new OutdatedViewError(`missing column(s): ${missing.join(", ")}`);
  const rows = { source: { tool: tool.name, args }, columns: out.columns, rows: out.rows };
  const result: RerunResult =
    parsed.kind === "chart"
      ? { kind: "chart", spec: chartFromResult(parsed.spec, rows).spec }
      : { kind: "table", spec: tableFromResult(parsed.spec, rows).spec };
  return { args, result };
}

/**
 * Validates by actually running the source and rendering the spec (read-only
 * ctx), so a view that can never render (unknown keys, bad pie) isn't stored.
 * Throws ToolError / OutdatedViewError.
 */
export async function createSavedView(
  db: Database,
  req: SaveRequest,
  createdBy: string,
  runCtx: RunCtx,
): Promise<SavedView> {
  const spec = { ...req.spec, title: req.title };
  const { args } = await runView({ kind: req.kind, spec, source: req.source }, runCtx);
  const id = randomUUID();
  // spec_json = { kind: "chart" | "table", spec } (a chart spec has its own `kind`).
  db.prepare(
    `INSERT INTO SavedInsight (insight_id, title, question, spec_json, source_json, schema_version, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    req.title,
    req.question,
    JSON.stringify({ kind: req.kind, spec }),
    JSON.stringify({ tool: req.source.tool, args }),
    AI_VIEWS_VERSION,
    createdBy,
  );
  return getSavedView(db, id)!;
}

type Row = SavedInsight & { created_by_name: string | null };

function toView(r: Row): SavedView {
  const base = {
    insight_id: r.insight_id,
    title: r.title,
    question: r.question,
    schema_version: r.schema_version,
    created_by: r.created_by,
    created_by_name: r.created_by_name,
    created_at: r.created_at,
  };
  try {
    const { kind, spec } = JSON.parse(r.spec_json) as SpecInput;
    const source = JSON.parse(r.source_json) as SavedView["source"];
    if ((kind !== "chart" && kind !== "table") || !spec || typeof spec !== "object" || !source || typeof source.tool !== "string") {
      throw new Error("bad shape");
    }
    return { ...base, kind, spec, source, corrupt: false };
  } catch {
    // One bad row (manual edit, partial restore) must not break the whole list: show it as outdated, deletable.
    console.error(`[insights] saved view ${r.insight_id} has corrupt JSON`);
    return { ...base, kind: "table", spec: {}, source: { tool: "", args: null }, corrupt: true };
  }
}

const SELECT = `SELECT s.*, w.name AS created_by_name FROM SavedInsight s LEFT JOIN Worker w ON w.worker_id = s.created_by`;

export function listSavedViews(db: Database): SavedView[] {
  return (db.prepare(`${SELECT} ORDER BY s.created_at DESC, s.rowid DESC`).all() as Row[]).map(toView);
}

export function getSavedView(db: Database, id: string): SavedView | null {
  const r = db.prepare(`${SELECT} WHERE s.insight_id = ?`).get(id) as Row | undefined;
  return r ? toView(r) : null;
}

export function deleteSavedView(db: Database, id: string): boolean {
  return db.prepare("DELETE FROM SavedInsight WHERE insight_id = ?").run(id).changes > 0;
}

/** Re-run the stored source (no LLM) and rebuild the spec with fresh rows. Throws OutdatedViewError / ToolError. */
export async function rerunSavedView(view: SavedView, ctx: RunCtx): Promise<RerunResult> {
  if (view.corrupt) throw new OutdatedViewError("corrupt row");
  return (await runView(view, ctx)).result;
}
