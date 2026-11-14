/**
 * Insights chat: prompt/history builder, the tool loop against a scripted fake
 * client (no network), rate limiter, and the usage route.
 */
import "./test-session";
import { resetTestDb } from "./test-db";
import { asUser } from "./test-session";
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import type Database from "better-sqlite3";
import { applyInsightsSchema } from "../insights/views";
import { ResultStore } from "../insights/result-store";
import { Budget } from "../insights/budget";
import { RateLimiter } from "../insights/rate-limit";
import {
  buildHistory, buildContextMessage, buildSystem, summarizeToolPart, HistoryError, SYSTEM_PROMPT,
  type ClientMessage,
} from "../insights/prompt";
import { runChatLoop, MESSAGES, MAX_ITERATIONS, TOOL_DEFINITIONS, type ChatEvent, type LoopClient } from "../insights/chat-loop";

const user = (text: string): ClientMessage => ({ role: "user", content: [{ type: "text", text }] });
const asst = (text: string, ...tools: ClientMessage["content"]): ClientMessage => ({
  role: "assistant",
  content: [{ type: "text", text }, ...tools],
});

describe("prompt + history", () => {
  it("system is static with one cache breakpoint", () => {
    const s = buildSystem();
    assert.equal(s.length, 1);
    assert.deepEqual(s[0].cache_control, { type: "ephemeral" });
    assert.equal(s[0].text, SYSTEM_PROMPT);
    assert.ok(!/\d{4}-\d{2}-\d{2}/.test(SYSTEM_PROMPT), "no dates in the cached prefix");
  });

  it("tool definitions are strict and in a fixed order", () => {
    assert.deepEqual(TOOL_DEFINITIONS.map((t) => t.name), [
      "list_reference", "shifts_per_worker", "weekend_shifts_per_worker", "quarter_coverage",
      "availability_summary", "worker_history", "justice_chart", "run_readonly_sql", "render_chart", "render_table",
    ]);
    assert.ok(TOOL_DEFINITIONS.every((t) => t.strict === true));
  });

  it("compacts tool parts into one-line summaries without rows", () => {
    const history = buildHistory([
      user("כמה משמרות?"),
      asst(
        "הנה:",
        { type: "tool", toolName: "shifts_per_worker", args: { quarter_id: "2026-Q1" }, result: { result_id: "r_1", columns: ["name", "shifts"], row_count: 3 } },
        { type: "tool", toolName: "render_chart", args: { result_id: "r_1", title: "משמרות" }, result: { data: [{ a: 1 }, { a: 2 }], title: "x" } },
      ),
      user("הצג כעוגה"),
    ]);
    assert.deepEqual(history, [
      { role: "user", content: "כמה משמרות?" },
      {
        role: "assistant",
        content:
          "הנה:\n[query: shifts_per_worker({\"quarter_id\":\"2026-Q1\"}) → result_id=r_1, 3 rows columns=name,shifts]\n" +
          "[chart: משמרות, result_id=r_1, 2 rows]",
      },
      { role: "user", content: "הצג כעוגה" },
    ]);
  });

  it("summarizes SQL and tables", () => {
    assert.equal(
      summarizeToolPart({ type: "tool", toolName: "run_readonly_sql", args: { sql: "SELECT 1" }, result: { result_id: "r_2", row_count: 1 } }),
      '[query: run_readonly_sql(sql="SELECT 1") → result_id=r_2, 1 rows]',
    );
    assert.equal(
      summarizeToolPart({ type: "tool", toolName: "render_table", args: { result_id: "r_2", title: "ט" }, result: { rows: 9 } }),
      "[table: ט, result_id=r_2, 9 rows]",
    );
  });

  it("keeps the last 10 turns and drops leading assistant messages", () => {
    const msgs: ClientMessage[] = [asst("orphan")];
    for (let i = 0; i < 12; i++) msgs.push(user(`q${i}`), asst(`a${i}`));
    msgs.push(user("last"));
    const h = buildHistory(msgs);
    assert.equal(h[0].content, "q3");
    assert.equal(h.length, 19);
    assert.equal(h[h.length - 1].content, "last");
  });

  it("trims older turns over the token estimate; rejects an oversize question", () => {
    const big = "x".repeat(3000);
    const h = buildHistory([user(big), asst(big), user(big), asst("ok"), user("q")], { maxTokens: 2100 });
    assert.equal(h[0].content, big);
    assert.equal(h.length, 3);
    assert.throws(() => buildHistory([user("x".repeat(400))], { maxTokens: 100 }), HistoryError);
  });

  it("thread must end with a user message", () => {
    assert.throws(() => buildHistory([user("a"), asst("b")]), HistoryError);
    assert.throws(() => buildHistory([asst("b")]), HistoryError);
  });

  it("context message is a system message", () => {
    const m = buildContextMessage({ today: "2026-11-14", currentQuarterId: "2026-Q4", selectedQuarterId: null });
    assert.equal(m.role, "system");
    assert.match(m.content as string, /today is 2026-11-14.*Current quarter: 2026-Q4.*selected in the app: none/);
  });
});

// --- fake client ------------------------------------------------------------------

type Script = { text?: string; content?: Anthropic.ContentBlock[]; stop: Anthropic.StopReason | "abort"; usage?: Partial<Anthropic.Usage> };

function fakeClient(scripts: Script[], calls: Anthropic.MessageStreamParams[], abort?: AbortController): LoopClient {
  let i = 0;
  return {
    messages: {
      stream(params) {
        calls.push(structuredClone(params));
        const s = scripts[i++];
        const listeners: ((d: string) => void)[] = [];
        const usage = { input_tokens: 1000, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, ...s.usage } as Anthropic.Usage;
        const content: Anthropic.ContentBlock[] = [
          ...(s.text ? [{ type: "text", text: s.text, citations: null } as Anthropic.TextBlock] : []),
          ...(s.content ?? []),
        ];
        const msg = { id: "m", type: "message", role: "assistant", model: "x", content, stop_reason: s.stop, stop_sequence: null, usage } as unknown as Anthropic.Message;
        return {
          on(_e: "text", cb: (d: string) => void) { listeners.push(cb); return this; },
          get currentMessage() { return msg; },
          async finalMessage() {
            await Promise.resolve();
            if (s.text) for (const cb of listeners) cb(s.text);
            if (s.stop === "abort") {
              abort?.abort();
              const e = new Error("aborted");
              e.name = "AbortError";
              throw e;
            }
            return msg;
          },
        };
      },
    },
  };
}

const toolUse = (id: string, name: string, input: unknown) =>
  ({ type: "tool_use", id, name, input, caller: { type: "direct" } }) as unknown as Anthropic.ContentBlock;

describe("chat loop", () => {
  let db: Database.Database;
  let budget: Budget;
  let events: ChatEvent[];
  let calls: Anthropic.MessageStreamParams[];
  const history: Anthropic.MessageParam[] = [{ role: "user", content: "כמה משמרות לכל עובד?" }];
  const context = buildContextMessage({ today: "2026-11-14", currentQuarterId: "2026-Q1", selectedQuarterId: null });

  beforeEach(() => {
    db = resetTestDb();
    applyInsightsSchema(db);
    db.exec(`
      INSERT INTO Rank VALUES ('R1','r',1,datetime('now'));
      INSERT INTO Worker (worker_id,name,rank_id) VALUES ('1','אבי','R1'),('2','בני','R1');
    `);
    budget = new Budget(db, 5, () => new Date(2026, 10, 14));
    events = [];
    calls = [];
  });

  const loop = (scripts: Script[], extra: Partial<Parameters<typeof runChatLoop>[0]> = {}) =>
    runChatLoop({
      client: fakeClient(scripts, calls),
      history, context, toolCtx: { db, store: new ResultStore() }, budget, emit: (e) => events.push(e), ...extra,
    });

  it("runs tools, renders a chart with joined rows, then ends", async () => {
    const chartInput = { kind: "bar", title: "ט", x: { key: "name", label: "שם", type: "category" }, series: [{ key: "shifts", label: "משמרות" }] };
    // The store id is only known after call 1, so resolve result_id lazily.
    Object.defineProperty(chartInput, "result_id", {
      get() {
        const r = events.find((e) => e.type === "tool_result" && e.name === "shifts_per_worker") as { result: { result_id: string } } | undefined;
        return r?.result.result_id ?? "missing";
      },
      enumerable: true,
    });
    await loop([
      { text: "בודק", content: [toolUse("t1", "shifts_per_worker", {})], stop: "tool_use" },
      { content: [toolUse("t2", "render_chart", chartInput)], stop: "tool_use" },
      { text: "סיימתי", stop: "end_turn" },
    ]);
    const types = events.map((e) => e.type);
    assert.deepEqual(types, ["text", "tool_call", "tool_result", "tool_call", "tool_result", "text", "text"]);
    const chart = events[4] as Extract<ChatEvent, { type: "tool_result" }>;
    assert.equal(chart.is_error, undefined);
    const spec = chart.result as { data: unknown[]; source: { tool: string } };
    assert.equal(spec.data.length, 2);
    assert.equal(spec.source.tool, "shifts_per_worker");
    assert.deepEqual(events[5], { type: "text", delta: "\n\n" });
    // second call carries the tool result; context system message sits after the user question
    assert.equal(calls.length, 3);
    const m = calls[1].messages;
    assert.equal(m[1].role, "system");
    assert.equal(m[2].role, "assistant");
    const toolResult = (m[3].content as Anthropic.ToolResultBlockParam[])[0];
    assert.equal(toolResult.tool_use_id, "t1");
    assert.match(toolResult.content as string, /"row_count":2/);
    assert.equal(calls[0].output_config?.effort, "medium");
    assert.equal(budget.pending, 0);
    assert.ok(budget.monthCost() > 0);
  });

  it("tool errors go back to the model as is_error", async () => {
    await loop([
      { content: [toolUse("t1", "worker_history", { worker_id: "999" })], stop: "tool_use" },
      { text: "לא נמצא", stop: "end_turn" },
    ]);
    const r = events.find((e) => e.type === "tool_result") as Extract<ChatEvent, { type: "tool_result" }>;
    assert.equal(r.is_error, true);
    const tr = (calls[1].messages[3].content as Anthropic.ToolResultBlockParam[])[0];
    assert.equal(tr.is_error, true);
    assert.match(tr.content as string, /Unknown worker_id/);
  });

  it("max_tokens → truncation notice; refusal → error", async () => {
    await loop([{ text: "חלקי", stop: "max_tokens" }]);
    assert.deepEqual(events.at(-1), { type: "notice", message: MESSAGES.truncated });
    events = [];
    await loop([{ stop: "refusal" }]);
    assert.deepEqual(events, [{ type: "error", message: MESSAGES.refusal }]);
  });

  it("iteration cap → too-complex notice", async () => {
    const scripts = Array.from({ length: MAX_ITERATIONS }, (_, i) => ({
      content: [toolUse(`t${i}`, "list_reference", { kind: "ranks" })], stop: "tool_use" as const,
    }));
    await loop(scripts);
    assert.equal(calls.length, MAX_ITERATIONS);
    assert.deepEqual(events.at(-1), { type: "notice", message: MESSAGES.tooComplex });
  });

  it("budget exhausted mid-loop ends the turn with the budget notice", async () => {
    db.prepare("INSERT INTO InsightUsage (month, cost_usd) VALUES ('2026-11', 4.9999)").run();
    await loop([{ content: [toolUse("t1", "list_reference", { kind: "ranks" })], stop: "tool_use" }]);
    assert.equal(calls.length, 0);
    assert.deepEqual(events, [{ type: "notice", message: MESSAGES.budget }]);
  });

  it("abort mid-stream stops the loop and still records usage", async () => {
    const ac = new AbortController();
    await runChatLoop({
      client: fakeClient([{ text: "חלק", stop: "abort", usage: { input_tokens: 3000, output_tokens: 7 } }], calls, ac),
      history, context, toolCtx: { db, store: new ResultStore() }, budget, signal: ac.signal, emit: (e) => events.push(e),
    });
    assert.ok(ac.signal.aborted);
    const row = db.prepare("SELECT input_tokens, output_tokens FROM InsightUsage").get() as Record<string, number>;
    assert.deepEqual({ ...row }, { input_tokens: 3000, output_tokens: 7 });
    assert.equal(budget.pending, 0);
  });

  it("a synchronous throw from stream() still settles that round's reservation", async () => {
    const inner = fakeClient([{ content: [toolUse("t1", "list_reference", { kind: "ranks" })], stop: "tool_use" }], calls);
    let n = 0;
    const client: LoopClient = {
      messages: {
        stream(params, o) {
          if (n++ === 1) throw new Error("bad params");
          return inner.messages.stream(params, o);
        },
      },
    };
    await assert.rejects(
      runChatLoop({ client, history, context, toolCtx: { db, store: new ResultStore() }, budget, emit: (e) => events.push(e) }),
      /bad params/,
    );
    assert.equal(budget.pending, 0);
  });
});

describe("rate limiter", () => {
  it("allows N per window per key, then refuses until the window slides", () => {
    let t = 0;
    const rl = new RateLimiter(2, 1000, () => t);
    assert.ok(rl.check("a").allowed);
    assert.ok(rl.check("a").allowed);
    const r = rl.check("a");
    assert.equal(r.allowed, false);
    assert.equal(r.retryAfterMs, 1000);
    assert.ok(rl.check("b").allowed);
    t = 1001;
    assert.ok(rl.check("a").allowed);
  });
});

describe("GET /api/insights/usage", () => {
  beforeEach(() => {
    const db = resetTestDb();
    applyInsightsSchema(db);
  });
  it("admin gets month, cost, cap, enabled; worker gets 403", async () => {
    const { GET } = await import("../../app/api/insights/usage/route");
    await asUser("1", false);
    assert.equal((await (GET as () => Promise<Response>)()).status, 403);
    await asUser("1", true);
    const body = await (await (GET as () => Promise<Response>)()).json();
    assert.equal(body.cap, 5);
    assert.equal(typeof body.cost_usd, "number");
    assert.match(body.month, /^\d{4}-\d{2}$/);
    assert.equal(typeof body.enabled, "boolean");
  });
});
