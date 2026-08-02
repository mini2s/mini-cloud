"use client";

import { useEffect, useMemo, useState } from "react";
import { GitBranch, Lock, Pencil, Plus, Trash2, UserMinus, UserRoundCog, X, Zap, Check } from "lucide-react";
import { toast } from "sonner";
import type {
  Agent,
  IssueAssigneeType,
  UpdateIssueRequest,
  Workflow,
  WorkflowRoleKey,
  WorkflowRuntimeSelectionPolicy,
} from "@multica/core/types";
import { BUILTIN_WORKFLOW_ROLES } from "@multica/core/types";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@multica/core/auth";
import { canAssignAgentToIssue } from "@multica/core/permissions";
import { useActorName } from "@multica/core/workspace/hooks";
import { useWorkspaceId } from "@multica/core/hooks";
import { memberListOptions, agentListOptions, squadListOptions, assigneeFrequencyOptions } from "@multica/core/workspace/queries";
import { isActiveWorkspaceMember } from "@multica/core/workspace/members";
import { workflowActiveListOptions } from "@multica/core/workflows/queries";
import { runtimeListOptions } from "@multica/core/runtimes/queries";
import { ActorAvatar } from "../../../common/actor-avatar";
import {
  PropertyPicker,
  PickerItem,
  PickerSection,
  PickerEmpty,
} from "./property-picker";
import { useT } from "../../../i18n";
import { matchesPinyin } from "../../../editor/extensions/pinyin-match";
import { RuntimeSelectDialog } from "../../../agents/components/runtime-select-dialog";
import {
  WorkflowRuntimeStrategyDialog,
  type WorkflowRuntimeStrategyValue,
} from "../../../workflows/components/workflow-runtime-strategy-dialog";
import { useUsableWorkflowRuntimes } from "../../../workflows/components/use-usable-workflow-runtimes";

/**
 * Legacy boolean shape kept around for callers (e.g. `use-issue-actions.ts`)
 * that haven't migrated to the new `canAssignAgentToIssue` Decision API yet.
 * Internally redirects to the canonical rule so behaviour stays in sync.
 */
export function canAssignAgent(
  agent: Agent,
  userId: string | undefined,
  memberRole: string | undefined,
): boolean {
  return canAssignAgentToIssue(agent, {
    userId: userId ?? null,
    role: memberRole === "owner" || memberRole === "admin" || memberRole === "member"
      ? memberRole
      : null,
  }).allowed;
}

export function AssigneePicker({
  assigneeType,
  assigneeId,
  onUpdate,
  isWorkflowRunning = false,
  trigger: customTrigger,
  triggerRender,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  align,
  skipBuiltinRuntimeSelection = false,
  includeWorkflows = true,
  role,
  onRoleChange,
  roleLabels,
  customRoles,
  onAddCustomRole,
  onDeleteCustomRole,
  onRenameCustomRole,
  allowedTypes,
  agentFilter,
  allowUnassigned = true,
  ariaLabel,
  emptyTriggerLabel,
}: {
  assigneeType: IssueAssigneeType | null;
  assigneeId: string | null;
  onUpdate: (updates: Partial<UpdateIssueRequest>) => void;
  /** When true, a workflow run is in progress. Changing the assignee will be blocked. */
  isWorkflowRunning?: boolean;
  trigger?: React.ReactNode;
  triggerRender?: React.ReactElement;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  align?: "start" | "center" | "end";
  /** When true, selecting a built-in agent will NOT show the runtime selection dialog.
   *  Use this in contexts like workflow editor where runtime is chosen at execution time. */
  skipBuiltinRuntimeSelection?: boolean;
  /** Workflow node actor pickers only support members, agents, squads, and role placeholders. */
  includeWorkflows?: boolean;
  /** When provided, role options appear as the first section in the dropdown. */
  role?: WorkflowRoleKey | null;
  onRoleChange?: (role: WorkflowRoleKey | null) => void;
  roleLabels?: Record<string, string>;
  /** Custom roles persisted at the workflow level. */
  customRoles?: string[];
  onAddCustomRole?: (name: string) => WorkflowRoleKey | null | void;
  onDeleteCustomRole?: (name: string) => void;
  onRenameCustomRole?: (oldName: string, newName: string) => void;
  /** When set, only show the specified assignee type sections. Undefined = show all. */
  allowedTypes?: IssueAssigneeType[];
  /** Optional context-specific filter for agent options. */
  agentFilter?: (agent: Agent) => boolean;
  /** Whether the picker offers an explicit unassigned option. */
  allowUnassigned?: boolean;
  /** Accessible label for an embedded picker trigger. */
  ariaLabel?: string;
  /** Optional trigger label shown when no assignee is selected. */
  emptyTriggerLabel?: string;
}) {
  const { t } = useT("issues");
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;
  const [filter, setFilter] = useState("");
  // Inline input state for adding a new custom role
  const [addingRole, setAddingRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [confirmingDeleteRole, setConfirmingDeleteRole] = useState<string | null>(null);
  // Inline edit state for renaming a custom role
  const [editingRoleName, setEditingRoleName] = useState<string | null>(null);
  const [editRoleValue, setEditRoleValue] = useState("");
  const normalizedCustomRoles = useMemo(
    () => Array.from(new Set((customRoles ?? []).map((r) => r.trim()).filter(Boolean))),
    [customRoles],
  );
  // Collect built-in role label values (i18n display names like "测试", "研发")
  // so we can detect when a user tries to create a custom role with the same name.
  const builtinLabelValues = useMemo(
    () => new Set(Object.values(roleLabels ?? {}).map((v) => v.toLowerCase())),
    [roleLabels],
  );

  // Reset transient state when the picker closes, regardless of how it closed
  // (click-outside, Escape, trigger click, or internal setOpen(false) from selecting an item).
  useEffect(() => {
    if (!open) {
      setFilter("");
      setConfirmingDeleteRole(null);
      setEditingRoleName(null);
    }
  }, [open]);

  const handleConfirmRole = () => {
    if (!onAddCustomRole) return;
    const normalized = newRoleName.trim().replace(/\s+/g, " ");
    if (!normalized) return;
    const normalizedLower = normalized.toLowerCase();
    // Check against built-in role keys (e.g. "qa")
    if (BUILTIN_WORKFLOW_ROLES.some((r) => r.toLowerCase() === normalizedLower)) {
      toast.error(t(($) => $.pickers.assignee.role_builtin_duplicate));
      return;
    }
    // Check against built-in role i18n labels (e.g. "测试", "研发")
    if (builtinLabelValues.has(normalizedLower)) {
      toast.error(t(($) => $.pickers.assignee.role_builtin_duplicate));
      return;
    }
    if (normalizedCustomRoles.some((r) => r.toLowerCase() === normalizedLower)) {
      toast.error(t(($) => $.pickers.assignee.role_duplicate));
      return;
    }
    const createdRole = onAddCustomRole(normalized) ?? normalized;
    onRoleChange?.(createdRole as WorkflowRoleKey);
    setNewRoleName("");
    setAddingRole(false);
  };

  const handleCancelAddRole = () => {
    setNewRoleName("");
    setAddingRole(false);
  };

  const handleConfirmRename = (oldName: string) => {
    if (!onRenameCustomRole) return;
    const normalized = editRoleValue.trim().replace(/\s+/g, " ");
    if (!normalized) return;
    if (normalized === oldName) {
      setEditingRoleName(null);
      setEditRoleValue("");
      return;
    }
    const normalizedLower = normalized.toLowerCase();
    if (BUILTIN_WORKFLOW_ROLES.some((r) => r.toLowerCase() === normalizedLower)) {
      toast.error(t(($) => $.pickers.assignee.role_builtin_duplicate));
      return;
    }
    if (builtinLabelValues.has(normalizedLower)) {
      toast.error(t(($) => $.pickers.assignee.role_builtin_duplicate));
      return;
    }
    // Check against other custom roles (excluding the one being renamed)
    if (normalizedCustomRoles.some((r) => r !== oldName && r.toLowerCase() === normalizedLower)) {
      toast.error(t(($) => $.pickers.assignee.role_duplicate));
      return;
    }
    onRenameCustomRole(oldName, normalized);
    setEditingRoleName(null);
    setEditRoleValue("");
  };

  const handleCancelRename = () => {
    setEditingRoleName(null);
    setEditRoleValue("");
  };
  const user = useAuthStore((s) => s.user);
  const wsId = useWorkspaceId();
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: squads = [] } = useQuery(squadListOptions(wsId));
  const { data: activeWorkflows = [] } = useQuery(workflowActiveListOptions(wsId));
  const { data: frequency = [] } = useQuery(assigneeFrequencyOptions(wsId));
  const { data: runtimes = [] } = useQuery(runtimeListOptions(wsId));
  const usableWorkflowRuntimes = useUsableWorkflowRuntimes(runtimes);
  const { getActorName, getMemberName } = useActorName();

  // Guard: prevent changing assignee while a workflow run is in progress.
  const guardedUpdate = (updates: Partial<UpdateIssueRequest>) => {
    if (
      isWorkflowRunning &&
      assigneeType === "workflow" &&
      updates.assignee_type !== undefined &&
      !(updates.assignee_type === "workflow" && updates.assignee_id === assigneeId)
    ) {
      toast.error(t(($) => $.pickers.assignee.workflow_running));
      return;
    }
    onUpdate(updates);
  };

  // Built-in agent runtime selection dialog state
  const [pendingBuiltinAgent, setPendingBuiltinAgent] = useState<Agent | null>(null);

  // Workflow runtime selection dialog state
  const [pendingWorkflowRuntime, setPendingWorkflowRuntime] = useState<{
    workflowId: string;
    workflowTitle: string;
    defaultPolicy: WorkflowRuntimeSelectionPolicy;
    defaultRuntimeId: string | null;
  } | null>(null);

  const currentMember = members.find((m) => m.user_id === user?.id);
  const memberRole = currentMember?.role;

  // Build a lookup map from frequency data for sorting.
  const freqMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of frequency) {
      map.set(`${entry.assignee_type}:${entry.assignee_id}`, entry.frequency);
    }
    return map;
  }, [frequency]);

  const getFreq = (type: string, id: string) => freqMap.get(`${type}:${id}`) ?? 0;

  const query = filter.trim().toLowerCase();
  const filteredMembers = members
    .filter((m) => !!m.user_id && isActiveWorkspaceMember(m))
    .filter((m) => m.name.toLowerCase().includes(query) || matchesPinyin(m.name, query))
    .sort((a, b) => getFreq("member", b.user_id) - getFreq("member", a.user_id));
  const filteredAgents = agents
    .filter((a) => !a.archived_at)
    .filter((a) => agentFilter ? agentFilter(a) : true)
    .filter((a) => a.name.toLowerCase().includes(query) || matchesPinyin(a.name, query))
    .sort((a, b) => getFreq("agent", b.id) - getFreq("agent", a.id));
  const filteredSquads = squads
    .filter((s) => !s.archived_at && (s.name.toLowerCase().includes(query) || matchesPinyin(s.name, query)))
    .sort((a, b) => getFreq("squad", b.id) - getFreq("squad", a.id));
  const filteredWorkflows = activeWorkflows
    .filter((w) => w.title.toLowerCase().includes(query) || matchesPinyin(w.title, query))
    .sort((a, b) => getFreq("workflow", b.id) - getFreq("workflow", a.id));
  const roleMatchesQuery = (value: string) =>
    !query || value.toLowerCase().includes(query) || matchesPinyin(value, query);
  const filteredBuiltinRoles = BUILTIN_WORKFLOW_ROLES.filter((r) =>
    roleMatchesQuery(r) || roleMatchesQuery(roleLabels?.[r] ?? r),
  );
  const filteredCustomRoles = normalizedCustomRoles.filter((r) => roleMatchesQuery(r));
  const hasRoleResults = Boolean(onRoleChange && roleLabels) &&
    (filteredBuiltinRoles.length > 0 || filteredCustomRoles.length > 0);

  const isSelected = (type: string, id: string) =>
    assigneeType === type && assigneeId === id;

  const emptyLabel = emptyTriggerLabel ?? t(($) => $.pickers.assignee.trigger_unassigned);
  const triggerLabel =
    role && roleLabels
      ? (roleLabels[role] ?? role)
      : assigneeType && assigneeId
        ? getActorName(assigneeType, assigneeId)
        : emptyLabel;

  // Handle clicking a built-in agent: show runtime dialog if >1 runtimes,
  // auto-select if exactly 1, fall through without runtime if 0.
  // When skipBuiltinRuntimeSelection is true, just assign the agent directly.
  const handleBuiltinAgentClick = (agent: Agent) => {
    if (skipBuiltinRuntimeSelection) {
      guardedUpdate({
        assignee_type: "agent",
        assignee_id: agent.id,
      });
      setOpen(false);
      return;
    }
    const onlineRuntimes = runtimes.filter((r) => r.status === "online");
    if (onlineRuntimes.length === 1) {
      // Single runtime: auto-select and close picker
      guardedUpdate({
        assignee_type: "agent",
        assignee_id: agent.id,
        runtime_id: onlineRuntimes[0]!.id,
      });
      setOpen(false);
    } else if (onlineRuntimes.length > 1) {
      // Multiple runtimes: show selection dialog
      setPendingBuiltinAgent(agent);
    } else {
      // No runtimes: proceed without runtime (backend will try auto-select)
      guardedUpdate({
        assignee_type: "agent",
        assignee_id: agent.id,
      });
      setOpen(false);
    }
  };

  const handleRuntimeConfirm = (runtimeId: string | null) => {
    if (!pendingBuiltinAgent) return;
    if (!runtimeId) return;
    guardedUpdate({
      assignee_type: "agent",
      assignee_id: pendingBuiltinAgent.id,
      runtime_id: runtimeId,
    });
    setPendingBuiltinAgent(null);
    setOpen(false);
  };

  const handleWorkflowClick = (workflow: Workflow) => {
    setPendingWorkflowRuntime({
      workflowId: workflow.id,
      workflowTitle: workflow.title,
      defaultPolicy: workflow.default_runtime_selection_policy,
      defaultRuntimeId: workflow.default_runtime_id,
    });
  };

  const handleWorkflowRuntimeConfirm = ({ policy, runtimeId }: WorkflowRuntimeStrategyValue) => {
    if (!pendingWorkflowRuntime) return;
    guardedUpdate({
      assignee_type: "workflow",
      assignee_id: pendingWorkflowRuntime.workflowId,
      runtime_id: runtimeId,
      runtime_selection_policy: policy,
    });
    setPendingWorkflowRuntime(null);
    setOpen(false);
  };

  return (
    <>
      <PropertyPicker
      open={open}
      onOpenChange={(v: boolean) => {
        setOpen(v);
      }}
      width="w-64"
      align={align}
      searchable
      searchPlaceholder={t(($) => $.pickers.assignee.search_placeholder)}
      onSearchChange={setFilter}
      triggerRender={triggerRender}
      trigger={
        <span aria-label={ariaLabel} className="contents">
        {customTrigger ? customTrigger : role ? (
          <>
            <UserRoundCog className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="truncate">{triggerLabel}</span>
          </>
        ) : assigneeType && assigneeId ? (
          <>
            <ActorAvatar actorType={assigneeType} actorId={assigneeId} size={18} enableHoverCard showStatusDot />
            <span className="truncate">{triggerLabel}</span>
          </>
        ) : (
          <span className="text-muted-foreground">{emptyLabel}</span>
        )}
        </span>
      }
    >
      {/* Unassigned option — hidden when search is active */}
      {allowUnassigned && !query && (
        <PickerItem
          selected={!role && !assigneeType && !assigneeId}
          onClick={() => {
            onRoleChange?.(null);
            guardedUpdate({ assignee_type: null, assignee_id: null });
            setOpen(false);
          }}
        >
          <UserMinus className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">{t(($) => $.pickers.assignee.trigger_unassigned)}</span>
        </PickerItem>
      )}

      {/* Workflows */}
      {(!allowedTypes || allowedTypes.includes("workflow")) && includeWorkflows && filteredWorkflows.length > 0 && (
        <PickerSection label={t(($) => $.pickers.assignee.workflows_group)}>
          {filteredWorkflows.map((w) => (
            <PickerItem
              key={w.id}
              selected={isSelected("workflow", w.id)}
              onClick={() => {
                handleWorkflowClick(w);
              }}
            >
              <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="truncate" title={w.title}>{w.title}</span>
            </PickerItem>
          ))}
        </PickerSection>
      )}

      {/* Agents */}
      {(!allowedTypes || allowedTypes.includes("agent")) && filteredAgents.length > 0 && (
        <PickerSection label={t(($) => $.pickers.assignee.agents_group)}>
          {filteredAgents.map((a) => {
            const decision = canAssignAgentToIssue(a, {
              userId: user?.id ?? null,
              role:
                memberRole === "owner" ||
                memberRole === "admin" ||
                memberRole === "member"
                  ? memberRole
                  : null,
            });
            const allowed = decision.allowed;
            return (
              <PickerItem
                key={a.id}
                selected={isSelected("agent", a.id)}
                disabled={!allowed}
                tooltip={!allowed ? decision.message : undefined}
                onClick={() => {
                  if (!allowed) return;
                  if (a.is_builtin) {
                    handleBuiltinAgentClick(a);
                  } else {
                    guardedUpdate({
                      assignee_type: "agent",
                      assignee_id: a.id,
                    });
                    setOpen(false);
                  }
                }}
              >
                <ActorAvatar actorType="agent" actorId={a.id} size={18} showStatusDot />
                <span className={`truncate ${allowed ? "" : "text-muted-foreground"}`}>{a.name}</span>
                {a.is_builtin && (
                  <span className="ml-auto shrink-0 inline-flex items-center gap-0.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                    <Zap className="h-2.5 w-2.5" />
                    {t(($) => $.pickers.assignee.builtin_label)}
                  </span>
                )}
                {a.visibility === "private" && !a.is_builtin && (
                  <Lock className="ml-auto h-3 w-3 text-muted-foreground" />
                )}
                {a.visibility === "private" && a.is_builtin && (
                  <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
                )}
              </PickerItem>
            );
          })}
        </PickerSection>
      )}

      {/* Members */}
      {(!allowedTypes || allowedTypes.includes("member")) && filteredMembers.length > 0 && (
        <PickerSection label={t(($) => $.pickers.assignee.members_group)}>
          {filteredMembers.map((m) => (
            <PickerItem
              key={m.user_id}
              selected={isSelected("member", m.user_id)}
              onClick={() => {
                guardedUpdate({
                  assignee_type: "member",
                  assignee_id: m.user_id,
                });
                setOpen(false);
              }}
            >
              <ActorAvatar actorType="member" actorId={m.user_id} size={18} />
              <span className="truncate">{m.name}</span>
            </PickerItem>
          ))}
        </PickerSection>
      )}

      {/* Role placeholders — shown below Members, hidden when search is active */}
      {(hasRoleResults || (!query && onRoleChange && roleLabels)) && onRoleChange && roleLabels && (
        <PickerSection
          label={t(($) => $.pickers.assignee.role_label)}
          action={
            onAddCustomRole && !addingRole && !query ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium normal-case tracking-normal text-primary hover:bg-accent transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  setAddingRole(true);
                  setNewRoleName("");
                  setConfirmingDeleteRole(null);
                }}
                aria-label={t(($) => $.pickers.assignee.add_role_action)}
              >
                <Plus className="h-3 w-3" />
                {t(($) => $.pickers.assignee.add_role_action)}
              </button>
            ) : undefined
          }
        >
          {/* Inline input for adding a new custom role */}
          {addingRole && onAddCustomRole && (
            <div className="mx-2 mb-1 rounded-md border border-dashed border-border bg-muted/30 p-2">
              <div className="mb-1 text-[11px] font-medium text-muted-foreground">
                {t(($) => $.pickers.assignee.add_role_title)}
              </div>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  name="workflow-role-name"
                  autoComplete="off"
                  aria-label={t(($) => $.pickers.assignee.add_role_title)}
                  className="flex-1 h-7 rounded border border-input bg-background px-2 text-sm placeholder:text-muted-foreground outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/40"
                  placeholder={t(($) => $.pickers.assignee.add_role_placeholder)}
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleConfirmRole();
                    else if (e.key === "Escape") handleCancelAddRole();
                  }}
                  onBlur={() => {
                    if (!newRoleName.trim()) handleCancelAddRole();
                  }}
                  autoFocus
                />
                <button
                  type="button"
                  disabled={!newRoleName.trim()}
                  className="inline-flex items-center justify-center h-6 w-6 rounded hover:bg-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  onClick={handleConfirmRole}
                  aria-label={t(($) => $.pickers.assignee.confirm_role_edit)}
                >
                  <Check className="h-3.5 w-3.5 text-green-600" />
                </button>
                <button
                  type="button"
                  className="inline-flex items-center justify-center h-6 w-6 rounded hover:bg-accent transition-colors"
                  onClick={handleCancelAddRole}
                  aria-label={t(($) => $.pickers.assignee.cancel_role_edit)}
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                {t(($) => $.pickers.assignee.add_role_hint)}
              </p>
            </div>
          )}
          {/* Built-in roles */}
          {filteredBuiltinRoles.map((r) => (
            <PickerItem
              key={r}
              selected={role === r}
              onClick={() => {
                onRoleChange(role === r ? null : r);
                setOpen(false);
              }}
            >
              <UserRoundCog className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="truncate">{roleLabels[r]}</span>
              <span className="ml-auto shrink-0 inline-flex items-center gap-0.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                <Zap className="h-2.5 w-2.5" />
                {t(($) => $.pickers.assignee.builtin_label)}
              </span>
            </PickerItem>
          ))}
          {/* Custom roles — editable and deletable */}
          {filteredCustomRoles.map((cr) => {
            const selected = role === cr;
            const isEditing = editingRoleName === cr;

            if (isEditing) {
              return (
                <div
                  key={cr}
                  className="flex w-full items-center gap-2 rounded-md bg-accent/40 px-2 py-1.5 text-sm"
                >
                  <UserRoundCog className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <input
                    type="text"
                    name="workflow-role-rename"
                    autoComplete="off"
                    aria-label={t(($) => $.pickers.assignee.edit_role_action)}
                    className="h-6 min-w-0 flex-1 rounded border border-input bg-background px-2 text-sm outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/40"
                    value={editRoleValue}
                    onChange={(e) => setEditRoleValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleConfirmRename(cr);
                      else if (e.key === "Escape") handleCancelRename();
                    }}
                    onBlur={() => {
                      if (!editRoleValue.trim()) handleCancelRename();
                    }}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-accent disabled:opacity-30"
                    disabled={!editRoleValue.trim()}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleConfirmRename(cr);
                    }}
                    aria-label={t(($) => $.pickers.assignee.confirm_role_edit)}
                  >
                    <Check className="h-3.5 w-3.5 text-green-600" />
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-accent"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCancelRename();
                    }}
                    aria-label={t(($) => $.pickers.assignee.cancel_role_edit)}
                  >
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </div>
              );
            }

            return (
              <div
                key={cr}
                className="group/role flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
              >
                <button
                  type="button"
                  data-picker-item
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() => {
                    onRoleChange(selected ? null : cr);
                    setOpen(false);
                  }}
                >
                  <UserRoundCog className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{cr}</span>
                </button>

                {onDeleteCustomRole && !selected && confirmingDeleteRole === cr ? (
                  <button
                    type="button"
                    className="inline-flex shrink-0 items-center gap-0.5 rounded bg-destructive/10 px-1 py-0.5 text-[10px] font-medium text-destructive hover:bg-destructive/15"
                    onClick={() => {
                      onDeleteCustomRole(cr);
                      setConfirmingDeleteRole(null);
                    }}
                    aria-label={t(($) => $.pickers.assignee.delete_role_confirm)}
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                    {t(($) => $.pickers.assignee.delete_role_confirm)}
                  </button>
                ) : onRenameCustomRole || (onDeleteCustomRole && !selected) ? (
                  <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium">
                    <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1 py-0.5 text-amber-700 group-hover/role:hidden group-focus-within/role:hidden dark:bg-amber-900/30 dark:text-amber-400">
                      <Pencil className="h-2.5 w-2.5" />
                      {t(($) => $.pickers.assignee.custom_label)}
                    </span>
                    <span className="hidden items-center gap-1 group-hover/role:inline-flex group-focus-within/role:inline-flex">
                      {onRenameCustomRole && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1 py-0.5 text-amber-700 transition-colors hover:text-primary dark:bg-amber-900/30 dark:text-amber-400"
                          onClick={() => {
                            setEditingRoleName(cr);
                            setEditRoleValue(cr);
                            setConfirmingDeleteRole(null);
                          }}
                          aria-label={`${t(($) => $.pickers.assignee.edit_role_action)} ${cr}`}
                        >
                          <Pencil className="h-2.5 w-2.5" />
                          {t(($) => $.pickers.assignee.edit_role_action)}
                        </button>
                      )}
                      {onDeleteCustomRole && !selected && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1 py-0.5 text-amber-700 transition-colors hover:text-destructive dark:bg-amber-900/30 dark:text-amber-400"
                          onClick={() => setConfirmingDeleteRole(cr)}
                          aria-label={`${t(($) => $.pickers.assignee.delete_role_action)} ${cr}`}
                        >
                          <Trash2 className="h-2.5 w-2.5" />
                          {t(($) => $.pickers.assignee.delete_role_action)}
                        </button>
                      )}
                    </span>
                  </span>
                ) : (
                  <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                    <Pencil className="h-2.5 w-2.5" />
                    {t(($) => $.pickers.assignee.custom_label)}
                  </span>
                )}

                <Check
                  className={`h-3.5 w-3.5 shrink-0 text-muted-foreground ${selected ? "" : "invisible"}`}
                />
              </div>
            );
          })}
        </PickerSection>
      )}

      {/* Squads — group ownership; assigning to a squad routes the issue to
          its leader agent on the backend. */}
      {(!allowedTypes || allowedTypes.includes("squad")) && filteredSquads.length > 0 && (
        <PickerSection label={t(($) => $.pickers.assignee.squads_group)}>
          {filteredSquads.map((s) => (
            <PickerItem
              key={s.id}
              selected={isSelected("squad", s.id)}
              onClick={() => {
                guardedUpdate({
                  assignee_type: "squad",
                  assignee_id: s.id,
                });
                setOpen(false);
              }}
            >
              <ActorAvatar actorType="squad" actorId={s.id} size={18} />
              <span className="truncate">{s.name}</span>
            </PickerItem>
          ))}
        </PickerSection>
      )}

      {filteredMembers.length === 0 &&
        filteredAgents.length === 0 &&
        filteredSquads.length === 0 &&
        (!includeWorkflows || filteredWorkflows.length === 0) &&
        !hasRoleResults &&
        filter && <PickerEmpty />}
    </PropertyPicker>
    {pendingBuiltinAgent && (
      <RuntimeSelectDialog
        agentName={pendingBuiltinAgent.name}
        runtimes={runtimes.filter((runtime) => runtime.status === "online")}
        loading={false}
        onConfirm={handleRuntimeConfirm}
        onClose={() => {
          setPendingBuiltinAgent(null);
        }}
      />
    )}
    {pendingWorkflowRuntime && (
      <WorkflowRuntimeStrategyDialog
        mode="run"
        workflowTitle={pendingWorkflowRuntime.workflowTitle}
        initialValue={{
          policy: pendingWorkflowRuntime.defaultPolicy,
          runtimeId: pendingWorkflowRuntime.defaultRuntimeId,
        }}
        runtimes={usableWorkflowRuntimes.runtimes}
        loading={usableWorkflowRuntimes.isLoading}
        getMemberName={getMemberName}
        onConfirm={handleWorkflowRuntimeConfirm}
        onClose={() => {
          setPendingWorkflowRuntime(null);
        }}
      />
    )}
    </>
  );
}
