"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  dashboardSummaryOptions,
  chatGlobalDailyOptions,
  globalConfigOptions,
  formatNumber,
  personDaysValue,
} from "@multica/core/efficiency";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { useEfficiencyGlossary } from "../i18n";
import { useCountUp } from "./use-count-up";

// Hero: person-day savings + gross cost savings + efficiency ratio (the
// "hero" metrics of the executive dashboard). The source (HeroSaving.tsx)
// also shows AI spend / net savings from the chat daily aggregate when the
// platform source is enabled. Request failure or disabled chat stats degrades
// safely to the three kanban-derived metrics.
//
// The big numbers roll up from 0 on load via useCountUp (ported from the
// source's animation hook, see use-count-up.ts); the roll is skipped when the
// user prefers reduced motion. Changing the date range remounts the metrics
// (query key change → loading state) so the numbers re-roll on fresh data.
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
  const { glossaryTip } = useEfficiencyGlossary();
  const summaryQ = useQuery(dashboardSummaryOptions(wsId, startDate, endDate));
  const configQ = useQuery(globalConfigOptions(wsId));
  const chatEnabled = configQ.data?.chat_stats_enabled === true;
  const chatQ = useQuery({
    ...chatGlobalDailyOptions(wsId, startDate ?? "", endDate ?? ""),
    enabled: !!wsId && !!startDate && !!endDate && chatEnabled,
    retry: 1,
    staleTime: 5 * 60_000,
  });

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
  // Gross saving = person-days x unit price.
  const grossSaving = savedDays * costPerPersonDay;
  const aiCost = useMemo(
    () =>
      (chatQ.data ?? []).reduce(
        (sum, row) => sum + (row.estimated_total_cost || 0),
        0,
      ),
    [chatQ.data],
  );
  const aiAvailable = chatEnabled && chatQ.isSuccess;
  const netSaving = grossSaving - aiCost;
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
      <div className="flex min-h-[15rem] flex-col rounded-lg border bg-card shadow-sm p-6 md:p-8">
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
    <div className="flex min-h-[15rem] flex-col rounded-lg border bg-card shadow-sm p-6 transition-shadow hover:shadow-lg md:p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3 md:mb-8">
        <div>
          {/* h2, not h1 — the page title h1 lives in PageHeader (app chrome
              convention). This sub-title conveys the cost basis. */}
          <h2 className="mb-1 text-xl font-semibold text-card-foreground">
            AI 提效总览
          </h2>
          <p className="text-sm text-muted-foreground">
            按 ¥{formatNumber(costPerPersonDay)}/人天估算 · 基于可计入且非异常的已合并需求 · 人均 = 总节省人天 ÷ 活跃用户数
            {aiAvailable && " · AI 花费为全平台口径（按价格表估算）"}
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

      <HeroSavingMetrics
        perCapitaDays={perCapitaDays}
        grossSaving={grossSaving}
        aiCost={aiCost}
        aiAvailable={aiAvailable}
        netSaving={netSaving}
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
  aiCost,
  aiAvailable,
  netSaving,
  ratioAvailable,
  ratioPct,
}: {
  perCapitaDays: number;
  grossSaving: number;
  aiCost: number;
  aiAvailable: boolean;
  netSaving: number;
  ratioAvailable: boolean;
  ratioPct: number;
}) {
  // Unconditional hooks: HeroSavingMetrics only mounts once data is present
  // (HeroSaving early-returns for loading/error), so the roll starts with the
  // final numbers already in hand — matching the source's behavior.
  const perCapitaCount = useCountUp(perCapitaDays);
  const grossCount = useCountUp(Math.round(grossSaving));
  const aiCount = useCountUp(Math.round(aiCost));
  const netCount = useCountUp(Math.round(netSaving));
  const ratioCount = useCountUp(ratioPct);

  return (
    <div
      className={
        aiAvailable
          ? "grid flex-1 grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2 xl:grid-cols-4"
          : "grid flex-1 grid-cols-1 gap-8 sm:grid-cols-3"
      }
    >
      <BigStat
        label="平均人均节省"
        value={perCapitaDays > 0 ? perCapitaCount.toFixed(2) : "-"}
        unit="人天"
        tone="success"
      />
      {aiAvailable ? (
        <>
          <BigStat
            label="AI 花费"
            value={`¥${formatNumber(Math.round(aiCount))}`}
            unit=""
            tone="foreground"
          />
          <BigStat
            label="净节省"
            value={`¥${formatNumber(Math.round(netCount))}`}
            unit=""
            tone={netSaving < 0 ? "destructive" : "success"}
          />
        </>
      ) : (
        <BigStat
          label="折合节省成本"
          value={
            grossSaving > 0
              ? `¥${formatNumber(Math.round(grossCount))}`
              : "-"
          }
          unit=""
          tone="success"
        />
      )}
      <BigStat
        label="综合日历提效"
        value={ratioAvailable ? `${ratioCount.toFixed(1)}%` : "-"}
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
