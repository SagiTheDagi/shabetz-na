"use client";

/**
 * /admin/insights: chat with the insights assistant. The thread is in-memory
 * only (lost on reload). Charts and tables arrive as finished tool results
 * with rows joined server-side.
 *
 * Streaming replaces the last turn on every text delta. Turns and chart/table
 * cards are memoized on their (immutable) objects, so only the running turn's
 * text re-renders, and the view follows new output only while the user is
 * already at the bottom.
 */
import Link from "next/link";
import { memo, useEffect, useRef, useState } from "react";
import { ArrowUp, Square, Loader2, RotateCcw, LayoutGrid, AlertTriangle } from "lucide-react";
import { useSelectedQuarter } from "@/lib/selected-quarter";
import { useInsightsChat } from "@/lib/insights/use-insights-chat";
import {
  isChartPart, isTablePart, TOOL_LABELS, type AssistantPart, type AssistantTurn, type ThreadMessage,
} from "@/lib/insights/chat-client";
import { InsightCard, type InsightCardContent } from "@/components/insights/insight-card";
import { SaveViewButton } from "@/components/insights/save-view-dialog";
import { BudgetIndicator, useInsightsUsage } from "@/components/insights/budget-indicator";

const EXAMPLES = [
  "כמה משמרות סופ״ש עשה כל עובד השנה?",
  "מי לא שובץ ברבעון הנוכחי?",
  "הצג התפלגות זמינות לפי דרגה",
  "אילו תאריכים ברבעון חסרים עתודה?",
];

/** Re-renders only when its part object changes (never while later text streams in). */
const PartCard = memo(function PartCard({ part, question }: { part: AssistantPart; question: string }) {
  const content: InsightCardContent | null = isChartPart(part)
    ? { kind: "chart", spec: part.result }
    : isTablePart(part)
      ? { kind: "table", spec: part.result }
      : null;
  if (!content) return null;
  return <InsightCard {...content} actions={<SaveViewButton content={content} question={question} />} />;
});

const AssistantMessage = memo(function AssistantMessage({ turn, question }: { turn: AssistantTurn; question: string }) {
  const running = turn.parts.filter((p) => p.type === "tool" && p.status === "running");
  const empty = turn.parts.length === 0 && turn.status === "running";
  return (
    <div className="flex flex-col gap-3 min-w-0">
      {turn.parts.map((p, i) => {
        if (p.type === "text") {
          return p.text.trim() ? (
            <p key={i} className="whitespace-pre-wrap leading-relaxed text-[13.5px] m-0">{p.text}</p>
          ) : null;
        }
        return <PartCard key={p.id} part={p} question={question} />;
      })}
      {(empty || running.length > 0) && turn.status === "running" && (
        <div className="flex items-center gap-2 text-[12px] nocturne-text-muted">
          <Loader2 className="size-3.5 animate-spin" />
          {running.length > 0 && running[0].type === "tool"
            ? `${TOOL_LABELS[running[0].toolName] ?? "מעבד"}…`
            : "חושב…"}
        </div>
      )}
      {turn.notices.map((n, i) => (
        <div key={i} className="flex items-center gap-2 text-[12px] nocturne-warning">
          <AlertTriangle className="size-3.5" /> {n}
        </div>
      ))}
      {turn.error && <div className="text-[12px] nocturne-error">{turn.error}</div>}
      {turn.status === "cancelled" && <div className="text-[11px] nocturne-text-muted">הופסק</div>}
    </div>
  );
});

const UserMessage = memo(function UserMessage({ text }: { text: string }) {
  return (
    <div className="self-start max-w-[85%] rounded-2xl rounded-tr-sm px-3.5 py-2 text-[13.5px] whitespace-pre-wrap nocturne-accent-badge">
      {text}
    </div>
  );
});

function Thread({ thread }: { thread: ThreadMessage[] }) {
  return (
    <>
      {thread.map((m, i) =>
        m.role === "user" ? (
          <UserMessage key={m.id} text={m.text} />
        ) : (
          <AssistantMessage
            key={m.id}
            turn={m}
            question={(thread[i - 1] && thread[i - 1].role === "user" ? (thread[i - 1] as { text: string }).text : "")}
          />
        ),
      )}
    </>
  );
}

export default function InsightsPage() {
  const selectedQuarterId = useSelectedQuarter();
  const [usageKey, setUsageKey] = useState(0);
  const usage = useInsightsUsage(usageKey);
  const { thread, running, send, stop, reset } = useInsightsChat({
    selectedQuarterId,
    onTurnEnd: () => setUsageKey((k) => k + 1),
  });
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Follow new output only while the user hasn't scrolled up to read. */
  const stickRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [thread]);

  function onScroll() {
    const el = scrollRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }

  function submit(text = input) {
    if (!text.trim() || running) return;
    stickRef.current = true;
    void send(text);
    setInput("");
  }

  if (usage && !usage.enabled) {
    return (
      <div className="max-w-xl rounded-xl border border-white/5 nocturne-surface p-4 text-[13px]">
        העוזר אינו מוגדר בשרת. יש להגדיר <code dir="ltr">ANTHROPIC_API_KEY</code> בקובץ הסביבה ולהפעיל מחדש.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col max-w-4xl mx-auto w-full gap-3">
      <div className="flex items-center gap-3 text-[12px]">
        <BudgetIndicator usage={usage} />
        <div className="mr-auto flex items-center gap-3">
          <Link href="/admin/insights/saved" className="inline-flex items-center gap-1 nocturne-text-secondary hover:opacity-80">
            <LayoutGrid className="size-3.5" /> תצוגות שמורות
          </Link>
          {thread.length > 0 && (
            <button type="button" onClick={reset} className="inline-flex items-center gap-1 nocturne-text-secondary hover:opacity-80">
              <RotateCcw className="size-3.5" /> שיחה חדשה
            </button>
          )}
        </div>
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-5 pb-2">
        {thread.length === 0 ? (
          <div className="m-auto flex flex-col items-center gap-4 text-center max-w-md py-8">
            <p className="text-[15px] m-0">שאל שאלה על נתוני השיבוץ</p>
            <p className="text-[12px] nocturne-text-muted m-0">
              התשובות מבוססות על נתוני המערכת. השיחה אינה נשמרת, אך ניתן לשמור גרפים וטבלאות כתצוגות.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {EXAMPLES.map((q) => (
                <button key={q} type="button" onClick={() => submit(q)}
                  className="text-[12px] px-3 py-1.5 rounded-full border nocturne-border hover:bg-white/5">
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <Thread thread={thread} />
        )}
      </div>

      <form
        className="flex items-end gap-2 rounded-2xl border nocturne-border nocturne-surface p-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          maxLength={2000}
          placeholder="לדוגמה: מי עשה הכי הרבה משמרות השנה?"
          className="flex-1 resize-none bg-transparent outline-none text-[14px] px-2 py-1.5 max-h-40 field-sizing-content"
        />
        {running ? (
          <button type="button" onClick={stop} aria-label="עצור"
            className="size-9 grid place-items-center rounded-full border nocturne-border hover:bg-white/5">
            <Square className="size-3.5 fill-current" />
          </button>
        ) : (
          <button type="submit" aria-label="שלח" disabled={!input.trim()}
            className="size-9 grid place-items-center rounded-full nocturne-accent-bg text-white disabled:opacity-40">
            <ArrowUp className="size-4" />
          </button>
        )}
      </form>
    </div>
  );
}
