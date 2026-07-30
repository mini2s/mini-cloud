"use client";

import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  fmtCost,
  formatNumber,
  usageUserDetailOptions,
  usageUserTrendOptions,
  useUserNameMap,
} from "@multica/core/efficiency";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@multica/ui/components/ui/dialog";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import {
  MultiTrendChart,
  PieBreakdownChart,
  type MultiTrendPoint,
  type PieDatum,
} from "../charts";
import {
  PCT,
  chartColorFor,
  filterZeroRequests,
  fmtMs,
  shortDate,
  shortToken,
  Td,
  TdNum,
  Th,
  ThNum,
} from "./shared";

// Member detail dialog — shown when the user clicks a row in MembersView.
// Ports the source UserDetailModal (308 lines, ECharts). Per design decision
// #2 we don't navigate to a member page; we surface detail in a Dialog owned
// by the parent UsageKanban. Layout is preserved:
//   1. Sub-header (uid / username / period).
//   2. 12 KPI tiles (3 rows × 4): total requests / input / output / total
//      token / success / fail / active days / sessions / avg TTFT / avg
//      latency / cost / cache token.
//   3. Department membership badges (main vs secondary).
//   4. Model preference pie (merged from per-day JSON) + per-model table.
//   5. Request trend + token trend + cost trend (3 area charts).
//   6. Per-day detail table.
//
// Simplifications:
//   - The source carried 3 trend charts (request, token, cost) + a per-day
//     table. We keep all of them but render via MultiTrendChart (recharts).
//   - The cost trend is shown when the trend points carry cost fields; we
//     always render it (zeros look fine for mock).

interface MemberDetailDialogProps {
  uid: string;
  startDate: string;
  endDate: string;
  onClose: () => void;
}

export function MemberDetailDialog({
  uid,
  startDate,
  endDate,
  onClose,
}: MemberDetailDialogProps) {
  const wsId = useWorkspaceId();
  const detailQ = useQuery(usageUserDetailOptions(wsId, uid, startDate, endDate));
  const trendQ = useQuery(usageUserTrendOptions(wsId, uid, startDate, endDate));

  const u = detailQ.data?.user_detail;
  const { resolveName } = useUserNameMap();
  // Source UserDetailModal: displayName = resolveName(uid) || u?.username || uid
  // (resolveName never returns "", so the roster hit / raw id always wins).
  const displayName = resolveName(uid) || u?.username || uid;
  const depts = detailQ.data?.departments ?? [];
  const models = detailQ.data?.models ?? [];
  const trendData = trendQ.data ?? [];

  const isLoading = detailQ.isLoading || trendQ.isLoading;
  const hasError = detailQ.error || trendQ.error;

  // KPI grid (12 tiles). Sourced from the detail row primarily; the source
  // also aggregated from trendData as a fallback — we keep just the detail
  // row fields here (the trend endpoint isn't guaranteed to carry every
  // aggregate field in mini-core).
  const ukpis: { title: string; value: string; tone?: "success" | "neg" }[] = u
    ? [
        { title: "总请求", value: formatNumber(u.total_requests) },
        { title: "总输入 Token", value: shortToken(u.sum_prompt_tokens) },
        { title: "总输出 Token", value: shortToken(u.sum_completion_tokens) },
        { title: "总 Token", value: shortToken(u.sum_total_tokens) },
        { title: "成功率", value: PCT(u.success_rate), tone: "success" },
        {
          title: "失败率",
          value: PCT(u.error_rate),
          tone: u.error_rate > 5 ? "neg" : undefined,
        },
        { title: "活跃天数", value: formatNumber(u.active_days) },
        { title: "会话数", value: formatNumber(u.total_sessions) },
        {
          title: "平均 TTFT",
          value: u.avg_ttft_ms ? fmtMs(u.avg_ttft_ms) : "-",
        },
        {
          title: "平均时延",
          value: u.avg_duration_ms ? fmtMs(u.avg_duration_ms) : "-",
        },
        {
          title: "预估花费",
          value: u.estimated_total_cost ? fmtCost(u.estimated_total_cost) : "-",
        },
        {
          title: "缓存 Token",
          value: shortToken(u.sum_cache_tokens),
        },
      ]
    : [];

  // Trend chart points (request, token, cost) — one row per day.
  const reqPoints: MultiTrendPoint[] = trendData.map((t) => ({
    label: shortDate(t.date),
    requests: t.total_requests ?? 0,
  }));
  const tokenPoints: MultiTrendPoint[] = trendData.map((t) => ({
    label: shortDate(t.date),
    prompt: t.sum_prompt_tokens ?? 0,
    completion: t.sum_completion_tokens ?? 0,
  }));
  const costPoints: MultiTrendPoint[] = trendData.map((t) => ({
    label: shortDate(t.date),
    total: +(t.estimated_total_cost ?? 0).toFixed(2),
    input: +(t.estimated_input_cost ?? 0).toFixed(2),
    output: +(t.estimated_output_cost ?? 0).toFixed(2),
  }));

  // Model preference pie (merged from per-day JSON in trendData). Mirrors the
  // source's mergedModelPref — sum across days.
  const mergedModelPref = useMemo(() => {
    const merged: Record<string, number> = {};
    for (const d of trendData) {
      if (!d.model_preference) continue;
      try {
        const prefs = JSON.parse(d.model_preference) as Record<string, number>;
        for (const [model, count] of Object.entries(prefs)) {
          merged[model] = (merged[model] ?? 0) + count;
        }
      } catch {
        // ignore malformed JSON
      }
    }
    return Object.keys(merged).length > 0
      ? Object.entries(merged)
          .sort((a, b) => b[1] - a[1])
          .map(([name, value]) => ({ name, value }))
      : null;
  }, [trendData]);

  const { visible: visibleModels, hiddenCount } = filterZeroRequests(
    models,
    (m) => m.request_count,
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{displayName} · 个人使用详情</DialogTitle>
          <DialogDescription>
            {u?.universal_id ? `用户 ID: ${u.universal_id} · ` : ""}
            {startDate} ~ {endDate}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-lg" />
            ))}
          </div>
        ) : hasError ? (
          <div className="py-12 text-center text-sm text-destructive">
            加载失败：{(hasError as Error).message}
          </div>
        ) : !u ? (
          <div className="py-12 text-center text-sm text-muted-foreground">暂无数据</div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* KPI tiles: 3 rows of 4. */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {ukpis.map((k) => (
                <KpiTile key={k.title} title={k.title} value={k.value} tone={k.tone} />
              ))}
            </div>

            {/* Department membership badges. */}
            {depts.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">部门归属：</span>
                {depts.map((dp) => (
                  <span
                    key={dp.dept_id}
                    className={
                      dp.is_main
                        ? "rounded-full bg-primary/10 px-2 py-0.5 text-primary"
                        : "rounded-full bg-muted px-2 py-0.5 text-muted-foreground"
                    }
                    title={dp.is_main ? "主部门" : "兼职部门"}
                  >
                    {dp.dept_name}
                    {dp.is_main ? " · 主" : ""}
                  </span>
                ))}
              </div>
            )}

            {/* Model preference pie + per-model table. */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {mergedModelPref && (
                <div className="flex flex-col rounded-lg border bg-card shadow-sm p-4">
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    模型偏好（使用次数）
                  </h3>
                  <PieBreakdownChart data={mergedModelPref as PieDatum[]} />
                </div>
              )}
              <div className="flex flex-col rounded-lg border bg-card shadow-sm p-4">
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  各模型使用 {hiddenCount > 0 ? `（隐藏 ${hiddenCount} 个 0 请求）` : ""}
                </h3>
                {visibleModels.length ? (
                  <ModelTable models={visibleModels} />
                ) : (
                  <div className="flex min-h-[10rem] items-center justify-center text-sm text-muted-foreground">
                    暂无数据
                  </div>
                )}
              </div>
            </div>

            {/* Trend charts. */}
            {trendData.length > 0 && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <ChartTile title="请求量趋势">
                  <MultiTrendChart
                    data={reqPoints}
                    formatY={shortToken}
                    series={[
                      { key: "requests", name: "请求量", color: "var(--chart-4)" },
                    ]}
                  />
                </ChartTile>
                <ChartTile title="Token 消耗趋势（按天）">
                  <MultiTrendChart
                    data={tokenPoints}
                    formatY={shortToken}
                    series={[
                      { key: "prompt", name: "输入 Token", color: "var(--chart-1)" },
                      { key: "completion", name: "输出 Token", color: "var(--chart-3)" },
                    ]}
                  />
                </ChartTile>
                <ChartTile title="成本变化趋势">
                  <MultiTrendChart
                    data={costPoints}
                    formatY={(v) => `¥${shortToken(v)}`}
                    series={[
                      { key: "total", name: "总成本", color: "var(--chart-5)" },
                      { key: "input", name: "输入成本", color: "var(--chart-1)" },
                      { key: "output", name: "输出成本", color: "var(--chart-2)" },
                    ]}
                  />
                </ChartTile>
              </div>
            )}

            {/* Per-day detail table. */}
            {trendData.length > 0 && <PerDayTable points={trendData} />}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function KpiTile({
  title,
  value,
  tone,
}: {
  title: string;
  value: string;
  tone?: "success" | "neg";
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "neg"
        ? "text-destructive"
        : "text-card-foreground";
  return (
    <div className="rounded-lg border bg-card shadow-sm p-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className={`mt-1 text-lg font-bold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}

function ChartTile({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col rounded-lg border bg-card shadow-sm p-4">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

function ModelTable({
  models,
}: {
  models: { model: string; request_count: number; request_pct: number; prompt_tokens: number; completion_tokens: number; success_rate: number }[];
}) {
  return (
    <div className="max-h-[280px] overflow-y-auto">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b text-muted-foreground">
            <Th>模型</Th>
            <ThNum>请求</ThNum>
            <ThNum>占比</ThNum>
            <ThNum>输入</ThNum>
            <ThNum>输出</ThNum>
            <ThNum>成功率</ThNum>
          </tr>
        </thead>
        <tbody>
          {models.map((m, i) => (
            <tr key={m.model || i} className="border-b border-border/50">
              <Td>
                <span className="inline-flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: chartColorFor(i) }}
                  />
                  <span className="max-w-[140px] truncate" title={m.model}>
                    {m.model || "-"}
                  </span>
                </span>
              </Td>
              <TdNum>{formatNumber(m.request_count)}</TdNum>
              <TdNum>{PCT(m.request_pct)}</TdNum>
              <TdNum title={formatNumber(m.prompt_tokens)}>{shortToken(m.prompt_tokens)}</TdNum>
              <TdNum title={formatNumber(m.completion_tokens)}>{shortToken(m.completion_tokens)}</TdNum>
              <TdNum>{PCT(m.success_rate)}</TdNum>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PerDayTable({
  points,
}: {
  points: {
    date: string;
    total_requests?: number;
    sum_prompt_tokens?: number;
    sum_completion_tokens?: number;
    sum_cache_tokens?: number;
    estimated_total_cost?: number | null;
    unique_task_count?: number;
    avg_first_token_duration_ms?: number | null;
    avg_duration_ms?: number | null;
  }[];
}) {
  return (
    <div className="max-h-[360px] overflow-y-auto rounded-lg border bg-card">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b text-muted-foreground">
            <Th>日期</Th>
            <ThNum>请求</ThNum>
            <ThNum>输入Token</ThNum>
            <ThNum>输出Token</ThNum>
            <ThNum>缓存Token</ThNum>
            <ThNum>成本</ThNum>
            <ThNum>会话</ThNum>
            <ThNum>TTFT</ThNum>
            <ThNum>时延</ThNum>
          </tr>
        </thead>
        <tbody>
          {points.map((d, i) => (
            <tr key={d.date || i} className="border-b border-border/50">
              <Td>{shortDate(d.date)}</Td>
              <TdNum>{formatNumber(d.total_requests ?? 0)}</TdNum>
              <TdNum title={formatNumber(d.sum_prompt_tokens)}>
                {shortToken(d.sum_prompt_tokens)}
              </TdNum>
              <TdNum title={formatNumber(d.sum_completion_tokens)}>
                {shortToken(d.sum_completion_tokens)}
              </TdNum>
              <TdNum title={formatNumber(d.sum_cache_tokens)}>
                {shortToken(d.sum_cache_tokens)}
              </TdNum>
              <TdNum>¥{Number(d.estimated_total_cost ?? 0).toFixed(2)}</TdNum>
              <TdNum>{formatNumber(d.unique_task_count ?? 0)}</TdNum>
              <TdNum>{fmtMs(d.avg_first_token_duration_ms)}</TdNum>
              <TdNum>{fmtMs(d.avg_duration_ms)}</TdNum>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


