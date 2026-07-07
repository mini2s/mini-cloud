"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import {
  useCreateStage,
  useDeleteNode,
  useAssignNodeToStage,
  workflowRolesOptions,
} from "@multica/core/workflows/queries";
import { useWorkflowEditorStore } from "@multica/core/workflows/store";
import { AssigneePicker } from "../../issues/components/pickers/assignee-picker";
import { parseNodeFormat, type WorkflowNode, type WorkflowNodeRun, type WorkflowStage, type WorkerType, type CriticType } from "@multica/core/types";
import type { IssueAssigneeType } from "@multica/core/types/issue";
import { NodeDeliverablesEditor } from "./node-deliverables-editor";
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

function toFormatSchemaString(fs: unknown): string {
  if (!fs) return "";
  if (typeof fs === "string") return fs;
  return JSON.stringify(fs, null, 2);
}

function parseFormatSchemaValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return raw;
  }
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
  emptyText,
}: {
  type: string;
  id: string | null;
  emptyText: string;
}) {
  const Icon = type === "agent" ? Bot : type === "squad" ? Users : type === "role" ? ShieldCheck : User;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-2.5 py-2">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium">{id ? `${type}: ${id}` : emptyText}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {type === "role" ? "Resolved when the workflow runs" : "Pick a concrete assignee for predictable execution"}
        </p>
      </div>
    </div>
  );
}

function pickerTriggerLabel(type: string, id: string | null, emptyPrefix: string): string {
  if (id) return `${type}: ${id}`;
  if (type === "human") return `${emptyPrefix} Human`;
  if (type === "agent") return `${emptyPrefix} Agent`;
  if (type === "squad") return `${emptyPrefix} Squad`;
  return emptyPrefix;
}

function gatewayLabel(kind: "fork" | "join" | null): string {
  if (kind === "join") return "Join gateway";
  if (kind === "fork") return "Fork gateway";
  return "Gateway";
}

function gatewayDescription(kind: "fork" | "join" | null): string {
  if (kind === "join") return "Waits for all upstream nodes to finish, then automatically completes and continues downstream.";
  if (kind === "fork") return "Automatically completes and fans out to all downstream nodes.";
  return "Gateway kind is invalid. Choose Fork or Join before publishing.";
}

function AssigneePickerTrigger({
  type,
  id,
  emptyPrefix,
}: {
  type: string;
  id: string | null;
  emptyPrefix: string;
}) {
  const Icon = type === "agent" ? Bot : type === "squad" ? Users : User;
  return (
    <>
      <Icon className="size-3.5 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-left">
        {pickerTriggerLabel(type, id, emptyPrefix)}
      </span>
    </>
  );
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
  onSaveNode?: () => void;
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
  onClose,
  onDeleteNode,
  onStageChange,
}: NodeConfigPanelProps) {
  const { t } = useT("workflows");
  const wsId = useWorkspaceId();
  const deleteMutation = useDeleteNode(wsId, workflowId);
  const assignStageMutation = useAssignNodeToStage(wsId, workflowId);
  const createStageMutation = useCreateStage(wsId, workflowId);
  const nodeEdits = useWorkflowEditorStore((s) => s.nodeEdits);
  const undoRedoVersion = useWorkflowEditorStore((s) => s._undoRedoVersion);
  const cacheNodeEdits = useWorkflowEditorStore((s) => s.cacheNodeEdits);
  const { data: roles = [] } = useQuery(workflowRolesOptions(wsId));

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
  const [formatSchema, setFormatSchema] = useState<string>(
    toFormatSchemaString(saved?.format_schema ?? node.format_schema),
  );
  const [workerType, setWorkerType] = useState(saved?.worker_type ?? node.worker_type);
  const [workerId, setWorkerId] = useState<string | null>(saved?.worker_id ?? node.worker_id ?? null);
  const [criticType, setCriticType] = useState(saved?.critic_type ?? node.critic_type);
  const [criticId, setCriticId] = useState<string | null>(saved?.critic_id ?? node.critic_id ?? null);
  const [criticApiUrl, setCriticApiUrl] = useState(saved?.critic_api_url ?? node.critic_api_url ?? "");
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
    setFormatSchema(toFormatSchemaString(s?.format_schema ?? node.format_schema));
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

  return (
    <WorkflowNodeDetailPanelShell
      mode="edit"
      title={title || t(($) => $.node.title)}
      eyebrow="Node inspector"
      closeLabel="Close node inspector"
      onClose={onClose}
      badges={(
        <>
          <StatusBadge>{currentStageName}</StatusBadge>
          {recentNodeRun ? (
            <StatusBadge tone={runTone}>
              <Activity className="size-3" />
              Latest run: {recentNodeRun.status}
            </StatusBadge>
          ) : (
            <StatusBadge>No run data</StatusBadge>
          )}
        </>
      )}
    >
      <NodeDetailSection
        sectionId="primary"
        icon={<GitBranch className="size-4" />}
        title="Primary"
        subtitle="Definition fields and ownership for this workflow node."
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
                title="Annotation binding"
                subtitle="Attach this note to a workflow node."
              >
                <Label className="text-xs text-muted-foreground">Bind to Node</Label>
                {targetNodeId ? (
                  <div className="flex items-center gap-1.5 rounded-md border px-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {bindableNodes.find((bn) => bn.id === targetNodeId)?.title ?? "Unknown node"}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      onClick={() => {
                        let obj: Record<string, unknown> = {};
                        try {
                          const parsed = JSON.parse(formatSchema || "{}");
                          if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
                            obj = parsed as Record<string, unknown>;
                          }
                        } catch {
                          // Keep the current object shape when the JSON is incomplete.
                        }
                        delete obj.annotation_target_node_id;
                        cacheNodeEdits(node.id, { format_schema: obj });
                        setFormatSchema(JSON.stringify(obj, null, 2));
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
                      let obj: Record<string, unknown> = {};
                      try {
                        const parsed = JSON.parse(formatSchema || "{}");
                        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
                          obj = parsed as Record<string, unknown>;
                        }
                      } catch {
                        // Keep the current object shape when the JSON is incomplete.
                      }
                      obj.annotation_target_node_id = tid;
                      cacheNodeEdits(node.id, { format_schema: obj });
                      setFormatSchema(JSON.stringify(obj, null, 2));
                    }}
                  >
                    <option value="">Select a node...</option>
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
                title={gatewayLabel(nodeFormat.gateway_kind)}
                subtitle="Gateway nodes control DAG flow and do not run worker or critic tasks."
                status={<StatusBadge tone={nodeFormat.gateway_kind_valid ? "success" : "danger"}>{nodeFormat.gateway_kind_valid ? "Valid" : "Invalid"}</StatusBadge>}
              >
                <p className="text-sm text-muted-foreground">{gatewayDescription(nodeFormat.gateway_kind)}</p>
              </InspectorSection>
            ) : null}

            {!isAnnotation && !isGateway ? (
              <>
                <AssignmentCard
                  icon={<Bot className="size-4" />}
                  title={t(($) => $.node.section_worker)}
                  subtitle="Who performs this workflow step."
                  status={workerConfigured ? <StatusBadge tone="success">Configured</StatusBadge> : <StatusBadge tone="warning">Needs assignee</StatusBadge>}
                >
                  <TypeSegmentedControl<WorkerType>
                    label="Worker"
                    value={workerType}
                    disabled={disabled}
                    options={[
                      { value: "human", label: t(($) => $.node.worker_type_human) },
                      { value: "agent", label: t(($) => $.node.worker_type_agent) },
                      { value: "squad", label: t(($) => $.node.worker_type_squad) },
                      { value: "role", label: "Role" },
                    ]}
                    onChange={(wt) => {
                      setWorkerType(wt);
                      setWorkerId(null);
                      cacheNodeEdits(node.id, { worker_type: wt, worker_id: null });
                    }}
                  />

                  {workerType === "role" ? (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground" htmlFor="worker-role-select">Worker role</Label>
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
                        <option value="">Select a role...</option>
                        {roles.map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                      <ActorSummary type="role" id={workerId} emptyText="No worker role selected" />
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
                              emptyPrefix="Select existing"
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
                      <ActorSummary type={workerType} id={workerId} emptyText="No worker selected" />
                    </div>
                  )}
                </AssignmentCard>

                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-1 text-[11px] font-medium text-muted-foreground">
                  <span className="h-px bg-border" />
                  <span>Worker output moves to Critic review</span>
                  <span className="h-px bg-border" />
                </div>

                <AssignmentCard
                  icon={<ShieldCheck className="size-4" />}
                  title={t(($) => $.node.section_critic)}
                  subtitle="Who reviews or validates the worker output."
                  status={criticConfigured ? <StatusBadge tone="success">Configured</StatusBadge> : <StatusBadge>Optional</StatusBadge>}
                >
                  <TypeSegmentedControl<CriticType>
                    label="Critic"
                    value={criticType}
                    disabled={disabled}
                    options={[
                      { value: "human", label: t(($) => $.node.critic_type_human) },
                      { value: "agent", label: t(($) => $.node.critic_type_agent) },
                      { value: "squad", label: t(($) => $.node.critic_type_squad) },
                      { value: "role", label: "Role" },
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
                      <Label className="text-xs text-muted-foreground" htmlFor="critic-role-select">Critic role</Label>
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
                        <option value="">Select a role...</option>
                        {roles.map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                      <ActorSummary type="role" id={criticId} emptyText="No critic role selected" />
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
                              emptyPrefix="Select existing"
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
                      <ActorSummary type={criticType} id={criticId} emptyText="No critic selected" />
                    </div>
                  )}
                </AssignmentCard>

              </>
            ) : null}

            <details className="group overflow-hidden rounded-lg border border-dashed bg-background">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground">
                    <Braces className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">Advanced</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{t(($) => $.node.format_schema_label)}</span>
                  </span>
                </span>
                <StatusBadge>Collapsed</StatusBadge>
              </summary>
              <div className="space-y-1.5 border-t p-3">
                <Textarea
                  disabled={disabled}
                  value={formatSchema}
                  onChange={(e) => {
                    setFormatSchema(e.target.value);
                    cacheNodeEdits(node.id, { format_schema: parseFormatSchemaValue(e.target.value) });
                  }}
                  placeholder="{}"
                  className="min-h-[96px] text-sm font-mono"
                  rows={5}
                />
                <p className="text-[11px] text-muted-foreground">{t(($) => $.node.format_schema_hint)}</p>
              </div>
            </details>
        </div>
      </NodeDetailSection>

      <NodeDetailSection
        sectionId="deliverables"
        icon={<FileCheck2 className="size-4" />}
        title="Deliverables"
        subtitle="Required documents or pull requests for this node."
      >
        {!isAnnotation && !isGateway ? (
          <NodeDeliverablesEditor
            workflowId={workflowId}
            nodeId={node.id}
            disabled={disabled}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {isGateway ? "Gateway nodes do not define deliverables." : "Annotation nodes do not define deliverables."}
          </p>
        )}
      </NodeDetailSection>

      <NodeDetailSection
        sectionId="runtime"
        icon={<Activity className="size-4" />}
        title="Runtime"
        subtitle="Latest run context for this node."
        status={recentNodeRun ? <StatusBadge tone={runTone}>{recentNodeRun.status}</StatusBadge> : <StatusBadge>No run</StatusBadge>}
      >
        {recentNodeRun ? (
          <div className="space-y-2">
            <div className={`flex items-start gap-2 rounded-lg border p-3 ${statusClasses(runTone)}`}>
              {runTone === "danger" ? <AlertTriangle className="mt-0.5 size-4" /> : <CheckCircle2 className="mt-0.5 size-4" />}
              <div className="min-w-0">
                    <p className="text-sm font-medium">Status: {recentNodeRun.status}</p>
                <p className="mt-1 text-[11px] leading-snug opacity-80">
                  Worker output, critic output and comments remain available in this runtime section.
                </p>
              </div>
            </div>
            <NodeDataPreview nodeRun={recentNodeRun} />
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No run data for this node yet.
          </div>
        )}
      </NodeDetailSection>

      <NodeDetailSection
        sectionId="connections"
        icon={<GitBranch className="size-4" />}
        title="Connections"
        subtitle="Canvas topology stays visible in the editor while details focus on the selected node."
      >
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>Stage: {currentStageName}</p>
          {isGateway ? <p>Gateway edge counts and topology are shown on the canvas.</p> : null}
          {isAnnotation && targetNodeId ? (
            <p>Bound to: {bindableNodes.find((bn) => bn.id === targetNodeId)?.title ?? "Unknown node"}</p>
          ) : null}
        </div>
      </NodeDetailSection>

      <NodeDetailSection
        sectionId="actions"
        icon={<Trash2 className="size-4" />}
        title="Actions"
        subtitle="Definition-level operations for this node."
      >
        {!disabled ? (
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
        ) : (
          <p className="text-sm text-muted-foreground">Node actions are disabled in this context.</p>
        )}
      </NodeDetailSection>
    </WorkflowNodeDetailPanelShell>
  );
}
