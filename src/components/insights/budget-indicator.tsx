"use client";

/**
 * Usage of the assistant: useInsightsUsage ("$x / $5", refreshes when
 * `refreshKey` changes) and useInsightsEnabled (nav entries). Both read one
 * shared request: the layout's fetch is reused by /admin/insights on mount
 * while it's fresh, and enabled is fetched once per page load.
 */
import { useEffect, useState } from "react";

export interface InsightsUsage {
  month: string;
  cost_usd: number;
  cap: number;
  enabled: boolean;
  pseudonymize?: boolean;
  /** Set with enabled: false when the API key is there but a required setting isn't. */
  misconfigured?: "alias_secret";
}

const REUSE_MS = 5_000;
let shared: { at: number; p: Promise<InsightsUsage | null> } | null = null;

/** Shared /api/insights/usage request; `fresh` forces a new one (after a turn). */
function loadUsage(fresh: boolean): Promise<InsightsUsage | null> {
  if (!fresh && shared && Date.now() - shared.at < REUSE_MS) return shared.p;
  const entry = {
    at: Date.now(),
    p: fetch("/api/insights/usage")
      .then((r) => (r.ok ? (r.json() as Promise<InsightsUsage>) : null))
      .catch(() => null),
  };
  shared = entry;
  // Don't reuse a failure (transient error, 401 mid-login): the next caller retries.
  entry.p.then((u) => {
    if (!u && shared === entry) shared = null;
  });
  return entry.p;
}

export function useInsightsUsage(refreshKey: number) {
  const [usage, setUsage] = useState<InsightsUsage | null>(null);
  useEffect(() => {
    let alive = true;
    loadUsage(refreshKey > 0).then((u) => alive && setUsage(u));
    return () => {
      alive = false;
    };
  }, [refreshKey]);
  return usage;
}

// Whether the server has a key doesn't change while the page is open.
// Misconfigured counts as enabled for the nav: the page shows the setup message.
let enabledPromise: Promise<boolean> | null = null;

export function useInsightsEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    const p = (enabledPromise ??= loadUsage(false).then((u) => {
      if (!u) enabledPromise = null; // failed or not admin: retry on next mount
      return !!(u?.enabled || u?.misconfigured);
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
