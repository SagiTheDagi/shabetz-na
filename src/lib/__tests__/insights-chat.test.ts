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
import {
  buildPseudonymizer, computeAliases, createPseudonymizer, resetPseudonymizerCache, withAliases,
} from "../insights/pseudonymize";
import { revealAliases } from "../insights/chat-client";
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

// --- T5.3 pseudonymization ---------------------------------------------------------


describe("pseudonymizer", () => {
  const workers = [
    { worker_id: "1234567", name: "אבי כהן" },
    { worker_id: "7654321", name: "דן" },
    { worker_id: "12", name: "דנה לוי" },
  ];

  it("aliases are stable across requests and unique even with prefix collisions", () => {
    const a = buildPseudonymizer(workers, "secret");
    const b = buildPseudonymizer([...workers].reverse(), "secret");
    for (const w of workers) assert.equal(a.aliasOf(w.worker_id), b.aliasOf(w.worker_id));
    assert.match(a.aliasOf("1234567")!, /^W-[0-9a-f]{8}$/);
    // Short prefixes force collisions; production uses 8 hex chars.
    const ids = Array.from({ length: 300 }, (_, i) => String(i));
    const aliases = computeAliases(ids, "s", 3);
    assert.equal(new Set(aliases.values()).size, 300);
    assert.ok([...aliases.values()].some((x) => x.length > 5), "some prefixes collided and were extended");
    assert.notEqual(buildPseudonymizer(workers, "other").aliasOf("1234567"), a.aliasOf("1234567"));
  });

  it("hides names and long ids in history; whole words only", () => {
    const p = buildPseudonymizer(workers, "secret");
    const [m] = p.mapClientMessages([user("כמה משמרות עשה אבי כהן (1234567)? ומה עם דן ודני? 2026, 12")]);
    const text = (m.content[0] as { text: string }).text;
    const avi = p.aliasOf("1234567")!;
    // "דן" is single-word: never aliased in free text (see the single-word test).
    assert.equal(text, `כמה משמרות עשה ${avi} (${avi})? ומה עם דן ודני? 2026, 12`);
  });

  it("stored names with stray whitespace still match", () => {
    const p = buildPseudonymizer([{ worker_id: "1234567", name: " אבי  כהן " }], "secret");
    const avi = p.aliasOf("1234567")!;
    const [m] = p.mapClientMessages([user("כמה משמרות עשה אבי כהן? ואבי  כהן?")]);
    assert.equal((m.content[0] as { text: string }).text, `כמה משמרות עשה ${avi}? ו${avi}?`);
    assert.equal(p.mapForModel(JSON.stringify({ name: "אבי כהן" })), JSON.stringify({ name: avi }));
    assert.equal(p.aliasNames[avi], "אבי  כהן");
  });

  it("names with attached Hebrew prefixes are aliased, prefix kept", () => {
    const p = buildPseudonymizer(workers, "secret");
    const avi = p.aliasOf("1234567")!;
    const [m] = p.mapClientMessages([user("כמה משמרות היו לאבי כהן? ומה ולאבי כהן, שאבי כהן, ואבי כהןן?")]);
    assert.equal((m.content[0] as { text: string }).text, `כמה משמרות היו ל${avi}? ומה ול${avi}, ש${avi}, ואבי כהןן?`);
    assert.equal(revealAliases(`ל${avi}`, p.aliasNames), "לאבי כהן");
  });

  it("createPseudonymizer reuses the instance until a worker changes", () => {
    const db = resetTestDb();
    db.exec(`INSERT INTO Rank VALUES ('R1','r',1,datetime('now'));
             INSERT INTO Worker (worker_id,name,rank_id) VALUES ('1234567','אבי כהן','R1');`);
    const env = { on: process.env.INSIGHTS_PSEUDONYMIZE, secret: process.env.SESSION_SECRET };
    process.env.INSIGHTS_PSEUDONYMIZE = "true";
    process.env.SESSION_SECRET = "test-secret";
    resetPseudonymizerCache();
    try {
      const a = createPseudonymizer(db)!;
      assert.equal(createPseudonymizer(db), a);
      db.prepare("UPDATE Worker SET name = 'אבי לוי' WHERE worker_id = '1234567'").run();
      const b = createPseudonymizer(db)!;
      assert.notEqual(b, a);
      assert.equal(b.aliasNames[b.aliasOf("1234567")!], "אבי לוי");
    } finally {
      for (const [k, v] of [["INSIGHTS_PSEUDONYMIZE", env.on], ["SESSION_SECRET", env.secret]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      resetPseudonymizerCache();
    }
  });

  it("tool input: aliases → real ids (args and SQL)", () => {
    const p = buildPseudonymizer(workers, "secret");
    const a = p.aliasOf("12")!;
    assert.deepEqual(p.mapToolInput("worker_history", { worker_id: a }), { worker_id: "12" });
    assert.deepEqual(p.mapToolInput("run_readonly_sql", { sql: `SELECT * FROM ai_history WHERE worker_id = '${a}'` }), {
      sql: "SELECT * FROM ai_history WHERE worker_id = '12'",
    });
  });

  it("tool results to the model carry aliases only; client gets names back", () => {
    const p = buildPseudonymizer(workers, "secret");
    const forModel = p.mapForModel(JSON.stringify({ preview: [{ worker_id: "12", name: "דנה לוי", rank_name: "r" }] })) as string;
    assert.ok(!forModel.includes("דנה") && !forModel.includes('"12"'));
    assert.ok(forModel.includes(p.aliasOf("12")!));
    const a = p.aliasOf("12")!;
    assert.deepEqual(p.mapForClient({ worker_id: a, title: `משמרות של ${a}` }), { worker_id: "12", title: "משמרות של דנה לוי" });
    assert.equal(revealAliases(`ל${a} יש 3`, p.aliasNames), "לדנה לוי יש 3");
  });

  it("in the loop: model sees aliases, tools run on real ids, stored source keeps real ids", async () => {
    const db = resetTestDb();
    applyInsightsSchema(db);
    db.exec(`INSERT INTO Rank VALUES ('R1','r',1,datetime('now'));
             INSERT INTO Worker (worker_id,name,rank_id) VALUES ('1234567','אבי כהן','R1');`);
    const p = buildPseudonymizer([{ worker_id: "1234567", name: "אבי כהן" }], "secret");
    const alias = p.aliasOf("1234567")!;
    const store = new ResultStore();
    const evs: ChatEvent[] = [];
    const sent: Anthropic.MessageStreamParams[] = [];
    const tableInput = { title: `היסטוריה של ${alias}` };
    Object.defineProperty(tableInput, "result_id", {
      get: () => (evs.find((e) => e.type === "tool_result" && e.name === "worker_history") as { result: { result_id: string } } | undefined)?.result.result_id,
      enumerable: true,
    });
    await runChatLoop({
      client: fakeClient([
        { content: [toolUse("t1", "list_reference", { kind: "workers" })], stop: "tool_use" },
        { content: [toolUse("t2", "worker_history", { worker_id: alias })], stop: "tool_use" },
        { content: [toolUse("t3", "render_table", tableInput)], stop: "tool_use" },
        { text: `ל${alias} אין משמרות`, stop: "end_turn" },
      ], sent),
      history: [{ role: "user", content: `היסטוריה של ${alias}` }],
      context: buildContextMessage({ today: "2026-11-14", currentQuarterId: null, selectedQuarterId: null }),
      toolCtx: { db, store }, budget: new Budget(db, 5), emit: (e) => evs.push(e),
      mapToolInput: p.mapToolInput, mapForModel: p.mapForModel, mapForClient: p.mapForClient,
    });
    const toModel = JSON.stringify(sent.map((c) => c.messages));
    assert.ok(!toModel.includes("אבי") && !toModel.includes("1234567"), toModel);
    const hist = evs.find((e) => e.type === "tool_result" && e.name === "worker_history") as { result: { result_id: string }; is_error?: boolean };
    assert.equal(hist.is_error, undefined);
    assert.deepEqual(store.get(hist.result.result_id)!.source.args, { worker_id: "1234567" });
    // Args reach the client with the alias, so they round-trip through history unchanged.
    const call = evs.find((e) => e.type === "tool_call" && e.name === "worker_history") as { args: unknown };
    assert.deepEqual(call.args, { worker_id: alias });
    // Render args skip mapToolInput: the title's alias becomes the name, not the raw id.
    const table = evs.find((e) => e.type === "tool_result" && e.name === "render_table") as { result: { title: string }; is_error?: boolean };
    assert.equal(table.is_error, undefined);
    assert.equal(table.result.title, "היסטוריה של אבי כהן");
  });

  it("history round-trip keeps the right worker when two share a name; nameless workers stay aliased", () => {
    const p = buildPseudonymizer(
      [{ worker_id: "11111", name: "אבי כהן" }, { worker_id: "22222", name: "אבי כהן" }, { worker_id: "7", name: " " }],
      "secret",
    );
    const second = p.aliasOf("22222")!;
    const args = { sql: `SELECT * FROM ai_assignments WHERE worker_id = '${second}'` };
    const [back] = p.mapClientMessages([
      { role: "assistant", content: [{ type: "tool", toolName: "run_readonly_sql", args, result: {} }] },
    ]);
    assert.deepEqual((back.content[0] as { args: unknown }).args, args);
    assert.equal(p.aliasNames[p.aliasOf("7")!], p.aliasOf("7"));
  });

  it("shared names get numbered labels that map back to their own alias", () => {
    const p = buildPseudonymizer([{ worker_id: "22222", name: "דני לוי" }, { worker_id: "11111", name: "דני לוי" }], "secret");
    const [first, second] = [p.aliasOf("11111")!, p.aliasOf("22222")!];
    assert.equal(p.aliasNames[first], "דני לוי");
    assert.equal(p.aliasNames[second], "דני לוי (2)");
    const shown = revealAliases(`${first} ו${second}`, p.aliasNames);
    const [back] = p.mapClientMessages([{ role: "assistant", content: [{ type: "text", text: shown }] }]);
    assert.equal((back.content[0] as { text: string }).text, `${first} ו${second}`);
  });

  it("SQL: literals revealed, quoted column aliases kept; client keeps spec keys", () => {
    const p = buildPseudonymizer(workers, "secret");
    const a = p.aliasOf("12")!;
    const sql = `SELECT SUM(CASE WHEN worker_id = '${a}' THEN 1 END) AS "${a}" FROM ai_history`;
    assert.deepEqual(p.mapToolInput("run_readonly_sql", { sql }), {
      sql: `SELECT SUM(CASE WHEN worker_id = '12' THEN 1 END) AS "${a}" FROM ai_history`,
    });
    assert.deepEqual(p.mapForClient({ series: [{ key: a, label: a }] }), { series: [{ key: a, label: "דנה לוי" }] });
  });

  it("only worker id columns alias exact ids; other id columns and short values are kept", () => {
    const p = buildPseudonymizer(workers, "secret");
    const row = { worker_id: "12", reserve_worker_id: "1234567", rank_id: "12", shift_type_id: "1234567", month: "12", name: "אבי כהן" };
    const out = JSON.parse(p.mapForModel(JSON.stringify({ preview: [row] })) as string);
    assert.deepEqual(out.preview[0], {
      worker_id: p.aliasOf("12"), reserve_worker_id: p.aliasOf("1234567"),
      rank_id: "12", shift_type_id: "1234567", month: "12", name: p.aliasOf("1234567"),
    });
  });

  it("client keeps source SQL verbatim so saved views still match the spec keys", () => {
    const p = buildPseudonymizer(workers, "secret");
    const a = p.aliasOf("12")!;
    const sql = `SELECT COUNT(*) AS "${a}" FROM ai_history WHERE worker_id = '12'`;
    assert.deepEqual(p.mapForClient({ source: { args: { sql } } }), { source: { args: { sql } } });
  });

  it("single-word names are aliased only next to their own worker id", () => {
    const p = buildPseudonymizer([{ worker_id: "55555", name: "טל" }, { worker_id: "66666", name: "אור" }], "secret");
    const [tal, or] = [p.aliasOf("55555")!, p.aliasOf("66666")!];
    const [m] = p.mapClientMessages([user("בטל את זה, טל. כמה משמרות אור יום יש?")]);
    assert.equal((m.content[0] as { text: string }).text, "בטל את זה, טל. כמה משמרות אור יום יש?");
    const out = JSON.parse(p.mapForModel(JSON.stringify({
      preview: [
        { worker_id: "55555", name: "טל", rank_name: "אור" },
        { rank_id: "R1", name: "אור" },
        { shift_worker_id: "66666", shift_worker_name: "אור", reserve_worker_id: "55555", reserve_worker_name: "טל" },
      ],
    })) as string);
    assert.deepEqual(out.preview, [
      { worker_id: tal, name: tal, rank_name: "אור" },
      { rank_id: "R1", name: "אור" },
      { shift_worker_id: or, shift_worker_name: or, reserve_worker_id: tal, reserve_worker_name: tal },
    ]);
  });

  it("a shared name in a result row gets that row's worker alias", () => {
    const p = buildPseudonymizer([{ worker_id: "11111", name: "אבי כהן" }, { worker_id: "22222", name: "אבי כהן" }], "secret");
    const [first, second] = [p.aliasOf("11111")!, p.aliasOf("22222")!];
    const out = JSON.parse(p.mapForModel(JSON.stringify({
      preview: [{ worker_id: "22222", name: "אבי כהן" }, { worker_id: "11111", name: "אבי כהן" }, { name: "אבי כהן" }],
    })) as string);
    assert.deepEqual(out.preview, [{ worker_id: second, name: second }, { worker_id: first, name: first }, { name: first }]);
    // Client spec rows (real id + numbered label) map back the same way.
    const [back] = p.mapClientMessages([{ role: "assistant", content: [{ type: "tool", toolName: "render_table", args: {}, result: { data: [{ worker_id: "22222", name: "אבי כהן (2)" }] } }] }]);
    assert.deepEqual((back.content[0] as { result: unknown }).result, { data: [{ worker_id: second, name: second }] });
  });

  it("withAliases holds back an alias at the end of a delta (it may be a longer one)", () => {
    const ids = ["10000", "10001"];
    const p = buildPseudonymizer(ids.map((id) => ({ worker_id: id, name: `w ${id}` })), "secret");
    const [a, b] = [p.aliasOf(ids[0])!, p.aliasOf(ids[1])!];
    const evs: ChatEvent[] = [];
    const emit = withAliases((e) => evs.push(e), p);
    emit({ type: "text", delta: `ראה ${a.slice(0, 5)}` });
    emit({ type: "text", delta: `${a.slice(5)}` });
    assert.equal(evs.filter((e) => e.type === "aliases").length, 0, "alias at end of text is held");
    emit({ type: "text", delta: ` ו${b}.` });
    emit({ type: "done" });
    const maps = evs.filter((e) => e.type === "aliases") as { map: Record<string, string> }[];
    assert.deepEqual(Object.assign({}, ...maps.map((m) => m.map)), { [a]: `w ${ids[0]}`, [b]: `w ${ids[1]}` });
    assert.equal(evs.at(-1)?.type, "done");
  });

  it("aliasNamesIn returns only known, unsent aliases", () => {
    const p = buildPseudonymizer(workers, "secret");
    const [a, b] = [p.aliasOf("12")!, p.aliasOf("1234567")!];
    assert.deepEqual(p.aliasNamesIn(`${a} ו${b} W-abc`), { [a]: "דנה לוי", [b]: "אבי כהן" });
    assert.deepEqual(p.aliasNamesIn(`${a} ו${b}`, new Set([a])), { [b]: "אבי כהן" });
    assert.equal(p.aliasNamesIn("אין כאן", new Set()), null);
  });

  it("SQL: only '…' literals are revealed; \"W-…\" is always an identifier", () => {
    const p = buildPseudonymizer(workers, "secret");
    const a = p.aliasOf("12")!;
    // Pivot column filtered by comparison stays a column (was rewritten to '12' > 2).
    const pivot = `SELECT * FROM (SELECT SUM(CASE WHEN worker_id='${a}' THEN 1 END) AS "${a}" FROM ai_assignments) WHERE "${a}" > 2 OR "${a}" = 1`;
    assert.deepEqual(p.mapToolInput("run_readonly_sql", { sql: pivot }), {
      sql: `SELECT * FROM (SELECT SUM(CASE WHEN worker_id='12' THEN 1 END) AS "${a}" FROM ai_assignments) WHERE "${a}" > 2 OR "${a}" = 1`,
    });
    // Apostrophes in comments / quoted identifiers don't open a fake literal; escapes inside literals survive.
    const tricky = `-- ספירה לצ'ק\nSELECT 1 AS "don't", 'it''s ${a}' AS t /* a'b */ FROM ai_history WHERE worker_id = '${a}'`;
    assert.deepEqual(p.mapToolInput("run_readonly_sql", { sql: tricky }), {
      sql: `-- ספירה לצ'ק\nSELECT 1 AS "don't", 'it''s 12' AS t /* a'b */ FROM ai_history WHERE worker_id = '12'`,
    });
  });

  it("SQL: a double-quoted alias meant as a value errors instead of matching nothing", () => {
    const db = resetTestDb();
    applyInsightsSchema(db);
    assert.throws(() => db.prepare(`SELECT * FROM ai_history WHERE worker_id = "W-abc12345"`).all(), /no such column/);
  });

  it("result keys and numeric worker ids are aliased for the model", () => {
    const p = buildPseudonymizer(workers, "secret");
    const [avi, dana] = [p.aliasOf("1234567")!, p.aliasOf("12")!];
    const key = "COUNT(*) FILTER (WHERE worker_id='1234567')";
    const out = JSON.parse(p.mapForModel(JSON.stringify({
      columns: [key, "worker_id"],
      preview: [{ [key]: 3, worker_id: 12 }, { total: 1234567, rank_id: 1234567, n: 12 }],
    })) as string);
    assert.deepEqual(out, {
      columns: [`COUNT(*) FILTER (WHERE worker_id='${avi}')`, "worker_id"],
      // A count/sum equal to an id stays a number; only worker id columns alias numbers.
      preview: [{ [`COUNT(*) FILTER (WHERE worker_id='${avi}')`]: 3, worker_id: dana }, { total: 1234567, rank_id: 1234567, n: 12 }],
    });
    // render keys copied from that result resolve to the stored column; pivot "W-…" columns match as is.
    assert.equal(p.resolveKey(`COUNT(*) FILTER (WHERE worker_id='${avi}')`, [key]), key);
    assert.equal(p.resolveKey(dana, [dana]), dana);
  });

  it("column names: a name pivot resolves back; clashes get suffixes; unknown keys never echo real columns", () => {
    const p = buildPseudonymizer(workers, "secret");
    const avi = p.aliasOf("1234567")!;
    const cols = ["אבי כהן", "1234567", "12", "n"];
    const out = JSON.parse(p.mapForModel(JSON.stringify({ columns: cols, preview: [{ "אבי כהן": 1, "1234567": 2, "12": 3, n: 4 }] })) as string);
    // Both clash on the alias; sorted original order: "1234567" < "אבי כהן". Short id "12" stays (documented limit).
    assert.deepEqual(out.columns, [`${avi} (2)`, avi, "12", "n"]);
    assert.deepEqual(out.preview[0], { [`${avi} (2)`]: 1, [avi]: 2, "12": 3, n: 4 });
    for (const [i, shown] of out.columns.entries()) assert.equal(p.resolveKey(shown, cols), cols[i]);
    assert.throws(() => p.resolveKey("nope", ["1234567", "דנה לוי"]), (e: Error) => !e.message.includes("1234567") && !e.message.includes("דנה"));
  });

  it("query summary columns reach the client as aliases (they come back in history)", () => {
    const p = buildPseudonymizer([{ worker_id: "55555", name: "טל" }], "secret");
    const tal = p.aliasOf("55555")!;
    assert.deepEqual(p.mapForClient({ columns: [tal, "n"], title: tal }), { columns: [tal, "n"], title: "טל" });
  });

  it("*_by columns are worker id columns", () => {
    const p = buildPseudonymizer(workers, "secret");
    const out = JSON.parse(p.mapForModel(JSON.stringify({ preview: [{ assigned_by: "12" }] })) as string);
    assert.deepEqual(out.preview[0], { assigned_by: p.aliasOf("12") });
    assert.deepEqual(p.mapForClient({ assigned_by: p.aliasOf("12") }), { assigned_by: "12" });
  });

  it("ALIAS_RE matches whole aliases only", () => {
    const names = { "W-abc": "x" };
    assert.equal(revealAliases("ROW-abc W-abcd W-abc W-abc_n לW-abc", names), "ROW-abc W-abcd x x_n לx");
    // Hebrew prefix joined with a hyphen; a hyphen after a Latin letter is not a prefix.
    assert.equal(revealAliases("ל-W-abc של-W-abc x-W-abc", names), "ל-x של-x x-W-abc");
  });
});
