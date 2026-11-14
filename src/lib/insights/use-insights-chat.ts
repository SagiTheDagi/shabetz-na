"use client";

/**
 * In-memory chat thread for /admin/insights: POSTs the thread to
 * /api/insights/chat and folds the NDJSON events into the last assistant
 * turn. stop() aborts the fetch; the server sees the abort and stops the loop.
 */
import { useCallback, useRef, useState } from "react";
import type { ChatEvent } from "./chat-loop";
import {
  applyEvent, splitLines, toWireMessages,
  type AssistantTurn, type ThreadMessage,
} from "./chat-client";

const newId = () => Math.random().toString(36).slice(2, 10);

export function useInsightsChat(opts: { selectedQuarterId: string | null; onTurnEnd?: () => void }) {
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const threadRef = useRef<ThreadMessage[]>([]);

  const update = useCallback((fn: (t: ThreadMessage[]) => ThreadMessage[]) => {
    threadRef.current = fn(threadRef.current);
    setThread(threadRef.current);
  }, []);

  const patchLast = useCallback(
    (fn: (a: AssistantTurn) => AssistantTurn) =>
      update((t) => {
        const last = t[t.length - 1];
        return last?.role === "assistant" ? [...t.slice(0, -1), fn(last)] : t;
      }),
    [update],
  );

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || abortRef.current) return;
      const user: ThreadMessage = { id: newId(), role: "user", text: q };
      const assistant: AssistantTurn = { id: newId(), role: "assistant", parts: [], notices: [], status: "running" };
      const wire = toWireMessages([...threadRef.current, user]);
      update((t) => [...t, user, assistant]);

      const ac = new AbortController();
      abortRef.current = ac;
      setRunning(true);
      try {
        const res = await fetch("/api/insights/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: wire, selected_quarter_id: opts.selectedQuarterId }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          const body = await res.json().catch(() => ({}));
          patchLast((a) => ({ ...a, error: body.error || "שגיאה בפנייה לעוזר", status: "done" }));
          return;
        }
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const { lines, rest } = splitLines(buffer + value);
          buffer = rest;
          for (const line of lines) {
            let e: ChatEvent;
            try {
              e = JSON.parse(line);
            } catch {
              continue;
            }
            patchLast((a) => applyEvent(a, e));
          }
        }
        patchLast((a) => (a.status === "running" ? { ...a, status: "done" } : a));
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          patchLast((a) => ({ ...a, status: "cancelled" }));
        } else {
          patchLast((a) => ({ ...a, error: "החיבור לעוזר נקטע", status: "done" }));
        }
      } finally {
        abortRef.current = null;
        setRunning(false);
        opts.onTurnEnd?.();
      }
    },
    [opts, patchLast, update],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    update(() => []);
  }, [update]);

  return { thread, running, send, stop, reset };
}
