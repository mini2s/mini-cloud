"use client";

import type { ReactNode, SyntheticEvent } from "react";
import type { Issue, UpdateIssueRequest } from "@multica/core/types";
import { useActorName } from "@multica/core/workspace/hooks";
import { ActorAvatar } from "../../common/actor-avatar";
import { AssigneePicker } from "./pickers";

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
  actorName: string;
}

function PeopleTooltipRow({ label, actorName }: PeopleTooltipRowProps) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="w-10 shrink-0 text-[10px] font-medium text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 truncate text-xs font-medium text-foreground">
        {actorName}
      </span>
    </span>
  );
}

interface RoleAvatarProps {
  label: string;
  actorType: string;
  actorId: string;
  size: number;
  variant: "responsible" | "assignee";
}

function RoleAvatar({ label, actorType, actorId, size, variant }: RoleAvatarProps) {
  return (
    <span className="relative inline-flex" title={label}>
      <ActorAvatar
        actorType={actorType}
        actorId={actorId}
        size={size}
        className="ring-2 ring-card"
        enableHoverCard
        showStatusDot={actorType === "agent"}
      />
      <span
        className={`absolute -bottom-1 -right-1 flex size-3 items-center justify-center rounded-full border border-card text-[8px] font-semibold leading-none ${
          variant === "responsible"
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground"
        }`}
      >
        {label.trim().slice(0, 1)}
      </span>
    </span>
  );
}

interface IssuePeopleBadgesProps {
  issue: Issue;
  responsibleLabel: string;
  assigneeLabel: string;
  compact?: boolean;
  editableAssignee?: boolean;
  onAssigneeUpdate?: (updates: Partial<UpdateIssueRequest>) => void;
}

export function IssuePeopleBadges({
  issue,
  responsibleLabel,
  assigneeLabel,
  compact = false,
  editableAssignee = false,
  onAssigneeUpdate,
}: IssuePeopleBadgesProps) {
  const { getActorName } = useActorName();
  const hasResponsible = !!issue.responsible_user_id;
  const hasAssignee = !!issue.assignee_type && !!issue.assignee_id;

  if (!hasResponsible && !hasAssignee) return null;

  const responsibleName = hasResponsible
    ? getActorName("member", issue.responsible_user_id!)
    : null;
  const assigneeName = hasAssignee
    ? getActorName(issue.assignee_type!, issue.assignee_id!)
    : null;
  const tooltipTitle = [
    hasResponsible ? `${responsibleLabel}: ${responsibleName}` : null,
    hasAssignee ? `${assigneeLabel}: ${assigneeName}` : null,
  ].filter(Boolean).join(" / ");

  const avatarStack = (
    <span className="flex shrink-0 -space-x-1">
      {hasResponsible && (
        <RoleAvatar
          label={responsibleLabel}
          actorType="member"
          actorId={issue.responsible_user_id!}
          size={compact ? 18 : 20}
          variant="responsible"
        />
      )}
      {hasAssignee && (
        <RoleAvatar
          label={assigneeLabel}
          actorType={issue.assignee_type!}
          actorId={issue.assignee_id!}
          size={compact ? 18 : 20}
          variant="assignee"
        />
      )}
    </span>
  );

  const hoverTooltip = (
    <span className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 hidden w-max max-w-56 rounded-md border border-border bg-popover px-2.5 py-2 text-popover-foreground shadow-md group-hover/people:block group-focus-within/people:block">
      <span className="flex flex-col gap-1">
        {hasResponsible && (
          <PeopleTooltipRow label={responsibleLabel} actorName={responsibleName!} />
        )}
        {hasAssignee && (
          <PeopleTooltipRow label={assigneeLabel} actorName={assigneeName!} />
        )}
      </span>
    </span>
  );

  const trigger = (
    <span
      className="group/people relative inline-flex shrink-0 items-center rounded-full transition-transform hover:-translate-y-px focus-within:-translate-y-px"
      title={tooltipTitle}
    >
      {avatarStack}
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
        />
      </PickerWrapper>
    );
  }

  return trigger;
}
