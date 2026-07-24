import { PieChart, Pie, Cell, Legend } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@multica/ui/components/ui/chart";

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
}

export function PieBreakdownChart({
  data,
  colors,
  heightClass = "h-[280px]",
}: PieBreakdownChartProps) {
  // Pad the config to cover the data length so each slice resolves a color.
  const config = buildConfig(Math.max(data.length, TOKEN_CYCLE.length));
  const pickColor = (i: number) =>
    colors && colors[i] ? colors[i] : `var(--color-${i % TOKEN_CYCLE.length})`;

  return (
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
                const total = data.reduce((s, d) => s + d.value, 0);
                const pct =
                  total > 0 && typeof value === "number"
                    ? ((value / total) * 100).toFixed(1)
                    : null;
                return (
                  <span>
                    {label}: {String(value)}
                    {pct != null ? ` (${pct}%)` : ""}
                  </span>
                );
              }}
            />
          }
        />
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius="38%"
          outerRadius="68%"
          paddingAngle={2}
        >
          {data.map((d, i) => (
            <Cell key={d.name} fill={pickColor(i)} />
          ))}
        </Pie>
        <Legend
          verticalAlign="bottom"
          height={36}
          wrapperStyle={{ fontSize: 12 }}
        />
      </PieChart>
    </ChartContainer>
  );
}
