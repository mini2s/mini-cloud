import { useState } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@multica/ui/components/ui/chart";
import { ChartSeriesLegend } from "./chart-series-legend";

export interface MultiTrendSeries {
  /** Series key (matches data field). */
  key: string;
  /** Human-readable series name shown in the tooltip. */
  name: string;
  /** CSS color string (e.g. "var(--chart-1)" or "#0071e3"). */
  color: string;
}

export interface MultiTrendPoint {
  /** X-axis label. */
  label: string;
  /** One numeric field per series, keyed by series.key. */
  [seriesKey: string]: string | number;
}

// Multi-series area trend. Each series is rendered as a stacked-area band;
// the parent decides the empty-state and pre-shapes data into rows keyed by
// series.key. Colors are passed per-series (caller controls palette, so this
// chart can be reused for token in/out, request vs active users, cost split,
// etc.) and surfaced as ChartConfig so ChartContainer emits the matching
// --color-{key} vars.
//
// `formatY` lets the caller shrink large numbers (e.g. token counts shown via
// shortToken) on the Y-axis ticks. The tooltip uses ChartTooltipContent with
// a numeric formatter so units stay consistent with the axis.
interface MultiTrendChartProps {
  data: MultiTrendPoint[];
  series: MultiTrendSeries[];
  /** Y-axis tick formatter (e.g. shortToken). Defaults to identity. */
  formatY?: (v: number) => string;
  /** Height class for the container. */
  heightClass?: string;
  /** Stack the areas (default: false — overlapping translucent bands). */
  stack?: boolean;
  /** Show an interactive, horizontally scrollable series legend above the chart. */
  showLegend?: boolean;
}

export function hasNonZeroTrendValue(
  data: MultiTrendPoint[],
  series: MultiTrendSeries[],
): boolean {
  return data.some((point) =>
    series.some(({ key }) => {
      const value = point[key];
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value !== 0
      );
    }),
  );
}

export function MultiTrendChart({
  data,
  series,
  formatY,
  heightClass = "h-[280px]",
  stack = false,
  showLegend = false,
}: MultiTrendChartProps) {
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(
    () => new Set(),
  );
  const config = Object.fromEntries(
    series.map((s) => [s.key, { label: s.name, color: s.color }]),
  ) satisfies ChartConfig;

  const toggleSeries = (key: string) => {
    setHiddenSeries((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="w-full min-w-0">
      {showLegend && series.length > 0 ? (
        <ChartSeriesLegend
          items={series}
          hiddenKeys={hiddenSeries}
          onToggle={toggleSeries}
        />
      ) : null}
      <ChartContainer config={config} className={`${heightClass} w-full`}>
        <AreaChart
          data={data}
          margin={{ left: 0, right: 0, top: 4, bottom: 0 }}
        >
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
                formatter={(value) =>
                  formatY ? formatY(Number(value)) : String(value)
                }
              />
            }
          />
          {series.map((s, i) => (
            <Area
              key={s.key}
              dataKey={s.key}
              name={s.name}
              type="monotone"
              stroke={s.color}
              fill={s.color}
              fillOpacity={0.18}
              hide={hiddenSeries.has(s.key)}
              isAnimationActive={false}
              dot={
                data.length === 1
                  ? { r: 4, fill: s.color, stroke: s.color }
                  : false
              }
              stackId={stack ? "1" : undefined}
              // The first series without stacking draws a faint baseline so a
              // single-series chart still reads as an area rather than a line.
              strokeWidth={2}
              {...(stack ? {} : { style: { zIndex: series.length - i } })}
            />
          ))}
        </AreaChart>
      </ChartContainer>
    </div>
  );
}
