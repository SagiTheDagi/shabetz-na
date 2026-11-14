"use client";

/**
 * Chat thread rendering shared by the desktop assistant panel and the mobile
 * /admin/insights page.
 *
 * Streaming replaces the last turn on every text delta. Turns and chart/table
 * cards are memoized on their (immutable) objects, so only the running turn's
 * text re-renders.
 */
import { memo, useEffect, useRef } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import {
  isChartPart, isTablePart, revealAliases, TOOL_LABELS, type AssistantPart, type AssistantTurn, type ThreadMessage,
} from "@/lib/insights/chat-client";
import { InsightCard, type InsightCardContent } from "@/components/insights/insight-card";
import { SaveViewButton } from "@/components/insights/save-view-dialog";
import type { InsightsUsage } from "@/components/insights/budget-indicator";

export const EXAMPLES = [
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
  // Busy unless text is streaming: no output yet, a tool running, or waiting for the model after a tool.
  const busy = turn.status === "running" && turn.parts[turn.parts.length - 1]?.type !== "text";
  return (
    <div className="flex flex-col gap-3 min-w-0">
      {turn.parts.map((p, i) => {
        if (p.type === "text") {
          return p.text.trim() ? (
            <p key={i} className="whitespace-pre-wrap leading-relaxed text-[13.5px] m-0">{revealAliases(p.text, turn.aliases)}</p>
          ) : null;
        }
        return <PartCard key={p.id} part={p} question={question} />;
      })}
      {busy && (
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

export function Thread({ thread }: { thread: ThreadMessage[] }) {
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

/**
 * Keeps a scroll container pinned to the bottom while the user is already
 * there. Follows size changes, not just thread updates: charts measure and
 * grow after the commit, and the container shrinks when the textarea grows.
 * `remountKey` changes when the two divs are unmounted and mounted again.
 */
export function useFollowScroll(remountKey: unknown) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  /** Follow new output only while the user hasn't scrolled up to read. */
  const stickRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const follow = () => {
      if (stickRef.current) el.scrollTop = el.scrollHeight;
    };
    follow();
    const ro = new ResizeObserver(follow);
    ro.observe(content);
    ro.observe(el); // container shrinks too (notice/textarea/keyboard), content height unchanged
    return () => ro.disconnect();
  }, [remountKey]);

  function onScroll() {
    const el = scrollRef.current;
    // A hidden container (closed panel) reports zero sizes: keep the last answer.
    if (el && el.clientHeight > 0) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }

  /** Pin to the bottom again: on send, and when the container is shown again (display:none drops scrollTop). */
  function stick() {
    stickRef.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  return { scrollRef, contentRef, onScroll, stick };
}

/** Shown instead of the chat when the server lacks the settings the assistant needs. */
export function NotConfiguredNotice({ usage }: { usage: InsightsUsage | null }) {
  return (
    <div className="max-w-xl rounded-xl border border-white/5 nocturne-surface p-4 text-[13px]">
      {usage?.misconfigured === "alias_secret" ? (
        <>INSIGHTS_PSEUDONYMIZE פעיל אך חסר סוד לכינויים. יש להגדיר <code dir="ltr">INSIGHTS_ALIAS_SECRET</code> (או <code dir="ltr">SESSION_SECRET</code>) בקובץ הסביבה ולהפעיל מחדש.</>
      ) : (
        <>העוזר אינו מוגדר בשרת. יש להגדיר <code dir="ltr">ANTHROPIC_API_KEY</code> בקובץ הסביבה ולהפעיל מחדש.</>
      )}
    </div>
  );
}

export const PSEUDONYMIZE_NOTE =
  "שמות ומספרי עובדים מוחלפים בכינויים לפני השליחה לשירות. ההחלפה מדויקת בלבד: כינויי חיבה, שגיאות כתיב ומספרי עובד קצרים מ-5 ספרות נשלחים כפי שנכתבו. העדף שם מלא.";
