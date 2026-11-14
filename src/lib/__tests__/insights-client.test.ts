/** Client-side pure helpers for /admin/insights: chat event reducer, wire format, table sort, CSV. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyEvent, createRequestSlot, readNdjson, splitLines, toWireMessages, WIRE_MAX_MESSAGES, type AssistantTurn, type ThreadMessage } from "../insights/chat-client";
import { toCsv, sortRows } from "../insights/csv";
import type { Row } from "../insights/result-store";
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

  it("unanswered questions (empty assistant turn) are dropped with their reply", () => {
    const thread: ThreadMessage[] = [
      { id: "u0", role: "user", text: "q0" },
      { ...empty(), id: "a0", status: "done", parts: [{ type: "text", text: "a0" }] },
      { id: "u1", role: "user", text: "q1" },
      { ...empty(), id: "a1", status: "done", error: "budget" },
      { id: "u2", role: "user", text: "q2" },
      { ...empty(), id: "a2", status: "cancelled", parts: [{ type: "text", text: "  " }] },
      { id: "u3", role: "user", text: "q3" },
    ];
    const wire = toWireMessages(thread);
    assert.deepEqual(wire.map((m) => m.role), ["user", "assistant", "user"]);
    const hist = buildHistory(wire);
    assert.equal(hist[hist.length - 1].content, "q3");
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

describe("csv", () => {
  it("BOM, quoting, formula neutralization", () => {
    const csv = toCsv([{ key: "a", label: "שם" }, { key: "b", label: "ערך" }], [
      { a: 'אבי, "הגדול"', b: 3 },
      { a: "=HYPERLINK(1)", b: -2 },
      { a: null, b: null },
      { a: "\t=1+1", b: "\r=cmd" },
    ]);
    assert.ok(csv.startsWith("﻿"));
    assert.equal(csv.slice(1), 'שם,ערך\r\n"אבי, ""הגדול""",3\r\n\'=HYPERLINK(1),-2\r\n,\r\n\'\t=1+1,"\'\r=cmd"\r\n');
  });
  it("numbers never get the formula prefix", () => {
    assert.equal(toCsv([{ key: "n", label: "n" }], [{ n: -1e-7 }, { n: -1.5e21 }]).slice(1), "n\r\n-1e-7\r\n-1.5e+21\r\n");
  });
  it("object values export as JSON, like the table shows them", () => {
    assert.equal(toCsv([{ key: "j", label: "j" }], [{ j: { a: 1 } }, { j: [1, 2] }] as unknown as Row[]).slice(1), 'j\r\n"{""a"":1}"\r\n"[1,2]"\r\n');
  });
  it("sortRows: numeric, nulls last, stable", () => {
    const rows = [{ n: 2, k: "b" }, { n: null, k: "x" }, { n: 10, k: "a" }, { n: 2, k: "c" }];
    assert.deepEqual(sortRows(rows, "n", "desc").map((r) => r.k), ["a", "b", "c", "x"]);
    assert.deepEqual(sortRows(rows, "n", "asc").map((r) => r.k), ["b", "c", "a", "x"]);
  });
});

describe("readNdjson", () => {
  const streamOf = (...chunks: string[]) =>
    new ReadableStream<string>({
      start(c) {
        chunks.forEach((x) => c.enqueue(x));
        c.close();
      },
    });
  const collect = async (...chunks: string[]) => {
    const out: unknown[] = [];
    await readNdjson(streamOf(...chunks), (e) => out.push(e));
    return out;
  };

  it("joins lines split across chunks and skips bad lines", async () => {
    const out = await collect('{"type":"text","de', 'lta":"a"}\nnot json\n', '{"type":"done"}\n');
    assert.deepEqual(out, [{ type: "text", delta: "a" }, { type: "done" }]);
  });

  it("delivers a final event with no trailing newline", async () => {
    const out = await collect('{"type":"text","delta":"a"}\n{"type":"error","message":"x"}');
    assert.deepEqual(out, [{ type: "text", delta: "a" }, { type: "error", message: "x" }]);
  });
});

describe("createRequestSlot", () => {
  it("allows one request at a time", () => {
    const slot = createRequestSlot();
    const a = slot.acquire();
    assert.ok(a);
    assert.equal(slot.acquire(), null);
    assert.equal(slot.release(a!), true);
    assert.ok(slot.acquire());
  });

  it("reset frees the slot at once; the stale request's release is a no-op", () => {
    const slot = createRequestSlot();
    const old = slot.acquire()!;
    slot.reset();
    assert.equal(old.signal.aborted, true);
    const next = slot.acquire(); // send right after reset is not dropped
    assert.ok(next);
    assert.equal(slot.release(old), false); // aborted send's finally runs late
    assert.equal(slot.busy, true);
    assert.equal(slot.release(next!), true);
    assert.equal(slot.busy, false);
  });
});
