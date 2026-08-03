import { cn } from "@multica/ui/lib/utils";

interface WorkflowNodeTypeBadgeProps {
  label: string;
  testId?: string;
  className?: string;
}

export function WorkflowNodeTypeBadge({
  label,
  testId,
  className,
}: WorkflowNodeTypeBadgeProps) {
  return (
    <span
      data-testid={testId}
      data-workflow-node-type-badge="true"
      className={cn(
        "shrink-0 rounded-full border border-border/55 bg-background/70 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase leading-none text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]",
        className,
      )}
    >
      {label}
    </span>
  );
}
