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

export interface ComboTrendPoint {
  label: string;
  /** Bar series value (left axis), e.g. request count. */
  bar: number;
  /** Line series value (right axis), e.g. active users. */
  line: number;
}

// Dual-axis combo chart: a bar series on the left axis + a line series on the
// right axis. Used by the dept usage trend (request bars + active-user line).
// The source used ECharts buildDualAxisTrendOption; recharts' ComposedChart
// covers the same layout with two YAxis (yAxisId="left"/"right"). Colors are
// config-driven and the tooltip merges both series.
interface ComboTrendChartProps {
  data: ComboTrendPoint[];
  /** Bar series label + color. */
  bar: { name: string; color: string };
  /** Line series label + color. */
  line: { name: string; color: string };
  /** Left (bar) Y-axis tick formatter. */
  formatLeftY?: (v: number) => string;
  /** Right (line) Y-axis tick formatter. */
  formatRightY?: (v: number) => string;
  /** Height class for the container. */
  heightClass?: string;
}

export function ComboTrendChart({
  data,
  bar,
  line,
  formatLeftY,
  formatRightY,
  heightClass = "h-[280px]",
}: ComboTrendChartProps) {
  const config = {
    bar: { label: bar.name, color: bar.color },
    line: { label: line.name, color: line.color },
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
        <YAxis
          yAxisId="left"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={56}
          tickFormatter={formatLeftY ? (v: number) => formatLeftY(v) : undefined}
        />
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
          dataKey="bar"
          name={bar.name}
          fill={bar.color}
          radius={4}
          maxBarSize={36}
        />
        <Line
          yAxisId="right"
          dataKey="line"
          name={line.name}
          type="monotone"
          stroke={line.color}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </ComposedChart>
    </ChartContainer>
  );
}
