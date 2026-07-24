"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  dashboardSummaryOptions,
  globalConfigOptions,
  formatNumber,
  glossaryTip,
  personDaysValue,
} from "@multica/core/efficiency";
import { Skeleton } from "@multica/ui/components/ui/skeleton";

// Hero: person-day savings + gross cost savings + efficiency ratio (the
// "hero" metrics of the executive dashboard). The source (HeroSaving.tsx)
// additionally showed AI spend / net savings by calling the chat proxy
// (chatGet '/stats/global/daily'); the mini-cloud migration DECIDED NOT to
// migrate the chat proxy (design decision: no chat proxy). So this card is
// simplified to the source's degraded 3-grid path — person-day savings /
// gross cost savings / efficiency ratio — which only needs dashboardSummary
// + globalConfig. The chat-driven 4-grid (AI spend / net savings) is
// intentionally omitted; see the comment block on HeroSavingMetrics for the
// full rationale.
//
// Per design decision: NO useCountUp number-roll animation (the source's
// animation hook); values are shown directly, matching the runtimes KpiCard
// style.
//
// ROI badge is retained: it derives from gross savings / total_cost, where
// total_cost is the kanban-task-scope cost already in dashboardSummary (not
// the platform AI spend), so no chat data is needed.

interface HeroSavingProps {
  startDate?: string;
  endDate?: string;
}

/** Person-day unit-price fallback when globalConfig omits cost_per_person_day (matches source). */
const FALLBACK_COST_PER_PERSON_DAY = 2000;

export function HeroSaving({ startDate, endDate }: HeroSavingProps) {
  const wsId = useWorkspaceId();
  const summaryQ = useQuery(dashboardSummaryOptions(wsId, startDate, endDate));
  const configQ = useQuery(globalConfigOptions(wsId));

  const data = summaryQ.data;

  const period = useMemo(
    () => fmtPeriod(startDate, endDate),
    [startDate, endDate],
  );

  const costPerPersonDay =
    configQ.data?.cost_per_person_day &&
    configQ.data.cost_per_person_day > 0
      ? configQ.data.cost_per_person_day
      : FALLBACK_COST_PER_PERSON_DAY;

  // savedMin = max(0, baseline - actual); person-days = savedMin / 480.
  const savedMin = Math.max(
    0,
    (data?.need_baseline_calendar_min || 0) -
      (data?.need_actual_calendar_min || 0),
  );
  const savedDays = personDaysValue(savedMin);
  // Per-capita saving = total saved person-days / active users.
  const activeUsers = data?.total_users_v2 || 0;
  const perCapitaDays = activeUsers > 0 ? savedDays / activeUsers : 0;
  // Gross saving = person-days x unit price (no AI-cost netting — see file header).
  const grossSaving = savedDays * costPerPersonDay;
  // ROI = gross saving / kanban-task total_cost (NOT platform AI spend). Only
  // shown when total_cost > 0.
  const roi =
    data && data.total_cost > 0 ? grossSaving / data.total_cost : null;

  const ratio = data?.need_calendar_ratio;
  const ratioAvailable =
    ratio != null && Number.isFinite(Number(ratio));
  const ratioPct = ratioAvailable ? Number(ratio) * 100 : 0;

  if (summaryQ.error) {
    return (
      <div className="rounded-lg border bg-card p-6 text-sm text-destructive">
        加载失败：{(summaryQ.error as Error).message}
      </div>
    );
  }

  if (summaryQ.isLoading || !data) {
    return (
      <div className="flex min-h-[15rem] flex-col rounded-lg border bg-card p-6 md:p-8">
        <Skeleton className="mb-2 h-7 w-48" />
        <Skeleton className="mb-8 h-4 w-64" />
        <div className="grid flex-1 grid-cols-1 gap-8 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[15rem] flex-col rounded-lg border bg-card p-6 transition-shadow hover:shadow-lg md:p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3 md:mb-8">
        <div>
          {/* h2, not h1 — the page title h1 lives in PageHeader (app chrome
              convention). This sub-title conveys the cost basis. */}
          <h2 className="mb-1 text-xl font-semibold text-card-foreground">
            提效节省概览
          </h2>
          <p className="text-sm text-muted-foreground">
            按 ¥{formatNumber(costPerPersonDay)}/人天估算 · 基于可计入且非异常的已合并需求 · 人均 = 总节省人天 ÷ 活跃用户数
          </p>
        </div>
        <div className="flex items-center gap-2">
          {roi != null && roi > 0 && (
            <span
              className="whitespace-nowrap rounded-full bg-success/10 px-3 py-1 text-xs font-medium tabular-nums text-success"
              title={glossaryTip("roi")}
            >
              ROI {roi.toFixed(1)}x
            </span>
          )}
          <span className="whitespace-nowrap rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
            {period}
          </span>
        </div>
      </div>

      {/* Degraded 3-grid (chat proxy not migrated). Source's 4-grid path
          (AI spend / net savings from '/stats/global/daily') is intentionally
          omitted here — see file header. */}
      <HeroSavingMetrics
        perCapitaDays={perCapitaDays}
        grossSaving={grossSaving}
        ratioAvailable={ratioAvailable}
        ratioPct={ratioPct}
      />
    </div>
  );
}

/** The 3 hero stats. Extracted so the layout is easy to scan at a glance. */
function HeroSavingMetrics({
  perCapitaDays,
  grossSaving,
  ratioAvailable,
  ratioPct,
}: {
  perCapitaDays: number;
  grossSaving: number;
  ratioAvailable: boolean;
  ratioPct: number;
}) {
  return (
    <div className="grid flex-1 grid-cols-1 gap-8 sm:grid-cols-3">
      <BigStat
        label="平均人均节省"
        value={perCapitaDays > 0 ? perCapitaDays.toFixed(2) : "-"}
        unit="人天"
        tone="success"
      />
      <BigStat
        label="折合节省成本"
        value={grossSaving > 0 ? `¥${formatNumber(Math.round(grossSaving))}` : "-"}
        unit=""
        tone="success"
      />
      <BigStat
        label="综合日历提效"
        value={ratioAvailable ? `${ratioPct.toFixed(1)}%` : "-"}
        unit=""
        tone={ratioPct < 0 ? "destructive" : "success"}
      />
    </div>
  );
}

function BigStat({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: string;
  unit: string;
  tone: "success" | "destructive" | "foreground";
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "destructive"
        ? "text-destructive"
        : "text-card-foreground";
  return (
    <div>
      <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span
          className={`text-5xl font-black leading-none tabular-nums md:text-6xl ${toneClass}`}
        >
          {value}
        </span>
        {unit && <span className="text-lg text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}

/** 'YYYY-MM-DD'×2 (or undefined) → '2026/03/06 ~ 2026/06/04'; empty when unset. */
function fmtPeriod(start?: string, end?: string): string {
  if (!start || !end) return "";
  // Store time range is always YYYY-MM-DD (see view-state-store); just swap
  // the separators for display.
  const f = (s: string) => s.replace(/-/g, "/");
  return `${f(start)} ~ ${f(end)}`;
}
