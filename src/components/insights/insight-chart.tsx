"use client";

/**
 * Renders a server-validated ChartSpec with Recharts (via the shadcn chart
 * wrapper). RTL: category axes run right to left and the value axis sits on
 * the right.
 *
 * Colors: --chart-1..5 is a single purple ramp whose dark end disappears on
 * the card, so series and slices use a categorical palette of distinct hues
 * (all mid-tone, readable on dark and light). Specs allow at most
 * PALETTE.length series; pies fold the smallest slices into "אחר".
 */
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, XAxis, YAxis,
} from "recharts";
import {
  ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart";
import type { ChartSpec } from "@/lib/insights/render";

export const PALETTE = ["#9184d9", "#56b4e9", "#e69f00", "#2fb58f", "#cc79a7", "#e07a5f", "#d8c95a", "#8a96ab"];
const color = (i: number) => PALETTE[i % PALETTE.length];
const OTHER_LABEL = "אחר";
const HORIZONTAL_BAR_THRESHOLD = 12;

/** At most PALETTE.length slices: the largest ones, the rest summed into "אחר". */
export function foldPieSlices<T extends Record<string, string | number | null>>(data: T[], xKey: string, vKey: string): T[] {
  if (data.length <= PALETTE.length) return data;
  const sorted = [...data].sort((a, b) => Number(b[vKey] ?? 0) - Number(a[vKey] ?? 0));
  const keep = sorted.slice(0, PALETTE.length - 1);
  const rest = sorted.slice(PALETTE.length - 1).reduce((n, r) => n + Number(r[vKey] ?? 0), 0);
  return [...keep, { [xKey]: OTHER_LABEL, [vKey]: rest } as T];
}

/** Series values as numbers; x stays as-is. */
function normalize(spec: ChartSpec) {
  return spec.data.map((row) => {
    const out: Record<string, string | number | null> = { [spec.x.key]: row[spec.x.key] ?? "" };
    for (const s of spec.series) {
      const v = row[s.key];
      out[s.key] = v === null || v === undefined || v === "" ? null : Number(v);
    }
    return out;
  });
}

export function InsightChart({ spec }: { spec: ChartSpec }) {

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

  if (spec.kind === "bar" || spec.kind === "stacked_bar") {
    const stack = spec.kind === "stacked_bar" ? "a" : undefined;
    const horizontal = data.length > HORIZONTAL_BAR_THRESHOLD;
    if (horizontal) {
      // Many categories: horizontal bars, labels readable on the right.
      return (
        <ChartContainer config={config} className="aspect-auto w-full" style={{ height: Math.min(28 * data.length + 60, 900) }}>
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 8 }}>
            <CartesianGrid horizontal={false} />
            <XAxis type="number" reversed allowDecimals={false} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey={spec.x.key} orientation="right" width={110} tickLine={false} axisLine={false} interval={0} />
            {tooltip}
            {legend}
            {spec.series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} fill={color(i)} stackId={stack} radius={stack ? 0 : 4} />
            ))}
          </BarChart>
        </ChartContainer>
      );
    }
    return (
      <ChartContainer config={config} className="aspect-auto h-[300px] w-full">
        <BarChart data={data} margin={{ top: 8, left: 8, right: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey={spec.x.key} reversed tickLine={false} axisLine={false} interval={0} tickMargin={8} />
          <YAxis orientation="right" allowDecimals={false} tickLine={false} axisLine={false} width={36} />
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
