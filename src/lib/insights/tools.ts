/**
 * Domain query tools for the insights assistant.
 *
 * Each tool validates its args with zod, runs read-only queries against the
 * connection in ctx (the read-only connection in production, the in-memory
 * test DB in tests), and returns plain rows. `executeQueryTool` stores the rows
 * in the ResultStore and hands the model only a result_id plus a preview.
 *
 * Tools never write. justice_chart reads the stored chart via buildChartData
 * and never calls recomputeJusticeChart.
 */
import { z } from "zod";
import type { Database } from "better-sqlite3";
import type Anthropic from "@anthropic-ai/sdk";
import { buildChartData } from "../justice-chart";
import { weekendRuleSql } from "../weekend-rule";
import { ToolError } from "./errors";
import type { ResultStore, Row, ResultSource } from "./result-store";

export { ToolError };
export interface ToolCtx {
  db: Database;
  store: ResultStore;
  /** Session the stored results belong to (the admin's worker_id); other sessions can't read them. */
  owner?: string;
}

export interface QueryOutput {
  columns: string[];
  rows: Row[];
  /** Extra context for the model (data freshness, caveats). */
  note?: string;
}

export interface QueryTool<S extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  schema: S;
  run(args: z.infer<S>, ctx: ToolCtx): QueryOutput | Promise<QueryOutput>;
}

export const PREVIEW_ROWS = 20;

export interface QueryToolResult {
  result_id: string;
  columns: string[];
  row_count: number;
  preview: Row[];
  note?: string;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const quarterId = z.string().regex(/^\d{4}-Q[1-4]$/, "expected e.g. 2026-Q1");

/**
 * Checks a tool's run() against its own schema here, at the definition, then
 * erases the schema type so tools with different schemas fit in one list.
 * Callers always go through parseArgs, so run() only ever sees parsed args.
 */
export function defineTool<S extends z.ZodObject>(t: QueryTool<S>): QueryTool {
  return t as unknown as QueryTool;
}

function requireQuarter(db: Database, quarter_id: string) {
  if (!db.prepare("SELECT 1 FROM Quarter WHERE quarter_id = ?").get(quarter_id)) {
    throw new ToolError(`Unknown quarter_id "${quarter_id}". Use list_reference({kind:"quarters"}).`);
  }
}

// --- Batch A ---------------------------------------------------------------

export const listReference = defineTool({
  name: "list_reference",
  description:
    "List reference data: ranks, shift types, quarters, or workers (id, name, rank, exempt/archived flags). " +
    "Use it to resolve names to ids before calling other tools.",
  schema: z.strictObject({
    kind: z.enum(["ranks", "shift_types", "quarters", "workers"]),
  }),
  run({ kind }, { db }) {
    const sql = {
      ranks: "SELECT rank_id, name FROM Rank ORDER BY display_order, rank_id",
      shift_types: "SELECT shift_type_id, name FROM ShiftType ORDER BY display_order, shift_type_id",
      quarters: "SELECT quarter_id, start_date, end_date, status FROM Quarter ORDER BY quarter_id",
      workers: `SELECT w.worker_id, w.name, r.name AS rank_name, w.is_exempt, w.is_archived
                FROM Worker w JOIN Rank r ON r.rank_id = w.rank_id
                ORDER BY w.is_archived, w.name`,
    }[kind];
    const stmt = db.prepare(sql);
    return { columns: stmt.columns().map((c) => c.name), rows: stmt.all() as Row[] };
  },
});

export const shiftsPerWorker = defineTool({
  name: "shifts_per_worker",
  description:
    "Count assignments per active (non-archived) worker, including workers with zero. " +
    "Filters: quarter_id, date range (from/to inclusive), shift_type_id, role ('shift' = primary, " +
    "'reserve' = backup, 'any'; default 'shift'). Columns: worker_id, name, rank_name, shifts (matching the filters), " +
    "weekend_shifts (within the same filters, only primary shifts that count toward the weekend rule: never reserves or GUARD).",
  schema: z.strictObject({
    quarter_id: quarterId.optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    shift_type_id: z.string().optional(),
    role: z.enum(["shift", "reserve", "any"]).optional(),
  }),
  run({ quarter_id, from, to, shift_type_id, role = "shift" }, { db }) {
    const conds: string[] = [];
    const params: (string | number)[] = [];
    if (quarter_id) { conds.push("sd.quarter_id = ?"); params.push(quarter_id); }
    if (from) { conds.push("sd.date >= ?"); params.push(from); }
    if (to) { conds.push("sd.date <= ?"); params.push(to); }
    if (shift_type_id) { conds.push("sd.shift_type_id = ?"); params.push(shift_type_id); }
    if (role !== "any") { conds.push("sa.role = ?"); params.push(role); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const rows = db
      .prepare(
        `SELECT w.worker_id, w.name, r.name AS rank_name,
                COUNT(a.assignment_id) AS shifts,
                COALESCE(SUM(a.is_weekend), 0) AS weekend_shifts
         FROM Worker w
         JOIN Rank r ON r.rank_id = w.rank_id
         LEFT JOIN (
           SELECT sa.assignment_id, sa.worker_id,
                  CASE WHEN sa.role = 'shift' THEN ${weekendRuleSql("sd")} ELSE 0 END AS is_weekend
           FROM ShiftAssignment sa JOIN ShiftDate sd ON sd.shift_date_id = sa.shift_date_id
           ${where}
         ) a ON a.worker_id = w.worker_id
         WHERE w.is_archived = 0
         GROUP BY w.worker_id
         ORDER BY shifts DESC, w.name`
      )
      .all(...params) as Row[];
    return { columns: ["worker_id", "name", "rank_name", "shifts", "weekend_shifts"], rows };
  },
});

export const weekendShiftsPerWorker = defineTool({
  name: "weekend_shifts_per_worker",
  description:
    "Weekend shifts per active worker in a year, counted like the weekend rule: weekend shifts in the permanent " +
    "history for quarters of that year, plus primary assignments on weekend dates of that year that have no " +
    "history row yet (GUARD excluded). Includes workers with zero. Columns: worker_id, name, rank_name, weekend_shifts.",
  schema: z.strictObject({
    year: z.number().int().min(2000).max(2100),
  }),
  run({ year }, { db }) {
    const rows = db
      .prepare(
        `SELECT w.worker_id, w.name, r.name AS rank_name,
                COUNT(h.history_id) AS weekend_shifts
         FROM Worker w
         JOIN Rank r ON r.rank_id = w.rank_id
         LEFT JOIN (
           -- Same two sources as the rule in shift-rules.ts: history (year from the
           -- quarter), plus primary assignments not yet in history (e.g. JSON import),
           -- year from the date. Assignments that have a history row count once.
           SELECT sh.history_id, sh.worker_id
           FROM ShiftHistory sh
           WHERE sh.was_weekend = 1 AND sh.quarter_id LIKE ?
           UNION ALL
           SELECT sa.assignment_id, sa.worker_id
           FROM ShiftAssignment sa JOIN ShiftDate sd ON sd.shift_date_id = sa.shift_date_id
           WHERE sa.role = 'shift' AND ${weekendRuleSql("sd")} = 1 AND sd.date LIKE ?
             AND NOT EXISTS (SELECT 1 FROM ShiftHistory sh2
                             WHERE sh2.worker_id = sa.worker_id AND sh2.shift_date_id = sa.shift_date_id)
         ) h ON h.worker_id = w.worker_id
         WHERE w.is_archived = 0
         GROUP BY w.worker_id
         ORDER BY weekend_shifts DESC, w.name`
      )
      .all(`${year}-%`, `${year}-%`) as Row[];
    return { columns: ["worker_id", "name", "rank_name", "weekend_shifts"], rows };
  },
});

// --- Batch B ---------------------------------------------------------------

export const quarterCoverage = defineTool({
  name: "quarter_coverage",
  description:
    "One row per shift date in a quarter with its primary and reserve assignee and a status: " +
    "'unassigned' (no primary), 'reserve_missing' (primary but no reserve), 'assigned' (both). " +
    "Columns: date, shift_type_id, shift_type_name, is_weekend, shift_worker_id, shift_worker_name, " +
    "reserve_worker_id, reserve_worker_name, status.",
  schema: z.strictObject({ quarter_id: quarterId }),
  run({ quarter_id }, { db }) {
    requireQuarter(db, quarter_id);
    const rows = db
      .prepare(
        `SELECT sd.date, sd.shift_type_id, st.name AS shift_type_name, ${weekendRuleSql("sd")} AS is_weekend,
                s.worker_id AS shift_worker_id, sw.name AS shift_worker_name,
                rv.worker_id AS reserve_worker_id, rw.name AS reserve_worker_name,
                CASE WHEN s.worker_id IS NULL THEN 'unassigned'
                     WHEN rv.worker_id IS NULL THEN 'reserve_missing'
                     ELSE 'assigned' END AS status
         FROM ShiftDate sd
         JOIN ShiftType st ON st.shift_type_id = sd.shift_type_id
         LEFT JOIN ShiftAssignment s ON s.shift_date_id = sd.shift_date_id AND s.role = 'shift'
         LEFT JOIN Worker sw ON sw.worker_id = s.worker_id
         LEFT JOIN ShiftAssignment rv ON rv.shift_date_id = sd.shift_date_id AND rv.role = 'reserve'
         LEFT JOIN Worker rw ON rw.worker_id = rv.worker_id
         WHERE sd.quarter_id = ?
         ORDER BY sd.date, st.display_order`
      )
      .all(quarter_id) as Row[];
    return {
      columns: ["date", "shift_type_id", "shift_type_name", "is_weekend", "shift_worker_id",
        "shift_worker_name", "reserve_worker_id", "reserve_worker_name", "status"],
      rows,
    };
  },
});

const STATUS_COUNTS = `
  SUM(wa.status = 'unavailable') AS unavailable,
  SUM(wa.status = 'prefer_not_work') AS prefer_not_work,
  SUM(wa.status = 'prefer_work') AS prefer_work`;

export const availabilitySummary = defineTool({
  name: "availability_summary",
  description:
    "Count submitted availability entries (unavailable / prefer_not_work / prefer_work) in a quarter, " +
    "grouped by rank, worker or date. Group columns: rank → rank_id, rank_name; worker → worker_id, name, " +
    "rank_name; date → date. Then unavailable, prefer_not_work, prefer_work.",
  schema: z.strictObject({
    quarter_id: quarterId,
    group_by: z.enum(["rank", "worker", "date"]),
  }),
  run({ quarter_id, group_by }, { db }) {
    requireQuarter(db, quarter_id);
    const counts = ["unavailable", "prefer_not_work", "prefer_work"];
    const variants = {
      rank: {
        cols: ["rank_id", "rank_name"],
        sql: `SELECT r.rank_id, r.name AS rank_name, ${STATUS_COUNTS}
              FROM WorkerAvailability wa
              JOIN Worker w ON w.worker_id = wa.worker_id
              JOIN Rank r ON r.rank_id = w.rank_id
              WHERE wa.quarter_id = ?
              GROUP BY r.rank_id ORDER BY r.display_order`,
      },
      worker: {
        cols: ["worker_id", "name", "rank_name"],
        sql: `SELECT w.worker_id, w.name, r.name AS rank_name, ${STATUS_COUNTS}
              FROM WorkerAvailability wa
              JOIN Worker w ON w.worker_id = wa.worker_id
              JOIN Rank r ON r.rank_id = w.rank_id
              WHERE wa.quarter_id = ?
              GROUP BY w.worker_id ORDER BY unavailable DESC, w.name`,
      },
      date: {
        cols: ["date"],
        sql: `SELECT wa.date, ${STATUS_COUNTS}
              FROM WorkerAvailability wa
              WHERE wa.quarter_id = ?
              GROUP BY wa.date ORDER BY wa.date`,
      },
    }[group_by];
    return { columns: [...variants.cols, ...counts], rows: db.prepare(variants.sql).all(quarter_id) as Row[] };
  },
});

export const workerHistory = defineTool({
  name: "worker_history",
  description:
    "A worker's full primary-shift history (permanent record), newest first. " +
    "Columns: date, quarter_id, shift_type_id, shift_type_name, was_weekend.",
  schema: z.strictObject({ worker_id: z.string().min(1) }),
  run({ worker_id }, { db }) {
    if (!db.prepare("SELECT 1 FROM Worker WHERE worker_id = ?").get(worker_id)) {
      throw new ToolError(`Unknown worker_id "${worker_id}". Use list_reference({kind:"workers"}).`);
    }
    const rows = db
      .prepare(
        `SELECT sd.date, sh.quarter_id, sd.shift_type_id, st.name AS shift_type_name, sh.was_weekend
         FROM ShiftHistory sh
         JOIN ShiftDate sd ON sd.shift_date_id = sh.shift_date_id
         JOIN ShiftType st ON st.shift_type_id = sd.shift_type_id
         WHERE sh.worker_id = ?
         ORDER BY sd.date DESC`
      )
      .all(worker_id) as Row[];
    return { columns: ["date", "quarter_id", "shift_type_id", "shift_type_name", "was_weekend"], rows };
  },
});

export const justiceChart = defineTool({
  name: "justice_chart",
  description:
    "The stored justice chart (fairness): per-worker shift totals over the trailing year, one column " +
    "per shift type named st_<shift_type_id>. Optional rank_ids filter. Columns: worker_id, name, " +
    "rank_name, total_shifts, weekend_shifts, st_*. Data is as fresh as the chart's last recompute.",
  schema: z.strictObject({
    rank_ids: z.array(z.string()).optional(),
  }),
  run({ rank_ids }, { db }) {
    const data = buildChartData(db);
    let entries = data.entries;
    if (rank_ids && rank_ids.length > 0) {
      const known = new Set(db.prepare("SELECT rank_id FROM Rank").pluck().all() as string[]);
      const unknown = rank_ids.filter((r) => !known.has(r));
      if (unknown.length) {
        throw new ToolError(`Unknown rank_id(s): ${unknown.join(", ")}. Use list_reference({kind:"ranks"}).`);
      }
      // Entries carry the rank name only; filter by id so same-named ranks stay apart.
      const wanted = new Set(rank_ids);
      const rankOf = new Map(
        (db.prepare("SELECT worker_id, rank_id FROM Worker").all() as { worker_id: string; rank_id: string }[]).map(
          (w) => [w.worker_id, w.rank_id],
        ),
      );
      entries = entries.filter((e) => wanted.has(rankOf.get(e.worker_id) ?? ""));
    }
    const stCols = data.shift_types.map((s) => `st_${s.shift_type_id}`);
    const rows = entries.map((e) => {
      const row: Row = {
        worker_id: e.worker_id,
        name: e.name,
        rank_name: e.rank_name,
        total_shifts: e.total_shifts,
        weekend_shifts: e.weekend_shifts,
      };
      for (const s of data.shift_types) row[`st_${s.shift_type_id}`] = e.shift_counts[s.shift_type_id] ?? 0;
      return row;
    });
    const first = data.entries[0];
    const note = first
      ? `Stored chart covering ${first.period_start}..${first.period_end}, last recomputed ${first.updated_at} (UTC). ` +
        `Shift type columns: ${data.shift_types.map((s) => `st_${s.shift_type_id}=${s.name}`).join(", ")}.`
      : "The justice chart is empty: it has never been recomputed. Ask the admin to recompute it on the justice page.";
    return { columns: ["worker_id", "name", "rank_name", "total_shifts", "weekend_shifts", ...stCols], rows, note };
  },
});

export const DOMAIN_TOOLS: QueryTool[] = [
  listReference,
  shiftsPerWorker,
  weekendShiftsPerWorker,
  quarterCoverage,
  availabilitySummary,
  workerHistory,
  justiceChart,
];

// --- Execution -------------------------------------------------------------

/** Validate args with the tool's schema; a failure becomes a ToolError the model can fix. */
export function parseArgs(tool: QueryTool, raw: unknown): Record<string, unknown> {
  const parsed = tool.schema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new ToolError(`Invalid input for ${tool.name}: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

/** Run a query tool (no storing). Used directly by saved-view re-runs. */
export async function runQueryTool(tool: QueryTool, rawArgs: unknown, ctx: ToolCtx): Promise<QueryOutput> {
  return tool.run(parseArgs(tool, rawArgs), ctx);
}

/** Run a query tool, store its rows, and return what the model sees. */
export async function executeQueryTool(tool: QueryTool, rawArgs: unknown, ctx: ToolCtx): Promise<QueryToolResult> {
  const args = parseArgs(tool, rawArgs);
  const out = await tool.run(args, ctx);
  const source: ResultSource = { tool: tool.name, args };
  const result_id = ctx.store.put({ source, columns: out.columns, rows: out.rows }, ctx.owner);
  return {
    result_id,
    columns: out.columns,
    row_count: out.rows.length,
    preview: out.rows.slice(0, PREVIEW_ROWS),
    ...(out.note ? { note: out.note } : {}),
  };
}

// Numeric / length bounds aren't supported by strict tool schemas; zod still
// enforces them when the call arrives (parseArgs).
const UNSUPPORTED_KEYWORDS = ["$schema", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
  "minLength", "maxLength", "minItems", "maxItems"];

function stripUnsupported(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripUnsupported);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (UNSUPPORTED_KEYWORDS.includes(k)) continue;
    // Keys of `properties` are argument names, not keywords: keep them all.
    out[k] =
      k === "properties" && v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v).map(([name, sub]) => [name, stripUnsupported(sub)]))
        : stripUnsupported(v);
  }
  return out;
}

/** Anthropic tool definition from a zod schema (strict, no extra properties). */
export function toAnthropicTool(t: { name: string; description: string; schema: z.ZodObject }): Anthropic.Tool {
  const schema = stripUnsupported(z.toJSONSchema(t.schema, { io: "input", target: "draft-2020-12" }));
  return {
    name: t.name,
    description: t.description,
    input_schema: schema as Anthropic.Tool.InputSchema,
    strict: true,
  };
}
