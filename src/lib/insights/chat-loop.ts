/**
 * The insights tool-use loop, independent of HTTP so it can be tested with a
 * fake client. The route handler owns auth, parsing and the response stream.
 *
 * Per iteration: reserve budget → stream one model call (text deltas go out
 * as they arrive) → settle the reservation with the actual usage (also on
 * abort/error) → act on stop_reason. Tools run server-side; query results are
 * stored and referenced by result_id, render tools join the stored rows into
 * the spec sent to the client.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Budget, Reservation } from "./budget";
import { BUDGET_EXCEEDED_MESSAGE } from "./budget";
import { estimateCost, estimateTextTokens, INSIGHTS_MODEL } from "./pricing";
import { buildSystem } from "./prompt";
import { ToolError } from "./errors";
import { DOMAIN_TOOLS, executeQueryTool, toAnthropicTool, type QueryTool, type ToolCtx } from "./tools";
import { runReadonlySql } from "./sql-runner";
import { RENDER_TOOLS, renderChart, renderTable } from "./render";

export const MAX_ITERATIONS = 8;
export const MAX_TOKENS = 4096;

export const MESSAGES = {
  truncated: "התשובה נקטעה, נסה לשאול שאלה ממוקדת יותר",
  refusal: "העוזר לא יכול לענות על שאלה זו",
  tooComplex: "השאלה מורכבת מדי, נסה לפצל אותה",
  budget: BUDGET_EXCEEDED_MESSAGE,
  failed: "אירעה שגיאה בעוזר, נסה שוב",
  toolFailed: "הרצת הכלי נכשלה",
} as const;

export type Effort = "low" | "medium" | "high";
export const DEFAULT_EFFORT: Effort = "medium";

export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "tool_result"; id: string; name: string; result: unknown; is_error?: boolean }
  | { type: "notice"; message: string }
  | { type: "error"; message: string }
  | { type: "done" };

const QUERY_TOOLS: QueryTool[] = [...DOMAIN_TOOLS, runReadonlySql];
const QUERY_TOOL_MAP = new Map(QUERY_TOOLS.map((t) => [t.name, t]));

/** Static, deterministic tool list (part of the cached prefix). */
export const TOOL_DEFINITIONS: Anthropic.Tool[] = [...QUERY_TOOLS, ...RENDER_TOOLS].map((t) =>
  toAnthropicTool(t as { name: string; description: string; schema: QueryTool["schema"] }),
);

interface StreamLike {
  on(event: "text", cb: (delta: string) => void): unknown;
  finalMessage(): Promise<Anthropic.Message>;
  readonly currentMessage?: Anthropic.Message;
}
export interface LoopClient {
  messages: {
    stream(params: Anthropic.MessageStreamParams, opts?: { signal?: AbortSignal }): StreamLike;
  };
}

export interface ChatLoopInput {
  client: LoopClient;
  /** Compacted history ending with the latest user message. */
  history: Anthropic.MessageParam[];
  /** Mid-conversation system message with per-request context. */
  context: Anthropic.MessageParam;
  toolCtx: ToolCtx;
  budget: Budget;
  /** Reservation already made for the first call (the route checks it before opening the stream). */
  firstReservation?: Reservation;
  signal?: AbortSignal;
  effort?: Effort;
  emit: (e: ChatEvent) => void;
  /** Hook for pseudonymization: maps tool input before execution. */
  mapToolInput?: (name: string, input: unknown) => unknown;
  /** Hook for pseudonymization: maps what the model sees from a tool result. */
  mapForModel?: (value: unknown) => unknown;
  /** Hook for pseudonymization: maps what the client sees. */
  mapForClient?: (value: unknown) => unknown;
}

/** Block types that accept cache_control (thinking blocks don't). */
const CACHEABLE_BLOCKS = new Set(["text", "tool_use", "tool_result"]);

/**
 * Second cache breakpoint (the first ends system): on the last block of the
 * newest user/assistant message, skipping the per-request context message.
 * Round n of the tool loop then reads the prefix round n-1 wrote, instead of
 * resending history + earlier tool results uncached. Returns copies; the
 * caller's messages are never mutated.
 */
export function withMessageCacheBreakpoint(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user" && m.role !== "assistant") continue;
    const blocks: Anthropic.ContentBlockParam[] =
      typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
    const last = blocks[blocks.length - 1];
    if (!last || !CACHEABLE_BLOCKS.has(last.type)) return messages;
    const marked = { ...last, cache_control: { type: "ephemeral" } } as Anthropic.ContentBlockParam;
    const out = [...messages];
    out[i] = { ...m, content: [...blocks.slice(0, -1), marked] };
    return out;
  }
  return messages;
}

export function buildParams(
  history: Anthropic.MessageParam[],
  context: Anthropic.MessageParam,
  loopMessages: Anthropic.MessageParam[],
  effort: Effort,
): Anthropic.MessageStreamParams {
  return {
    model: INSIGHTS_MODEL,
    max_tokens: MAX_TOKENS,
    tools: TOOL_DEFINITIONS,
    system: buildSystem(),
    messages: withMessageCacheBreakpoint([...history, context, ...loopMessages]),
    output_config: { effort },
  };
}

// Per-object token estimates. System, tools, history and earlier loop messages
// are never mutated after they're built, so each round only walks what's new.
const tokenCache = new WeakMap<object, number>();
function valueTokens(v: unknown): number {
  if (typeof v === "string") return estimateTextTokens(v);
  if (typeof v === "number" || typeof v === "boolean") return 1;
  if (!v || typeof v !== "object") return 0;
  const hit = tokenCache.get(v);
  if (hit !== undefined) return hit;
  let n = 0;
  if (Array.isArray(v)) for (const x of v) n += 1 + valueTokens(x);
  else for (const [k, x] of Object.entries(v)) n += 1 + estimateTextTokens(k) + valueTokens(x);
  tokenCache.set(v, n);
  return n;
}

/** Pessimistic cost of one call: walks strings directly (no JSON.stringify, so no escaping skews the count). */
export function estimateParamsCost(params: Anthropic.MessageStreamParams): number {
  const input = valueTokens(params.system) + valueTokens(params.tools) + valueTokens(params.messages);
  return estimateCost(input, params.max_tokens);
}

const isAbort = (e: unknown, signal?: AbortSignal) =>
  e instanceof Anthropic.APIUserAbortError || (e as Error)?.name === "AbortError" || !!signal?.aborted;

type ToolOutcome = { forModel: string; forClient: unknown; isError: boolean };

async function runTool(block: Anthropic.ToolUseBlock, input: ChatLoopInput): Promise<ToolOutcome> {
  const { toolCtx, mapToolInput = (_n, i) => i } = input;
  try {
    if (block.name === "render_chart" || block.name === "render_table") {
      // No mapToolInput here: render args are titles/labels (shown to the user) and a
      // result_id, not query input. mapForClient turns aliases in them into names.
      const out =
        block.name === "render_chart"
          ? renderChart(block.input, toolCtx.store, toolCtx.owner)
          : renderTable(block.input, toolCtx.store, toolCtx.owner);
      return { forModel: JSON.stringify(out.forModel), forClient: out.spec, isError: false };
    }
    const tool = QUERY_TOOL_MAP.get(block.name);
    if (!tool) throw new ToolError(`Unknown tool "${block.name}".`);
    const args = mapToolInput(block.name, block.input); // query input only: aliases → real ids
    const res = await executeQueryTool(tool, args, { ...toolCtx, signal: input.signal });
    const { preview: _preview, ...summary } = res;
    void _preview;
    return { forModel: JSON.stringify(res), forClient: summary, isError: false };
  } catch (e) {
    // The model gets the (English) detail to fix its call; the client gets Hebrew only.
    if (e instanceof ToolError) return { forModel: e.message, forClient: { error: MESSAGES.toolFailed }, isError: true };
    console.error(`[insights] tool ${block.name} failed`, e);
    return { forModel: "Internal error while running the tool.", forClient: { error: MESSAGES.toolFailed }, isError: true };
  }
}

/** Runs until the model finishes, the cap is hit, the budget runs out, or the request is aborted. */
export async function runChatLoop(input: ChatLoopInput): Promise<void> {
  const { client, history, context, budget, signal, emit, effort = DEFAULT_EFFORT } = input;
  const mapForModel = input.mapForModel ?? ((v) => v);
  const mapForClient = input.mapForClient ?? ((v) => v);
  const loopMessages: Anthropic.MessageParam[] = [];
  let reservation = input.firstReservation;
  let emittedText = false;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    if (signal?.aborted) return;
    const params = buildParams(history, context, loopMessages, effort);
    if (!reservation) {
      const r = budget.reserve(estimateParamsCost(params));
      if (!r.ok) {
        emit({ type: "notice", message: MESSAGES.budget });
        return;
      }
      reservation = r.reservation;
    }
    const res = reservation;
    reservation = undefined;

    let message: Anthropic.Message;
    let iterText = false;
    let stream: StreamLike | undefined;
    try {
      // Inside the try: a synchronous throw from stream() must still settle this reservation.
      stream = client.messages.stream(params, { signal });
      stream.on("text", (delta) => {
        if (!iterText && emittedText) emit({ type: "text", delta: "\n\n" });
        iterText = emittedText = true;
        emit({ type: "text", delta });
      });
      message = await stream.finalMessage();
    } catch (e) {
      // Partial usage so far (message_start carries input, deltas carry output).
      budget.settle(res, stream?.currentMessage?.usage ?? null);
      if (isAbort(e, signal)) return;
      throw e;
    }
    budget.settle(res, message.usage);

    switch (message.stop_reason) {
      case "end_turn":
      case "stop_sequence":
        return;
      case "max_tokens":
      case "model_context_window_exceeded":
        emit({ type: "notice", message: MESSAGES.truncated });
        return;
      case "refusal":
        emit({ type: "error", message: MESSAGES.refusal });
        return;
      case "pause_turn":
        loopMessages.push({ role: "assistant", content: message.content });
        continue;
      case "tool_use": {
        const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
        loopMessages.push({ role: "assistant", content: message.content });
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const block of toolUses) {
          if (signal?.aborted) return;
          // Args go out exactly as the model wrote them (no mapForClient): they come back
          // unchanged in the next turn's history.
          emit({ type: "tool_call", id: block.id, name: block.name, args: block.input });
          const out = await runTool(block, input);
          emit({
            type: "tool_result",
            id: block.id,
            name: block.name,
            result: mapForClient(out.forClient),
            ...(out.isError ? { is_error: true } : {}),
          });
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: mapForModel(out.forModel) as string,
            ...(out.isError ? { is_error: true } : {}),
          });
        }
        loopMessages.push({ role: "user", content: results });
        continue;
      }
      default:
        return;
    }
  }
  emit({ type: "notice", message: MESSAGES.tooComplex });
}
