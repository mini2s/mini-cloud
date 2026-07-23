"use client";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@multica/ui/components/ui/chart";

export interface BarDatum {
  label: string;
  value: number;
}

// Horizontal bar chart for rankings / department comparisons. Parent
// decides the empty-state. Uses layout="vertical" so categories sit on Y.
// ChartContainer needs a concrete height for horizontal layout (the default
// aspect-video sizing collapses with vertical layout), so we pin h-[300px].
const config = {
  value: { label: "Value", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function HBarChart({ data }: { data: BarDatum[] }) {
  return (
    <ChartContainer config={config} className="h-[300px] w-full">
      <BarChart
        data={data}
        layout="vertical"
        margin={{ left: 8, right: 8, top: 4, bottom: 4 }}
      >
        <CartesianGrid horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis
          dataKey="label"
          type="category"
          tickLine={false}
          axisLine={false}
          width={90}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="value" fill="var(--chart-1)" radius={4} />
      </BarChart>
    </ChartContainer>
  );
}
