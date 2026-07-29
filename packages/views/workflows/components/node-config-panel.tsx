"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Bot,
  Braces,
  GitBranch,
	GitFork,
	Play,
  Plus,
  ShieldCheck,
  Save,
  Trash2,
  User,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { Label } from "@multica/ui/components/ui/label";
import { useT } from "../../i18n";
import { useNavigation } from "../../navigation";
import { useWorkspacePaths } from "@multica/core/paths";
import { useWorkspaceId } from "@multica/core/hooks";
import { useActorName } from "@multica/core/workspace/hooks";
import {
  useCreateStage,
  useDeleteNode,
  useAssignNodeToStage,
  workflowRolesOptions,
} from "@multica/core/workflows/queries";
import { useWorkflowEditorStore } from "@multica/core/workflows/store";
import { AssigneePicker } from "../../issues/components/pickers/assignee-picker";
import { isBoundaryNode, parseNodeFormat, type WorkflowNode, type WorkflowNodeRun, type WorkflowStage, type WorkerType, type CriticType, type SplitConfig } from "@multica/core/types";
import type { IssueAssigneeType } from "@multica/core/types/issue";
import {
  NodeDetailSection,
  WorkflowNodeDetailPanelShell,
} from "../../common/workflow-node-detail-panel-shell";
import { SplitConfigPanel } from "./split/split-config-panel";

function fromAssigneeType(t: IssueAssigneeType | null): WorkerType {
  if (t === "member") return "human";
  if (t === "agent") return "agent";
  if (t === "squad") return "squad";
  return "human";
}

function fromAssigneeTypeCritic(t: IssueAssigneeType | null): CriticType {
  if (t === "member") return "human";
  if (t === "agent") return "agent";
  if (t === "squad") return "squad";
  return "human";
}

type ParticipantCategory = "human" | "agent" | "role" | "squad";

function participantCategory(type: string, roleId: string | null): ParticipantCategory {
  if (roleId) return "role";
  if (type === "agent" || type === "squad") return type;
  return "human";
}

function categoryAssigneeType(category: Exclude<ParticipantCategory, "role">): IssueAssigneeType {
  return category === "human" ? "member" : category;
}

function statusTone(status: string | null | undefined): "default" | "success" | "warning" | "danger" {
  if (!status) return "default";
  if (status === "completed" || status === "critic_approved" || status === "format_ok") return "success";
  if (status === "failed" || status === "blocked" || status === "cancelled" || status === "critic_rework" || status === "format_failed") return "danger";
  if (status === "working" || status === "critic_reviewing" || status === "awaiting_critic" || status === "awaiting_input") return "warning";
  return "default";
}

function statusClasses(tone: "default" | "success" | "warning" | "danger"): string {
  if (tone === "danger") return "text-destructive";
  if (tone === "warning") return "text-foreground";
  return "text-muted-foreground";
}

function StatusBadge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  return (
    <span className={`inline-flex min-h-5 shrink-0 items-center gap-1 text-[11px] font-medium ${statusClasses(tone)}`}>
      {children}
    </span>
  );
}

function InspectorSection({
  icon,
  title,
  subtitle,
  status,
  children,
  className = "",
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  status?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-2.5 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-muted-foreground">
            {icon}
          </span>
          <div className="min-w-0">
            <h4 className="text-sm font-medium leading-none">{title}</h4>
            {subtitle ? <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{subtitle}</p> : null}
          </div>
        </div>
        {status}
      </div>
      {children ? <div className="space-y-3">{children}</div> : null}
    </div>
  );
}

function AssignmentModeControl<T extends string>({
  value,
  options,
  ariaLabel,
  disabled,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  ariaLabel: string;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`grid w-full ${options.length === 2 ? "grid-cols-2" : "grid-cols-4"} rounded-lg border bg-muted/40 p-1`}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            disabled={disabled}
            aria-selected={active}
            className={`min-h-9 min-w-0 whitespace-nowrap rounded-md px-1.5 text-[11px] font-medium leading-tight transition-colors ${
              active
                ? "border border-border bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background/70 hover:text-foreground"
            }`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function pickerTriggerLabel(type: string, id: string | null, emptyPrefix: string, t: ReturnType<typeof useT<"workflows">>["t"], label?: string | null): string {
  if (id) return label ?? `${type}: ${id}`;
  const typeLabels: Record<string, () => string> = {
    human: () => t(($) => $.node.worker_type_human),
    agent: () => t(($) => $.node.worker_type_agent),
    squad: () => t(($) => $.node.worker_type_squad),
  };
  const typeLabel = typeLabels[type]?.() ?? type;
  return `${emptyPrefix} ${typeLabel}`;
}

function gatewayLabel(kind: "fork" | "join" | null, t: ReturnType<typeof useT<"workflows">>["t"]): string {
  if (kind === "join") return t(($) => $.detail_panel.gateway_label_join);
  if (kind === "fork") return t(($) => $.detail_panel.gateway_label_fork);
  return t(($) => $.detail_panel.gateway_label_default);
}

function gatewayDescription(kind: "fork" | "join" | null, t: ReturnType<typeof useT<"workflows">>["t"]): string {
  if (kind === "join") return t(($) => $.detail_panel.gateway_desc_join);
  if (kind === "fork") return t(($) => $.detail_panel.gateway_desc_fork);
  return t(($) => $.detail_panel.gateway_desc_invalid);
}

function AssigneePickerTrigger({
  type,
  id,
  label,
  emptyPrefix,
  emptyLabel,
  t,
}: {
  type: string;
  id: string | null;
  label?: string | null;
  emptyPrefix: string;
  emptyLabel?: string;
  t: ReturnType<typeof useT<"workflows">>["t"];
}) {
  const Icon = type === "agent" ? Bot : type === "squad" ? Users : User;
  return (
    <>
      <Icon className="size-3.5 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-left">
        {id ? pickerTriggerLabel(type, id, emptyPrefix, t, label) : emptyLabel ?? pickerTriggerLabel(type, id, emptyPrefix, t, label)}
      </span>
    </>
  );
}

function actorLookupType(type: string): string {
  if (type === "human") return "member";
  return type;
}

const SPLIT_PLANNER_GENERAL_NAME = "Split Planner (General)";
const SPLIT_PLANNER_PREFIX = "Split Planner (";

function isVisibleSplitPlannerAgent(agent: { name: string; is_builtin: boolean }): boolean {
  if (!agent.is_builtin) return true;
  if (!agent.name.startsWith(SPLIT_PLANNER_PREFIX)) return true;
  return agent.name === SPLIT_PLANNER_GENERAL_NAME;
}

function AssignmentCard({
  title,
  subtitle,
  icon,
  status,
  children,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  status: ReactNode;
  children: ReactNode;
}) {
  return (
    <InspectorSection icon={icon} title={title} subtitle={subtitle} status={status}>
      {children}
    </InspectorSection>
  );
}

interface NodeConfigPanelProps {
  node: WorkflowNode;
  workflowId: string;
  nodes?: WorkflowNode[];
  stages?: WorkflowStage[];
  disabled?: boolean;
  recentNodeRun?: WorkflowNodeRun | null;
	incomingCount?: number;
	outgoingCount?: number;
	onTrialRun?: () => void;
  onClose: () => void;
  onSaveNode?: () => boolean | Promise<boolean>;
  onDirtyChange?: (dirty: boolean) => void;
  onRegisterSave?: (save: (() => Promise<boolean>) | null) => void;
  onDeleteNode?: (nodeId: string) => void;
  onStageChange?: (nodeId: string, stageId: string | null) => void;
}

export function NodeConfigPanel({
  node,
  workflowId,
  nodes = [],
  stages = [],
  disabled = false,
  recentNodeRun = null,
	incomingCount = 0,
	outgoingCount = 0,
	onTrialRun,
  onClose,
  onSaveNode,
  onDirtyChange,
  onRegisterSave,
  onDeleteNode,
  onStageChange,
}: NodeConfigPanelProps) {
  const { t } = useT("workflows");
  const wsId = useWorkspaceId();
  const navigation = useNavigation();
  const wsPaths = useWorkspacePaths();
  const deleteMutation = useDeleteNode(wsId, workflowId);
  const assignStageMutation = useAssignNodeToStage(wsId, workflowId);
  const createStageMutation = useCreateStage(wsId, workflowId);
  const nodeEdits = useWorkflowEditorStore((s) => s.nodeEdits);
  const undoRedoVersion = useWorkflowEditorStore((s) => s._undoRedoVersion);
  const cacheNodeEdits = useWorkflowEditorStore((s) => s.cacheNodeEdits);
  const { data: roles = [] } = useQuery(workflowRolesOptions(wsId));
  const { getActorName } = useActorName();

  const saved = nodeEdits[node.id];

  const nodeFormat = useMemo(() => parseNodeFormat(saved?.format_schema ?? node.format_schema), [saved?.format_schema, node.format_schema]);
  const isAnnotation = (() => {
    const fs = saved?.format_schema ?? node.format_schema;
    return Boolean(
      fs &&
      typeof fs === "object" &&
      !Array.isArray(fs) &&
      (fs as Record<string, unknown>).type === "annotation",
    );
  })();
  const isGateway = nodeFormat.kind === "gateway";
  const isSplit = nodeFormat.kind === "split";
  const isBoundary = isBoundaryNode(node);

  const [title, setTitle] = useState(saved?.title ?? node.title);
  const [description, setDescription] = useState(saved?.description ?? node.description);
  const [workerType, setWorkerType] = useState(saved?.worker_type ?? node.worker_type);
  const [workerId, setWorkerId] = useState<string | null>(saved?.worker_id ?? node.worker_id ?? null);
  const [workerRoleId, setWorkerRoleId] = useState<string | null>(saved?.worker_role_id ?? node.worker_role_id ?? null);
  const [criticType, setCriticType] = useState(saved?.critic_type ?? node.critic_type);
  const [criticId, setCriticId] = useState<string | null>(saved?.critic_id ?? node.critic_id ?? null);
  const [criticRoleId, setCriticRoleId] = useState<string | null>(saved?.critic_role_id ?? node.critic_role_id ?? null);
  const [criticApiUrl, setCriticApiUrl] = useState(saved?.critic_api_url ?? node.critic_api_url ?? "");
  const [workerCategory, setWorkerCategory] = useState<ParticipantCategory>(() =>
    participantCategory(saved?.worker_type ?? node.worker_type, saved?.worker_role_id ?? node.worker_role_id ?? null),
  );
  const [criticCategory, setCriticCategory] = useState<ParticipantCategory>(() =>
    participantCategory(saved?.critic_type ?? node.critic_type, saved?.critic_role_id ?? node.critic_role_id ?? null),
  );
  const [stageId, setStageId] = useState<string | null>(node.stage_id ?? null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newStageName, setNewStageName] = useState("");
  const [newStageDescription, setNewStageDescription] = useState("");

  useEffect(() => {
    setStageId(node.stage_id ?? null);
  }, [node.stage_id]);

  const bindableNodes = useMemo(
    () => nodes.filter((n) => {
      if (n.id === node.id) return false;
      const fs = n.format_schema;
      return !(fs && typeof fs === "object" && !Array.isArray(fs) && (fs as Record<string, unknown>).type === "annotation");
    }),
    [nodes, node.id],
  );

  const getTargetNodeId = (): string | null => {
    const fs = nodeEdits[node.id]?.format_schema ?? node.format_schema;
    if (fs && typeof fs === "object" && !Array.isArray(fs)) {
      return (fs as Record<string, unknown>).annotation_target_node_id as string | null ?? null;
    }
    return null;
  };

  const targetNodeId = getTargetNodeId();

  useEffect(() => {
    const s = nodeEdits[node.id];
    setTitle(s?.title ?? node.title);
    setDescription(s?.description ?? node.description);
    setWorkerType(s?.worker_type ?? node.worker_type);
    setWorkerId(s?.worker_id ?? node.worker_id ?? null);
    setWorkerRoleId(s?.worker_role_id ?? node.worker_role_id ?? null);
    setCriticType(s?.critic_type ?? node.critic_type);
    setCriticId(s?.critic_id ?? node.critic_id ?? null);
    setCriticRoleId(s?.critic_role_id ?? node.critic_role_id ?? null);
    setCriticApiUrl(s?.critic_api_url ?? node.critic_api_url ?? "");
    setWorkerCategory(participantCategory(s?.worker_type ?? node.worker_type, s?.worker_role_id ?? node.worker_role_id ?? null));
    setCriticCategory(participantCategory(s?.critic_type ?? node.critic_type, s?.critic_role_id ?? node.critic_role_id ?? null));
  }, [node.id, undoRedoVersion]);

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(node.id);
      toast.success(t(($) => $.node.toast_deleted));
      onClose();
    } catch {
      toast.error(t(($) => $.node.toast_delete_failed));
    }
  };

  const currentStageName = stages.find((s) => s.id === stageId)?.name ?? t(($) => $.overview.stage_canvas.unassigned);
  const workerConfigured = Boolean(workerId || workerRoleId);
  const criticConfigured = criticType === "api" ? Boolean(criticApiUrl.trim()) : Boolean(criticId || criticRoleId);
  const splitConfig: SplitConfig = nodeFormat.split_config ?? {
    mode: "barrier",
    max_concurrency: 5,
    max_failures: 0,
  };
  const runTone = statusTone(recentNodeRun?.status);
  // Builtin role names are seeded in English (developer/qa/tech_lead); localize
  // them so the picker and summary stay in the active locale. Custom roles fall
  // through to their raw name.
  const renderRoleName = useCallback(
    (role: { is_builtin: boolean; name: string }): string => {
      if (!role.is_builtin) return role.name;
      if (role.name === "developer") return t(($) => $.builtin_roles.developer.name);
      if (role.name === "qa") return t(($) => $.builtin_roles.qa.name);
      if (role.name === "tech_lead") return t(($) => $.builtin_roles.tech_lead.name);
      return role.name;
    },
    [t],
  );
  const workerRole = workerRoleId ? roles.find((role) => role.id === workerRoleId) : undefined;
  const criticRole = criticRoleId ? roles.find((role) => role.id === criticRoleId) : undefined;
  const workerLabel = workerRoleId
    ? (workerRole ? renderRoleName(workerRole) : null)
    : workerId
      ? getActorName(actorLookupType(workerType), workerId)
      : null;
  const criticLabel = criticRoleId
    ? (criticRole ? renderRoleName(criticRole) : null)
    : criticId
      ? getActorName(actorLookupType(criticType), criticId)
      : null;
  const participantCategoryOptions: Array<{ value: ParticipantCategory; label: string }> = [
    { value: "human", label: t(($) => $.detail_panel.participant_type_human) },
    { value: "agent", label: t(($) => $.detail_panel.participant_type_agent) },
    { value: "role", label: t(($) => $.detail_panel.participant_type_role) },
    { value: "squad", label: t(($) => $.detail_panel.participant_type_squad) },
  ];
  const splitReviewerCategoryOptions: Array<{ value: ParticipantCategory; label: string }> = [
    { value: "human", label: t(($) => $.detail_panel.participant_type_human) },
    { value: "role", label: t(($) => $.detail_panel.participant_type_role) },
  ];
  const splitReviewerValid = criticCategory === "human" || criticCategory === "role";
  const hasLocalEdits = Boolean(nodeEdits[node.id]);
  const hasUnsavedChanges = hasLocalEdits;

  const handleSplitConfigChange = useCallback((next: SplitConfig) => {
    const raw = saved?.format_schema ?? node.format_schema;
    const base =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? { ...(raw as Record<string, unknown>) }
        : {};
    const nextFormatSchema = {
      ...base,
      type: "split",
      shape: typeof base.shape === "string" ? base.shape : "rectangle",
      template_id: typeof base.template_id === "string" ? base.template_id : "task-splitter",
      template_category: typeof base.template_category === "string" ? base.template_category : "logic",
      split_config: {
        mode: next.mode,
        max_concurrency: next.max_concurrency,
        max_failures: next.max_failures,
      },
    };
    cacheNodeEdits(node.id, { format_schema: nextFormatSchema });
  }, [cacheNodeEdits, node.format_schema, node.id, saved?.format_schema]);

  const handleSaveAll = useCallback(async () => {
    try {
      if (onSaveNode) {
        return await onSaveNode();
      }
      return true;
    } catch {
      toast.error(t(($) => $.detail.toast_save_failed));
      return false;
    }
  }, [onSaveNode, t]);

  const handleNodeDelete = () => {
    if (onDeleteNode) {
      onDeleteNode(node.id);
      return;
    }
    void handleDelete();
  };

  useEffect(() => {
    onDirtyChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onDirtyChange]);

  useEffect(() => {
    if (onSaveNode) {
      onRegisterSave?.(async () => {
        try {
          return await onSaveNode();
        } catch {
          toast.error(t(($) => $.detail.toast_save_failed));
          return false;
        }
      });
    }
    return () => onRegisterSave?.(null);
  }, [onSaveNode, onRegisterSave, t]);

  return (
    <WorkflowNodeDetailPanelShell
      mode="edit"
      widthClassName="w-[min(800px,calc(100vw-2rem))]"
      title={title || t(($) => $.node.title)}
      eyebrow={isBoundary ? t(($) => $.detail_panel.boundary_eyebrow) : t(($) => $.detail_panel.eyebrow)}
      closeLabel={t(($) => $.detail_panel.close_label)}
      onClose={onClose}
      badges={(
        <>
          <StatusBadge>{currentStageName}</StatusBadge>
          {isBoundary ? (
            <StatusBadge>
              {nodeFormat.kind === "start"
                ? t(($) => $.detail_panel.boundary_badge_start)
                : t(($) => $.detail_panel.boundary_badge_end)}
            </StatusBadge>
          ) : recentNodeRun ? (
            <StatusBadge tone={runTone}>
              <Activity className="size-3" />
              {t(($) => $.detail_panel.badge_latest_run, { status: recentNodeRun.status })}
            </StatusBadge>
          ) : (
            <StatusBadge>{t(($) => $.detail_panel.badge_no_run_data)}</StatusBadge>
          )}
        </>
      )}
      footer={disabled ? (
        <p className="text-sm text-muted-foreground">{t(($) => $.detail_panel.actions_disabled)}</p>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={handleNodeDelete}
            disabled={deleteMutation.isPending}
          >
            <Trash2 className="mr-1.5 size-3.5" />
            {deleteMutation.isPending ? t(($) => $.node.saving) : t(($) => $.node.delete)}
          </Button>
          <div className="flex min-w-0 items-center justify-end gap-2">
            {isSplit ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onTrialRun}
                disabled={!onTrialRun}
              >
                <Play className="mr-1.5 size-3.5" />
                {t(($) => $.detail_panel.trial_run)}
              </Button>
            ) : null}
            {onSaveNode ? (
              <Button
                type="button"
                size="sm"
                onClick={handleSaveAll}
                disabled={!hasUnsavedChanges}
              >
                <Save className="mr-1.5 size-3.5" />
                {t(($) => $.detail_panel.save_changes)}
              </Button>
            ) : null}
          </div>
        </div>
      )}
    >
      <div
        data-testid="node-config-grid"
        className={isBoundary
          ? "grid grid-cols-1 gap-6"
          : "grid grid-cols-1 gap-6 min-[1280px]:grid-cols-2 min-[1280px]:gap-0"}
      >
        <div
          data-testid="node-config-primary-column"
          className="min-w-0 space-y-6 min-[1280px]:pr-6"
        >
      <NodeDetailSection
        sectionId="primary"
        title={t(($) => $.detail_panel.section_primary)}
      >
        <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t(($) => $.node.title)}</Label>
                <Input
                  disabled={disabled}
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    cacheNodeEdits(node.id, { title: e.target.value });
                  }}
                  placeholder={t(($) => $.node.title_placeholder)}
                  className="h-8 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t(($) => $.node.stage_label)}</Label>
                <select
                  disabled={disabled || assignStageMutation.isPending}
                  className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={stageId ?? ""}
                  onChange={(e) => {
                    const newVal = e.target.value;
                    if (newVal === "__create_new__") {
                      (e.target as HTMLSelectElement).value = stageId ?? "";
                      setShowCreateForm(true);
                      return;
                    }
                    const newStageId = newVal || null;
                    setStageId(newStageId);
                    if (onStageChange) {
                      onStageChange(node.id, newStageId);
                    } else {
                      assignStageMutation.mutate(
                        { nodeId: node.id, stage_id: newStageId },
                        { onError: () => setStageId(node.stage_id ?? null) },
                      );
                    }
                  }}
                >
                  <option value="">{t(($) => $.overview.stage_canvas.unassigned)}</option>
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                  <option value="__create_new__" disabled={disabled}>
                    {t(($) => $.node.stage_create_option)}
                  </option>
                </select>

                {showCreateForm ? (
                  <div className="space-y-2 rounded-md border border-muted p-3">
                    <Input
                      disabled={disabled}
                      value={newStageName}
                      onChange={(e) => setNewStageName(e.target.value)}
                      placeholder={t(($) => $.node.stage_create_name_placeholder)}
                      className="h-8 text-sm"
                      autoFocus
                    />
                    <Input
                      disabled={disabled}
                      value={newStageDescription}
                      onChange={(e) => setNewStageDescription(e.target.value)}
                      placeholder={t(($) => $.node.stage_create_description_placeholder)}
                      className="h-8 text-sm"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="default"
                        disabled={disabled || !newStageName.trim() || createStageMutation.isPending}
                        onClick={async () => {
                          if (!newStageName.trim()) return;
                          try {
                            const created = await createStageMutation.mutateAsync({
                              name: newStageName.trim(),
                              description: newStageDescription.trim() || undefined,
                            });
                            setStageId(created.id);
                            assignStageMutation.mutate(
                              { nodeId: node.id, stage_id: created.id },
                              { onError: () => setStageId(node.stage_id ?? null) },
                            );
                            setShowCreateForm(false);
                            setNewStageName("");
                            setNewStageDescription("");
                          } catch {
                            // Mutation state displays the failure below.
                          }
                        }}
                      >
                        {createStageMutation.isPending ? t(($) => $.node.saving) : t(($) => $.detail.create_dialog.create)}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={createStageMutation.isPending}
                        onClick={() => {
                          setShowCreateForm(false);
                          setNewStageName("");
                          setNewStageDescription("");
                        }}
                      >
                        {t(($) => $.overview.stage_dialog.cancel)}
                      </Button>
                    </div>
                    {createStageMutation.error ? (
                      <p className="text-xs text-destructive">{createStageMutation.error.message}</p>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t(($) => $.node.description)}</Label>
                <Textarea
                  disabled={disabled}
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    cacheNodeEdits(node.id, { description: e.target.value });
                  }}
                  placeholder={t(($) => $.node.description_placeholder)}
                  className="min-h-[72px] text-sm"
                  rows={3}
                />
              </div>

        </div>
      </NodeDetailSection>

		{isSplit ? (
			<NodeDetailSection
				sectionId="split-behavior"
				title={t(($) => $.detail_panel.section_split_behavior)}
			>
				<SplitConfigPanel
					config={splitConfig}
					disabled={disabled}
					onChange={handleSplitConfigChange}
				/>
			</NodeDetailSection>
		) : null}
        </div>

        {!isBoundary ? (
        <div
          data-testid="node-config-participants-column"
          className="min-w-0 space-y-6 min-[1280px]:border-l min-[1280px]:border-border/40 min-[1280px]:pl-6"
        >

      <NodeDetailSection
        sectionId="worker-critic"
        title={t(($) => $.detail_panel.section_worker_critic)}
      >
        <div className="space-y-3">
            {isAnnotation ? (
              <InspectorSection
                icon={<Braces className="size-4" />}
                title={t(($) => $.detail_panel.section_annotation_binding)}
                subtitle={t(($) => $.detail_panel.section_annotation_binding_desc)}
              >
                <Label className="text-xs text-muted-foreground">{t(($) => $.detail_panel.label_bind_to_node)}</Label>
                {targetNodeId ? (
                  <div className="flex items-center gap-1.5 rounded-md border px-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {bindableNodes.find((bn) => bn.id === targetNodeId)?.title ?? t(($) => $.detail_panel.empty_unknown_node)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      onClick={() => {
                        const raw = saved?.format_schema ?? node.format_schema;
                        const obj: Record<string, unknown> = (raw && typeof raw === "object" && !Array.isArray(raw))
                          ? { ...(raw as Record<string, unknown>) }
                          : {};
                        delete obj.annotation_target_node_id;
                        cacheNodeEdits(node.id, { format_schema: obj });
                      }}
                      title="Unbind"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <select
                    disabled={disabled}
                    className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value=""
                    onChange={(e) => {
                      const tid = e.target.value;
                      if (!tid) return;
                      const raw = saved?.format_schema ?? node.format_schema;
                      const obj: Record<string, unknown> = (raw && typeof raw === "object" && !Array.isArray(raw))
                        ? { ...(raw as Record<string, unknown>) }
                        : {};
                      obj.annotation_target_node_id = tid;
                      cacheNodeEdits(node.id, { format_schema: obj });
                    }}
                  >
                    <option value="">{t(($) => $.detail_panel.select_node)}</option>
                    {bindableNodes.map((bn) => (
                      <option key={bn.id} value={bn.id}>{bn.title}</option>
                    ))}
                  </select>
                )}
              </InspectorSection>
            ) : null}

            {isGateway ? (
              <InspectorSection
                icon={<GitBranch className="size-4" />}
                title={gatewayLabel(nodeFormat.gateway_kind, t)}
                subtitle={t(($) => $.detail_panel.gateway_subtitle)}
                status={<StatusBadge tone={nodeFormat.gateway_kind_valid ? "success" : "danger"}>{nodeFormat.gateway_kind_valid ? t(($) => $.detail_panel.badge_valid) : t(($) => $.detail_panel.badge_invalid)}</StatusBadge>}
              >
                <p className="text-sm text-muted-foreground">{gatewayDescription(nodeFormat.gateway_kind, t)}</p>
              </InspectorSection>
            ) : null}

            {!isAnnotation && !isGateway ? (
              <>
                {isSplit ? (
                  <>
                    <AssignmentCard
                    icon={<Bot className="size-4" />}
                    title={t(($) => $.node.section_worker)}
                    subtitle={t(($) => $.detail_panel.split_worker_subtitle)}
                    status={workerConfigured ? <StatusBadge tone="success">{t(($) => $.detail_panel.badge_configured)}</StatusBadge> : <StatusBadge tone="warning">{t(($) => $.detail_panel.badge_needs_assignee)}</StatusBadge>}
                  >
                    <AssignmentModeControl<ParticipantCategory>
                      value={workerCategory}
                      options={participantCategoryOptions}
                      ariaLabel={t(($) => $.detail_panel.worker_category_label)}
                      disabled={disabled}
                      onChange={(category) => {
                        if (category === workerCategory) return;
                        const nextType: WorkerType = category === "role" ? "human" : category;
                        setWorkerCategory(category);
                        setWorkerType(nextType);
                        setWorkerId(null);
                        setWorkerRoleId(null);
                        cacheNodeEdits(node.id, { worker_type: nextType, worker_id: null, worker_role_id: null });
                      }}
                    />

                    {workerCategory === "role" ? (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground" htmlFor="split-worker-role-select">{t(($) => $.detail_panel.label_worker_role)}</Label>
                        <select
                          id="split-worker-role-select"
                          aria-label={t(($) => $.detail_panel.label_worker_role)}
                          disabled={disabled}
                          className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                          value={workerRoleId ?? ""}
                          onChange={(e) => {
                            const rid = e.target.value || null;
                            setWorkerType("human");
                            setWorkerId(null);
                            setWorkerRoleId(rid);
                            cacheNodeEdits(node.id, { worker_type: "human", worker_id: null, worker_role_id: rid });
                          }}
                        >
                          <option value="">{t(($) => $.detail_panel.select_role)}</option>
                          {roles.map((role) => <option key={role.id} value={role.id}>{renderRoleName(role)}</option>)}
                        </select>
                      </div>
                    ) : (
                      <div className={disabled ? "pointer-events-none opacity-60" : undefined}>
                        <AssigneePicker
                          assigneeType={categoryAssigneeType(workerCategory)}
                          assigneeId={workerId}
                          allowedTypes={[categoryAssigneeType(workerCategory)]}
                          agentFilter={isVisibleSplitPlannerAgent}
                          triggerRender={<Button type="button" variant="outline" size="sm" className="h-8 w-full justify-start" disabled={disabled} />}
                          trigger={
                            <AssigneePickerTrigger
                              type={workerCategory}
                              id={workerId}
                              label={workerLabel}
                              emptyPrefix={t(($) => $.detail_panel.picker_empty_prefix)}
                              emptyLabel={t(($) => $.detail_panel.empty_worker)}
                              t={t}
                            />
                          }
                          onUpdate={disabled ? () => {} : (u) => {
                            const wt = fromAssigneeType(u.assignee_type ?? categoryAssigneeType(workerCategory));
                            const wid = u.assignee_id ?? null;
                            setWorkerRoleId(null);
                            setWorkerType(wt);
                            setWorkerId(wid);
                            cacheNodeEdits(node.id, { worker_type: wt, worker_id: wid, worker_role_id: null });
                          }}
                          align="start"
                          skipBuiltinRuntimeSelection
                          includeWorkflows={false}
                        />
                      </div>
                    )}
                    </AssignmentCard>

                    <AssignmentCard
                      icon={<ShieldCheck className="size-4" />}
                      title={t(($) => $.node.section_critic)}
                      subtitle={t(($) => $.detail_panel.split_critic_subtitle)}
                      status={!splitReviewerValid
                        ? <StatusBadge tone="danger">{t(($) => $.preflight.check_split_reviewer_invalid)}</StatusBadge>
                        : criticConfigured
                          ? <StatusBadge tone="success">{t(($) => $.detail_panel.badge_configured)}</StatusBadge>
                          : <StatusBadge tone="warning">{t(($) => $.detail_panel.badge_needs_assignee)}</StatusBadge>}
                    >
                      <AssignmentModeControl<ParticipantCategory>
                        value={criticCategory}
                        ariaLabel={t(($) => $.detail_panel.critic_category_label)}
                        disabled={disabled}
                        options={splitReviewerCategoryOptions}
                        onChange={(category) => {
                          if (category === criticCategory) return;
                          const nextType: CriticType = category === "role" ? "human" : category;
                          setCriticCategory(category);
                          setCriticType(nextType);
                          setCriticId(null);
                          setCriticRoleId(null);
                          setCriticApiUrl("");
                          cacheNodeEdits(node.id, {
                            critic_type: nextType,
                            critic_id: null,
                            critic_role_id: null,
                            critic_api_url: null,
                          });
                        }}
                      />

                      {!splitReviewerValid ? (
                        <p className="text-xs leading-relaxed text-destructive">
                          {t(($) => $.preflight.detail_split_reviewer_invalid)}
                        </p>
                      ) : null}

                      {criticCategory === "role" ? (
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground" htmlFor="split-critic-role-select">{t(($) => $.detail_panel.label_critic_role)}</Label>
                          <select
                            id="split-critic-role-select"
                            aria-label="Critic role"
                            disabled={disabled}
                            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                            value={criticRoleId ?? ""}
                            onChange={(e) => {
                              const rid = e.target.value || null;
                              setCriticType("human");
                              setCriticId(null);
                              setCriticRoleId(rid);
                              setCriticApiUrl("");
                              cacheNodeEdits(node.id, { critic_type: "human", critic_id: null, critic_role_id: rid, critic_api_url: null });
                            }}
                          >
                            <option value="">{t(($) => $.detail_panel.select_role)}</option>
                            {roles.map((r) => (
                              <option key={r.id} value={r.id}>{renderRoleName(r)}</option>
                            ))}
                          </select>
                          <Button
                            type="button"
                            variant="link"
                            size="sm"
                            className="h-5 px-0 text-[11px] text-muted-foreground"
                            onClick={() => navigation.push(wsPaths.roles())}
                          >
                            <Plus className="mr-1 size-3" />
                            {t(($) => $.detail_panel.manage_roles_shortcut)}
                          </Button>
                        </div>
                      ) : criticCategory === "human" ? (
                        <div className="space-y-2">
                          <div className={disabled ? "pointer-events-none opacity-60" : undefined}>
                            <AssigneePicker
                              assigneeType="member"
                              assigneeId={criticId}
                              allowedTypes={["member"]}
                              triggerRender={
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-8 w-full justify-start"
                                  disabled={disabled}
                                />
                              }
                              trigger={
                                <AssigneePickerTrigger
                                  type={criticCategory}
                                  id={criticId}
                                  label={criticLabel}
                                  emptyPrefix={t(($) => $.detail_panel.picker_empty_prefix)}
                                  emptyLabel={t(($) => $.detail_panel.empty_critic)}
                                  t={t}
                                />
                              }
                              onUpdate={disabled ? () => {} : (u) => {
                                const ct = fromAssigneeTypeCritic(u.assignee_type ?? "member");
                                const cid = u.assignee_id ?? null;
                                setCriticRoleId(null);
                                setCriticType(ct);
                                setCriticId(cid);
                                setCriticApiUrl("");
                                cacheNodeEdits(node.id, { critic_type: ct, critic_id: cid, critic_role_id: null, critic_api_url: null });
                              }}
                              align="start"
                              includeWorkflows={false}
                            />
                          </div>
                        </div>
                      ) : null}
                    </AssignmentCard>
                  </>
                ) : (
                  <>
                    <AssignmentCard
                      icon={<Bot className="size-4" />}
                      title={t(($) => $.node.section_worker)}
                      subtitle={t(($) => $.detail_panel.worker_subtitle)}
                      status={workerConfigured ? <StatusBadge tone="success">{t(($) => $.detail_panel.badge_configured)}</StatusBadge> : <StatusBadge tone="warning">{t(($) => $.detail_panel.badge_needs_assignee)}</StatusBadge>}
                    >
                      <AssignmentModeControl<ParticipantCategory>
                        value={workerCategory}
                        ariaLabel={t(($) => $.detail_panel.worker_category_label)}
                        disabled={disabled}
                        options={participantCategoryOptions}
                        onChange={(category) => {
                          if (category === workerCategory) return;
                          const nextType: WorkerType = category === "role" ? "human" : category;
                          setWorkerCategory(category);
                          setWorkerType(nextType);
                          setWorkerId(null);
                          setWorkerRoleId(null);
                          cacheNodeEdits(node.id, { worker_type: nextType, worker_id: null, worker_role_id: null });
                        }}
                      />

                      {workerCategory === "role" ? (
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground" htmlFor="worker-role-select">{t(($) => $.detail_panel.label_worker_role)}</Label>
                          <select
                            id="worker-role-select"
                            aria-label="Worker role"
                            disabled={disabled}
                            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                            value={workerRoleId ?? ""}
                            onChange={(e) => {
                              const rid = e.target.value || null;
                              setWorkerType("human");
                              setWorkerId(null);
                              setWorkerRoleId(rid);
                              cacheNodeEdits(node.id, { worker_type: "human", worker_id: null, worker_role_id: rid });
                            }}
                          >
                            <option value="">{t(($) => $.detail_panel.select_role)}</option>
                            {roles.map((r) => (
                              <option key={r.id} value={r.id}>{renderRoleName(r)}</option>
                            ))}
                          </select>
                          <Button
                            type="button"
                            variant="link"
                            size="sm"
                            className="h-5 px-0 text-[11px] text-muted-foreground"
                            onClick={() => navigation.push(wsPaths.roles())}
                          >
                            <Plus className="mr-1 size-3" />
                            {t(($) => $.detail_panel.manage_roles_shortcut)}
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className={disabled ? "pointer-events-none opacity-60" : undefined}>
                            <AssigneePicker
                              assigneeType={categoryAssigneeType(workerCategory)}
                              assigneeId={workerId}
                              allowedTypes={[categoryAssigneeType(workerCategory)]}
                              triggerRender={
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-8 w-full justify-start"
                                  disabled={disabled}
                                />
                              }
                              trigger={
                                <AssigneePickerTrigger
                                  type={workerCategory}
                                  id={workerId}
                                  label={workerLabel}
                                  emptyPrefix={t(($) => $.detail_panel.picker_empty_prefix)}
                                  emptyLabel={t(($) => $.detail_panel.empty_worker)}
                                  t={t}
                                />
                              }
                              onUpdate={disabled ? () => {} : (u) => {
                                const wt = fromAssigneeType(u.assignee_type ?? categoryAssigneeType(workerCategory));
                                const wid = u.assignee_id ?? null;
                                setWorkerRoleId(null);
                                setWorkerType(wt);
                                setWorkerId(wid);
                                cacheNodeEdits(node.id, { worker_type: wt, worker_id: wid, worker_role_id: null });
                              }}
                              align="start"
                              skipBuiltinRuntimeSelection
                              includeWorkflows={false}
                            />
                          </div>
                        </div>
                      )}
                    </AssignmentCard>

                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-1 text-[11px] font-medium text-muted-foreground">
                      <span className="h-px bg-border" />
                      <span>{t(($) => $.detail_panel.worker_critic_divider)}</span>
                      <span className="h-px bg-border" />
                    </div>

                    <AssignmentCard
                      icon={<ShieldCheck className="size-4" />}
                      title={t(($) => $.node.section_critic)}
                      subtitle={t(($) => $.detail_panel.critic_subtitle)}
                      status={criticConfigured ? <StatusBadge tone="success">{t(($) => $.detail_panel.badge_configured)}</StatusBadge> : <StatusBadge>{t(($) => $.detail_panel.badge_optional)}</StatusBadge>}
                    >
                      <AssignmentModeControl<ParticipantCategory>
                        value={criticCategory}
                        ariaLabel={t(($) => $.detail_panel.critic_category_label)}
                        disabled={disabled}
                        options={participantCategoryOptions}
                        onChange={(category) => {
                          if (category === criticCategory) return;
                          const nextType: CriticType = category === "role" ? "human" : category;
                          setCriticCategory(category);
                          setCriticType(nextType);
                          setCriticId(null);
                          setCriticRoleId(null);
                          setCriticApiUrl("");
                          cacheNodeEdits(node.id, {
                            critic_type: nextType,
                            critic_id: null,
                            critic_role_id: null,
                            critic_api_url: null,
                          });
                        }}
                      />

                      {criticCategory === "role" ? (
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground" htmlFor="critic-role-select">{t(($) => $.detail_panel.label_critic_role)}</Label>
                          <select
                            id="critic-role-select"
                            aria-label="Critic role"
                            disabled={disabled}
                            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                            value={criticRoleId ?? ""}
                            onChange={(e) => {
                              const rid = e.target.value || null;
                              setCriticType("human");
                              setCriticId(null);
                              setCriticRoleId(rid);
                              setCriticApiUrl("");
                              cacheNodeEdits(node.id, { critic_type: "human", critic_id: null, critic_role_id: rid, critic_api_url: null });
                            }}
                          >
                            <option value="">{t(($) => $.detail_panel.select_role)}</option>
                            {roles.map((r) => (
                              <option key={r.id} value={r.id}>{renderRoleName(r)}</option>
                            ))}
                          </select>
                          <Button
                            type="button"
                            variant="link"
                            size="sm"
                            className="h-5 px-0 text-[11px] text-muted-foreground"
                            onClick={() => navigation.push(wsPaths.roles())}
                          >
                            <Plus className="mr-1 size-3" />
                            {t(($) => $.detail_panel.manage_roles_shortcut)}
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className={disabled ? "pointer-events-none opacity-60" : undefined}>
                            <AssigneePicker
                              assigneeType={categoryAssigneeType(criticCategory)}
                              assigneeId={criticId}
                              allowedTypes={[categoryAssigneeType(criticCategory)]}
                              triggerRender={
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-8 w-full justify-start"
                                  disabled={disabled}
                                />
                              }
                              trigger={
                                <AssigneePickerTrigger
                                  type={criticCategory}
                                  id={criticId}
                                  label={criticLabel}
                                  emptyPrefix={t(($) => $.detail_panel.picker_empty_prefix)}
                                  emptyLabel={t(($) => $.detail_panel.empty_critic)}
                                  t={t}
                                />
                              }
                              onUpdate={disabled ? () => {} : (u) => {
                                const ct = fromAssigneeTypeCritic(u.assignee_type ?? categoryAssigneeType(criticCategory));
                                const cid = u.assignee_id ?? null;
                                setCriticRoleId(null);
                                setCriticType(ct);
                                setCriticId(cid);
                                setCriticApiUrl("");
                                cacheNodeEdits(node.id, { critic_type: ct, critic_id: cid, critic_role_id: null, critic_api_url: null });
                              }}
                              align="start"
                              includeWorkflows={false}
                            />
                          </div>
                        </div>
                      )}
                    </AssignmentCard>
                  </>
                )}
              </>
            ) : null}

        </div>
      </NodeDetailSection>

		{isSplit ? (
			<NodeDetailSection
				sectionId="connections"
				title={t(($) => $.detail_panel.section_connections)}
			>
				<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
					<span className="inline-flex items-center gap-1.5">
						<GitFork className="size-3.5" />
						{t(($) => $.detail_panel.connection_upstream_count, { count: incomingCount })}
					</span>
					<span>{t(($) => $.detail_panel.connection_downstream_count, { count: outgoingCount })}</span>
				</div>
			</NodeDetailSection>
		) : null}
        </div>
        ) : null}
      </div>
    </WorkflowNodeDetailPanelShell>
  );
}
