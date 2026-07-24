import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@multica/ui/components/ui/chart";

export interface DualAxisTrendPoint {
  /** X-axis label. */
  label: string;
  /** Large-value series (left axis), e.g. commit_diff_lines. Rendered as a Bar. */
  primary: number;
  /** Small-count series (right axis), e.g. merged_needs / commits. Rendered as a Line. */
  secondary: number;
}

// Dual Y-axis trend: a primary large-value series on the left axis (Bar) and a
// secondary small-count series on the right axis (Line). Solves the magnitude
// gap in contribution trends where commit_diff_lines dwarfs merged_needs /
// commits — putting them on one axis flattens the small series to noise.
//
// Mirrors ComboTrendChart (also dual-axis bar+line) but uses fixed
// primary/secondary semantics + var(--chart-1)/var(--chart-2) palette tokens
// so callers don't pass colors per-use. ChartContainer emits --color-primary
// / --color-secondary from config, keeping colors config-driven (single source
// of truth, matches the rest of the chart family).
interface DualAxisTrendChartProps {
  data: DualAxisTrendPoint[];
  /** Label for the primary (left-axis, Bar) series shown in the tooltip/legend. */
  primaryLabel?: string;
  /** Label for the secondary (right-axis, Line) series shown in the tooltip/legend. */
  secondaryLabel?: string;
  /** Left (primary, Bar) Y-axis tick formatter (e.g. formatNumber for code lines). */
  formatLeftY?: (v: number) => string;
  /** Right (secondary, Line) Y-axis tick formatter. */
  formatRightY?: (v: number) => string;
  /** Height class for the container. */
  heightClass?: string;
}

export function DualAxisTrendChart({
  data,
  primaryLabel = "Primary",
  secondaryLabel = "Secondary",
  formatLeftY,
  formatRightY,
  heightClass = "h-[280px]",
}: DualAxisTrendChartProps) {
  const config = {
    primary: { label: primaryLabel, color: "var(--chart-1)" },
    secondary: { label: secondaryLabel, color: "var(--chart-2)" },
  } satisfies ChartConfig;

  return (
    <ChartContainer config={config} className={`${heightClass} w-full`}>
      <ComposedChart data={data} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          interval="preserveStartEnd"
        />
        {/* Left axis: large-value primary series (Bar). */}
        <YAxis
          yAxisId="left"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={56}
          tickFormatter={formatLeftY ? (v: number) => formatLeftY(v) : undefined}
        />
        {/* Right axis: small-count secondary series (Line). id="right" + orientation="right". */}
        <YAxis
          yAxisId="right"
          orientation="right"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={48}
          tickFormatter={formatRightY ? (v: number) => formatRightY(v) : undefined}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar
          yAxisId="left"
          dataKey="primary"
          name={primaryLabel}
          fill="var(--color-primary)"
          radius={4}
          maxBarSize={36}
        />
        <Line
          yAxisId="right"
          dataKey="secondary"
          name={secondaryLabel}
          type="monotone"
          stroke="var(--color-secondary)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </ComposedChart>
    </ChartContainer>
  );
}
