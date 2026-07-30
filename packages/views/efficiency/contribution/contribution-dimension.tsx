"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useUserNameMap, useViewState } from "@multica/core/efficiency";
import { PageHeader } from "../../layout/page-header";
import { DateRangePicker } from "../components";
import {
  EntityObjectSelector,
  type EfficiencyEntity,
} from "../components/entity-object-selector";
import { CreateProjectButton } from "../components/create-project-button";
import { UserDetail } from "../detail";
import { OrgContribution } from "./org-contribution";
import { UserContribution } from "./user-contribution";
import {
  ProjectContribution,
  ProjectContributionFocus,
} from "./project-contribution";
import {
  RepoContribution,
  RepoContributionFocus,
} from "./repo-contribution";
import { ContributionTrendSection } from "./contribution-trend-section";

// Aggregate contribution dashboard for organization, user, project, and repo.
// Contribution is derived from kanban delivery data rather than platform token
// consumption. Aggregate and focused entity states are rendered here.

type Entity = EfficiencyEntity;

export interface ContributionViewState {
  entity: Entity;
  object: string;
}

interface ContributionDimensionProps {
  initialEntity?: Entity;
  initialObject?: string;
  onStateChange?: (state: ContributionViewState) => void;
}

const ENTITY_TABS: { key: Entity; label: string }[] = [
  { key: "org", label: "组织" },
  { key: "user", label: "个人" },
  { key: "project", label: "项目" },
  { key: "repo", label: "仓库" },
];

export function ContributionDimension({
  initialEntity = "org",
  initialObject = "",
  onStateChange,
}: ContributionDimensionProps = {}) {
  const { timeRange, setTimeRange } = useViewState();
  const [startDate, endDate] = timeRange;
  const [internalState, setInternalState] = useState<ContributionViewState>({
    entity: initialEntity,
    object: initialObject,
  });
  const state = onStateChange
    ? { entity: initialEntity, object: initialObject }
    : internalState;

  function updateState(next: ContributionViewState) {
    setInternalState(next);
    onStateChange?.(next);
  }

  const { entity, object } = state;

  return (
    <div className="flex h-full flex-col">
      <PageHeader className="h-auto min-h-12 flex-wrap justify-between gap-y-1.5 px-5 py-1.5 sm:py-0">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" />
          <h1 className="truncate text-sm font-medium">贡献看板</h1>
        </div>
        <DateRangePicker value={timeRange} onChange={setTimeRange} />
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-4 p-6 lg:space-y-6 lg:px-8">
          {/* Caliber note: contribution is derived-only (no platform data). */}
          <p className="text-xs text-muted-foreground">
            贡献 = 交付物（合并需求 / 代码行 / 提交 / 贡献者），为
            <span className="font-medium text-foreground">看板派生口径</span>
            。平台（chat-stats）的 tokens 为消耗量 ≠ 贡献，故本维度不接入平台数据。
          </p>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              className="flex flex-wrap items-center gap-1"
              role="tablist"
              aria-label="主体"
            >
              {ENTITY_TABS.map((t) => (
                <EntityTab
                  key={t.key}
                  active={entity === t.key}
                  onClick={() => updateState({ entity: t.key, object: "" })}
                >
                  {t.label}
                </EntityTab>
              ))}
            </div>
            <EntityObjectSelector
              entity={entity}
              value={object}
              startDate={startDate}
              endDate={endDate}
              onChange={(value) => updateState({ entity, object: value })}
            />
            {entity === "project" && (
              <CreateProjectButton
                onCreated={(projectId) =>
                  updateState({ entity, object: projectId })
                }
              />
            )}
          </div>

          {object ? (
            <FocusedContribution
              entity={entity}
              object={object}
              startDate={startDate}
              endDate={endDate}
              onBack={() => updateState({ entity, object: "" })}
            />
          ) : entity === "org" ? (
            <OrgContribution
              startDate={startDate}
              endDate={endDate}
              onSelect={(value) => updateState({ entity, object: value })}
            />
          ) : entity === "user" ? (
            <UserContribution
              startDate={startDate}
              endDate={endDate}
            />
          ) : entity === "project" ? (
            <ProjectContribution
              startDate={startDate}
              endDate={endDate}
              onSelect={(value) => updateState({ entity, object: value })}
            />
          ) : (
            <RepoContribution
              startDate={startDate}
              endDate={endDate}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function FocusedContribution({
  entity,
  object,
  startDate,
  endDate,
  onBack,
}: {
  entity: Entity;
  object: string;
  startDate: string;
  endDate: string;
  onBack: () => void;
}) {
  if (entity === "org") {
    return (
      <OrgContribution
        startDate={startDate}
        endDate={endDate}
        deptId={object}
      />
    );
  }

  if (entity === "user") {
    return (
      <UserContributionFocus
        userId={object}
        startDate={startDate}
        endDate={endDate}
        onBack={onBack}
      />
    );
  }

  if (entity === "project") {
    return (
      <ProjectContributionFocus
        projectId={object}
        startDate={startDate}
        endDate={endDate}
        onBack={onBack}
        onDeleted={onBack}
      />
    );
  }

  return (
    <RepoContributionFocus
      repoAddr={object}
      startDate={startDate}
      endDate={endDate}
    />
  );
}

function UserContributionFocus({
  userId,
  startDate,
  endDate,
  onBack,
}: {
  userId: string;
  startDate: string;
  endDate: string;
  onBack: () => void;
}) {
  const { resolveName } = useUserNameMap();
  const userName = resolveName(userId);

  return (
    <div className="space-y-4">
      <ContributionTrendSection
        userId={userId}
        startDate={startDate}
        endDate={endDate}
        subtitle={`个人 · ${userName}`}
      />
      <p className="text-xs text-muted-foreground">
        汇总中的 Commit / 代码行按
        <span className="font-medium text-foreground"> commits 直聚</span>
        ；上方趋势沿用 Need
        关联周表，两者不要求加总一致。下方为 {userName} 的个人贡献明细。
      </p>
      <UserDetail
        userId={userId}
        startDate={startDate}
        endDate={endDate}
        onBack={onBack}
      />
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
