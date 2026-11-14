"use client";

/**
 * Usage of the assistant: useInsightsUsage ("$x / $5", refreshes when
 * `refreshKey` changes) and useInsightsEnabled (nav entries; one request per
 * page load, shared by the layout and /admin/more).
 */
import { useEffect, useState } from "react";

export interface InsightsUsage {
  month: string;
  cost_usd: number;
  cap: number;
  enabled: boolean;
}

function fetchInsightsUsage(): Promise<InsightsUsage | null> {
  return fetch("/api/insights/usage")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
}

export function useInsightsUsage(refreshKey: number) {
  const [usage, setUsage] = useState<InsightsUsage | null>(null);
  useEffect(() => {
    let alive = true;
    fetchInsightsUsage().then((u) => alive && setUsage(u));
    return () => {
      alive = false;
    };
  }, [refreshKey]);
  return usage;
}

// Whether the server has a key doesn't change while the page is open.
let enabledPromise: Promise<boolean> | null = null;

export function useInsightsEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    const p = (enabledPromise ??= fetchInsightsUsage().then((u) => {
      if (!u) enabledPromise = null; // failed or not admin: retry on next mount
      return !!u?.enabled;
    }));
    p.then((v) => alive && setEnabled(v));
    return () => {
      alive = false;
    };
  }, []);
  return enabled;
}

export function BudgetIndicator({ usage }: { usage: InsightsUsage | null }) {
  if (!usage) return null;
  const ratio = usage.cap > 0 ? usage.cost_usd / usage.cap : 0;
  const tone = ratio >= 1 ? "nocturne-error" : ratio >= 0.8 ? "nocturne-warning" : "nocturne-text-muted";
  return (
    <span
      className={`text-[11px] font-mono tabular-nums ${tone}`}
      title={`עלות העוזר החודש (${usage.month}) מתוך התקציב החודשי`}
      dir="ltr"
    >
      ${usage.cost_usd.toFixed(2)} / ${usage.cap}
    </span>
  );
}
