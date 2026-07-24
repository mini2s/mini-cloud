"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useViewState } from "@multica/core/efficiency";
import { PageHeader } from "../../layout/page-header";
import { PeriodSelect } from "../components";
import { OrgContribution } from "./org-contribution";
import { UserContribution } from "./user-contribution";
import { ProjectContribution } from "./project-contribution";
import { RepoContribution } from "./repo-contribution";

// Contribution Dimension — the contribution dimension page. Ports the source
// ContributionDimension (entity dispatched via URL + useEntityFocus) to
// component-state-driven per design decision #1 (NO URL query state) and #2
// (NO navigation). SCOPE (this slice): AGGREGATE MODE ONLY. The source's
// focused mode embeds full DeptMembersPanel/UserDetail/ProjectDetail/
// RepoDetail pages which don't exist yet — those land in slice 5.
//
// Per design decision #5 (zero-platform-request): contribution DERIVES
// everything from already-ready queries (deptRankingOptions / allUsersOptions
// / allReposOptions / projectListOptions). No new queryOptions/mock/api —
// the dimension is structurally the simplest: 4 KPI strips + 4 sortable
// ranking tables differing only in fields.
//
// Contribution caliber: merged needs + code lines + commits (NOT tokens —
// tokens = consumption ≠ contribution, belong to the usage/cost dimension).
//
// Per design decision #3 (no ECharts) the source's ContributionTrend is
// omitted (it relied on ECharts with a second Y axis). Each entity view
// renders its KPI strip + sortable ranking table only; a weekly timeline
// is deferred until a recharts variant is built (the efficiency dimension's
// timeline lives at /v2/efficiency and is user-scoped).
//
// Per design decision #4 (reuse) PeriodSelect + shared Th/Td/SortHeader
// primitives from ../usage/shared are reused.

type Entity = "org" | "user" | "project" | "repo";

const ENTITY_TABS: { key: Entity; label: string }[] = [
  { key: "org", label: "组织" },
  { key: "user", label: "个人" },
  { key: "project", label: "项目" },
  { key: "repo", label: "仓库" },
];

export function ContributionDimension() {
  const { timeRange, setTimeRange } = useViewState();
  const [startDate, endDate] = timeRange;
  const [entity, setEntity] = useState<Entity>("org");

  return (
    <div className="flex h-full flex-col">
      <PageHeader className="h-auto min-h-12 flex-wrap justify-between gap-y-1.5 px-5 py-1.5 sm:py-0">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" />
          <h1 className="truncate text-sm font-medium">贡献看板</h1>
        </div>
        <PeriodSelect
          value={startDate}
          onChange={(range) => setTimeRange(range)}
        />
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-4 p-6 lg:space-y-6">
          {/* Caliber note: contribution is derived-only (no platform data). */}
          <p className="text-xs text-muted-foreground">
            贡献 = 交付物（合并需求 / 代码行 / 提交 / 贡献者），为
            <span className="font-medium text-foreground">看板派生口径</span>
            。平台（chat-stats）的 tokens 为消耗量 ≠ 贡献，故本维度不接入平台数据。
          </p>

          {/* Entity tabs (internal state, no URL). */}
          <div
            className="flex flex-wrap items-center gap-1"
            role="tablist"
            aria-label="主体"
          >
            {ENTITY_TABS.map((t) => (
              <EntityTab
                key={t.key}
                active={entity === t.key}
                onClick={() => setEntity(t.key)}
              >
                {t.label}
              </EntityTab>
            ))}
          </div>

          {/* Aggregate content dispatch (focused mode deferred to slice 5). */}
          {entity === "org" ? (
            <OrgContribution startDate={startDate} endDate={endDate} />
          ) : entity === "user" ? (
            <UserContribution startDate={startDate} endDate={endDate} />
          ) : entity === "project" ? (
            <ProjectContribution startDate={startDate} endDate={endDate} />
          ) : (
            <RepoContribution startDate={startDate} endDate={endDate} />
          )}
        </div>
      </div>
    </div>
  );
}

/** A flat entity-tab button (matches the efficiency-dimension style). */
function EntityTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        active
          ? "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors"
          : "rounded-md bg-transparent px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      }
    >
      {children}
    </button>
  );
}
