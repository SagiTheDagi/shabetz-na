"use client";

/**
 * /admin/insights. On mobile: the chat itself, in-memory only (lost on
 * reload). On desktop the assistant is the panel docked beside every admin
 * page (AssistantPanel in the layout), so this route just opens it.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUp, Square, RotateCcw, LayoutGrid } from "lucide-react";
import { useSelectedQuarter } from "@/lib/selected-quarter";
import { useIsMobile } from "@/lib/use-media";
import { useInsightsChat } from "@/lib/insights/use-insights-chat";
import { setAssistantOpen } from "@/lib/insights/panel-store";
import { BudgetIndicator, useInsightsUsage } from "@/components/insights/budget-indicator";
import {
  EXAMPLES, NotConfiguredNotice, PSEUDONYMIZE_NOTE, Thread, useFollowScroll,
} from "@/components/insights/chat-thread";

export default function InsightsPage() {
  const isMobile = useIsMobile();
  useEffect(() => {
    if (isMobile === false) setAssistantOpen(true);
  }, [isMobile]);

  if (isMobile === null) return null;
  return isMobile ? <MobileChat /> : <DesktopHint />;
}

function DesktopHint() {
  const usage = useInsightsUsage(0);
  if (!usage) return null;
  if (!usage.enabled) return <NotConfiguredNotice usage={usage} />;
  return (
    <div className="max-w-xl rounded-xl border border-white/5 nocturne-surface p-4 text-[13px] flex flex-col gap-2">
      <p className="m-0">העוזר זמין בחלונית הצד בכל עמודי הניהול, דרך הכפתור ״עוזר AI״ בסרגל העליון.</p>
      <Link href="/admin/insights/saved" className="inline-flex items-center gap-1 nocturne-accent hover:opacity-80">
        <LayoutGrid className="size-3.5" /> תצוגות שמורות
      </Link>
    </div>
  );
}

function MobileChat() {
  const selectedQuarterId = useSelectedQuarter();
  const [usageKey, setUsageKey] = useState(0);
  const usage = useInsightsUsage(usageKey);
  const { thread, running, send, stop, reset } = useInsightsChat({
    selectedQuarterId,
    onTurnEnd: () => setUsageKey((k) => k + 1),
  });
  const [input, setInput] = useState("");
  const disabled = !!usage && !usage.enabled;
  // The "not configured" early return unmounts both divs.
  const { scrollRef, contentRef, onScroll, stick } = useFollowScroll(disabled);

  function submit(text = input) {
    if (!text.trim() || running) return;
    stick();
    void send(text);
    setInput("");
  }

  if (disabled) return <NotConfiguredNotice usage={usage} />;

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

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 min-h-0 overflow-y-auto">
        <div ref={contentRef} className="min-h-full flex flex-col gap-5 pb-2">
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
      {usage?.pseudonymize && (
        <p className="text-[11px] nocturne-text-muted m-0 -mt-1">
          {PSEUDONYMIZE_NOTE}
        </p>
      )}
    </div>
  );
}
