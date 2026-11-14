/**
 * Eval for the insights assistant: runs Hebrew questions through the real
 * chat loop (real Claude calls, real tools) against DATABASE_PATH, and checks
 * that the expected number appears in the final answer text or in the
 * rendered chart/table data. Expected values are computed live with SQL, so
 * the cases hold for any seeded DB.
 *
 * COSTS MONEY (~$0.002 per question per effort level) and records usage in
 * that DB's InsightUsage. Run it against a TEST database.
 *
 * Usage: npx tsx --env-file=.env scripts/eval-insights.ts [--effort low,medium] [--only 3]
 */
import Anthropic from "@anthropic-ai/sdk";
import Database from "better-sqlite3";
import { resolveDbPath } from "../src/lib/db";
import { openReadonlyDb } from "../src/lib/insights/readonly-db";
import { ResultStore } from "../src/lib/insights/result-store";
import { Budget } from "../src/lib/insights/budget";
import { buildContextMessage } from "../src/lib/insights/prompt";
import { runChatLoop, type ChatEvent, type Effort, type LoopClient } from "../src/lib/insights/chat-loop";
import { computeCost } from "../src/lib/insights/pricing";
import { toIsoDate } from "../src/lib/date-utils";

interface Case {
  q: string;
  /** SQL returning one numeric value that must appear in the answer or rendered data. */
  expectSql: string;
  /** Tool the model should call (soft check, reported only). */
  tool?: string;
}

// DRAFT cases: replace/extend with the product owner's real questions (aim for 15–20).
const CASES: Case[] = [
  { q: "כמה עובדים פעילים (לא בארכיון) יש במערכת?", expectSql: "SELECT COUNT(*) FROM Worker WHERE is_archived = 0" },
  { q: "כמה דרגות מוגדרות במערכת?", expectSql: "SELECT COUNT(*) FROM Rank", tool: "list_reference" },
  { q: "כמה סוגי משמרות יש?", expectSql: "SELECT COUNT(*) FROM ShiftType", tool: "list_reference" },
  { q: "כמה רבעונים קיימים במערכת?", expectSql: "SELECT COUNT(*) FROM Quarter", tool: "list_reference" },
  { q: "כמה עובדים פטורים ממשמרות (לא בארכיון)?", expectSql: "SELECT COUNT(*) FROM Worker WHERE is_exempt = 1 AND is_archived = 0" },
  { q: "כמה תאריכי משמרות יש ברבעון הנוכחי?", expectSql: "SELECT COUNT(*) FROM ShiftDate sd JOIN Quarter q ON q.quarter_id = sd.quarter_id WHERE date('now') BETWEEN q.start_date AND q.end_date" },
  { q: "כמה משמרות סופ\"ש יש בסך הכל ברבעון הנוכחי?", expectSql: "SELECT COUNT(*) FROM ShiftDate sd JOIN Quarter q ON q.quarter_id = sd.quarter_id WHERE sd.is_weekend = 1 AND date('now') BETWEEN q.start_date AND q.end_date" },
  { q: "כמה משמרות (משובץ ראשי) שובצו בסך הכל ברבעון הנוכחי?", expectSql: "SELECT COUNT(*) FROM ShiftAssignment sa JOIN ShiftDate sd ON sd.shift_date_id = sa.shift_date_id JOIN Quarter q ON q.quarter_id = sd.quarter_id WHERE sa.role = 'shift' AND date('now') BETWEEN q.start_date AND q.end_date" },
  { q: "כמה תאריכים ברבעון הנוכחי עדיין ללא משובץ?", expectSql: "SELECT COUNT(*) FROM ShiftDate sd JOIN Quarter q ON q.quarter_id = sd.quarter_id WHERE date('now') BETWEEN q.start_date AND q.end_date AND NOT EXISTS (SELECT 1 FROM ShiftAssignment sa WHERE sa.shift_date_id = sd.shift_date_id AND sa.role = 'shift')", tool: "quarter_coverage" },
  { q: "כמה סימוני 'לא יכול' הוגשו ברבעון הנוכחי?", expectSql: "SELECT COUNT(*) FROM WorkerAvailability wa JOIN Quarter q ON q.quarter_id = wa.quarter_id WHERE wa.status = 'unavailable' AND date('now') BETWEEN q.start_date AND q.end_date", tool: "availability_summary" },
];

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const efforts = (opt("effort") ?? "medium,low").split(",") as Effort[];
const only = opt("only") ? Number(opt("only")) : CASES.length;

const dbPath = resolveDbPath();
const rw = new Database(dbPath);
const ro = openReadonlyDb(dbPath);
const client = new Anthropic();
const budget = new Budget(rw);

const today = toIsoDate(new Date());
const current = ro.prepare("SELECT quarter_id FROM Quarter WHERE start_date <= ? AND end_date >= ? LIMIT 1").get(today, today) as
  | { quarter_id: string }
  | undefined;
const context = buildContextMessage({ today, currentQuarterId: current?.quarter_id ?? null, selectedQuarterId: null });

// Count usage per run by wrapping the stream.
let runUsage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const countingClient: LoopClient = {
  messages: {
    stream(params, o) {
      const s = client.messages.stream(params, o);
      const orig = s.finalMessage.bind(s);
      return Object.assign(s, {
        finalMessage: async () => {
          const m = await orig();
          runUsage.input_tokens += m.usage.input_tokens;
          runUsage.output_tokens += m.usage.output_tokens;
          runUsage.cache_creation_input_tokens += m.usage.cache_creation_input_tokens ?? 0;
          runUsage.cache_read_input_tokens += m.usage.cache_read_input_tokens ?? 0;
          return m;
        },
      });
    },
  },
};

const numbersIn = (s: string) => (s.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

async function main() {
  console.log(`DB: ${dbPath}\nEfforts: ${efforts.join(", ")}  Cases: ${only}\n`);
  const summary: string[] = [];
  for (const effort of efforts) {
    let pass = 0;
    let cost = 0;
    for (const c of CASES.slice(0, only)) {
      const expected = Number(Object.values(ro.prepare(c.expectSql).get() as Record<string, number>)[0]);
      const events: ChatEvent[] = [];
      runUsage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
      const t0 = Date.now();
      try {
        await runChatLoop({
          client: countingClient,
          history: [{ role: "user", content: c.q }],
          context,
          toolCtx: { db: ro, store: new ResultStore() },
          budget,
          effort,
          emit: (e) => events.push(e),
        });
      } catch (e) {
        events.push({ type: "error", message: String(e) });
      }
      const text = events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("");
      const rendered = events
        .filter((e) => e.type === "tool_result" && (e.name === "render_chart" || e.name === "render_table"))
        .map((e) => JSON.stringify((e as { result: unknown }).result));
      const tools = events.filter((e) => e.type === "tool_call").map((e) => (e as { name: string }).name);
      const ok = numbersIn(text).includes(expected) || rendered.some((r) => numbersIn(r).includes(expected));
      const runCost = computeCost(runUsage);
      cost += runCost;
      if (ok) pass++;
      console.log(
        `${ok ? "PASS" : "FAIL"} [${effort}] ${c.q}\n  expected=${expected} tools=${tools.join(",") || "-"}` +
          `${c.tool && !tools.includes(c.tool) ? ` (expected tool ${c.tool})` : ""} ${Date.now() - t0}ms $${runCost.toFixed(4)}` +
          `\n  answer: ${text.replace(/\s+/g, " ").slice(0, 160)}`,
      );
    }
    summary.push(`${effort}: ${pass}/${Math.min(only, CASES.length)} passed, $${cost.toFixed(4)} total`);
  }
  console.log("\n" + summary.join("\n"));
  rw.close();
  ro.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
