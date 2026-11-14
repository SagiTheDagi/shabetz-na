/** Client-side pure helpers for /admin/insights: chat event reducer, wire format, table sort. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyEvent, splitLines, toWireMessages, WIRE_MAX_MESSAGES, type AssistantTurn, type ThreadMessage } from "../insights/chat-client";
import { sortRows } from "../insights/csv";
import { buildHistory, chatRequestSchema, MAX_TURNS } from "../insights/prompt";

describe("chat client helpers", () => {
  const empty = (): AssistantTurn => ({ id: "a", role: "assistant", parts: [], notices: [], status: "running" });

  it("folds events: text merges, tool parts update in place", () => {
    let t = empty();
    t = applyEvent(t, { type: "text", delta: "שלום" });
    t = applyEvent(t, { type: "text", delta: " עולם" });
    t = applyEvent(t, { type: "tool_call", id: "t1", name: "shifts_per_worker", args: {} });
    t = applyEvent(t, { type: "tool_result", id: "t1", name: "shifts_per_worker", result: { result_id: "r_1" } });
    t = applyEvent(t, { type: "text", delta: "\n\nסוף" });
    t = applyEvent(t, { type: "notice", message: "n" });
    t = applyEvent(t, { type: "done" });
    assert.deepEqual(t.parts.map((p) => (p.type === "text" ? p.text : p.status)), ["שלום עולם", "done", "סוף"]);
    assert.deepEqual(t.notices, ["n"]);
    assert.equal(t.status, "done");
  });

  it("splitLines keeps the partial tail", () => {
    assert.deepEqual(splitLines('{"a":1}\n{"b":'), { lines: ['{"a":1}'], rest: '{"b":' });
  });

  it("wire format strips chart rows", () => {
    const thread: ThreadMessage[] = [
      { id: "u", role: "user", text: "q" },
      {
        ...empty(), status: "done",
        parts: [
          { type: "tool", id: "t1", toolName: "shifts_per_worker", args: {}, status: "done", result: { result_id: "r_1", columns: ["a"], row_count: 9 } },
          { type: "tool", id: "t2", toolName: "render_chart", args: { result_id: "r_1", title: "x" }, status: "done", result: { data: [{ a: 1 }, { a: 2 }], title: "x" } },
        ],
      },
    ];
    const wire = toWireMessages(thread);
    assert.deepEqual(wire[1].content[1], { type: "tool", toolName: "render_chart", args: { result_id: "r_1", title: "x" }, result: { rows: 2 } });
    assert.ok(!JSON.stringify(wire).includes('"data"'));
  });

  it("failed and cancelled tool calls go out as errors, not empty results", () => {
    const thread: ThreadMessage[] = [
      { id: "u", role: "user", text: "q" },
      {
        ...empty(), status: "cancelled",
        parts: [
          { type: "tool", id: "t1", toolName: "render_chart", args: { result_id: "r_x", title: "x" }, status: "error", result: { error: "הרצת הכלי נכשלה" } },
          { type: "tool", id: "t2", toolName: "shifts_per_worker", args: { year: 2026 }, status: "running" },
        ],
      },
    ];
    const [, a] = toWireMessages(thread);
    assert.deepEqual(a.content.map((p) => (p.type === "tool" ? p.result : null)), [{ error: "failed" }, { error: "cancelled" }]);
    const text = JSON.stringify(buildHistory([...toWireMessages(thread), { role: "user", content: [{ type: "text", text: "n" }] }]));
    assert.ok(text.includes("[chart failed, not shown: x, result_id=r_x]"), text);
    assert.ok(text.includes("[query cancelled, no result: shifts_per_worker"), text);
  });

  it("long threads send only recent messages and stay under the request cap", () => {
    const thread: ThreadMessage[] = [];
    for (let i = 0; i < 150; i++) {
      thread.push({ id: `u${i}`, role: "user", text: `q${i}` });
      thread.push({ ...empty(), id: `a${i}`, status: "done", parts: [{ type: "text", text: `a${i}` }] });
    }
    const wire = toWireMessages([...thread, { id: "new", role: "user", text: "next" }]);
    assert.equal(wire.length, WIRE_MAX_MESSAGES);
    assert.deepEqual(wire.at(-1)!.content, [{ type: "text", text: "next" }]);
    assert.ok(chatRequestSchema.safeParse({ messages: wire }).success);
    assert.equal(buildHistory(wire).filter((m) => m.role === "user").length, MAX_TURNS);
  });
});

describe("table sort", () => {
  it("sortRows: numeric, nulls last, stable", () => {
    const rows = [{ n: 2, k: "b" }, { n: null, k: "x" }, { n: 10, k: "a" }, { n: 2, k: "c" }];
    assert.deepEqual(sortRows(rows, "n", "desc").map((r) => r.k), ["a", "b", "c", "x"]);
    assert.deepEqual(sortRows(rows, "n", "asc").map((r) => r.k), ["b", "c", "a", "x"]);
  });
});
