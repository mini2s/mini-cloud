"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type Granularity,
  GRANULARITY_CN,
  availableGranularities,
  defaultGranularity,
  rangeDays,
} from "@multica/core/efficiency";

// Trend granularity shared control. Ports the source
// pages/dimensions/granularity.tsx (useGranularity + GranularityToggle) onto
// the migrated utils/time-bucket helpers (already in @multica/core/efficiency)
// and the shadcn semantic-token palette. One toggle per trend chart; the hook
// owns the selected value + the option set for the current range.

/**
 * Given a selected range, return the current granularity + the options valid
 * for that span. Changing start/end resets to the range's default (even when
 * both ranges share a default — a manual choice only persists within one
 * range). Matches the source's reset-on-range-change contract.
 */
export function useGranularity(start: string, end: string) {
  const span = rangeDays(start, end);
  const options = useMemo(() => availableGranularities(span), [span]);
  const [gran, setGran] = useState<Granularity>(() => defaultGranularity(span));
  // Bind to start/end: switching the range always resets (the source's
  // useEffect on [start, end]); a manual selection only persists within the
  // same range.
  useEffect(() => {
    setGran(defaultGranularity(rangeDays(start, end)));
  }, [start, end]);
  return { gran, setGran, options };
}

/**
 * Segment control for day/week/month granularity. Renders null when fewer
 * than 2 options are available (ranges < 14 days are day-only). Uses semantic
 * tokens (bg-primary / text-primary-foreground for the active item,
 * bg-muted / text-muted-foreground for inactive) — NOT the source's
 * bg-gray-100 / apple-blue, so it tracks theme via tokens.
 */
export function GranularityToggle({
  value,
  options,
  onChange,
}: {
  value: Granularity;
  options: Granularity[];
  onChange: (g: Granularity) => void;
}) {
  if (options.length < 2) return null;
  return (
    <div
      className="inline-flex items-center rounded-lg bg-muted p-0.5"
      role="group"
      aria-label="趋势粒度"
    >
      {options.map((g) => {
        const active = g === value;
        return (
          <button
            key={g}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(g)}
            className={
              active
                ? "rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                : "rounded-md bg-transparent px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            }
          >
            {GRANULARITY_CN[g]}
          </button>
        );
      })}
    </div>
  );
}
