"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, LoaderCircle, MailWarning, RefreshCw, UserRoundCog } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@multica/core/api";
import { useWorkspaceId } from "@multica/core/hooks";
import { memberListOptions } from "@multica/core/workspace/queries";
import { isActiveWorkspaceMember } from "@multica/core/workspace/members";
import {
  workflowRunOptions,
  workflowNodesOptions,
  workflowEdgesOptions,
  workflowNodeRunsOptions,
  workflowRoleResolutionsOptions,
  useAssignWorkflowRoleResolutions,
  useCancelWorkflowRun,
  useRetryWorkflowRoleResolutions,
} from "@multica/core/workflows/queries";
import { PageHeader } from "../../layout/page-header";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Button } from "@multica/ui/components/ui/button";
import { Badge } from "@multica/ui/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@multica/ui/components/ui/alert-dialog";
import { useT } from "../../i18n";
import { DAGCanvas } from "./dag-canvas";
import { ReactFlowProvider } from "@xyflow/react";
import { NodeRunCard } from "./node-run-card";
import { parseNodeFormat, type WorkflowRunStatus, type NodeRunStatus } from "@multica/core/types";
import { useAuthStore } from "@multica/core/auth";
import { SplitReviewPanel } from "./split/split-review-panel";

const RUNNING_STATES = new Set<NodeRunStatus>(["format_checking", "working", "critic_reviewing", "splitting", "split_active"]);
const TERMINAL_RUN_STATES = new Set(["completed", "failed", "cancelled"]);
const STATUS_COLOR: Record<NodeRunStatus, string> = {
  pending: "rgba(107,114,128,0.2)",
  format_checking: "rgba(245,158,11,0.3)",
  format_ok: "rgba(34,197,94,0.25)",
  format_failed: "rgba(239,68,68,0.3)",
  worker_assigned: "rgba(245,158,11,0.25)",
  working: "rgba(59,130,246,0.3)",
  awaiting_input: "rgba(6,182,212,0.3)",
  awaiting_critic: "rgba(168,85,247,0.25)",
  critic_reviewing: "rgba(168,85,247,0.3)",
  critic_approved: "rgba(34,197,94,0.25)",
  critic_rework: "rgba(249,115,22,0.25)",
  splitting: "rgba(59,130,246,0.3)",
  awaiting_split_review: "rgba(245,158,11,0.3)",
  split_active: "rgba(59,130,246,0.3)",
  completed: "rgba(34,197,94,0.3)",
  failed: "rgba(239,68,68,0.3)",
  blocked: "rgba(239,68,68,0.3)",
  skipped: "rgba(107,114,128,0.2)",
  cancelled: "rgba(107,114,128,0.2)",
};

interface WorkflowRunPageProps {
  workflowId: string;
  runId: string;
}

type WorkflowTranslator = ReturnType<typeof useT<"workflows">>["t"];

function formatWorkflowRunStatus(t: WorkflowTranslator, status: WorkflowRunStatus): string {
  switch (status) {
    case "running":
      return t(($) => $.run.status.running);
    case "completed":
      return t(($) => $.run.status.completed);
    case "failed":
      return t(($) => $.run.status.failed);
    case "cancelled":
      return t(($) => $.run.status.cancelled);
    default:
      return status;
  }
}

function formatNodeRunStatus(t: WorkflowTranslator, status: NodeRunStatus): string {
  switch (status) {
    case "pending":
      return t(($) => $.node_run.status.pending);
    case "format_checking":
      return t(($) => $.node_run.status.format_checking);
    case "format_ok":
      return t(($) => $.node_run.status.format_ok);
    case "format_failed":
      return t(($) => $.node_run.status.format_failed);
    case "worker_assigned":
      return t(($) => $.node_run.status.worker_assigned);
    case "working":
      return t(($) => $.node_run.status.working);
    case "awaiting_input":
      return t(($) => $.node_run.status.awaiting_input);
    case "awaiting_critic":
      return t(($) => $.node_run.status.awaiting_critic);
    case "critic_reviewing":
      return t(($) => $.node_run.status.critic_reviewing);
    case "critic_approved":
      return t(($) => $.node_run.status.critic_approved);
    case "critic_rework":
      return t(($) => $.node_run.status.critic_rework);
    case "splitting":
      return t(($) => $.node_run.status.splitting);
    case "awaiting_split_review":
      return t(($) => $.node_run.status.awaiting_split_review);
    case "split_active":
      return t(($) => $.node_run.status.split_active);
    case "completed":
      return t(($) => $.node_run.status.completed);
    case "failed":
      return t(($) => $.node_run.status.failed);
    case "blocked":
      return t(($) => $.node_run.status.blocked);
    case "skipped":
      return t(($) => $.node_run.status.skipped);
    case "cancelled":
      return t(($) => $.node_run.status.cancelled);
    default:
      return status;
  }
}

export function WorkflowRunPage({ workflowId, runId }: WorkflowRunPageProps) {
  const { t } = useT("workflows");
  const wsId = useWorkspaceId();
  const user = useAuthStore((state) => state.user);
  const [selectedSplitNodeId, setSelectedSplitNodeId] = useState<string | null>(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const { data: run, isLoading: runLoading } = useQuery(workflowRunOptions(wsId, workflowId, runId));
  const { data: nodes = [], isLoading: nodesLoading } = useQuery(workflowNodesOptions(wsId, workflowId));
  const { data: edges = [] } = useQuery(workflowEdgesOptions(wsId, workflowId));
  const { data: nodeRuns = [], isLoading: nodeRunsLoading } = useQuery(workflowNodeRunsOptions(wsId, workflowId, runId));
  const { data: resolutions = [], refetch: refetchResolutions } = useQuery(
    workflowRoleResolutionsOptions(wsId, workflowId, runId),
  );
  const { data: members = [] } = useQuery(memberListOptions(wsId));

  const cancelMutation = useCancelWorkflowRun(wsId);
  const assignMutation = useAssignWorkflowRoleResolutions(wsId, workflowId, runId);
  const retryMutation = useRetryWorkflowRoleResolutions(wsId, workflowId, runId);
  const [selections, setSelections] = useState<Record<string, string>>({});

  useEffect(() => {
    setSelections((current) => {
      const next = { ...current };
      for (const resolution of resolutions) {
        if (!(resolution.id in next) && resolution.resolved_user_id) {
          next[resolution.id] = resolution.resolved_user_id;
        }
      }
      return next;
    });
  }, [resolutions]);

  const activeMembers = useMemo(
    () => members.filter((member) => Boolean(member.user_id) && isActiveWorkspaceMember(member)),
    [members],
  );
  const memberNameById = useMemo(
    () => new Map(members.map((member) => [member.user_id, member.name])),
    [members],
  );
  const currentMember = members.find((member) => member.user_id === user?.id);
  const canManageRoles = Boolean(
    user && run && (
      run.triggered_by_id === user.id ||
      currentMember?.role === "owner" ||
      currentMember?.role === "admin"
    ),
  );

  const nodeRunByNodeId = useMemo(() => new Map(nodeRuns.map((nodeRun) => [nodeRun.workflow_node_id, nodeRun])), [nodeRuns]);
  const nodeRunTitleById = useMemo(() => new Map(nodeRuns.map((nodeRun) => [nodeRun.id, nodeRun.node_title])), [nodeRuns]);
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const nodeStatusColors = useMemo(() => {
    const colors: Record<string, string> = {};
    for (const node of nodes) {
      const nodeRun = nodeRunByNodeId.get(node.id);
      if (nodeRun) {
        const status = nodeRun.status as NodeRunStatus;
        colors[node.id] = STATUS_COLOR[status] ?? "fill-muted stroke-muted";
      }
    }
    return colors;
  }, [nodes, nodeRunByNodeId]);
  const nodeStatuses = useMemo(() => {
    const statuses: Record<string, { status: string; isRunning: boolean; isAwaitingInput: boolean }> = {};
    for (const node of nodes) {
      const nodeRun = nodeRunByNodeId.get(node.id);
      if (nodeRun) {
        const status = nodeRun.status as NodeRunStatus;
        statuses[node.id] = {
          status: formatNodeRunStatus(t, status),
          isRunning: RUNNING_STATES.has(status),
          isAwaitingInput: status === "awaiting_input",
        };
      }
    }
    return statuses;
  }, [nodes, nodeRunByNodeId, t]);

  const unresolved = resolutions.filter((resolution) => resolution.status !== "resolved");
  const assignments = resolutions
    .filter((resolution) =>
      Boolean(selections[resolution.id]) &&
      (resolution.status !== "resolved" || selections[resolution.id] !== resolution.resolved_user_id),
    )
    .map((resolution) => ({
      resolution_id: resolution.id,
      user_id: selections[resolution.id]!,
      version: resolution.version,
    }));
  const allUnresolvedSelected = unresolved.every((resolution) => Boolean(selections[resolution.id]));
  const showAssignmentControls = canManageRoles && Boolean(
    run && !TERMINAL_RUN_STATES.has(run.status) &&
    (run.status === "waiting_role_assignment" || unresolved.some((resolution) => resolution.status === "invalidated")),
  );
  const canSubmitAssignments = showAssignmentControls && allUnresolvedSelected && assignments.length > 0;

  const handleAssign = async () => {
    if (!canSubmitAssignments) return;
    try {
      await assignMutation.mutateAsync(assignments);
      toast.success(t(($) => $.run.roles.assignment_saved));
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await refetchResolutions();
        setSelections({});
        toast.error(t(($) => $.run.roles.assignment_conflict));
        return;
      }
      toast.error(error instanceof Error ? error.message : t(($) => $.run.roles.assignment_failed));
    }
  };

  const splitNodeIds = useMemo(
    () => new Set(
      nodes
        .filter((node) => parseNodeFormat(node.format_schema).kind === "split")
        .map((node) => node.id),
    ),
    [nodes],
  );
  const selectedSplitNode = selectedSplitNodeId ? nodeById.get(selectedSplitNodeId) ?? null : null;
  const selectedSplitNodeRun = selectedSplitNodeId ? nodeRunByNodeId.get(selectedSplitNodeId) ?? null : null;

  const handleNodeClick = (nodeId: string) => {
    if (splitNodeIds.has(nodeId)) {
      setSelectedSplitNodeId(nodeId);
    }
  };

  const handleCancel = () => {
    cancelMutation.mutate({ workflowId, runId });
  };

  const handleRetry = async () => {
    try {
      await retryMutation.mutateAsync();
      toast.success(t(($) => $.run.roles.retry_started));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t(($) => $.run.roles.retry_failed));
    }
  };

  const isLoading = runLoading || nodesLoading || nodeRunsLoading;
  if (isLoading) {
    return <div className="flex h-full items-center justify-center"><Skeleton className="h-[400px] w-[600px]" /></div>;
  }
  if (!run) {
    return <div className="flex h-full items-center justify-center"><p className="text-sm text-muted-foreground">{t(($) => $.detail.not_found)}</p></div>;
  }

  const canCancel = run.status === "running" || run.status === "resolving_roles" || run.status === "waiting_role_assignment";
  const roleStateMessage = run.status === "resolving_roles"
    ? t(($) => $.run.roles.resolving)
    : run.status === "waiting_role_assignment"
      ? t(($) => $.run.roles.waiting)
      : unresolved.some((resolution) => resolution.status === "invalidated")
        ? t(($) => $.run.roles.invalidated)
        : "";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <PageHeader className="justify-between px-5 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-sm font-medium truncate">{run.workflow_title}</h1>
          <Badge variant="secondary" className="text-[10px] px-1.5 h-4">
            {formatWorkflowRunStatus(t, run.status as WorkflowRunStatus)}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {canCancel && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCancelDialogOpen(true)}
              disabled={cancelMutation.isPending}
            >
              {cancelMutation.isPending ? t(($) => $.run.cancelling) : t(($) => $.run.cancel)}
            </Button>
          )}
        </div>
      </PageHeader>

      {roleStateMessage ? (
        <div className="flex items-center gap-2 border-b bg-amber-50 px-5 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          {run.status === "resolving_roles" ? <LoaderCircle className="size-4 animate-spin" /> : <AlertTriangle className="size-4" />}
          <span>{roleStateMessage}</span>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="flex-1 bg-muted/20">
          {nodes.length > 0 ? (
            <ReactFlowProvider>
              <DAGCanvas
                nodes={nodes}
                edges={edges}
                nodeStatusColors={nodeStatusColors}
                nodeStatuses={nodeStatuses}
                onNodeClick={handleNodeClick}
              />
            </ReactFlowProvider>
          ) : (
            <div className="flex h-full items-center justify-center"><p className="text-sm text-muted-foreground">{t(($) => $.detail.no_nodes)}</p></div>
          )}
        </div>
        <aside className="w-96 shrink-0 space-y-4 overflow-y-auto border-l bg-card p-3">
          {resolutions.length > 0 ? (
            <section className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <UserRoundCog className="size-3.5" />
                  {t(($) => $.run.roles.title)}
                </h3>
                {canManageRoles && unresolved.length > 0 ? (
                  <Button type="button" variant="ghost" size="sm" disabled={retryMutation.isPending || run.status === "resolving_roles"} onClick={() => void handleRetry()}>
                    <RefreshCw className={retryMutation.isPending ? "mr-1 size-3 animate-spin" : "mr-1 size-3"} />
                    {t(($) => $.run.roles.retry)}
                  </Button>
                ) : null}
              </div>

              {resolutions.map((resolution) => {
                const editable = showAssignmentControls && (run.status === "waiting_role_assignment" || resolution.status !== "resolved");
                const notificationFailed = resolution.notification_status === "failed" || resolution.notification_status === "skipped_no_email";
                return (
                  <article key={resolution.id} className="space-y-2 rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs text-muted-foreground">{nodeRunTitleById.get(resolution.workflow_node_run_id) ?? t(($) => $.run.roles.unknown_node)}</p>
                        <p className="text-sm font-medium">{resolution.role_name} → {resolution.slot_type === "worker" ? t(($) => $.run.roles.worker) : t(($) => $.run.roles.critic)}</p>
                      </div>
                      <Badge variant="secondary" className="shrink-0 text-[10px]">{t(($) => ($.run.roles.status as Record<string, string>)[resolution.status] ?? resolution.status)}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{resolution.role_description}</p>
                    {editable ? (
                      <select
                        className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                        value={selections[resolution.id] ?? ""}
                        onChange={(event) => setSelections((current) => ({ ...current, [resolution.id]: event.target.value }))}
                      >
                        <option value="">{t(($) => $.run.roles.select_member)}</option>
                        {activeMembers.map((member) => <option key={member.user_id} value={member.user_id}>{member.name}</option>)}
                      </select>
                    ) : resolution.resolved_user_id ? (
                      <p className="text-sm">{t(($) => $.run.roles.assigned_to, { name: memberNameById.get(resolution.resolved_user_id) ?? resolution.resolved_user_id })}</p>
                    ) : null}
                    {resolution.reason_code ? <p className="text-[11px] text-muted-foreground">{t(($) => $.run.roles.reason, { code: resolution.reason_code })}{resolution.reason_detail ? " · " + resolution.reason_detail : ""}</p> : null}
                    {notificationFailed ? (
                      <p className="flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300"><MailWarning className="size-3" />{t(($) => $.run.roles.notification_failed)}</p>
                    ) : null}
                  </article>
                );
              })}

              {showAssignmentControls ? (
                <Button className="w-full" size="sm" disabled={!canSubmitAssignments || assignMutation.isPending} onClick={() => void handleAssign()}>
                  {assignMutation.isPending ? t(($) => $.run.roles.assigning) : t(($) => $.run.roles.assign_continue)}
                </Button>
              ) : null}
            </section>
          ) : null}

          <section className="space-y-2">
            <h3 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t(($) => $.run.node_runs)}</h3>
            {nodeRuns.map((nodeRun) => (
              <NodeRunCard
                key={nodeRun.id}
                nodeRun={nodeRun}
                maxRetries={3}
                workflowId={workflowId}
                runId={runId}
                isSplitNode={splitNodeIds.has(nodeRun.workflow_node_id)}
                onOpenSplit={() => setSelectedSplitNodeId(nodeRun.workflow_node_id)}
              />
            ))}
          </section>
        </aside>
      </div>
      {selectedSplitNode ? (
        <SplitReviewPanel
          node={selectedSplitNode}
          nodeRun={selectedSplitNodeRun}
          wsId={wsId}
          workflowId={workflowId}
          runId={runId}
          onClose={() => setSelectedSplitNodeId(null)}
        />
      ) : null}
      <AlertDialog
        open={cancelDialogOpen}
        onOpenChange={(open) => {
          if (!cancelMutation.isPending) setCancelDialogOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(($) => $.cancel_dialog.title)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $.cancel_dialog.description)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelMutation.isPending}>
              {t(($) => $.cancel_dialog.keep)}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={cancelMutation.isPending}
              onClick={handleCancel}
            >
              {cancelMutation.isPending ? t(($) => $.run.cancelling) : t(($) => $.cancel_dialog.confirm)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
