"use client";

import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  dashboardSummaryOptions,
  formatV2Ratio,
} from "@multica/core/efficiency";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { KpiCard } from "../../runtimes/components/shared";

// AI penetration card: penetration rate (share of needs whose authors actually
// use AI, including ones split across repos/branches) + data coverage rate
// (share of needs the dashboard can directly tie to an AI session) + the split
// gap (used AI but was split by the need boundary and excluded from the calc).
// gap = penetration − coverage, computed on the front-end.
interface AIPenetrationCardProps {
  startDate?: string;
  endDate?: string;
}

export function AIPenetrationCard({
  startDate,
  endDate,
}: AIPenetrationCardProps) {
  const wsId = useWorkspaceId();
  const { data, isLoading, error } = useQuery(
    dashboardSummaryOptions(wsId, startDate, endDate),
  );

  const pen = data?.ai_penetration_rate ?? null;
  const cov = data?.ai_coverage_rate ?? null;
  const gap = pen != null && cov != null ? pen - cov : null;

  return (
    <div className="flex flex-col rounded-lg border bg-card shadow-sm p-5 md:p-6">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        AI 渗透率
      </h2>
      {error ? (
        <div className="flex min-h-[7rem] flex-1 items-center justify-center text-sm text-destructive">
          加载失败：{(error as Error).message}
        </div>
      ) : isLoading || !data ? (
        <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiCard
            label="AI 渗透率"
            value={formatV2Ratio(pen)}
            hint="作者实际在用 AI 的需求占比（含被切散）"
          />
          <KpiCard
            label="数据覆盖率"
            value={formatV2Ratio(cov)}
            hint="看板能直接关联到 AI 会话的占比"
          />
          <KpiCard
            label="切散缺口"
            value={formatV2Ratio(gap)}
            hint="用了 AI 但被 need 边界切散、未进计算"
          />
        </div>
      )}
    </div>
  );
}
