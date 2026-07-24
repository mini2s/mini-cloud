"use client";

import { useMemo } from "react";
import { getDefaultDateRangeWide } from "@multica/core/efficiency";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@multica/ui/components/ui/select";

// Preset period selector. Shared by the Overview page and the Usage Kanban
// header. Simpler than a Calendar+Popover date-range picker and covers the
// manager's "show me the last N days" flow. Each option maps to a [start, end]
// range anchored at today; the value is the start date so the Select can
// identify the active option. Custom date-range picking is deferred (the
// source used a top-bar DateRangePicker; that's a slice-5 concern once the
// picker primitive is wired).
//
// Previously duplicated between overview-page.tsx (useMemo active-key) and
// usage-kanban.tsx (IIFE active-key) and already drifting; this is the single
// source of truth, taking the cleaner useMemo variant.

interface Preset {
  label: string;
  days: number;
}
const PRESETS: Preset[] = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

export function PeriodSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (range: [string, string]) => void;
}) {
  // Match the current start against the preset windows to mark the active
  // option. Defaults to "90d" when none match (the store's default).
  const activeKey = useMemo(() => {
    for (const p of PRESETS) {
      const [start] = getDefaultDateRangeWide(p.days);
      if (start === value) return p.label;
    }
    return "90d";
  }, [value]);

  const handle = (label: string) => {
    const preset = PRESETS.find((p) => p.label === label);
    if (preset) onChange(getDefaultDateRangeWide(preset.days));
  };

  return (
    <Select value={activeKey} onValueChange={(v) => handle(v ?? "90d")}>
      <SelectTrigger size="sm" className="min-w-[90px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PRESETS.map((p) => (
          <SelectItem key={p.label} value={p.label}>
            {p.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
