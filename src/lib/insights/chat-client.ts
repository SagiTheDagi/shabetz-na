/**
 * Client-side chat state for /admin/insights. Pure (no React, no fetch) so it
 * can be unit-tested; the hook in use-insights-chat.ts drives it.
 *
 * The thread lives only in memory (lost on reload). The server rebuilds and
 * compacts history itself; toWireMessages strips chart/table rows before
 * sending so the request stays small.
 */
import type { ChatEvent } from "./chat-loop";
import type { ClientMessage } from "./prompt";
import type { ChartSpec, TableSpec } from "./render";

export type ToolPart = {
  type: "tool";
  id: string;
  toolName: string;
  args: unknown;
  status: "running" | "done" | "error";
  result?: unknown;
};
export type TextPart = { type: "text"; text: string };
export type AssistantPart = TextPart | ToolPart;

export interface UserTurn {
  id: string;
  role: "user";
  text: string;
}
export interface AssistantTurn {
  id: string;
  role: "assistant";
  parts: AssistantPart[];
  notices: string[];
  error?: string;
  status: "running" | "done" | "cancelled";
}
export type ThreadMessage = UserTurn | AssistantTurn;

export const isChartPart = (p: AssistantPart): p is ToolPart & { result: ChartSpec } =>
  p.type === "tool" && p.toolName === "render_chart" && p.status === "done";
export const isTablePart = (p: AssistantPart): p is ToolPart & { result: TableSpec } =>
  p.type === "tool" && p.toolName === "render_table" && p.status === "done";

/** Apply one server event to the assistant turn (returns a new object). */
export function applyEvent(turn: AssistantTurn, e: ChatEvent): AssistantTurn {
  switch (e.type) {
    case "text": {
      const parts = [...turn.parts];
      const last = parts[parts.length - 1];
      if (last?.type === "text") parts[parts.length - 1] = { type: "text", text: last.text + e.delta };
      else parts.push({ type: "text", text: e.delta.replace(/^\n+/, "") });
      return { ...turn, parts };
    }
    case "tool_call":
      return {
        ...turn,
        parts: [...turn.parts, { type: "tool", id: e.id, toolName: e.name, args: e.args, status: "running" }],
      };
    case "tool_result":
      return {
        ...turn,
        parts: turn.parts.map((p) =>
          p.type === "tool" && p.id === e.id ? { ...p, result: e.result, status: e.is_error ? "error" : "done" } : p,
        ),
      };
    case "notice":
      return { ...turn, notices: [...turn.notices, e.message] };
    case "error":
      return { ...turn, error: e.message };
    case "done":
      return { ...turn, status: turn.status === "cancelled" ? "cancelled" : "done" };
  }
}

/** Splits a streamed body into complete NDJSON lines; returns the leftover partial line. */
export function splitLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.filter((l) => l.trim()), rest };
}

/**
 * Messages sent per request. The server keeps only the last MAX_TURNS (10)
 * turns, so sending the whole thread would just grow the body until it hits
 * the request cap (200 messages). A little slack over 2 × 10 covers turns
 * that end without an assistant reply.
 */
export const WIRE_MAX_MESSAGES = 24;

/**
 * Thread → request wire format: recent messages only; render results are
 * reduced to a row count. Failed calls, and calls still running when the user
 * pressed stop, go out as { error } so the model doesn't take them for results.
 */
export function toWireMessages(thread: ThreadMessage[]): ClientMessage[] {
  return thread.slice(-WIRE_MAX_MESSAGES).map((m) => {
    if (m.role === "user") return { role: "user", content: [{ type: "text", text: m.text }] };
    return {
      role: "assistant",
      content: m.parts.map((p) => {
        if (p.type === "text") return p;
        const r = (p.result ?? {}) as Record<string, unknown>;
        const result =
          p.status === "error" ? { error: "failed" }
          : p.status === "running" ? { error: "cancelled" }
          : p.toolName === "render_chart" || p.toolName === "render_table"
            ? { rows: Array.isArray(r.data) ? r.data.length : 0 }
            : { result_id: r.result_id, columns: r.columns, row_count: r.row_count };
        return { type: "tool" as const, toolName: p.toolName, args: p.args, result };
      }),
    };
  });
}

export const TOOL_LABELS: Record<string, string> = {
  list_reference: "טוען נתוני עזר",
  shifts_per_worker: "סופר משמרות לעובד",
  weekend_shifts_per_worker: "סופר משמרות סופ״ש",
  quarter_coverage: "בודק כיסוי רבעון",
  availability_summary: "מסכם זמינות",
  worker_history: "טוען היסטוריית עובד",
  justice_chart: "קורא את טבלת הצדק",
  run_readonly_sql: "מריץ שאילתה",
  render_chart: "בונה גרף",
  render_table: "בונה טבלה",
};
