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

interface PersonBadgeProps {
  label: string;
  actorType: string;
  actorId: string;
  compact?: boolean;
}

function PersonBadge({ label, actorType, actorId, compact = false }: PersonBadgeProps) {
  const { getActorName } = useActorName();
  const actorName = getActorName(actorType, actorId);

  return (
    <span
      className={`group/person inline-flex shrink-0 items-center gap-1 overflow-hidden rounded-md border border-border/70 bg-background/80 text-muted-foreground transition-colors hover:border-border hover:bg-muted/70 focus-within:border-border focus-within:bg-muted/70 ${
        compact ? "h-6 px-1 text-[10px]" : "h-7 px-1.5 text-[11px]"
      }`}
      title={`${label}: ${actorName}`}
    >
      <span className="shrink-0 font-medium leading-none">{label}</span>
      <ActorAvatar
        actorType={actorType}
        actorId={actorId}
        size={compact ? 18 : 20}
        enableHoverCard
        showStatusDot={actorType === "agent"}
      />
      <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-150 group-hover/person:max-w-28 group-hover/person:opacity-100 group-focus-within/person:max-w-28 group-focus-within/person:opacity-100">
        {actorName}
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
  const hasResponsible = !!issue.responsible_user_id;
  const hasAssignee = !!issue.assignee_type && !!issue.assignee_id;

  if (!hasResponsible && !hasAssignee) return null;

  const assigneeBadge = hasAssignee ? (
    <PersonBadge
      label={assigneeLabel}
      actorType={issue.assignee_type!}
      actorId={issue.assignee_id!}
      compact={compact}
    />
  ) : null;

  return (
    <span className="inline-flex min-w-0 shrink-0 items-center gap-1">
      {hasResponsible && (
        <PersonBadge
          label={responsibleLabel}
          actorType="member"
          actorId={issue.responsible_user_id!}
          compact={compact}
        />
      )}
      {assigneeBadge &&
        (editableAssignee && onAssigneeUpdate ? (
          <PickerWrapper>
            <AssigneePicker
              assigneeType={issue.assignee_type}
              assigneeId={issue.assignee_id}
              onUpdate={onAssigneeUpdate}
              trigger={assigneeBadge}
            />
          </PickerWrapper>
        ) : (
          assigneeBadge
        ))}
    </span>
  );
}
