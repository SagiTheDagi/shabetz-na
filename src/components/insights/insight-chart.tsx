"use client";

/**
 * Renders a server-validated ChartSpec with Recharts (via the shadcn chart
 * wrapper). RTL: category axes run right to left and the value axis sits on
 * the right.
 *
 * Colors: --chart-1..5 is a single purple ramp whose dark end disappears on
 * the card, so series and slices use a categorical palette of distinct hues
 * (all mid-tone, readable on dark and light). Specs allow at most
 * MAX_CHART_SERIES series; pies fold the smallest slices into "אחר".
 */
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, XAxis, YAxis,
} from "recharts";
import {
  ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart";
import type { ChartSpec } from "@/lib/insights/render";
import { CHART_PALETTE } from "@/lib/insights/config";
import { HeatmapCalendar } from "./heatmap-calendar";

const color = (i: number) => CHART_PALETTE[i % CHART_PALETTE.length];
const OTHER_LABEL = "אחר";
const HORIZONTAL_BAR_THRESHOLD = 12;
const HORIZONTAL_BAR_ROW_PX = 28;
const HORIZONTAL_BAR_MAX_VIEW_PX = 900;

/** At most CHART_PALETTE.length slices: the largest ones, the rest summed into "אחר". */
export function foldPieSlices<T extends Record<string, string | number | null>>(data: T[], xKey: string, vKey: string): T[] {
  if (data.length <= CHART_PALETTE.length) return data;
  const sorted = [...data].sort((a, b) => Number(b[vKey] ?? 0) - Number(a[vKey] ?? 0));
  const keep = sorted.slice(0, CHART_PALETTE.length - 1);
  const rest = sorted.slice(CHART_PALETTE.length - 1).reduce((n, r) => n + Number(r[vKey] ?? 0), 0);
  return [...keep, { [xKey]: OTHER_LABEL, [vKey]: rest } as T];
}

/** Series values as numbers; x stays as-is. */
function normalize(spec: ChartSpec) {
  return spec.data.map((row) => {
    const out: Record<string, string | number | null> = { [spec.x.key]: row[spec.x.key] ?? "" };
    for (const s of spec.series) {
      const v = row[s.key];
      const n = v === null || v === undefined || v === "" ? NaN : Number(v);
      out[s.key] = Number.isFinite(n) ? n : null; // text in a series column → gap, never NaN
    }
    return out;
  });
}

export function InsightChart({ spec }: { spec: ChartSpec }) {
  if (spec.kind === "heatmap_calendar") return <HeatmapCalendar spec={spec} />;

  const data = normalize(spec);
  const config: ChartConfig = Object.fromEntries(
    spec.series.map((s, i) => [s.key, { label: s.label, color: color(i) }]),
  );

  if (spec.kind === "pie") {
    const s = spec.series[0];
    const slices = foldPieSlices(data, spec.x.key, s.key);
    const pieConfig: ChartConfig = Object.fromEntries(
      slices.map((row, i) => [String(row[spec.x.key]), { label: String(row[spec.x.key]), color: color(i) }]),
    );
    return (
      <ChartContainer config={{ ...config, ...pieConfig }} className="aspect-square max-h-[320px] mx-auto">
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent nameKey={spec.x.key} hideLabel />} />
          <Pie data={slices} dataKey={s.key} nameKey={spec.x.key} innerRadius="45%" strokeWidth={2}>
            {slices.map((_, i) => (
              <Cell key={i} fill={color(i)} />
            ))}
          </Pie>
          <ChartLegend content={<ChartLegendContent nameKey={spec.x.key} />} className="flex-wrap" />
        </PieChart>
      </ChartContainer>
    );
  }

  const legend = spec.series.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null;
  const tooltip = <ChartTooltip content={<ChartTooltipContent />} />;
  const xIsNumber = spec.x.type === "number";
  // Integer ticks for counts; fractional data (ratios, averages) needs decimals.
  const decimals = data.some((r) => spec.series.some((s) => { const v = r[s.key]; return typeof v === "number" && !Number.isInteger(v); }));

  if (spec.kind === "bar" || spec.kind === "stacked_bar") {
    const stack = spec.kind === "stacked_bar" ? "a" : undefined;
    const horizontal = data.length > HORIZONTAL_BAR_THRESHOLD;
    if (horizontal) {
      // Many categories: horizontal bars, labels readable on the right. Full
      // height per row (labels never overlap); the card scrolls past 900px.
      return (
        <div className="w-full overflow-y-auto" style={{ maxHeight: HORIZONTAL_BAR_MAX_VIEW_PX }}>
          <ChartContainer config={config} className="aspect-auto w-full" style={{ height: HORIZONTAL_BAR_ROW_PX * data.length + 60 }}>
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 8 }}>
              <CartesianGrid horizontal={false} />
              <XAxis type="number" reversed allowDecimals={decimals} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey={spec.x.key} orientation="right" width={110} tickLine={false} axisLine={false} interval={0} />
              {tooltip}
              {legend}
              {spec.series.map((s, i) => (
                <Bar key={s.key} dataKey={s.key} fill={color(i)} stackId={stack} radius={stack ? 0 : 4} />
              ))}
            </BarChart>
          </ChartContainer>
        </div>
      );
    }
    return (
      <ChartContainer config={config} className="aspect-auto h-[300px] w-full">
        <BarChart data={data} margin={{ top: 8, left: 8, right: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey={spec.x.key} reversed tickLine={false} axisLine={false} interval={0} tickMargin={8} />
          <YAxis orientation="right" allowDecimals={decimals} tickLine={false} axisLine={false} width={36} />
          {tooltip}
          {legend}
          {spec.series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} fill={color(i)} stackId={stack} radius={stack ? 0 : 4} />
          ))}
        </BarChart>
      </ChartContainer>
    );
  }

  const Chart = spec.kind === "line" ? LineChart : AreaChart;
  return (
    <ChartContainer config={config} className="aspect-auto h-[300px] w-full">
      <Chart data={data} margin={{ top: 8, left: 8, right: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey={spec.x.key} type={xIsNumber ? "number" : "category"} reversed tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
        <YAxis orientation="right" tickLine={false} axisLine={false} width={36} />
        {tooltip}
        {legend}
        {spec.series.map((s, i) =>
          spec.kind === "line" ? (
            <Line key={s.key} dataKey={s.key} stroke={color(i)} strokeWidth={2} dot={data.length <= 40} type="monotone" />
          ) : (
            <Area key={s.key} dataKey={s.key} stroke={color(i)} fill={color(i)} fillOpacity={0.25} type="monotone" />
          ),
        )}
      </Chart>
    </ChartContainer>
  );
}
