"use client";

/**
 * In-memory chat thread (desktop assistant panel, mobile /admin/insights): POSTs the thread to
 * /api/insights/chat and folds the NDJSON events into the last assistant
 * turn. stop() aborts the fetch; the server sees the abort and stops the loop.
 * Unmounting aborts too (leaving the mobile page; the desktop panel stays mounted
 * while closed, so closing it mid-answer lets the answer finish).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyEvent, createRequestSlot, readNdjson, toWireMessages,
  type AssistantTurn, type ThreadMessage,
} from "./chat-client";

const newId = () => Math.random().toString(36).slice(2, 10);

export function useInsightsChat(opts: { selectedQuarterId: string | null; onTurnEnd?: () => void }) {
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [slot] = useState(createRequestSlot);
  const threadRef = useRef<ThreadMessage[]>([]);

  useEffect(() => () => slot.reset(), [slot]);

  const update = useCallback((fn: (t: ThreadMessage[]) => ThreadMessage[]) => {
    threadRef.current = fn(threadRef.current);
    setThread(threadRef.current);
  }, []);

  /** Patch one assistant turn by id (a stale, aborted send never touches a newer turn). */
  const patchTurn = useCallback(
    (id: string, fn: (a: AssistantTurn) => AssistantTurn) =>
      update((t) => t.map((m) => (m.id === id && m.role === "assistant" ? fn(m) : m))),
    [update],
  );

  // Latest opts without making send() depend on a fresh object every render.
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || slot.busy) return;
      const user: ThreadMessage = { id: newId(), role: "user", text: q };
      const assistant: AssistantTurn = { id: newId(), role: "assistant", parts: [], notices: [], status: "running" };
      const patch = (fn: (a: AssistantTurn) => AssistantTurn) => patchTurn(assistant.id, fn);
      const wire = toWireMessages([...threadRef.current, user]);
      update((t) => [...t, user, assistant]);

      const ac = slot.acquire()!;
      setRunning(true);
      try {
        const res = await fetch("/api/insights/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: wire, selected_quarter_id: optsRef.current.selectedQuarterId }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          const body = await res.json().catch(() => ({}));
          patch((a) => ({ ...a, error: body.error || "שגיאה בפנייה לעוזר", status: "done" }));
          return;
        }
        await readNdjson(res.body.pipeThrough(new TextDecoderStream()), (e) => patch((a) => applyEvent(a, e)));
        // The server always ends with "done"; a stream that closes without it was cut off.
        patch((a) => (a.status === "running" ? { ...a, error: a.error ?? "החיבור לעוזר נקטע", status: "done" } : a));
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          patch((a) => ({ ...a, status: "cancelled" }));
        } else {
          patch((a) => ({ ...a, error: "החיבור לעוזר נקטע", status: "done" }));
        }
      } finally {
        // reset() may already have released this send and a newer one started:
        // then leave `running` alone, but still fire onTurnEnd (the turn may
        // have spent budget, so usage must refresh).
        if (slot.release(ac)) setRunning(false);
        optsRef.current.onTurnEnd?.();
      }
    },
    [patchTurn, slot, update],
  );

  const stop = useCallback(() => slot.abort(), [slot]);

  /** Abort and release immediately so a send right after reset isn't dropped. */
  const reset = useCallback(() => {
    slot.reset();
    setRunning(false);
    update(() => []);
  }, [slot, update]);

  return { thread, running, send, stop, reset };
}
