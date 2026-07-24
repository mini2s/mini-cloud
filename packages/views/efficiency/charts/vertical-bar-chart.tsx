import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@multica/ui/components/ui/chart";
import type { BarDatum } from "./ranking-bar-chart";

// Vertical bar chart (categories on X, values on Y). Used for by-weekday
// request distribution and per-model success rate in the usage views. The
// horizontal RankingBarChart already covers ranking (categories on Y); this
// is the orthogonal layout. Color is config-driven (var(--chart-1) default);
// pass `color` for an explicit CSS color when the caller wants a fixed hue
// (e.g. success-rate green). Per-bar colors are not supported here — callers
// needing that should compose recharts directly.
interface VerticalBarChartProps {
  data: BarDatum[];
  /** CSS color string for all bars. Defaults to var(--chart-1). */
  color?: string;
  /** Y-axis tick formatter. */
  formatY?: (v: number) => string;
  /** Height class for the container. */
  heightClass?: string;
  /** Optional per-bar color array (overrides color when present). */
  colors?: string[];
}

const DEFAULT_CONFIG = {
  value: { label: "Value", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function VerticalBarChart({
  data,
  color,
  formatY,
  heightClass = "h-[260px]",
  colors,
}: VerticalBarChartProps) {
  const config: ChartConfig = color
    ? { value: { label: "Value", color } }
    : DEFAULT_CONFIG;
  const fill = color ?? "var(--color-value)";
  return (
    <ChartContainer config={config} className={`${heightClass} w-full`}>
      <BarChart data={data} margin={{ left: 8, right: 8, top: 4, bottom: 4 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          interval="preserveStartEnd"
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={56}
          tickFormatter={formatY ? (v: number) => formatY(v) : undefined}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) => (formatY ? formatY(Number(value)) : String(value))}
            />
          }
        />
        <Bar dataKey="value" fill={fill} radius={4} maxBarSize={48}>
          {colors && colors.map((c, i) => <Cell key={i} fill={c} />)}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
