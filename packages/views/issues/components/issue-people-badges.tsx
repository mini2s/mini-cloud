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
  actorName: string;
}

function PeopleTooltipRow({ actorName }: PeopleTooltipRowProps) {
  return (
    <span className="block min-w-0">
      <span className="block max-w-64 whitespace-normal break-words text-xs font-medium leading-snug text-foreground">
        {actorName}
      </span>
    </span>
  );
}

interface RolePersonProps {
  label: string;
  actorType: string;
  actorId: string;
  actorName: string;
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
  actorName,
  initials,
  compact,
  variant,
}: RolePersonProps) {
  const tooltipTitle = actorName;

  return (
    <span
      className="group/person relative inline-flex min-w-0 items-center gap-1 rounded-sm text-[11px] font-medium leading-none text-muted-foreground transition-transform hover:-translate-y-px focus-within:-translate-y-px"
      aria-label={tooltipTitle}
    >
      <span className="shrink-0">{label}</span>
      <ActorTypeTile
        actorType={actorType}
        actorId={actorId}
        initials={initials}
        compact={compact}
        variant={variant}
      />
      <span className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 hidden w-max max-w-64 rounded-md border border-border bg-popover px-2.5 py-1.5 text-popover-foreground shadow-md group-hover/person:block group-focus-within/person:block">
        <PeopleTooltipRow actorName={actorName} />
      </span>
    </span>
  );
}

interface IssuePeopleBadgesProps {
  issue: Issue;
  responsibleLabel: string;
  assigneeLabel: string;
  actorTypeLabels?: ActorTypeLabels;
  compact?: boolean;
  editableResponsible?: boolean;
  editableAssignee?: boolean;
  onResponsibleUpdate?: (updates: Partial<UpdateIssueRequest>) => void;
  onAssigneeUpdate?: (updates: Partial<UpdateIssueRequest>) => void;
}

export function IssuePeopleBadges({
  issue,
  responsibleLabel,
  assigneeLabel,
  compact = false,
  editableResponsible = false,
  editableAssignee = false,
  onResponsibleUpdate,
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
  const responsiblePerson = hasResponsible ? (
    <RolePerson
      label={responsibleLabel}
      actorType="member"
      actorId={issue.responsible_user_id!}
      actorName={responsibleName!}
      initials={responsibleInitials!}
      compact={compact}
      variant="responsible"
    />
  ) : null;
  const assigneePerson = hasAssignee ? (
    <RolePerson
      label={assigneeLabel}
      actorType={issue.assignee_type!}
      actorId={issue.assignee_id!}
      actorName={assigneeName!}
      initials={assigneeInitials!}
      compact={compact}
      variant="assignee"
    />
  ) : null;
  const rolePeople = (
    <span className="inline-flex shrink-0 items-center gap-2">
      {responsiblePerson &&
        (editableResponsible && onResponsibleUpdate ? (
          <PickerWrapper>
            <AssigneePicker
              assigneeType="member"
              assigneeId={issue.responsible_user_id!}
              onUpdate={(updates) =>
                onResponsibleUpdate({ responsible_user_id: updates.assignee_id ?? null })
              }
              trigger={responsiblePerson}
              triggerRender={
                <span className="inline-flex cursor-pointer overflow-visible rounded px-1 -mx-1 transition-colors hover:bg-accent/30" />
              }
              allowedTypes={["member"]}
              allowUnassigned={false}
            />
          </PickerWrapper>
        ) : (
          responsiblePerson
        ))}
      {assigneePerson && (
        editableAssignee && onAssigneeUpdate ? (
          <PickerWrapper>
            <AssigneePicker
              assigneeType={issue.assignee_type}
              assigneeId={issue.assignee_id}
              onUpdate={onAssigneeUpdate}
              trigger={assigneePerson}
              triggerRender={
                <span className="inline-flex cursor-pointer overflow-visible rounded px-1 -mx-1 transition-colors hover:bg-accent/30" />
              }
            />
          </PickerWrapper>
        ) : (
          assigneePerson
        )
      )}
    </span>
  );

  return (
    <span className="inline-flex shrink-0 items-center">
      {rolePeople}
    </span>
  );
}
