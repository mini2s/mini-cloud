import { cn } from "@multica/ui/lib/utils";

export type WorkflowActorSlotKind = "worker" | "critic";
export type WorkflowActorState = "configured" | "optional" | "missing" | "pending";

interface WorkflowActorSlotProps {
  slot: WorkflowActorSlotKind;
  label: string;
  name: string | null | undefined;
  fallback: string;
  state: WorkflowActorState;
  testId?: string;
  className?: string;
}

function stateClassName(state: WorkflowActorState): string {
  switch (state) {
    case "configured":
      return "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]";
    case "pending":
      return "bg-blue-500 shadow-[0_0_0_3px_rgba(59,130,246,0.12)]";
    case "missing":
      return "bg-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.12)]";
    case "optional":
    default:
      return "bg-muted-foreground/45";
  }
}

export function WorkflowActorSlot({
  slot,
  label,
  name,
  fallback,
  state,
  testId,
  className,
}: WorkflowActorSlotProps) {
  const displayName = name?.trim() || fallback;
  const configured = state === "configured" || state === "pending";

  return (
    <div
      data-testid={testId}
      data-workflow-actor-slot={slot}
      className={cn("grid row-span-2 min-w-0 grid-rows-subgrid gap-1", className)}
    >
      <span className="block text-[9px] font-bold uppercase leading-3 text-muted-foreground">
        {label}
      </span>
      <span className="flex min-w-0 items-start gap-1.5 text-[11px] leading-4">
        <span
          aria-hidden="true"
          data-workflow-actor-state={state}
          className={cn("mt-[5px] size-1.5 shrink-0 rounded-full", stateClassName(state))}
        />
        <span
          className={cn(
            "min-w-0 break-words font-medium leading-4 text-foreground/85 line-clamp-2",
            !configured && "italic text-muted-foreground",
          )}
          title={displayName}
        >
          {displayName}
        </span>
      </span>
    </div>
  );
}
