"use client";

/** A chart or table result in a card, with optional actions (save, delete). */
import type { ReactNode } from "react";
import type { ChartSpec, TableSpec } from "@/lib/insights/render";
import { MAX_RENDER_ROWS } from "@/lib/insights/config";
import { InsightChart } from "./insight-chart";
import { InsightTable } from "./insight-table";

export type InsightCardContent = { kind: "chart"; spec: ChartSpec } | { kind: "table"; spec: TableSpec };

export function InsightCard({
  actions,
  badge,
  ...content
}: InsightCardContent & {
  actions?: ReactNode;
  badge?: ReactNode;
}) {
  const { spec } = content;
  return (
    <div className="rounded-xl border border-white/5 nocturne-surface p-3 md:p-4 flex flex-col gap-3 min-w-0">
      <div className="flex items-center gap-2">
        <h3 className="text-[13.5px] font-medium m-0 truncate">{spec.title}</h3>
        {badge}
        <div className="mr-auto flex items-center gap-3">{actions}</div>
      </div>
      {content.kind === "chart" ? <InsightChart spec={content.spec} /> : <InsightTable spec={content.spec} />}
      {/* A truncated heatmap holds > MAX_HEATMAP_DAYS days, so the calendar's own clip note covers it. */}
      {spec.truncated && !(content.kind === "chart" && content.spec.kind === "heatmap_calendar") && (
        <p className="text-[11px] nocturne-text-muted">מוצגות {MAX_RENDER_ROWS} השורות הראשונות בלבד.</p>
      )}
    </div>
  );
}
