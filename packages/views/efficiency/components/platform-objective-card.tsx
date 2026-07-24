"use client";

import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  dashboardSummaryOptions,
  globalConfigOptions,
  formatNumber,
  formatV2Ratio,
} from "@multica/core/efficiency";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { KpiCard } from "../../runtimes/components/shared";

// Platform objective metrics. The source (PlatformObjectiveCard) was built
// entirely on the chat proxy (chatGet '/stats/global/daily' and
// '/stats/cost-trend') to show real AI spend / requests / tokens / cache hit
// rate. The mini-cloud migration DECIDED NOT to migrate the chat proxy (no
// chat client, no chatGet). So this card is substantially simplified.
//
// Degradation logic (mirrors the source's guardrails, minimally):
// - config not resolved yet → render nothing (avoid a flash of the degraded
//   notice while globalConfig is still loading).
// - chat_stats_enabled !== true → show the source's "not enabled" notice
//   (this is the realistic default; the platform data source is off).
// - chat_stats_enabled === true but no chat client wired → show the
//   "full data wired when backend live" placeholder. We surface the AI
//   signals that ARE in dashboardSummary (AI code ratio / coverage /
//   penetration / kanban-task total_cost) so the card isn't empty, with an
//   explicit note that the platform-side spend/requests/tokens are pending.
//
// The KPIs shown are NOT the platform objective metrics from the source —
// they are the dashboard-derived AI signals, clearly labelled. This is the
// "simplification" the task brief calls out as the most affected card.

interface PlatformObjectiveCardProps {
  startDate?: string;
  endDate?: string;
}

export function PlatformObjectiveCard({
  startDate,
  endDate,
}: PlatformObjectiveCardProps) {
  const wsId = useWorkspaceId();
  const configQ = useQuery(globalConfigOptions(wsId));
  const summaryQ = useQuery(dashboardSummaryOptions(wsId, startDate, endDate));

  const configResolved = !configQ.isLoading;
  const chatEnabled = configQ.data?.chat_stats_enabled === true;

  const s = summaryQ.data;

  // Guard 0: config still loading → render nothing (avoid a flash).
  if (!configResolved) return null;

  const wrap = (children: React.ReactNode) => (
    <section className="flex flex-col rounded-lg border bg-card shadow-sm p-5 transition-shadow hover:shadow-lg md:p-6">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          平台客观指标
        </h2>
        <span className="text-[11px] text-muted-foreground">
          平台客观采集 · chat-indicator-statistics
        </span>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        AI 调用真实花费 / 请求 / Token，按全局时间范围聚合。口径独立于上方看板派生（平台¥=Token 调用花费，≠ 看板折算人天）。
      </p>
      {children}
    </section>
  );

  // Guard 1: chat stats not enabled → source's "not enabled" notice.
  if (!chatEnabled) {
    return wrap(
      <div className="flex min-h-[7rem] items-center justify-center px-4 text-center text-sm text-muted-foreground">
        当前环境未启用平台指标服务（chat_stats_enabled=false），配置平台源后将自动展示 AI 调用花费 / 请求 / Token 等客观数据。
      </div>,
    );
  }

  // Guard 2: chat stats enabled but the chat proxy is not migrated. Show the
  // dashboard-derived AI signals that ARE available, with an explicit note
  // that platform spend/requests/tokens are pending the chat proxy.
  if (summaryQ.error) {
    return wrap(
      <div className="flex min-h-[7rem] items-center justify-center px-4 text-center text-sm text-destructive">
        加载失败：{(summaryQ.error as Error).message}
      </div>,
    );
  }

  if (summaryQ.isLoading || !s) {
    return wrap(
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>,
    );
  }

  return wrap(
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-dashed bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
        平台 AI 花费 / 请求 / Token 趋势依赖 chat 代理，当前尚未接入；以下展示看板派生的 AI 信号（口径与上方看板一致），完整平台客观数据将在后端就绪后补齐。
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="AI 代码占比"
          value={formatV2Ratio(s.ai_code_ratio)}
          hint="交付代码中 AI 生成并采纳的比例"
        />
        <KpiCard
          label="AI 渗透率"
          value={formatV2Ratio(s.ai_penetration_rate)}
          hint="作者实际在用 AI 的需求占比"
        />
        <KpiCard
          label="数据覆盖率"
          value={formatV2Ratio(s.ai_coverage_rate)}
          hint="看板能直接关联到 AI 会话的占比"
        />
        <KpiCard
          label="看板任务成本"
          value={`¥${formatNumber(s.total_cost)}`}
          hint="看板任务口径累计（≠ 平台 Token 花费）"
        />
      </div>
    </div>,
  );
}
