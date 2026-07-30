import { useState } from "react";
import { PieChart, Pie, Cell, Legend } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@multica/ui/components/ui/chart";
import { ChartSeriesLegend } from "./chart-series-legend";

export interface PieDatum {
  /** Slice label (e.g. model name). */
  name: string;
  /** Slice value (e.g. request count). */
  value: number;
}

// Donut-style pie for breakdowns (model usage, mode usage, etc.). The parent
// decides the empty-state. Colors are config-driven (ChartContainer emits
// --color-{key}); each slice's key is its 0-based index, so a slice uses
// var(--color-0)..var(--color-N). Callers can also pass explicit hex/ var
// colors via `colors` to override (used when a specific palette is wanted).
//
// We default to the chart-1..5 token cycle (via buildConfig) so the donut
// adapts to the theme. The source used a fixed PIE_COLORS hex array; the
// token approach here keeps it consistent with slice-1's chart pattern.
const TOKEN_CYCLE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function buildConfig(n: number): ChartConfig {
  const cfg: ChartConfig = {};
  for (let i = 0; i < n; i++) {
    cfg[String(i)] = {
      label: `Series ${i + 1}`,
      color: TOKEN_CYCLE[i % TOKEN_CYCLE.length],
    };
  }
  return cfg;
}

interface PieBreakdownChartProps {
  data: PieDatum[];
  /** Optional explicit color overrides (any CSS color). Falls back to chart token cycle. */
  colors?: string[];
  /** Height class for the container (ChartContainer needs an explicit height for pie). */
  heightClass?: string;
  /** Replace the fixed Recharts legend with a non-clipping interactive scroll legend. */
  scrollLegend?: boolean;
}

export function PieBreakdownChart({
  data,
  colors,
  heightClass = "h-[280px]",
  scrollLegend = false,
}: PieBreakdownChartProps) {
  const [hiddenSlices, setHiddenSlices] = useState<Set<string>>(
    () => new Set(),
  );
  // Pad the config to cover the data length so each slice resolves a color.
  const config = buildConfig(Math.max(data.length, TOKEN_CYCLE.length));
  // Explicit palettes cycle: with more slices than colors the source reused
  // colors[i % len] rather than falling back to tokens mid-chart.
  const pickColor = (i: number) =>
    colors && colors.length > 0
      ? colors[i % colors.length] || TOKEN_CYCLE[i % TOKEN_CYCLE.length]!
      : TOKEN_CYCLE[i % TOKEN_CYCLE.length]!;
  const legendItems = data.map((datum, index) => ({
    key: `${datum.name}-${index}`,
    name: datum.name,
    color: pickColor(index),
  }));
  const visibleData = data
    .map((datum, index) => ({
      ...datum,
      legendKey: legendItems[index]!.key,
      color: legendItems[index]!.color,
    }))
    .filter((datum) => !hiddenSlices.has(datum.legendKey));
  const allValuesZero =
    visibleData.length > 0 &&
    visibleData.every((datum) => datum.value === 0);
  const renderData = visibleData.map((datum) => ({
    ...datum,
    // Recharts cannot draw a sector whose value is 0. When the complete
    // dataset is zero, use equal display weights while preserving `value`
    // as the real metric shown in the tooltip.
    displayValue: allValuesZero ? 1 : datum.value,
  }));
  const displayTotal = renderData.reduce(
    (sum, datum) => sum + datum.displayValue,
    0,
  );

  const toggleSlice = (key: string) => {
    setHiddenSlices((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="w-full min-w-0">
      <ChartContainer config={config} className={`${heightClass} w-full`}>
        <PieChart>
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value, _name, item) => {
                  const label =
                    item && typeof item === "object" && "name" in item
                      ? String((item as { name?: unknown }).name ?? "")
                      : "";
                  const actualValue =
                    item &&
                    typeof item === "object" &&
                    "payload" in item &&
                    typeof (item as { payload?: { value?: unknown } }).payload
                      ?.value === "number"
                      ? (item as { payload: { value: number } }).payload.value
                      : Number(value);
                  const pct =
                    displayTotal > 0 && typeof value === "number"
                      ? ((value / displayTotal) * 100).toFixed(1)
                      : null;
                  return (
                    <span>
                      {label}: {String(actualValue)}
                      {pct != null ? ` (${pct}%)` : ""}
                    </span>
                  );
                }}
              />
            }
          />
          <Pie
            data={renderData}
            dataKey="displayValue"
            nameKey="name"
            innerRadius="38%"
            outerRadius="68%"
            paddingAngle={2}
            isAnimationActive={false}
          >
            {renderData.map((datum) => (
              <Cell key={datum.legendKey} fill={datum.color} />
            ))}
          </Pie>
          {!scrollLegend ? (
            <Legend
              verticalAlign="bottom"
              height={36}
              wrapperStyle={{ fontSize: 12 }}
            />
          ) : null}
        </PieChart>
      </ChartContainer>
      {scrollLegend ? (
        <ChartSeriesLegend
          items={legendItems}
          hiddenKeys={hiddenSlices}
          onToggle={toggleSlice}
        />
      ) : null}
    </div>
  );
}
