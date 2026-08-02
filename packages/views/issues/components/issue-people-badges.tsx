"use client";

import type { ReactNode, SyntheticEvent } from "react";
import type { Issue, UpdateIssueRequest } from "@multica/core/types";
import { useActorName } from "@multica/core/workspace/hooks";
import { ArrowRight } from "lucide-react";
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
  actorName: string;
  compact?: boolean;
}

function PersonBadge({ label, actorName, compact = false }: PersonBadgeProps) {
  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1.5 ${
        compact ? "text-[11px]" : "text-xs"
      }`}
      title={`${label}: ${actorName}`}
    >
      <span className="min-w-0 truncate">
        <span className="text-muted-foreground/70">{label}</span>
        <span className="mx-1 text-muted-foreground/40">/</span>
        <span className="font-medium text-foreground/80">{actorName}</span>
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

  const avatarStack = (
    <span className="flex shrink-0 -space-x-1">
      {hasResponsible && (
        <ActorAvatar
          actorType="member"
          actorId={issue.responsible_user_id!}
          size={compact ? 18 : 20}
          className="ring-2 ring-card"
          enableHoverCard
        />
      )}
      {hasAssignee && (
        <ActorAvatar
          actorType={issue.assignee_type!}
          actorId={issue.assignee_id!}
          size={compact ? 18 : 20}
          className="ring-2 ring-card"
          enableHoverCard
          showStatusDot={issue.assignee_type === "agent"}
        />
      )}
    </span>
  );

  const assigneeBadge = hasAssignee ? (
    <PersonBadge
      label={assigneeLabel}
      actorName={assigneeName!}
      compact={compact}
    />
  ) : null;

  if (compact) {
    return (
      <span className="group/people inline-flex min-w-0 shrink-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-muted-foreground transition-colors hover:bg-muted/60 focus-within:bg-muted/60">
        {avatarStack}
        <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-150 group-hover/people:max-w-56 group-hover/people:opacity-100 group-focus-within/people:max-w-56 group-focus-within/people:opacity-100">
          <span className="inline-flex min-w-0 items-center gap-1 text-[11px]">
            {hasResponsible && (
              <span className="truncate">
                <span className="text-muted-foreground/70">{responsibleLabel}</span>
                <span className="mx-1 text-muted-foreground/40">/</span>
                <span className="font-medium text-foreground/80">{responsibleName}</span>
              </span>
            )}
            {hasResponsible && hasAssignee && (
              <ArrowRight className="size-3 shrink-0 text-muted-foreground/40" />
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
        </span>
      </span>
    );
  }

  return (
    <span className="inline-flex min-w-0 max-w-full shrink items-center gap-1.5 rounded-md bg-muted/45 px-1.5 py-1 text-muted-foreground">
      {avatarStack}
      <span className="flex min-w-0 items-center gap-1.5">
        {hasResponsible && (
          <PersonBadge
            label={responsibleLabel}
            actorName={responsibleName!}
            compact={compact}
          />
        )}
        {hasResponsible && hasAssignee && (
          <ArrowRight className="size-3 shrink-0 text-muted-foreground/40" />
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
    </span>
  );
}
