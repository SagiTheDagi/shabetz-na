"use client";

/**
 * /admin/insights/saved: shared grid of saved views. Each card re-runs its
 * source on open (no LLM), so the data is current, at most a few at a time.
 * A 409 means the view no longer matches the data shape: the card shows
 * "outdated" and can only be deleted.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Trash2, MessageSquare } from "lucide-react";
import { InsightCard, type InsightCardContent } from "@/components/insights/insight-card";
import type { SavedView } from "@/lib/insights/saved";

type CardState =
  | { status: "loading" }
  | ({ status: "ready" } & InsightCardContent)
  | { status: "outdated" | "error"; message: string };

// Each card re-runs a query on the server (SQL ones spawn a child process): cap how many run at once.
const MAX_CONCURRENT_LOADS = 3;
let activeLoads = 0;
const waitingLoads: (() => void)[] = [];

async function limited<T>(fn: () => Promise<T>): Promise<T> {
  while (activeLoads >= MAX_CONCURRENT_LOADS) await new Promise<void>((r) => waitingLoads.push(r));
  activeLoads++;
  try {
    return await fn();
  } finally {
    activeLoads--;
    waitingLoads.shift()?.();
  }
}

/** A /data body that InsightCard can render without crashing. */
function isCardContent(b: unknown): b is InsightCardContent {
  const o = b as { kind?: unknown; spec?: { title?: unknown; data?: unknown } } | null;
  return (
    !!o && (o.kind === "chart" || o.kind === "table") &&
    !!o.spec && typeof o.spec === "object" && typeof o.spec.title === "string" && Array.isArray(o.spec.data)
  );
}

/** SQLite datetime('now') is UTC without a zone; show the local date. */
function localDate(utc: string): string {
  const d = new Date(utc.replace(" ", "T") + "Z");
  return isNaN(d.getTime()) ? utc.slice(0, 10) : d.toLocaleDateString("he-IL");
}

function SavedCard({ view, onDeleted }: { view: SavedView; onDeleted: (id: string) => void }) {
  const [state, setState] = useState<CardState>({ status: "loading" });

  useEffect(() => {
    // Abort on unmount: the server then kills the re-run (and a queued card never starts).
    const ac = new AbortController();
    limited(async () => {
      if (ac.signal.aborted) return;
      const r = await fetch(`/api/insights/saved/${view.insight_id}/data`, { signal: ac.signal });
      const body = await r.json().catch(() => ({}));
      if (ac.signal.aborted) return;
      if (r.ok && isCardContent(body)) setState({ status: "ready", ...body });
      else if (r.ok) setState({ status: "error", message: "טעינה נכשלה" }); // 200 with a cut-off/invalid body
      else setState({ status: r.status === 409 ? "outdated" : "error", message: body.error || "טעינה נכשלה" });
    }).catch(() => !ac.signal.aborted && setState({ status: "error", message: "טעינה נכשלה" }));
    return () => ac.abort();
  }, [view.insight_id]);

  async function remove() {
    if (!confirm(`למחוק את התצוגה "${view.title}"?`)) return;
    try {
      const res = await fetch(`/api/insights/saved/${view.insight_id}`, { method: "DELETE" });
      if (res.ok) {
        onDeleted(view.insight_id);
        toast.success("התצוגה נמחקה");
        return;
      }
      const body = await res.json().catch(() => ({}));
      toast.error(body.error || "המחיקה נכשלה");
    } catch {
      toast.error("המחיקה נכשלה");
    }
  }

  const actions = (
    <button type="button" onClick={remove} aria-label="מחיקה" className="nocturne-text-muted hover:opacity-80">
      <Trash2 className="size-3.5" />
    </button>
  );
  const meta = (
    <p className="text-[11px] nocturne-text-muted m-0 truncate" title={view.question}>
      {view.created_by_name ?? view.created_by ?? "—"} · {localDate(view.created_at)}
      {view.question ? ` · ${view.question}` : ""}
    </p>
  );

  if (state.status === "ready") {
    return (
      <div className="flex flex-col gap-1 min-w-0">
        <InsightCard {...state} actions={actions} />
        {meta}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="rounded-xl border border-white/5 nocturne-surface p-4 flex flex-col gap-3 min-h-40">
        <div className="flex items-center gap-2">
          <h3 className="text-[13.5px] font-medium m-0 truncate">{view.title}</h3>
          {state.status === "outdated" && (
            <span className="text-[10px] px-1.5 py-0.5 rounded nocturne-warning border border-current">לא עדכנית</span>
          )}
          <div className="mr-auto">{actions}</div>
        </div>
        {state.status === "loading" ? (
          <Loader2 className="size-4 animate-spin m-auto nocturne-text-muted" />
        ) : (
          <p className={`text-[12px] m-0 ${state.status === "error" ? "nocturne-error" : "nocturne-text-muted"}`}>{state.message}</p>
        )}
      </div>
      {meta}
    </div>
  );
}

export default function SavedInsightsPage() {
  const [views, setViews] = useState<SavedView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/insights/saved")
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (r.ok && Array.isArray(body)) setViews(body);
        else setError(body?.error || "טעינת התצוגות השמורות נכשלה");
      })
      .catch(() => setError("טעינת התצוגות השמורות נכשלה"));
  }, []);
  useEffect(load, [load]);

  if (error) {
    return (
      <div className="max-w-xl rounded-xl border border-white/5 nocturne-surface p-4 text-[13px] nocturne-error" role="alert">
        {error}
      </div>
    );
  }
  if (!views) return <Loader2 className="size-5 animate-spin m-8 nocturne-text-muted" />;

  if (views.length === 0) {
    return (
      <div className="max-w-md m-auto mt-12 text-center flex flex-col gap-3 items-center text-[13px]">
        <p className="m-0">אין עדיין תצוגות שמורות.</p>
        <p className="m-0 text-[12px] nocturne-text-muted">שמור גרף או טבלה מתוך עוזר התובנות כדי שיופיעו כאן לכל המנהלים.</p>
        <Link href="/admin/insights" className="inline-flex items-center gap-1 nocturne-accent">
          <MessageSquare className="size-3.5" /> לעוזר התובנות
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
      {views.map((v) => (
        <SavedCard key={v.insight_id} view={v} onDeleted={(id) => setViews((vs) => vs!.filter((x) => x.insight_id !== id))} />
      ))}
    </div>
  );
}
