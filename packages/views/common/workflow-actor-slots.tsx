import { ActorAvatar } from "@multica/ui/components/common/actor-avatar";
import { cn } from "@multica/ui/lib/utils";
import { BadgeCheck, Braces, CircleDashed } from "lucide-react";

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
  const presence = identity.type === "agent" && identity.availability
    ? identity.availability === "online" ? "online" : "offline"
    : null;
  const avatar = (
    <ActorAvatar
      name={identity.name}
      initials={identity.initials || identity.name.slice(0, 2).toUpperCase()}
      avatarUrl={identity.avatarUrl}
      isAgent={identity.type === "agent"}
      isSquad={identity.type === "squad"}
      size={24}
      className={cn(
        identity.type === "agent" && identity.availability === "online" &&
          "bg-primary/10 text-primary",
      )}
    />
  );
  if (!presence) return avatar;

  return (
    <span className="relative inline-flex shrink-0">
      {avatar}
      <span
        role="img"
        aria-label={identity.availabilityLabel}
        title={identity.availabilityLabel}
        data-workflow-actor-presence={presence}
        className={cn(
          "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background transition-colors duration-200",
          presence === "online" ? "bg-[var(--success)]" : "bg-muted-foreground/55",
        )}
      />
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
            </span>
          ) : null}
        </span>
      </span>
    </div>
  );
}
