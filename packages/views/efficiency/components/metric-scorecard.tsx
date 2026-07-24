"use client";

import type { ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@multica/ui/components/ui/tooltip";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { type DashboardTrendDelta } from "@multica/core/efficiency";

// Overview scorecard: dimension label + glossary tooltip + big value + hint +
// wow delta arrow + weekly sparkline. Display-only (no drill-down). The info
// icon reveals the glossary caliber; drilling goes via the side nav / Top rank
// / dept PK, not this card.
//
// Accent is a token-based class (mapped to border/text tokens) rather than the
// source's raw hex, so the card adapts to the theme. Sparkline color is a CSS
// color string (the caller passes `var(--chart-1)` etc.) to stay token-driven.

type Accent = "brand" | "chart-1" | "chart-2" | "chart-3";

// Left accent bar + sparkline color for each accent key. The border uses a
// token utility class; the sparkline needs a concrete CSS color string for the
// inline SVG fill/stroke, so callers pass `sparkColor` separately (defaulting
// to the matching chart var).
const ACCENT_BORDER: Record<Accent, string> = {
  brand: "border-l-brand",
  "chart-1": "border-l-chart-1",
  "chart-2": "border-l-chart-2",
  "chart-3": "border-l-chart-3",
};

const ACCENT_SPARK: Record<Accent, string> = {
  brand: "var(--brand)",
  "chart-1": "var(--chart-1)",
  "chart-2": "var(--chart-2)",
  "chart-3": "var(--chart-3)",
};

interface MetricScorecardProps {
  /** Dimension name */
  label: string;
  /** Current-period value (already formatted); pass null when there is no data */
  value: ReactNode;
  /** Sub info (e.g. "63% AI" / "ROI 4.2x") */
  hint?: string;
  /** Glossary caliber text (from glossaryTip) */
  tip: string;
  /** Weekly series (ascending) for the sparkline; empty array draws nothing */
  series: number[];
  /** Week-over-week delta; no arrow when null or delta_pct is null */
  delta?: DashboardTrendDelta | null;
  /** Whether higher is better for this dimension (cost = false). Decides arrow color. Defaults true */
  higherIsBetter?: boolean;
  /** Accent key (mapped to border + sparkline color tokens) */
  accent?: Accent;
  /** Override sparkline color with an explicit CSS color string */
  sparkColor?: string;
  /** Loading state */
  loading?: boolean;
}

export function MetricScorecard({
  label,
  value,
  hint,
  tip,
  series,
  delta,
  higherIsBetter = true,
  accent = "brand",
  sparkColor,
  loading = false,
}: MetricScorecardProps) {
  const color = sparkColor ?? ACCENT_SPARK[accent];
  return (
    <div
      className={`rounded-lg border border-l-2 ${ACCENT_BORDER[accent]} bg-card p-4 flex flex-col gap-2`}
    >
      <div className="flex items-center gap-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                className="inline-flex cursor-help text-muted-foreground"
                aria-label={tip}
                tabIndex={0}
                role="button"
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </span>
            }
          />
          <TooltipContent side="top">
            <span className="whitespace-pre-line">{tip}</span>
          </TooltipContent>
        </Tooltip>
      </div>

      {loading ? (
        <Skeleton className="h-7 w-20" />
      ) : (
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-2xl font-bold tabular-nums text-card-foreground">
            {value ?? "-"}
          </span>
          <DeltaArrow delta={delta} higherIsBetter={higherIsBetter} />
        </div>
      )}

      {hint && (
        <div className="text-xs text-muted-foreground">{hint}</div>
      )}

      <div className="mt-auto pt-1">
        <Sparkline data={series} color={color} />
      </div>
    </div>
  );
}

// Wow arrow: arrow glyph + |change|% in the configured good/bad color. Returns
// null (renders nothing, no placeholder) when delta is missing or delta_pct is
// null. Zero change is rendered as a neutral muted dash.
function DeltaArrow({
  delta,
  higherIsBetter,
}: {
  delta?: DashboardTrendDelta | null;
  higherIsBetter: boolean;
}) {
  if (!delta || delta.delta_pct == null) return null;
  const pct = delta.delta_pct;
  if (pct === 0) {
    return (
      <span
        className="text-xs font-medium tabular-nums text-muted-foreground"
        title="环比：本期 vs 上期（持平）"
      >
        – 0%
      </span>
    );
  }
  const up = pct > 0;
  const good = higherIsBetter ? up : !up;
  const color = good ? "text-success" : "text-destructive";
  return (
    <span
      className={`text-xs font-medium tabular-nums ${color}`}
      title="环比：本期 vs 上期"
    >
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

// Minimal inline-SVG sparkline (no dependency). Normalizes to a viewBox,
// safely degrades for single-point / empty data. Logic is identical to the
// source; only the color is now a CSS-var string passed by the caller.
function Sparkline({ data, color }: { data: number[]; color: string }) {
  const w = 100;
  const h = 28;
  const pts = data.filter((d) => Number.isFinite(d));
  if (pts.length < 2) {
    return <div className="h-7" aria-hidden="true" />;
  }
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const step = w / (pts.length - 1);
  const coords = pts.map((d, i) => {
    const x = i * step;
    const y = h - ((d - min) / span) * (h - 4) - 2; // 2px padding top/bottom
    return [x, y] as const;
  });
  const line = coords
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  const last = coords[coords.length - 1];
  if (!last) {
    return <div className="h-7" aria-hidden="true" />;
  }
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-7 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label="周趋势"
    >
      <path d={area} fill={color} fillOpacity={0.1} stroke="none" />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={last[0]} cy={last[1]} r={2} fill={color} />
    </svg>
  );
}
