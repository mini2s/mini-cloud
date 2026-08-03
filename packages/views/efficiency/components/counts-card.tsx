"use client";

import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  dashboardSummaryOptions,
  formatNumber,
} from "@multica/core/efficiency";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { KpiCard } from "../../runtimes/components/shared";

// Scale overview card: 6 KpiCards (total repos / users / needs / commits / code
// lines / active users) in a 2-3 col grid. Reuses the runtimes KpiCard so the
// tile styling stays consistent with the rest of the app.
interface CountsCardProps {
  startDate?: string;
  endDate?: string;
}

export function CountsCard({ startDate, endDate }: CountsCardProps) {
  const wsId = useWorkspaceId();
  const { data, isLoading, error } = useQuery(
    dashboardSummaryOptions(wsId, startDate, endDate),
  );

  return (
    <div className="flex flex-col rounded-lg border bg-card shadow-sm p-5 md:p-6">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        规模概览
      </h2>
      {error ? (
        <div className="flex min-h-[14rem] flex-1 items-center justify-center text-sm text-destructive">
          加载失败：{(error as Error).message}
        </div>
      ) : isLoading || !data ? (
        <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <KpiCard
            label="总仓库数"
            value={formatNumber(data.total_repos)}
            hint={`分支 ${formatNumber(data.total_branchs)} 个`}
          />
          <KpiCard
            label="总用户数"
            value={formatNumber(data.total_users)}
            hint="参与提交的贡献者"
          />
          <KpiCard
            label="需求"
            value={formatNumber(data.total_needs)}
            hint={`已合并 ${formatNumber(data.merged_needs)} · 可计入 ${formatNumber(data.eligible_needs)}`}
          />
          <KpiCard
            label="总 Commit"
            value={formatNumber(data.total_commits)}
            hint={`代码行 ${formatNumber(data.total_commit_lines)}`}
          />
          <KpiCard
            label="总代码行"
            value={formatNumber(data.total_commit_lines)}
            hint="commit 净改动行数"
          />
          <KpiCard
            label="活跃用户(V2)"
            value={formatNumber(data.total_users_v2)}
            hint="需求口径参与者"
          />
        </div>
      )}
    </div>
  );
}
