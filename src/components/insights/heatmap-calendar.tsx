"use client";

/**
 * Calendar heatmap for a ChartSpec with kind "heatmap_calendar": one cell per
 * day (columns = weeks, rows = Sunday..Saturday), shaded by the first series'
 * value. Custom component, not Recharts. Null/blank values leave the day
 * empty; the scale runs from the smallest to the largest value (not from 0,
 * so a narrow range like 40–45 still shows contrast; negative diffs work too).
 */
import type { ChartSpec } from "@/lib/insights/render";
import { MAX_HEATMAP_DAYS } from "@/lib/insights/config";
import { fromIsoDate, isIsoDate, toIsoDate } from "@/lib/date-utils";

const DAY_LABELS = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];

export function HeatmapCalendar({ spec }: { spec: ChartSpec }) {
  const series = spec.series[0];
  const values = new Map<string, number>();
  for (const row of spec.data) {
    const date = String(row[spec.x.key] ?? "");
    const raw = row[series.key];
    if (raw === null || raw === undefined || raw === "") continue; // Number(null) is 0
    const v = Number(raw);
    if (isIsoDate(date) && Number.isFinite(v)) values.set(date, (values.get(date) ?? 0) + v);
  }
  if (values.size === 0) {
    return <p className="text-xs nocturne-text-muted">אין תאריכים להצגה בלוח שנה.</p>;
  }

  // New charts are capped server-side; a saved view over growing history shows its latest MAX_HEATMAP_DAYS.
  const all = [...values.keys()].sort();
  const end = fromIsoDate(all[all.length - 1]);
  const first = new Date(end);
  first.setDate(first.getDate() - MAX_HEATMAP_DAYS + 1);
  const dates = all.filter((d) => d >= toIsoDate(first));
  const clipped = dates.length < all.length;
  for (const d of all.slice(0, all.length - dates.length)) values.delete(d);
  const start = fromIsoDate(dates[0]);
  start.setDate(start.getDate() - start.getDay()); // back to Sunday
  const min = Math.min(...values.values());
  const max = Math.max(...values.values());
  const span = max - min || 1; // one distinct value: every cell gets the faintest shade

  const weeks: Date[][] = [];
  for (const d = new Date(start); d <= end; ) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
    weeks.push(week);
  }

  return (
    <div className="overflow-x-auto">
      <div className="inline-flex gap-1" dir="rtl">
        <div className="grid grid-rows-7 gap-1 text-[10px] nocturne-text-muted">
          {DAY_LABELS.map((l) => (
            <span key={l} className="h-4 leading-4">{l}</span>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-rows-7 gap-1">
            {week.map((day) => {
              const key = toIsoDate(day);
              const v = values.get(key);
              const pct = v === undefined ? 0 : Math.round(15 + (85 * (v - min)) / span);
              return (
                <span
                  key={key}
                  title={v === undefined ? `${key}: אין נתונים` : `${key}: ${v} ${series.label}`}
                  className="size-4 rounded-[3px] border border-white/5"
                  style={{
                    background: v === undefined ? "transparent" : `color-mix(in oklab, var(--chart-1) ${pct}%, transparent)`,
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
      {/* RTL: min on the right next to the faint end, max on the left next to the full shade. */}
      <div className="mt-2 flex items-center gap-2 text-[10px] nocturne-text-muted">
        <span>{min}</span>
        <span className="h-2 w-24 rounded" style={{ background: "linear-gradient(to left, color-mix(in oklab, var(--chart-1) 15%, transparent), var(--chart-1))" }} />
        <span>{max}</span>
        <span className="mr-2">{series.label}</span>
      </div>
      {clipped && <p className="mt-1 text-[10px] nocturne-text-muted">מוצגים {MAX_HEATMAP_DAYS} הימים האחרונים בלבד.</p>}
    </div>
  );
}
