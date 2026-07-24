"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  allNeedsOptions,
  usersOptions,
  formatV2Ratio,
  sortRows,
} from "@multica/core/efficiency";
import type { NeedsV2Summary, UserV2Row } from "@multica/core/efficiency";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@multica/ui/components/ui/tabs";

// Top efficiency rankings, switchable between Needs and Users via tabs. The
// backend does not support ordering by efficiency_ratio, so the source sorts
// client-side (nulls last) and takes the top 6; that logic is replicated here
// via the shared sortRows helper. Users are fetched with pageSize=1000 so the
// full population is sorted before slicing (the default 50 would rank only
// within the first page).
//
// Navigation: the source rows drilled into need/user detail via useNavigate
// (react-router). packages/views cannot import react-router-dom and the
// detail pages don't exist yet, so this card is display-only for now.
// TODO: navigation wired in slice 5.

interface TopRankCardProps {
  startDate?: string;
  endDate?: string;
}

type Tab = "need" | "user";

const RANK_BADGE = [
  "bg-amber-400 text-white", // 1 gold
  "bg-muted text-muted-foreground", // 2 silver
  "bg-orange-400 text-white", // 3 bronze
];
const RANK_DEFAULT = "bg-muted text-muted-foreground";

/** Truncate a long need_id (branch:.../pr:NN) for display. */
function shortNeedId(id: string): string {
  const colon = id.lastIndexOf(":");
  const tail = colon >= 0 ? id.slice(colon + 1) : id;
  return tail.length > 28 ? `${tail.slice(0, 28)}…` : tail;
}

export function TopRankCard({ startDate, endDate }: TopRankCardProps) {
  const wsId = useWorkspaceId();
  const [tab, setTab] = useState<Tab>("need");
  const needsQ = useQuery(allNeedsOptions(wsId, startDate, endDate));
  const usersQ = useQuery(
    usersOptions(wsId, startDate, endDate, 1000),
  );

  const topNeeds = useMemo<NeedsV2Summary[]>(() => {
    const rows = (needsQ.data ?? []).filter(
      (r) => r.coverage_eligible && r.efficiency_ratio != null,
    );
    return sortRows(rows, (r) => r.efficiency_ratio, true).slice(0, 6);
  }, [needsQ.data]);

  const topUsers = useMemo<UserV2Row[]>(() => {
    const rows = (usersQ.data?.data ?? []).filter(
      (r) => r.calendar_ratio != null,
    );
    return sortRows(rows, (r) => r.calendar_ratio, true).slice(0, 6);
  }, [usersQ.data]);

  const loading = tab === "need" ? needsQ.isLoading : usersQ.isLoading;
  const error = tab === "need" ? needsQ.error : usersQ.error;
  const empty = tab === "need" ? topNeeds.length === 0 : topUsers.length === 0;

  return (
    <div className="flex flex-col rounded-lg border bg-card shadow-sm p-5 transition-shadow hover:shadow-lg md:p-6">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab((v as Tab) ?? "need")}
        className="flex flex-1 flex-col gap-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Top 提效榜
          </h2>
          <TabsList>
            <TabsTrigger value="need">需求</TabsTrigger>
            <TabsTrigger value="user">人</TabsTrigger>
          </TabsList>
        </div>

        {error ? (
          <div className="flex min-h-[14rem] flex-1 items-center justify-center text-sm text-destructive">
            加载失败：{(error as Error).message}
          </div>
        ) : loading ? (
          <ul className="flex-1 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-11 rounded-xl" />
            ))}
          </ul>
        ) : empty ? (
          <div className="flex min-h-[14rem] flex-1 items-center justify-center text-sm text-muted-foreground">
            暂无可计入榜单数据
          </div>
        ) : (
          <>
            <TabsContent value="need">
              <ul className="space-y-2">
                {topNeeds.map((r, i) => (
                  <RankRow
                    key={r.need_id}
                    rank={i + 1}
                    title={shortNeedId(r.need_id)}
                    sub={r.repo_branch}
                    pill={formatV2Ratio(r.efficiency_ratio)}
                  />
                ))}
              </ul>
            </TabsContent>
            <TabsContent value="user">
              <ul className="space-y-2">
                {topUsers.map((r, i) => (
                  <RankRow
                    key={r.user_id}
                    rank={i + 1}
                    title={r.user_name}
                    sub={`合并需求 ${r.merged_need_count}`}
                    pill={formatV2Ratio(r.calendar_ratio)}
                  />
                ))}
              </ul>
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}

function RankRow({
  rank,
  title,
  sub,
  pill,
}: {
  rank: number;
  title: string;
  sub: string;
  pill: string;
}) {
  const badge = rank <= 3 ? RANK_BADGE[rank - 1] : RANK_DEFAULT;
  return (
    <li className="flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-muted/50">
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ${badge}`}
      >
        {rank}
      </span>
      <div className="min-w-0 flex-1">
        <div
          className="truncate text-sm font-medium text-card-foreground"
          title={title}
        >
          {title}
        </div>
        <div
          className="truncate text-xs text-muted-foreground"
          title={sub}
        >
          {sub}
        </div>
      </div>
      <span className="shrink-0 text-sm font-medium tabular-nums text-card-foreground">
        {pill}
      </span>
    </li>
  );
}
