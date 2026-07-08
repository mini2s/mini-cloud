"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Bot,
  Braces,
  CheckCircle2,
  FileCheck2,
  GitBranch,
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
import { useWorkspaceId } from "@multica/core/hooks";
import { useActorName } from "@multica/core/workspace/hooks";
import {
  useCreateStage,
  useDeleteNode,
  useAssignNodeToStage,
  workflowRolesOptions,
  workflowNodeDeliverablesOptions,
  useCreateWorkflowNodeDeliverable,
  useUpdateWorkflowNodeDeliverable,
  useDeleteWorkflowNodeDeliverable,
} from "@multica/core/workflows/queries";
import { useWorkflowEditorStore } from "@multica/core/workflows/store";
import { AssigneePicker } from "../../issues/components/pickers/assignee-picker";
import { parseNodeFormat, type WorkflowNode, type WorkflowNodeRun, type WorkflowStage, type WorkerType, type CriticType, type WorkflowNodeDeliverable } from "@multica/core/types";
import type { IssueAssigneeType } from "@multica/core/types/issue";
import { NodeDeliverablesEditor, type WorkflowNodeDeliverableDraft } from "./node-deliverables-editor";
import { NodeDataPreview } from "./node-data-preview";
import {
  NodeDetailSection,
  WorkflowNodeDetailPanelShell,
} from "../../common/workflow-node-detail-panel-shell";

function toAssigneeType(t: string): IssueAssigneeType | null {
  if (t === "human") return "member";
  if (t === "agent" || t === "squad") return t as IssueAssigneeType;
  return null;
}

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

function statusTone(status: string | null | undefined): "default" | "success" | "warning" | "danger" {
  if (!status) return "default";
  if (status === "completed" || status === "critic_approved" || status === "format_ok") return "success";
  if (status === "failed" || status === "blocked" || status === "cancelled" || status === "critic_rework" || status === "format_failed") return "danger";
  if (status === "working" || status === "critic_reviewing" || status === "awaiting_critic" || status === "awaiting_input") return "warning";
  return "default";
}

function statusClasses(tone: "default" | "success" | "warning" | "danger"): string {
  if (tone === "success") return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300";
  if (tone === "warning") return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300";
  if (tone === "danger") return "border-destructive/25 bg-destructive/10 text-destructive";
  return "border-border bg-muted/40 text-muted-foreground";
}

function StatusBadge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  return (
    <span className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-[11px] font-medium ${statusClasses(tone)}`}>
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
    <div className={`space-y-3 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border bg-muted/30 text-muted-foreground">
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

function TypeSegmentedControl<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: "Worker" | "Critic";
  value: T;
  options: Array<{ value: T; label: string }>;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div className="grid gap-1 rounded-lg border bg-muted/40 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            aria-label={`${label} type ${option.label}`}
            aria-pressed={active}
            className={`h-8 rounded-md px-2 text-[11px] font-medium transition-colors ${
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

function ActorSummary({
  type,
  id,
  label,
  emptyText,
  hint,
}: {
  type: string;
  id: string | null;
  label?: string | null;
  emptyText: string;
  hint: string;
}) {
  const Icon = type === "agent" ? Bot : type === "squad" ? Users : type === "role" ? ShieldCheck : User;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-2.5 py-2">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium">{id ? (label ?? `${type}: ${id}`) : emptyText}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {hint}
        </p>
      </div>
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
  t,
}: {
  type: string;
  id: string | null;
  label?: string | null;
  emptyPrefix: string;
  t: ReturnType<typeof useT<"workflows">>["t"];
}) {
  const Icon = type === "agent" ? Bot : type === "squad" ? Users : User;
  return (
    <>
      <Icon className="size-3.5 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-left">
        {pickerTriggerLabel(type, id, emptyPrefix, t, label)}
      </span>
    </>
  );
}

function actorLookupType(type: string): string {
  if (type === "human") return "member";
  return type;
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
  onClose: () => void;
  onSaveNode?: () => boolean | Promise<boolean>;
  onDirtyChange?: (dirty: boolean) => void;
  onRegisterSave?: (save: (() => Promise<boolean>) | null) => void;
  onDeleteNode?: (nodeId: string) => void;
  onStageChange?: (nodeId: string, stageId: string | null) => void;
}

const EMPTY_DELIVERABLES: WorkflowNodeDeliverable[] = [];

export function NodeConfigPanel({
  node,
  workflowId,
  nodes = [],
  stages = [],
  disabled = false,
  recentNodeRun = null,
  onClose,
  onSaveNode,
  onDirtyChange,
  onRegisterSave,
  onDeleteNode,
  onStageChange,
}: NodeConfigPanelProps) {
  const { t } = useT("workflows");
  const wsId = useWorkspaceId();
  const deleteMutation = useDeleteNode(wsId, workflowId);
  const assignStageMutation = useAssignNodeToStage(wsId, workflowId);
  const createStageMutation = useCreateStage(wsId, workflowId);
  const createDeliverableMutation = useCreateWorkflowNodeDeliverable(wsId, workflowId, node.id);
  const updateDeliverableMutation = useUpdateWorkflowNodeDeliverable(wsId, workflowId, node.id);
  const deleteDeliverableMutation = useDeleteWorkflowNodeDeliverable(wsId, workflowId, node.id);
  const nodeEdits = useWorkflowEditorStore((s) => s.nodeEdits);
  const undoRedoVersion = useWorkflowEditorStore((s) => s._undoRedoVersion);
  const cacheNodeEdits = useWorkflowEditorStore((s) => s.cacheNodeEdits);
  const { data: roles = [] } = useQuery(workflowRolesOptions(wsId));
  const { data: savedDeliverablesData } = useQuery(
    workflowNodeDeliverablesOptions(wsId, workflowId, node.id),
  );
  const savedDeliverables = savedDeliverablesData ?? EMPTY_DELIVERABLES;
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

  const [title, setTitle] = useState(saved?.title ?? node.title);
  const [description, setDescription] = useState(saved?.description ?? node.description);
  const [workerType, setWorkerType] = useState(saved?.worker_type ?? node.worker_type);
  const [workerId, setWorkerId] = useState<string | null>(saved?.worker_id ?? node.worker_id ?? null);
  const [criticType, setCriticType] = useState(saved?.critic_type ?? node.critic_type);
  const [criticId, setCriticId] = useState<string | null>(saved?.critic_id ?? node.critic_id ?? null);
  const [criticApiUrl, setCriticApiUrl] = useState(saved?.critic_api_url ?? node.critic_api_url ?? "");
  const [stageId, setStageId] = useState<string | null>(node.stage_id ?? null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newStageName, setNewStageName] = useState("");
  const [newStageDescription, setNewStageDescription] = useState("");
  const [deliverableDrafts, setDeliverableDrafts] = useState<WorkflowNodeDeliverableDraft[]>([]);
  const [deliverablesDirty, setDeliverablesDirty] = useState(false);

  const savedDeliverableKey = useMemo(
    () => savedDeliverables.map((d) => [
      d.id,
      d.kind,
      d.title,
      d.description,
      d.required,
      d.sort_order,
    ].join(":")).join("|"),
    [savedDeliverables],
  );

  useEffect(() => {
    setStageId(node.stage_id ?? null);
  }, [node.stage_id]);

  useEffect(() => {
    if (deliverablesDirty) return;
    setDeliverableDrafts(savedDeliverables.map((d) => ({ ...d, isDraft: false })));
  }, [savedDeliverableKey, savedDeliverables, deliverablesDirty]);

  useEffect(() => {
    setDeliverablesDirty(false);
    setDeliverableDrafts(savedDeliverables.map((d) => ({ ...d, isDraft: false })));
  }, [node.id]);

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
    setCriticType(s?.critic_type ?? node.critic_type);
    setCriticId(s?.critic_id ?? node.critic_id ?? null);
    setCriticApiUrl(s?.critic_api_url ?? node.critic_api_url ?? "");
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
  const workerConfigured = workerType === "role" ? Boolean(workerId) : Boolean(workerId);
  const criticConfigured = criticType === "api" ? Boolean(criticApiUrl.trim()) : Boolean(criticId);
  const runTone = statusTone(recentNodeRun?.status);
  const workerLabel = workerId
    ? workerType === "role"
      ? roles.find((r) => r.id === workerId)?.name ?? null
      : getActorName(actorLookupType(workerType), workerId)
    : null;
  const criticLabel = criticId
    ? criticType === "role"
      ? roles.find((r) => r.id === criticId)?.name ?? null
      : getActorName(actorLookupType(criticType), criticId)
    : null;
  const hasLocalEdits = Boolean(nodeEdits[node.id]);
  const hasUnsavedChanges = hasLocalEdits || deliverablesDirty;
  const isSavingDeliverables =
    createDeliverableMutation.isPending ||
    updateDeliverableMutation.isPending ||
    deleteDeliverableMutation.isPending;

  const handleDeliverablesChange = useCallback((next: WorkflowNodeDeliverableDraft[]) => {
    setDeliverableDrafts(next.map((d, index) => ({ ...d, sort_order: index })));
    setDeliverablesDirty(true);
  }, []);

  const saveDeliverables = useCallback(async () => {
    const baseById = new Map(savedDeliverables.map((d) => [d.id, d]));
    const draftById = new Map(deliverableDrafts.filter((d) => !d.isDraft).map((d) => [d.id, d]));

    const deletes = savedDeliverables.filter((d) => !draftById.has(d.id));
    const creates = deliverableDrafts.filter((d) => d.isDraft || !baseById.has(d.id));
    const updates = deliverableDrafts.filter((d) => {
      const base = baseById.get(d.id);
      if (!base) return false;
      return (
        base.kind !== d.kind ||
        base.title !== d.title ||
        base.description !== d.description ||
        base.required !== d.required ||
        base.sort_order !== d.sort_order
      );
    });

    await Promise.all([
      ...deletes.map((d) => deleteDeliverableMutation.mutateAsync(d.id)),
      ...creates.map((d) =>
        createDeliverableMutation.mutateAsync({
          kind: d.kind,
          title: d.title.trim() || t(($) => $.detail_panel.deliverable_default_title),
          description: d.description,
          required: d.required,
          sort_order: d.sort_order,
        }),
      ),
      ...updates.map((d) =>
        updateDeliverableMutation.mutateAsync({
          deliverableId: d.id,
          kind: d.kind,
          title: d.title.trim() || t(($) => $.detail_panel.deliverable_default_title),
          description: d.description,
          required: d.required,
          sort_order: d.sort_order,
        }),
      ),
    ]);
    setDeliverablesDirty(false);
  }, [
    createDeliverableMutation,
    deleteDeliverableMutation,
    deliverableDrafts,
    savedDeliverables,
    t,
    updateDeliverableMutation,
  ]);

  const handleSaveAll = useCallback(async () => {
    const hadNodeEdits = Boolean(nodeEdits[node.id]);
    try {
      const nodeSaved = onSaveNode ? await onSaveNode() : true;
      if (nodeSaved === false) return false;
      if (deliverablesDirty) {
        await saveDeliverables();
        if (!hadNodeEdits) toast.success(t(($) => $.detail.toast_saved));
      }
    } catch {
      toast.error(t(($) => $.detail.toast_save_failed));
      return false;
    }
    return true;
  }, [deliverablesDirty, node.id, nodeEdits, onSaveNode, saveDeliverables, t]);

  useEffect(() => {
    onDirtyChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onDirtyChange]);

  useEffect(() => {
    onRegisterSave?.(handleSaveAll);
    return () => onRegisterSave?.(null);
  }, [handleSaveAll, onRegisterSave]);

  return (
    <WorkflowNodeDetailPanelShell
      mode="edit"
      title={title || t(($) => $.node.title)}
      eyebrow={t(($) => $.detail_panel.eyebrow)}
      closeLabel={t(($) => $.detail_panel.close_label)}
      onClose={onClose}
      badges={(
        <>
          <StatusBadge>{currentStageName}</StatusBadge>
          {recentNodeRun ? (
            <StatusBadge tone={runTone}>
              <Activity className="size-3" />
              {t(($) => $.detail_panel.badge_latest_run, { status: recentNodeRun.status })}
            </StatusBadge>
          ) : (
            <StatusBadge>{t(($) => $.detail_panel.badge_no_run_data)}</StatusBadge>
          )}
        </>
      )}
    >
      <NodeDetailSection
        sectionId="primary"
        icon={<GitBranch className="size-4" />}
        title={t(($) => $.detail_panel.section_primary)}
        subtitle={t(($) => $.detail_panel.section_primary_desc)}
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
                <AssignmentCard
                  icon={<Bot className="size-4" />}
                  title={t(($) => $.node.section_worker)}
                  subtitle={t(($) => $.detail_panel.worker_subtitle)}
                  status={workerConfigured ? <StatusBadge tone="success">{t(($) => $.detail_panel.badge_configured)}</StatusBadge> : <StatusBadge tone="warning">{t(($) => $.detail_panel.badge_needs_assignee)}</StatusBadge>}
                >
                  <TypeSegmentedControl<WorkerType>
                    label="Worker"
                    value={workerType}
                    disabled={disabled}
                    options={[
                      { value: "human", label: t(($) => $.node.worker_type_human) },
                      { value: "agent", label: t(($) => $.node.worker_type_agent) },
                      { value: "squad", label: t(($) => $.node.worker_type_squad) },
                      { value: "role", label: t(($) => $.node.worker_type_role) },
                    ]}
                    onChange={(wt) => {
                      setWorkerType(wt);
                      setWorkerId(null);
                      cacheNodeEdits(node.id, { worker_type: wt, worker_id: null });
                    }}
                  />

                  {workerType === "role" ? (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground" htmlFor="worker-role-select">{t(($) => $.detail_panel.label_worker_role)}</Label>
                      <select
                        id="worker-role-select"
                        aria-label="Worker role"
                        disabled={disabled}
                        className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                        value={workerId ?? ""}
                        onChange={(e) => {
                          const rid = e.target.value || null;
                          setWorkerId(rid);
                          cacheNodeEdits(node.id, { worker_id: rid });
                        }}
                      >
                        <option value="">{t(($) => $.detail_panel.select_role)}</option>
                        {roles.map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                      <ActorSummary type="role" id={workerId} label={workerLabel} emptyText={t(($) => $.detail_panel.empty_worker_role)} hint={t(($) => $.detail_panel.actor_role_hint)} />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className={disabled ? "pointer-events-none opacity-60" : undefined}>
                        <AssigneePicker
                          assigneeType={toAssigneeType(workerType)}
                          assigneeId={workerId}
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
                              type={workerType}
                              id={workerId}
                              label={workerLabel}
                              emptyPrefix={t(($) => $.detail_panel.picker_empty_prefix)}
                              t={t}
                            />
                          }
                          onUpdate={disabled ? () => {} : (u) => {
                            const wt = fromAssigneeType(u.assignee_type ?? null);
                            const wid = u.assignee_id ?? null;
                            setWorkerType(wt);
                            setWorkerId(wid);
                            cacheNodeEdits(node.id, { worker_type: wt, worker_id: wid });
                          }}
                          align="start"
                          skipBuiltinRuntimeSelection
                        />
                      </div>
                      <ActorSummary type={workerType} id={workerId} label={workerLabel} emptyText={t(($) => $.detail_panel.empty_worker)} hint={t(($) => $.detail_panel.actor_assignee_hint)} />
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
                  <TypeSegmentedControl<CriticType>
                    label="Critic"
                    value={criticType}
                    disabled={disabled}
                    options={[
                      { value: "human", label: t(($) => $.node.critic_type_human) },
                      { value: "agent", label: t(($) => $.node.critic_type_agent) },
                      { value: "squad", label: t(($) => $.node.critic_type_squad) },
                      { value: "role", label: t(($) => $.node.critic_type_role) },
                      { value: "api", label: t(($) => $.node.critic_type_api) },
                    ]}
                    onChange={(ct) => {
                      setCriticType(ct);
                      setCriticId(null);
                      cacheNodeEdits(node.id, { critic_type: ct, critic_id: null });
                    }}
                  />

                  {criticType === "api" ? (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground" htmlFor="critic-api-url">{t(($) => $.node.critic_api_url_label)}</Label>
                      <Input
                        id="critic-api-url"
                        aria-label="Critic API URL"
                        disabled={disabled}
                        value={criticApiUrl}
                        onChange={(e) => {
                          setCriticApiUrl(e.target.value);
                          cacheNodeEdits(node.id, { critic_api_url: e.target.value });
                        }}
                        placeholder="https://..."
                        className="h-8 text-sm"
                      />
                      <p className="text-[11px] leading-snug text-muted-foreground">{t(($) => $.node.critic_api_url_hint)}</p>
                    </div>
                  ) : criticType === "role" ? (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground" htmlFor="critic-role-select">{t(($) => $.detail_panel.label_critic_role)}</Label>
                      <select
                        id="critic-role-select"
                        aria-label="Critic role"
                        disabled={disabled}
                        className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                        value={criticId ?? ""}
                        onChange={(e) => {
                          const rid = e.target.value || null;
                          setCriticId(rid);
                          cacheNodeEdits(node.id, { critic_id: rid });
                        }}
                      >
                        <option value="">{t(($) => $.detail_panel.select_role)}</option>
                        {roles.map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                      <ActorSummary type="role" id={criticId} label={criticLabel} emptyText={t(($) => $.detail_panel.empty_critic_role)} hint={t(($) => $.detail_panel.actor_role_hint)} />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className={disabled ? "pointer-events-none opacity-60" : undefined}>
                        <AssigneePicker
                          assigneeType={toAssigneeType(criticType)}
                          assigneeId={criticId}
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
                              type={criticType}
                              id={criticId}
                              label={criticLabel}
                              emptyPrefix={t(($) => $.detail_panel.picker_empty_prefix)}
                              t={t}
                            />
                          }
                          onUpdate={disabled ? () => {} : (u) => {
                            const ct = fromAssigneeTypeCritic(u.assignee_type ?? null);
                            const cid = u.assignee_id ?? null;
                            setCriticType(ct);
                            setCriticId(cid);
                            cacheNodeEdits(node.id, { critic_type: ct, critic_id: cid });
                          }}
                          align="start"
                        />
                      </div>
                      <ActorSummary type={criticType} id={criticId} label={criticLabel} emptyText={t(($) => $.detail_panel.empty_critic)} hint={t(($) => $.detail_panel.actor_assignee_hint)} />
                    </div>
                  )}
                </AssignmentCard>

              </>
            ) : null}

        </div>
      </NodeDetailSection>

      <NodeDetailSection
        sectionId="deliverables"
        icon={<FileCheck2 className="size-4" />}
        title={t(($) => $.detail_panel.section_deliverables)}
        subtitle={t(($) => $.detail_panel.section_deliverables_desc)}
      >
        {!isAnnotation && !isGateway ? (
          <NodeDeliverablesEditor
            nodeId={node.id}
            disabled={disabled}
            deliverables={deliverableDrafts}
            onChange={handleDeliverablesChange}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {isGateway ? t(($) => $.detail_panel.deliverables_not_applicable_gateway) : t(($) => $.detail_panel.deliverables_not_applicable_annotation)}
          </p>
        )}
      </NodeDetailSection>

      <NodeDetailSection
        sectionId="runtime"
        icon={<Activity className="size-4" />}
        title={t(($) => $.detail_panel.section_runtime)}
        subtitle={t(($) => $.detail_panel.section_runtime_desc)}
        status={recentNodeRun ? <StatusBadge tone={runTone}>{recentNodeRun.status}</StatusBadge> : <StatusBadge>{t(($) => $.detail_panel.badge_no_run)}</StatusBadge>}
      >
        {recentNodeRun ? (
          <div className="space-y-2">
            <div className={`flex items-start gap-2 rounded-lg border p-3 ${statusClasses(runTone)}`}>
              {runTone === "danger" ? <AlertTriangle className="mt-0.5 size-4" /> : <CheckCircle2 className="mt-0.5 size-4" />}
              <div className="min-w-0">
                    <p className="text-sm font-medium">{t(($) => $.detail_panel.runtime_status_label, { status: recentNodeRun.status })}</p>
                <p className="mt-1 text-[11px] leading-snug opacity-80">
                  {t(($) => $.detail_panel.runtime_hint)}
                </p>
              </div>
            </div>
            <NodeDataPreview nodeRun={recentNodeRun} />
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            {t(($) => $.detail_panel.runtime_no_data)}
          </div>
        )}
      </NodeDetailSection>

      <NodeDetailSection
        sectionId="connections"
        icon={<GitBranch className="size-4" />}
        title={t(($) => $.detail_panel.section_connections)}
        subtitle={t(($) => $.detail_panel.section_connections_desc)}
      >
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>{t(($) => $.detail_panel.connections_stage, { stage: currentStageName })}</p>
          {isGateway ? <p>{t(($) => $.detail_panel.connections_gateway_hint)}</p> : null}
          {isAnnotation && targetNodeId ? (
            <p>{t(($) => $.detail_panel.connections_bound_to, { node: bindableNodes.find((bn) => bn.id === targetNodeId)?.title ?? t(($) => $.detail_panel.empty_unknown_node) })}</p>
          ) : null}
        </div>
      </NodeDetailSection>

      <NodeDetailSection
        sectionId="actions"
        icon={<Trash2 className="size-4" />}
        title={t(($) => $.detail_panel.section_actions)}
        subtitle={t(($) => $.detail_panel.section_actions_desc)}
      >
        {!disabled ? (
          <div className="space-y-2">
            {onSaveNode ? (
              <Button
                size="sm"
                variant="default"
                className="w-full"
                onClick={handleSaveAll}
                disabled={!hasUnsavedChanges || isSavingDeliverables}
              >
                <Save className="mr-1.5 h-3.5 w-3.5" />
                {t(($) => $.detail_panel.save_changes)}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="destructive"
              className="w-full"
              onClick={() => {
                if (onDeleteNode) {
                  onDeleteNode(node.id);
                } else {
                  handleDelete();
                }
              }}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              {deleteMutation.isPending ? t(($) => $.node.saving) : t(($) => $.node.delete)}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t(($) => $.detail_panel.actions_disabled)}</p>
        )}
      </NodeDetailSection>
    </WorkflowNodeDetailPanelShell>
  );
}
