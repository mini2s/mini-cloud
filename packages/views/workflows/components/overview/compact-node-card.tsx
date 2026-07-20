"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WorkflowNode, WorkflowRole } from "@multica/core/types";
import type { BuiltinPlugin } from "@multica/core/api/schemas";
import { useWorkspaceId } from "@multica/core/hooks";
import { workflowRolesOptions } from "@multica/core/workflows/queries";
import { cn } from "@multica/ui/lib/utils";
import { useT } from "../../../i18n";

export interface CompactNodeCardProps {
  node: WorkflowNode;
  workerName: string | null;
  plugin: BuiltinPlugin | null;
  onClick: (nodeId: string, focus: "worker") => void;
  isSelected?: boolean;
  elementRef?: (el: HTMLButtonElement | null) => void;
}

export function CompactNodeCard({
  node,
  workerName,
  plugin,
  onClick,
  isSelected = false,
  elementRef,
}: CompactNodeCardProps) {
  const { t } = useT("workflows");
  const wsId = useWorkspaceId();
  const { data: workflowRoles = [] } = useQuery(workflowRolesOptions(wsId));
  const roleById = useMemo(
    () => new Map(workflowRoles.map((role) => [role.id, role])),
    [workflowRoles],
  );

  const renderRoleName = (
    role: WorkflowRole | undefined,
    rawKey?: string | null,
  ): string | undefined => {
    if (role) {
      if (!role.is_builtin) return role.name;
      if (role.name === "developer") return t(($) => $.builtin_roles.developer.name);
      if (role.name === "qa") return t(($) => $.builtin_roles.qa.name);
      if (role.name === "tech_lead") return t(($) => $.builtin_roles.tech_lead.name);
      return role.name;
    }
    if (rawKey) {
      if (rawKey === "developer") return t(($) => $.builtin_roles.developer.name);
      if (rawKey === "qa") return t(($) => $.builtin_roles.qa.name);
      if (rawKey === "tech_lead") return t(($) => $.builtin_roles.tech_lead.name);
      return rawKey;
    }
    return undefined;
  };

  const displayName = plugin?.name ?? node.title;
  const hasRole = Boolean(node.worker_role_id || node.worker_role);

  const subtitleLabel = (() => {
    if (workerName) {
      return hasRole ? `${t(($) => $.node.role_placeholder_label)} · ${workerName}` : workerName;
    }
    if (node.worker_role_id) {
      const resolved = renderRoleName(roleById.get(node.worker_role_id));
      return `${t(($) => $.node.role_placeholder_label)} · ${resolved ?? node.worker_role_id}`;
    }
    if (node.worker_role) {
      const resolved = renderRoleName(undefined, node.worker_role);
      return `${t(($) => $.node.role_placeholder_label)} · ${resolved ?? node.worker_role}`;
    }
    const wt = node.worker_type;
    const typeLabel =
      wt === "human" ? t(($) => $.node.worker_type_human)
      : wt === "squad" ? t(($) => $.node.worker_type_squad)
      : t(($) => $.node.worker_type_agent);
    return `${typeLabel} · ${t(($) => $.overview.detail_panel.not_configured)}`;
  })();

  return (
    <button
      type="button"
      data-testid={`compact-node-card-${node.id}`}
      onClick={() => onClick(node.id, "worker")}
      ref={elementRef}
      className={cn(
        "group flex h-16 w-56 shrink-0 flex-col gap-1.5 rounded-lg border border-slate-300/90 bg-white p-2.5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.08)] transition-all duration-150",
        "hover:-translate-y-0.5 hover:border-primary/45 hover:bg-background hover:shadow-[0_8px_20px_rgba(15,23,42,0.08)]",
        "active:translate-y-0 active:scale-[0.99]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        isSelected &&
          "border-primary/55 bg-background shadow-[inset_0_0_0_1px_rgba(59,130,246,0.08),0_2px_12px_rgba(15,23,42,0.06)]",
      )}
      aria-pressed={isSelected}
    >
      <span className="block truncate text-xs font-semibold text-foreground">
        {displayName}
      </span>

      <div className="mt-auto flex items-center gap-1.5">
        <span
          className={cn(
            "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
            hasRole ? "bg-amber-500" : workerName ? "bg-[var(--success)]" : "bg-muted-foreground/40",
          )}
        />
        <span className="truncate text-[11px] text-muted-foreground">
          {subtitleLabel}
        </span>
      </div>
    </button>
  );
}
