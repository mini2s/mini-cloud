import { ActorAvatar } from "@multica/ui/components/common/actor-avatar";
import { cn } from "@multica/ui/lib/utils";
import { BadgeCheck, Braces, CircleDashed, Wifi, WifiOff } from "lucide-react";

export type WorkflowActorSlotKind = "worker" | "critic";
export type WorkflowActorState = "configured" | "optional" | "missing" | "pending";
export type WorkflowActorEntityType = "agent" | "member" | "squad" | "role" | "api";
export type WorkflowActorAvailability = "online" | "offline" | "unstable";

export interface WorkflowActorIdentity {
  type: WorkflowActorEntityType;
  id: string | null;
  name: string;
  typeLabel: string;
  initials?: string;
  avatarUrl?: string | null;
  availability?: WorkflowActorAvailability | null;
  availabilityLabel?: string;
}

interface WorkflowActorSlotProps {
  slot: WorkflowActorSlotKind;
  label: string;
  identity?: WorkflowActorIdentity | null;
  fallback: string;
  state: WorkflowActorState;
  testId?: string;
  className?: string;
}

function WorkflowActorGlyph({ type }: { type: "role" | "api" | "empty" }) {
  const Icon = type === "role" ? BadgeCheck : type === "api" ? Braces : CircleDashed;
  return (
    <span
      data-testid={`workflow-actor-glyph-${type}`}
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-md border",
        type === "empty"
          ? "border-dashed border-border/80 bg-muted/30 text-muted-foreground/70"
          : "border-border/70 bg-muted/55 text-muted-foreground",
      )}
      aria-hidden="true"
    >
      <Icon className="size-3.5" strokeWidth={1.8} />
    </span>
  );
}

function WorkflowActorVisual({ identity }: { identity: WorkflowActorIdentity | null | undefined }) {
  if (!identity) return <WorkflowActorGlyph type="empty" />;
  if (identity.type === "role" || identity.type === "api") {
    return <WorkflowActorGlyph type={identity.type} />;
  }
  return (
    <ActorAvatar
      name={identity.name}
      initials={identity.initials || identity.name.slice(0, 2).toUpperCase()}
      avatarUrl={identity.avatarUrl}
      isAgent={identity.type === "agent"}
      isSquad={identity.type === "squad"}
      size={24}
    />
  );
}

function WorkflowActorAvailabilityMeta({ identity }: { identity: WorkflowActorIdentity }) {
  if (identity.type !== "agent" || !identity.availability || !identity.availabilityLabel) {
    return null;
  }
  const online = identity.availability === "online";
  const Icon = online ? Wifi : WifiOff;
  return (
    <span
      data-workflow-actor-availability={identity.availability}
      className={cn(
        "inline-flex min-w-0 items-center gap-0.5 font-medium",
        online ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground",
      )}
    >
      <Icon
        data-workflow-availability-icon={online ? "online" : "offline"}
        className="size-2.5 shrink-0"
        strokeWidth={2}
        aria-hidden="true"
      />
      <span>{identity.availabilityLabel}</span>
    </span>
  );
}

export function WorkflowActorSlot({
  slot,
  label,
  identity,
  fallback,
  state,
  testId,
  className,
}: WorkflowActorSlotProps) {
  const displayName = identity?.name.trim() || fallback;
  const configured = state === "configured" || state === "pending";

  return (
    <div
      data-testid={testId}
      data-workflow-actor-slot={slot}
      data-workflow-actor-type={identity?.type}
      data-workflow-actor-availability={identity?.availability || undefined}
      className={cn("grid row-span-2 min-w-0 grid-rows-subgrid gap-1", className)}
    >
      <span className="block text-[9px] font-bold uppercase leading-3 text-muted-foreground">
        {label}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4">
        <WorkflowActorVisual identity={identity} />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block min-w-0 truncate font-medium leading-4 text-foreground/90",
              !configured && "italic text-muted-foreground",
            )}
            title={displayName}
          >
            {displayName}
          </span>
          {identity ? (
            <span className="flex min-w-0 items-center gap-1 text-[9px] leading-3 text-muted-foreground">
              <span className="min-w-0 shrink truncate font-semibold" title={identity.typeLabel}>
                {identity.typeLabel}
              </span>
              <WorkflowActorAvailabilityMeta identity={identity} />
            </span>
          ) : null}
        </span>
      </span>
    </div>
  );
}
