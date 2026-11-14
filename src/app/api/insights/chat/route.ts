/**
 * POST /api/insights/chat: streamed insights chat (NDJSON, one ChatEvent per
 * line). Admin-only (proxy + re-checked here), budget-reserved, rate-limited.
 * The request's abort signal stops the tool loop; tokens already used are
 * still recorded.
 */
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { withApiErrors } from "@/lib/api-helpers";
import { ensureInsightsSchema } from "@/lib/insights/views";
import { toIsoDate } from "@/lib/date-utils";
import { getReadonlyDb } from "@/lib/insights/readonly-db";
import { getResultStore } from "@/lib/insights/result-store";
import { getBudget, BUDGET_EXCEEDED_MESSAGE } from "@/lib/insights/budget";
import { getChatRateLimiter } from "@/lib/insights/rate-limit";
import { insightsEnabled, NOT_CONFIGURED_MESSAGE } from "@/lib/insights/config";
import { chatRequestSchema, buildHistory, buildContextMessage, HistoryError } from "@/lib/insights/prompt";
import {
  runChatLoop, buildParams, estimateParamsCost, MESSAGES, DEFAULT_EFFORT,
  type ChatEvent, type Effort, type LoopClient,
} from "@/lib/insights/chat-loop";

export const runtime = "nodejs";

const EFFORTS: Effort[] = ["low", "medium", "high"];
const effortFromEnv = (): Effort =>
  EFFORTS.includes(process.env.INSIGHTS_EFFORT as Effort) ? (process.env.INSIGHTS_EFFORT as Effort) : DEFAULT_EFFORT;

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic());

export const POST = withApiErrors(async (req: Request) => {
  const session = await requireAdmin();
  ensureInsightsSchema();
  if (!insightsEnabled()) {
    return NextResponse.json({ error: NOT_CONFIGURED_MESSAGE }, { status: 503 });
  }

  const limit = getChatRateLimiter().check(session.worker_id);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "יותר מדי בקשות, נסה שוב בעוד דקה" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs ?? 60_000) / 1000)) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "גוף הבקשה אינו JSON תקין" }, { status: 400 });
  }
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "מבנה הבקשה שגוי" }, { status: 400 });
  }

  const roDb = getReadonlyDb();

  let history;
  try {
    history = buildHistory(parsed.data.messages);
  } catch (e) {
    if (e instanceof HistoryError) {
      return NextResponse.json({ error: "השאלה ארוכה מדי או ריקה" }, { status: 400 });
    }
    throw e;
  }

  const today = toIsoDate(new Date());
  const current = roDb
    .prepare("SELECT quarter_id FROM Quarter WHERE start_date <= ? AND end_date >= ? ORDER BY quarter_id LIMIT 1")
    .get(today, today) as { quarter_id: string } | undefined;
  const context = buildContextMessage({
    today,
    currentQuarterId: current?.quarter_id ?? null,
    selectedQuarterId: parsed.data.selected_quarter_id ?? null,
  });

  const effort = effortFromEnv();
  const budget = getBudget(getDb());
  const first = budget.reserve(estimateParamsCost(buildParams(history, context, [], effort)));
  if (!first.ok) {
    return NextResponse.json({ error: BUDGET_EXCEEDED_MESSAGE }, { status: 429 });
  }

  const encoder = new TextEncoder();
  const signal = req.signal;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (e: ChatEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          closed = true; // client went away
        }
      };
      try {
        await runChatLoop({
          client: getClient() as unknown as LoopClient,
          history,
          context,
          toolCtx: { db: roDb, store: getResultStore(), owner: session.worker_id },
          budget,
          firstReservation: first.reservation,
          signal,
          effort,
          emit,
        });
      } catch (e) {
        console.error("[insights] chat failed", e);
        const msg =
          e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError
            ? "שירות העוזר עמוס כרגע, נסה שוב בעוד מעט"
            : MESSAGES.failed;
        emit({ type: "error", message: msg });
      } finally {
        // Safety net: release the first reservation if the loop never used it.
        budget.settle(first.reservation, null);
        emit({ type: "done" });
        if (!closed) {
          closed = true;
          try { controller.close(); } catch { /* already closed */ }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
});
