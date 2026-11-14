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
import { ALIAS_RE } from "./config";

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
  /** alias → name for the aliases in this turn's text (sent incrementally); revealed at render time. */
  aliases?: Record<string, string>;
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
    case "aliases":
      return { ...turn, aliases: { ...turn.aliases, ...e.map } };
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
 * Reads an NDJSON text stream, calling onEvent per parsed line (bad lines are
 * skipped). A final line without a trailing newline is still delivered.
 */
export async function readNdjson(stream: ReadableStream<string>, onEvent: (e: ChatEvent) => void): Promise<void> {
  const handle = (line: string) => {
    let e: ChatEvent;
    try {
      e = JSON.parse(line);
    } catch {
      return;
    }
    onEvent(e);
  };
  const reader = stream.getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const { lines, rest } = splitLines(buffer + value);
    buffer = rest;
    lines.forEach(handle);
  }
  if (buffer.trim()) handle(buffer);
}

/**
 * At most one in-flight request. acquire() returns null while one runs;
 * release(ac) is a no-op unless ac is still current, so a request aborted by
 * reset() can't release a newer one.
 */
export function createRequestSlot() {
  let current: AbortController | null = null;
  return {
    get busy() {
      return current !== null;
    },
    acquire(): AbortController | null {
      if (current) return null;
      current = new AbortController();
      return current;
    },
    /** True when ac was current (caller should clear its running flag). */
    release(ac: AbortController): boolean {
      if (current !== ac) return false;
      current = null;
      return true;
    },
    abort() {
      current?.abort();
    },
    /** Abort and free the slot immediately. */
    reset() {
      current?.abort();
      current = null;
    },
  };
}

/**
 * Messages sent per request. The server keeps only the last MAX_TURNS (10)
 * turns, so sending the whole thread would just grow the body until it hits
 * the request cap (200 messages). A little slack over 2 × 10 covers turns
 * that end without an assistant reply.
 */
export const WIRE_MAX_MESSAGES = 24;

const hasContent = (a: AssistantTurn) => a.parts.some((p) => p.type === "tool" || p.text.trim());

/**
 * Drops unanswered exchanges: an assistant turn with no output (error before
 * any text, or stopped early) and the question before it. Otherwise the server
 * merges that question into the next one and the model answers both.
 */
function dropUnanswered(thread: ThreadMessage[]): ThreadMessage[] {
  const out: ThreadMessage[] = [];
  for (const m of thread) {
    if (m.role === "assistant" && !hasContent(m)) {
      if (out[out.length - 1]?.role === "user") out.pop();
      continue;
    }
    out.push(m);
  }
  return out;
}

/**
 * Thread → request wire format: recent answered messages only; render results
 * are reduced to a row count. Failed calls, and calls still running when the
 * user pressed stop, go out as { error } so the model doesn't take them for results.
 */
export function toWireMessages(thread: ThreadMessage[]): ClientMessage[] {
  return dropUnanswered(thread).slice(-WIRE_MAX_MESSAGES).map((m) => {
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

/** Replace aliases in already-joined text (never per chunk: an alias can span chunks). */
export function revealAliases(text: string, aliasNames: Record<string, string> | null | undefined): string {
  if (!aliasNames) return text;
  return text.replace(ALIAS_RE, (m) => aliasNames[m] ?? m);
}
