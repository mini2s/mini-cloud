"use client";

import type { ReactNode, SyntheticEvent } from "react";
import type { Issue, UpdateIssueRequest } from "@multica/core/types";
import { Bot, GitBranch, UserRound, Users } from "lucide-react";
import { useActorName } from "@multica/core/workspace/hooks";
import { AssigneePicker } from "./pickers";

type ActorTypeLabels = Partial<Record<string, string>>;

function PickerWrapper({ children }: { children: ReactNode }) {
  const stop = (e: SyntheticEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };
  return (
    <span onClick={stop} onMouseDown={stop} onPointerDown={stop}>
      {children}
    </span>
  );
}

interface PeopleTooltipRowProps {
  label: string;
  actorType: string;
  actorId: string;
  actorTypeLabel: string;
  actorName: string;
  initials: string;
}

function PeopleTooltipRow({
  label,
  actorType,
  actorId,
  actorTypeLabel,
  actorName,
  initials,
}: PeopleTooltipRowProps) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="w-10 shrink-0 text-[10px] font-medium text-muted-foreground">
        {label}
      </span>
      <ActorTypeTile
        actorType={actorType}
        actorId={actorId}
        initials={initials}
        compact
        variant="assignee"
        testIdSuffix="detail"
      />
      <span className="flex min-w-0 flex-col">
        <span className="text-[10px] font-medium leading-none text-muted-foreground">
          {actorTypeLabel}
        </span>
        <span className="min-w-0 truncate text-xs font-medium leading-snug text-foreground">
          {actorName}
        </span>
      </span>
    </span>
  );
}

interface RolePersonProps {
  label: string;
  actorType: string;
  actorId: string;
  initials: string;
  compact: boolean;
  variant: "responsible" | "assignee";
}

const ACTOR_TILE_VISUALS: Record<
  string,
  {
    icon: typeof UserRound;
    className: string;
  }
> = {
  member: {
    icon: UserRound,
    className: "bg-primary/10 text-primary ring-primary/35",
  },
  agent: {
    icon: Bot,
    className: "bg-info/10 text-info ring-info/35",
  },
  squad: {
    icon: Users,
    className: "bg-warning/10 text-warning ring-warning/35",
  },
  workflow: {
    icon: GitBranch,
    className: "bg-success/10 text-success ring-success/35",
  },
};

const DEFAULT_ACTOR_TILE_VISUAL = {
  icon: UserRound,
  className: "bg-muted text-muted-foreground ring-border",
};

interface ActorTypeTileProps {
  actorType: string;
  actorId: string;
  initials: string;
  compact: boolean;
  variant: "responsible" | "assignee";
  testIdSuffix?: string;
}

function ActorTypeTile({
  actorType,
  actorId,
  initials,
  compact,
  variant,
  testIdSuffix,
}: ActorTypeTileProps) {
  const visual = ACTOR_TILE_VISUALS[actorType] ?? DEFAULT_ACTOR_TILE_VISUAL;
  const TypeIcon = visual.icon;
  const initial = initials.trim().charAt(0).toUpperCase() || "?";

  return (
    <span
      data-testid={`actor-tile-${actorType}-${actorId}${testIdSuffix ? `-${testIdSuffix}` : ""}`}
      className={`inline-flex shrink-0 items-center justify-center gap-0.5 rounded-[4px] font-semibold leading-none ring-1 ${
        compact ? "h-[18px] min-w-7 px-0.5 text-[9px]" : "h-5 min-w-8 px-1 text-[10px]"
      } ${visual.className} ${
        variant === "responsible" ? "shadow-[0_0_0_1px_hsl(var(--primary)/0.16)]" : ""
      }`}
    >
      <TypeIcon
        aria-label={`${actorType} icon`}
        className={compact ? "size-2.5" : "size-3"}
        strokeWidth={2.3}
      />
      <span className="min-w-2 text-center tabular-nums">{initial}</span>
    </span>
  );
}

function RolePerson({
  label,
  actorType,
  actorId,
  initials,
  compact,
  variant,
}: RolePersonProps) {
  return (
    <span
      className="inline-flex min-w-0 items-center gap-1 rounded-sm text-[11px] font-medium leading-none text-muted-foreground"
    >
      <span className="shrink-0">{label}</span>
      <ActorTypeTile
        actorType={actorType}
        actorId={actorId}
        initials={initials}
        compact={compact}
        variant={variant}
      />
    </span>
  );
}

interface IssuePeopleBadgesProps {
  issue: Issue;
  responsibleLabel: string;
  assigneeLabel: string;
  actorTypeLabels?: ActorTypeLabels;
  compact?: boolean;
  editableAssignee?: boolean;
  onAssigneeUpdate?: (updates: Partial<UpdateIssueRequest>) => void;
}

export function IssuePeopleBadges({
  issue,
  responsibleLabel,
  assigneeLabel,
  actorTypeLabels,
  compact = false,
  editableAssignee = false,
  onAssigneeUpdate,
}: IssuePeopleBadgesProps) {
  const { getActorName, getActorInitials } = useActorName();
  const hasResponsible = !!issue.responsible_user_id;
  const hasAssignee = !!issue.assignee_type && !!issue.assignee_id;

  if (!hasResponsible && !hasAssignee) return null;

  const responsibleName = hasResponsible
    ? getActorName("member", issue.responsible_user_id!)
    : null;
  const responsibleInitials = hasResponsible
    ? getActorInitials("member", issue.responsible_user_id!)
    : null;
  const assigneeName = hasAssignee
    ? getActorName(issue.assignee_type!, issue.assignee_id!)
    : null;
  const assigneeInitials = hasAssignee
    ? getActorInitials(issue.assignee_type!, issue.assignee_id!)
    : null;
  const getActorTypeLabel = (actorType: string) => actorTypeLabels?.[actorType] ?? actorType;
  const tooltipTitle = [
    hasResponsible
      ? `${responsibleLabel} / ${getActorTypeLabel("member")}: ${responsibleName}`
      : null,
    hasAssignee
      ? `${assigneeLabel} / ${getActorTypeLabel(issue.assignee_type!)}: ${assigneeName}`
      : null,
  ].filter(Boolean).join(" / ");

  const rolePeople = (
    <span className="inline-flex shrink-0 items-center gap-2">
      {hasResponsible && (
        <RolePerson
          label={responsibleLabel}
          actorType="member"
          actorId={issue.responsible_user_id!}
          initials={responsibleInitials!}
          compact={compact}
          variant="responsible"
        />
      )}
      {hasAssignee && (
        <RolePerson
          label={assigneeLabel}
          actorType={issue.assignee_type!}
          actorId={issue.assignee_id!}
          initials={assigneeInitials!}
          compact={compact}
          variant="assignee"
        />
      )}
    </span>
  );

  const hoverTooltip = (
    <span className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 hidden w-max max-w-56 rounded-md border border-border bg-popover px-2.5 py-2 text-popover-foreground shadow-md group-hover/people:block group-focus-within/people:block">
      <span className="flex flex-col gap-1">
        {hasResponsible && (
          <PeopleTooltipRow
            label={responsibleLabel}
            actorType="member"
            actorId={issue.responsible_user_id!}
            actorTypeLabel={getActorTypeLabel("member")}
            actorName={responsibleName!}
            initials={responsibleInitials!}
          />
        )}
        {hasAssignee && (
          <PeopleTooltipRow
            label={assigneeLabel}
            actorType={issue.assignee_type!}
            actorId={issue.assignee_id!}
            actorTypeLabel={getActorTypeLabel(issue.assignee_type!)}
            actorName={assigneeName!}
            initials={assigneeInitials!}
          />
        )}
      </span>
    </span>
  );

  const trigger = (
    <span
      className="group/people relative inline-flex shrink-0 items-center transition-transform hover:-translate-y-px focus-within:-translate-y-px"
      aria-label={tooltipTitle}
    >
      {rolePeople}
      {hoverTooltip}
    </span>
  );

  if (editableAssignee && onAssigneeUpdate && hasAssignee) {
    return (
      <PickerWrapper>
        <AssigneePicker
          assigneeType={issue.assignee_type}
          assigneeId={issue.assignee_id}
          onUpdate={onAssigneeUpdate}
          trigger={trigger}
          triggerRender={
            <span className="inline-flex cursor-pointer overflow-visible rounded px-1 -mx-1 transition-colors hover:bg-accent/30" />
          }
        />
      </PickerWrapper>
    );
  }

  return trigger;
}
