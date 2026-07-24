"use client";

import { useMemo, type ReactNode } from "react";
import { BarChart3 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@multica/ui/components/ui/select";
import {
  useViewState,
  getDefaultDateRangeWide,
} from "@multica/core/efficiency";
import { PageHeader } from "../layout/page-header";
import {
  AIPenetrationCard,
  CountsCard,
  DeptPKCard,
  HeroSaving,
  PlatformObjectiveCard,
  ScorecardStrip,
  TopRankCard,
  TrendCard,
} from "./components";

// Executive efficiency overview. Bento 12-col grid assembling the 9 sections
// in the source's order: Hero → Platform → ScorecardStrip → AI penetration →
// Trend → DeptPK + TopRank (side by side) → Counts. The global time range is
// the single source of truth (useViewState), shared by every card; a preset
// period Select in the header drives it. The source's staggered fade-in is
// dropped (mini-cloud cards don't carry that animation token set).
//
// Layout note: the source spanned every row at col-span-12 except the DeptPK
// + TopRank pair (col-span-6 each on lg). That exact span is preserved.

export function OverviewPage() {
  const { timeRange, setTimeRange } = useViewState();

  // The store holds YYYY-MM-DD; the cards accept that directly (the data
  // layer's mock/live fetchers normalize internally).
  const [startDate, endDate] = timeRange;

  return (
    <div className="flex h-full flex-col">
      <PageHeader className="h-auto min-h-12 flex-wrap justify-between gap-y-1.5 px-5 py-1.5 sm:py-0">
        <div className="flex min-w-0 items-center gap-2">
          <BarChart3 className="h-4 w-4 shrink-0 text-muted-foreground" />
          <h1 className="truncate text-sm font-medium">AI 提效总览</h1>
        </div>
        <PeriodSelect
          value={startDate}
          onChange={(range) => setTimeRange(range)}
        />
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-4 p-6 lg:space-y-6">
          <div className="grid grid-cols-12 gap-4 lg:gap-6">
            {/* Row 1: Hero (person-day / cost savings / efficiency). */}
            <Cell className="col-span-12">
              <HeroSaving startDate={startDate} endDate={endDate} />
            </Cell>

            {/* Row 2: Platform objective metrics (graceful degrade when the
                chat proxy is off / not migrated — see the card). */}
            <Cell className="col-span-12">
              <PlatformObjectiveCard startDate={startDate} endDate={endDate} />
            </Cell>

            {/* Row 3: Usage / contribution / AI-ratio scorecards (equal height). */}
            <Cell className="col-span-12">
              <ScorecardStrip startDate={startDate} endDate={endDate} />
            </Cell>

            {/* Row 4: AI penetration (penetration / coverage / split gap). */}
            <Cell className="col-span-12">
              <AIPenetrationCard startDate={startDate} endDate={endDate} />
            </Cell>

            {/* Row 5: Weekly efficiency trend (full width). */}
            <Cell className="col-span-12">
              <TrendCard startDate={startDate} endDate={endDate} />
            </Cell>

            {/* Row 6: Dept PK + Top rank (side by side on lg). */}
            <Cell className="col-span-12 lg:col-span-6">
              <DeptPKCard startDate={startDate} endDate={endDate} />
            </Cell>
            <Cell className="col-span-12 lg:col-span-6">
              <TopRankCard startDate={startDate} endDate={endDate} />
            </Cell>

            {/* Row 7: Scale overview. */}
            <Cell className="col-span-12">
              <CountsCard startDate={startDate} endDate={endDate} />
            </Cell>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Layout cell — kept as a passthrough wrapper to mirror the source grid. */
function Cell({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={className}>{children}</div>;
}

// Preset period selector. Simpler than a Calendar+Popover date-range picker
// and covers the manager's "show me the last N days" flow. Each option maps
// to a [start, end] range anchored at today; the value is the start date so
// the Select can identify the active option. Custom date-range picking is
// deferred (the source used a top-bar DateRangePicker; that's a slice-5
// concern once the picker primitive is wired).
interface Preset {
  label: string;
  days: number;
}
const PRESETS: Preset[] = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

function PeriodSelect({
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
