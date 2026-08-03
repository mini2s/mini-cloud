"use client";

import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  dashboardSummaryOptions,
  dashboardTrendsOptions,
  formatNumber,
  formatV2Ratio,
} from "@multica/core/efficiency";
import { useEfficiencyGlossary } from "../i18n";
import { MetricScorecard } from "./metric-scorecard";

// Three equal-height scorecards: active users / contributed lines / AI code
// ratio. Current values come from dashboard/summary (org-level global caliber);
// the usage + contribution sparklines and wow deltas come from dashboard/trends
// weekly series. AI ratio has no weekly series (the weekly table has no AI
// coverage row), so its sparkline is empty (the card keeps the height to match
// the other two). Display-only; info icon reveals the glossary caliber.
interface ScorecardStripProps {
  startDate?: string;
  endDate?: string;
}

export function ScorecardStrip({ startDate, endDate }: ScorecardStripProps) {
  const wsId = useWorkspaceId();
  const { glossaryTip } = useEfficiencyGlossary();
  const summaryQ = useQuery(dashboardSummaryOptions(wsId, startDate, endDate));
  const trendsQ = useQuery(dashboardTrendsOptions(wsId, startDate, endDate));

  const s = summaryQ.data;
  // Trends failure degrades softly: summary is the load-bearing data, so a
  // trends fetch error leaves the cards rendering without sparklines/deltas
  // (empty series + empty compare) rather than blocking the whole strip.
  const points = trendsQ.data?.points ?? [];
  const compare = trendsQ.data?.compare ?? {};
  const loading = summaryQ.isLoading || trendsQ.isLoading;

  if (summaryQ.error) {
    return (
      <div className="rounded-lg border bg-card p-5 text-sm text-destructive">
        加载失败：{(summaryQ.error as Error).message}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:gap-4">
      <MetricScorecard
        label="使用人数"
        value={s ? formatNumber(s.total_users_v2) : null}
        hint={s ? `需求 ${formatNumber(s.merged_needs)} 已合并` : undefined}
        tip={glossaryTip("active_users")}
        series={points.map((p) => p.active_users)}
        delta={compare.usage}
        accent="brand"
        loading={loading}
      />
      <MetricScorecard
        label="贡献行数"
        value={s ? `${formatNumber(s.total_commit_lines)}` : null}
        hint={s ? `AI ${formatV2Ratio(s.ai_code_ratio)} · 净增行` : undefined}
        tip={glossaryTip("commit_diff_lines")}
        series={points.map((p) => p.commit_diff_lines)}
        delta={compare.contribution}
        accent="chart-2"
        loading={loading}
      />
      <MetricScorecard
        label="AI 代码占比"
        value={s ? formatV2Ratio(s.ai_code_ratio) : null}
        hint={
          s
            ? `可计入 ${formatNumber(s.eligible_needs)}/${formatNumber(s.total_needs)} 需求`
            : undefined
        }
        tip={glossaryTip("ai_code_ratio")}
        series={[]}
        accent="chart-3"
        loading={loading}
      />
    </div>
  );
}
