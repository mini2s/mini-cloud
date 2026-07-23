"use client";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@multica/ui/components/ui/chart";

export interface TrendPoint {
  label: string;
  value: number;
}

// Single-series area trend. The parent passes pre-shaped {label, value}
// points and decides the empty-state. Color follows the runtimes chart
// convention: chart-1 for the primary series.
const config = {
  value: { label: "Value", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function TrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <ChartContainer config={config} className="aspect-[3/1] w-full">
      <AreaChart data={data} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          interval="preserveStartEnd"
        />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={50} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Area
          dataKey="value"
          type="monotone"
          stroke="var(--chart-1)"
          fill="var(--chart-1)"
          fillOpacity={0.2}
        />
      </AreaChart>
    </ChartContainer>
  );
}
