"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import {
  allNeedsOptions,
  usersOptions,
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
import { useNavigation } from "../../navigation";
import { DRILLDOWN_ROW_CLASS } from "./drilldown-styles";
import { RatioPill } from "./ratio-pill";

// Top efficiency rankings, switchable between Needs and Users via tabs. The
// backend does not support ordering by efficiency_ratio, so the source sorts
// client-side (nulls last) and takes the top 6; that logic is replicated here
// via the shared sortRows helper. Users are fetched with pageSize=1000 so the
// full population is sorted before slicing (the default 50 would rank only
// within the first page).
//
// Rows drill into the migrated need/user detail routes through the shared
// navigation adapter, keeping this component independent of Next.js.

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
  const paths = useWorkspacePaths();
  const { push } = useNavigation();
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
                    pill={<RatioPill value={r.efficiency_ratio} />}
                    onClick={() => push(paths.metricsNeedDetail(r.need_id))}
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
                    pill={<RatioPill value={r.calendar_ratio} />}
                    onClick={() => push(paths.metricsUserDetail(r.user_id))}
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
  onClick,
}: {
  rank: number;
  title: string;
  sub: string;
  pill: ReactNode;
  onClick: () => void;
}) {
  const badge = rank <= 3 ? RANK_BADGE[rank - 1] : RANK_DEFAULT;
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left ${DRILLDOWN_ROW_CLASS}`}
        aria-label={`查看 ${title} 详情`}
      >
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
        <span className="shrink-0">{pill}</span>
      </button>
    </li>
  );
}
