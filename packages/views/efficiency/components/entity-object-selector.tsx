"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  allReposOptions,
  allUsersOptions,
  deptOverviewOptions,
  projectListOptions,
  type DeptTreeNodeWithSummary,
  useUserNameMap,
} from "@multica/core/efficiency";
import { useT } from "../../i18n";

export type EfficiencyEntity = "org" | "user" | "project" | "repo";

interface EntityObjectSelectorProps {
  entity: EfficiencyEntity;
  value: string;
  startDate: string;
  endDate: string;
  onChange: (value: string) => void;
}

interface ObjectOption {
  value: string;
  label: string;
}

export function EntityObjectSelector(props: EntityObjectSelectorProps) {
  if (props.entity === "org") return <DepartmentSelector {...props} />;
  if (props.entity === "user") return <UserSelector {...props} />;
  if (props.entity === "project") return <ProjectSelector {...props} />;
  return <RepoSelector {...props} />;
}

function Selector({
  entity,
  value,
  options,
  loading,
  onChange,
}: {
  entity: EfficiencyEntity;
  value: string;
  options: ObjectOption[];
  loading: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useT("efficiency");
  const labels: Record<EfficiencyEntity, string> = {
    org: t(($) => $.common.selector.entity.org),
    user: t(($) => $.common.selector.entity.user),
    project: t(($) => $.common.selector.entity.project),
    repo: t(($) => $.common.selector.entity.repo),
  };
  const entityLabel = labels[entity];

  return (
    <label className="flex min-w-0 items-center gap-2 text-sm">
      <span className="shrink-0 text-muted-foreground">{entityLabel}</span>
      <select
        value={value}
        disabled={loading}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 min-w-0 max-w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-64"
        aria-label={t(($) => $.common.selector.select, {
          entity: entityLabel,
        })}
      >
        <option value="">
          {loading
            ? t(($) => $.common.selector.loading)
            : t(($) => $.common.selector.all, { entity: entityLabel })}
        </option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function DepartmentSelector(props: EntityObjectSelectorProps) {
  const wsId = useWorkspaceId();
  const query = useQuery(
    deptOverviewOptions(wsId, props.startDate, props.endDate),
  );
  const options = useMemo(
    () => flattenDepartments(query.data?.nodes ?? []),
    [query.data?.nodes],
  );
  return (
    <Selector
      {...props}
      options={options}
      loading={query.isLoading}
    />
  );
}

function UserSelector(props: EntityObjectSelectorProps) {
  const wsId = useWorkspaceId();
  const { resolveName, isLoading: namesLoading } = useUserNameMap();
  const query = useQuery(allUsersOptions(wsId, props.startDate, props.endDate));
  const options = useMemo(
    () =>
      (query.data ?? []).map((row) => ({
        value: row.user_id,
        label: resolveName(row.user_id),
      })),
    [query.data, resolveName],
  );
  return (
    <Selector
      {...props}
      options={options}
      loading={query.isLoading || namesLoading}
    />
  );
}

function ProjectSelector(props: EntityObjectSelectorProps) {
  const wsId = useWorkspaceId();
  const query = useQuery(
    projectListOptions(wsId, props.startDate, props.endDate),
  );
  const options = useMemo(
    () =>
      (query.data ?? []).map((row) => ({
        value: row.project_id,
        label: row.name || row.project_id,
      })),
    [query.data],
  );
  return (
    <Selector
      {...props}
      options={options}
      loading={query.isLoading}
    />
  );
}

function RepoSelector(props: EntityObjectSelectorProps) {
  const wsId = useWorkspaceId();
  const query = useQuery(allReposOptions(wsId, props.startDate, props.endDate));
  const options = useMemo(
    () =>
      (query.data ?? []).map((row) => ({
        value: row.repo_addr,
        label: row.repo_addr,
      })),
    [query.data],
  );
  return (
    <Selector
      {...props}
      options={options}
      loading={query.isLoading}
    />
  );
}

function flattenDepartments(
  nodes: DeptTreeNodeWithSummary[],
  depth = 0,
): ObjectOption[] {
  return nodes.flatMap((node) => [
    {
      value: node.dept_id,
      label: `${"　".repeat(depth)}${node.dept_name || node.dept_id}`,
    },
    ...flattenDepartments(node.children, depth + 1),
  ]);
}
