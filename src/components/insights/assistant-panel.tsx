"use client";

/**
 * Desktop assistant: a panel docked beside the page content on every admin
 * page, toggled from the header. It stays mounted while closed, so the
 * (in-memory) thread survives closing the panel and moving between pages.
 */
import { useEffect, useState } from "react";
import { useSelectedQuarter } from "@/lib/selected-quarter";
import { useInsightsChat } from "@/lib/insights/use-insights-chat";
import { setAssistantOpen, useAssistantOpen } from "@/lib/insights/panel-store";
import { BudgetIndicator, useInsightsUsage } from "@/components/insights/budget-indicator";
import {
  EXAMPLES, NotConfiguredNotice, PSEUDONYMIZE_NOTE, Thread, useFollowScroll,
} from "@/components/insights/chat-thread";

const LABEL = "text-[10px] tracking-widest nocturne-text-muted";

export function AssistantPanel() {
  const open = useAssistantOpen();
  const selectedQuarterId = useSelectedQuarter();
  const [usageKey, setUsageKey] = useState(0);
  const usage = useInsightsUsage(usageKey);
  const { thread, running, send, stop, reset } = useInsightsChat({
    selectedQuarterId,
    onTurnEnd: () => setUsageKey((k) => k + 1),
  });
  const [input, setInput] = useState("");
  const disabled = !!usage && !usage.enabled;
  const { scrollRef, contentRef, onScroll, stick } = useFollowScroll(disabled);

  useEffect(() => {
    if (open) stick();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stick only touches refs
  }, [open]);

  function submit(text = input) {
    if (!text.trim() || running) return;
    stick();
    void send(text);
    setInput("");
  }

  return (
    <aside
      aria-label="עוזר AI"
      className={`${open ? "hidden md:flex" : "hidden"} w-[clamp(280px,32vw,372px)] flex-none flex-col min-h-0 border-s nocturne-border`}
    >
      <div className="flex-none flex items-end gap-3 px-4 pt-3 pb-3.5 border-b nocturne-border">
        <div className="min-w-0">
          <div className={LABEL}>עוזר AI</div>
          <div className="text-[14px] font-medium mt-0.5">שאלו על נתוני המערכת</div>
        </div>
        <div className="mr-auto flex items-center gap-4 text-[12px] pb-0.5">
          <button
            type="button"
            onClick={reset}
            disabled={thread.length === 0}
            className="nocturne-accent hover:opacity-80 disabled:opacity-50 disabled:hover:opacity-50"
          >
            שיחה חדשה
          </button>
          <button type="button" onClick={() => setAssistantOpen(false)} className="nocturne-text-muted hover:opacity-80">
            סגירה
          </button>
        </div>
      </div>

      {disabled ? (
        <div className="p-4">
          <NotConfiguredNotice usage={usage} />
        </div>
      ) : (
        <>
          <div ref={scrollRef} onScroll={onScroll} className="flex-1 min-h-0 overflow-y-auto px-4">
            <div ref={contentRef} className="min-h-full flex flex-col gap-5 py-4">
              {thread.length === 0 ? (
                <div className="mt-auto flex flex-col gap-2.5">
                  <p className="text-[12px] leading-relaxed nocturne-text-muted m-0">
                    העוזר שולף תשובות ישירות מנתוני המערכת: עובדים, משמרות, תאריכי הרבעון ומטריצת הכשירות.
                    השיחה אינה נשמרת, אך ניתן לשמור גרפים וטבלאות כתצוגות.
                  </p>
                  <div className={`${LABEL} mt-1`}>לדוגמה</div>
                  {EXAMPLES.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => submit(q)}
                      className="text-start text-[12.5px] px-3 py-2 rounded-lg border nocturne-border nocturne-text-secondary hover:bg-white/5 transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              ) : (
                <Thread thread={thread} />
              )}
            </div>
          </div>

          <form
            className="flex-none flex flex-col gap-2 px-4 pt-3 pb-3 border-t nocturne-border"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <label htmlFor="assistant-question" className={LABEL}>שאלה לעוזר</label>
            <div className="flex items-end gap-2">
              <textarea
                id="assistant-question"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submit();
                  }
                }}
                rows={2}
                maxLength={2000}
                placeholder="למשל: מי עשה הכי הרבה משמרות השנה?"
                className="flex-1 min-w-0 resize-none rounded-lg border nocturne-border nocturne-surface outline-none text-[13px] px-3 py-2 min-h-14 max-h-40 field-sizing-content focus:border-primary"
              />
              {running ? (
                <button
                  type="button"
                  onClick={stop}
                  className="flex-none h-8 px-3.5 rounded-lg border nocturne-border text-xs hover:bg-white/5"
                >
                  עצירה
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="flex-none h-8 px-3.5 rounded-lg border border-primary text-primary text-xs hover:bg-white/5 disabled:opacity-50 disabled:hover:bg-transparent"
                >
                  שליחה
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 text-[10.5px] nocturne-text-muted">
              <span>Enter לשליחה · Shift+Enter לשורה חדשה</span>
              <span className="mr-auto"><BudgetIndicator usage={usage} /></span>
            </div>
            {usage?.pseudonymize && <p className="text-[10.5px] nocturne-text-muted m-0">{PSEUDONYMIZE_NOTE}</p>}
          </form>
        </>
      )}
    </aside>
  );
}
