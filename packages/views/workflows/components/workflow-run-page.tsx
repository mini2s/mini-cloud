"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CircleUserRound, LoaderCircle, MailWarning, RefreshCw, UserRoundCog } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@multica/core/api";
import { useWorkspaceId } from "@multica/core/hooks";
import { memberListOptions } from "@multica/core/workspace/queries";
import { isActiveWorkspaceMember } from "@multica/core/workspace/members";
import {
  workflowRunOptions,
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
import {
  type WorkflowRunStatus,
  type WorkflowRuntimeSelectionPolicy,
} from "@multica/core/types";
import { useAuthStore } from "@multica/core/auth";
import { ExecutionPanoramaPage } from "../../issues/components/execution";

const TERMINAL_RUN_STATES = new Set(["completed", "failed", "cancelled"]);

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

function formatRuntimeSelectionPolicy(
  t: WorkflowTranslator,
  policy: WorkflowRuntimeSelectionPolicy | undefined,
): string {
  switch (policy) {
    case "specified_runtime_first":
      return t(($) => $.run.runtime_policy_specified);
    case "issue_creator_first":
      return t(($) => $.run.runtime_policy_issue_creator);
    default:
      return t(($) => $.run.runtime_policy_idle);
  }
}

// Resolution rows snapshot the built-in role name as the English identifier
// (developer/qa/tech_lead). Map those to localized labels so the role-assignment
// panel stays in the active locale; custom roles fall through to their raw name.
function formatRoleName(t: WorkflowTranslator, rawName: string): string {
  if (rawName === "developer") return t(($) => $.builtin_roles.developer.name);
  if (rawName === "qa") return t(($) => $.builtin_roles.qa.name);
  if (rawName === "tech_lead") return t(($) => $.builtin_roles.tech_lead.name);
  return rawName;
}

function formatRoleDescription(t: WorkflowTranslator, rawName: string, rawDescription: string): string {
  if (rawName === "developer") return t(($) => $.builtin_roles.developer.description);
  if (rawName === "qa") return t(($) => $.builtin_roles.qa.description);
  if (rawName === "tech_lead") return t(($) => $.builtin_roles.tech_lead.description);
  return rawDescription;
}

// Reason codes are a stable API contract and are intended for UI
// internationalization. reason_detail is free-form audit context, so it must
// not leak model-generated English into the localized user-facing panel.
function formatRoleResolutionReason(t: WorkflowTranslator, reasonCode: string): string {
  switch (reasonCode) {
    case "matched_position":
      return t(($) => $.run.roles.reason_codes.matched_position);
    case "matched_department":
      return t(($) => $.run.roles.reason_codes.matched_department);
    case "insufficient_data":
      return t(($) => $.run.roles.reason_codes.insufficient_data);
    case "no_candidate":
      return t(($) => $.run.roles.reason_codes.no_candidate);
    case "candidate_limit_exceeded":
      return t(($) => $.run.roles.reason_codes.candidate_limit_exceeded);
    case "slot_limit_exceeded":
      return t(($) => $.run.roles.reason_codes.slot_limit_exceeded);
    case "input_limit_exceeded":
      return t(($) => $.run.roles.reason_codes.input_limit_exceeded);
    case "org_service_unavailable":
      return t(($) => $.run.roles.reason_codes.org_service_unavailable);
    case "invalid_org_identity":
      return t(($) => $.run.roles.reason_codes.invalid_org_identity);
    case "prompt_injection_suspected":
      return t(($) => $.run.roles.reason_codes.prompt_injection_suspected);
    case "invalid_model_output":
      return t(($) => $.run.roles.reason_codes.invalid_model_output);
    case "resolver_not_configured":
      return t(($) => $.run.roles.reason_codes.resolver_not_configured);
    case "resolver_unavailable":
      return t(($) => $.run.roles.reason_codes.resolver_unavailable);
    case "member_inactive":
      return t(($) => $.run.roles.reason_codes.member_inactive);
    case "manual_assignment":
      return t(($) => $.run.roles.reason_codes.manual_assignment);
    default:
      return t(($) => $.run.roles.reason_codes.unknown);
  }
}

function workflowRoleRetryErrorCode(error: ApiError): string | null {
  if (!error.body || typeof error.body !== "object") return null;
  const code = (error.body as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function formatWorkflowRoleRetryError(t: WorkflowTranslator, error: unknown): string {
  if (!(error instanceof ApiError)) {
    return t(($) => $.run.roles.retry_failed);
  }

  switch (workflowRoleRetryErrorCode(error)) {
    case "workflow_role_retry_rate_limited":
      return t(($) => $.run.roles.retry_errors.rate_limited);
    case "workflow_role_resolution_limit":
      return t(($) => $.run.roles.retry_errors.workspace_limit);
    case "workflow_role_retry_active":
      return t(($) => $.run.roles.retry_errors.already_active);
    case "workflow_role_no_unresolved":
      return t(($) => $.run.roles.retry_errors.no_unresolved);
    case "workflow_role_retry_unavailable":
      return t(($) => $.run.roles.retry_errors.unavailable);
    case "workflow_role_stage_started":
      return t(($) => $.run.roles.retry_errors.stage_started);
    case "workflow_run_not_found":
      return t(($) => $.run.roles.retry_errors.run_not_found);
    case "workflow_role_retry_failed":
      return t(($) => $.run.roles.retry_failed);
  }

  // Compatibility with servers deployed before structured retry error codes.
  switch (error.status) {
    case 401:
    case 403:
      return t(($) => $.run.roles.retry_errors.permission_denied);
    case 404:
      return t(($) => $.run.roles.retry_errors.run_not_found);
    case 409:
      return t(($) => $.run.roles.retry_errors.conflict);
    case 429:
      return t(($) => $.run.roles.retry_errors.limited);
    case 503:
      return t(($) => $.run.roles.retry_errors.unavailable);
    default:
      return t(($) => $.run.roles.retry_failed);
  }
}

export function WorkflowRunPage({ workflowId, runId }: WorkflowRunPageProps) {
  const { t } = useT("workflows");
  const wsId = useWorkspaceId();
  const user = useAuthStore((state) => state.user);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const { data: run, isLoading: runLoading } = useQuery(workflowRunOptions(wsId, workflowId, runId));
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
  const issueId = useMemo(() => {
    if (!run?.input || typeof run.input !== "object" || Array.isArray(run.input)) return undefined;
    const value = (run.input as Record<string, unknown>).issue_id;
    return typeof value === "string" && value ? value : undefined;
  }, [run?.input]);
  const canManageRoles = Boolean(
    user && run && (!currentMember || isActiveWorkspaceMember(currentMember)),
  );

  const nodeRunTitleById = useMemo(() => new Map(nodeRuns.map((nodeRun) => [nodeRun.id, nodeRun.node_title])), [nodeRuns]);

  const unresolved = resolutions.filter((resolution) => resolution.status !== "resolved");
  const manuallyAssignable = resolutions.filter(
    (resolution) => resolution.status === "needs_human" || resolution.status === "invalidated",
  );
  const manuallyAssignableIds = new Set(manuallyAssignable.map((resolution) => resolution.id));
  const assignments = manuallyAssignable
    .filter((resolution) =>
      Boolean(selections[resolution.id]) &&
      selections[resolution.id] !== resolution.resolved_user_id,
    )
    .map((resolution) => ({
      resolution_id: resolution.id,
      user_id: selections[resolution.id]!,
      version: resolution.version,
    }));
  const allManuallyAssignableSelected = manuallyAssignable.every(
    (resolution) => Boolean(selections[resolution.id]),
  );
  const showAssignmentControls = canManageRoles && Boolean(
    run && !TERMINAL_RUN_STATES.has(run.status) &&
    manuallyAssignable.length > 0,
  );
  const canSubmitAssignments =
    showAssignmentControls && allManuallyAssignableSelected && assignments.length > 0;

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

  const handleCancel = () => {
    cancelMutation.mutate({ workflowId, runId });
  };

  const handleRetry = async () => {
    try {
      await retryMutation.mutateAsync();
      toast.success(t(($) => $.run.roles.retry_started));
    } catch (error) {
      toast.error(formatWorkflowRoleRetryError(t, error));
    }
  };

  const isLoading = runLoading || nodeRunsLoading;
  if (isLoading) {
    return <div className="flex h-full items-center justify-center"><Skeleton className="h-[400px] w-[600px]" /></div>;
  }
  if (!run) {
    return <div className="flex h-full items-center justify-center"><p className="text-sm text-muted-foreground">{t(($) => $.detail.not_found)}</p></div>;
  }

  const canCancel = run.status === "running" || run.status === "resolving_roles" || run.status === "waiting_role_assignment";
  const isLegacyRun = (run.definition_schema_version ?? 0) <= 0 || !run.definition_snapshot;
  const roleStateMessage = run.status === "resolving_roles"
    ? t(($) => $.run.roles.resolving)
    : run.status === "waiting_role_assignment"
      ? t(($) => $.run.roles.waiting)
      : manuallyAssignable.length > 0
        ? manuallyAssignable.some((resolution) => resolution.status === "invalidated")
          ? t(($) => $.run.roles.invalidated)
          : t(($) => $.run.roles.waiting)
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
          <Badge variant="outline" className="text-[10px] px-1.5 h-4">
            {t(($) => $.run.runtime_policy)}: {formatRuntimeSelectionPolicy(t, run.runtime_selection_policy)}
          </Badge>
          {isLegacyRun ? (
            <Badge variant="outline" className="text-[10px] px-1.5 h-4">
              {t(($) => $.run.historical_config_incomplete)}
            </Badge>
          ) : null}
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
        <div className="min-w-0 flex-1">
          <ExecutionPanoramaPage
            workflowId={workflowId}
            runId={runId}
            wsId={wsId}
            issueId={issueId}
            fillAvailableHeight
            showRoleAssignmentEntry={false}
          />
        </div>
        {resolutions.length > 0 ? (
          <aside className="w-96 shrink-0 overflow-y-auto border-l bg-card p-3">
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

              {!canManageRoles && manuallyAssignable.length > 0 ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                  {t(($) => $.run.roles.assignment_permission_required)}
                </p>
              ) : null}

              {resolutions.map((resolution) => {
                const editable = showAssignmentControls && manuallyAssignableIds.has(resolution.id);
                const notificationFailed = resolution.notification_status === "failed" || resolution.notification_status === "skipped_no_email";
                const roleName = formatRoleName(t, resolution.role_name);
                const resolvedMemberName = resolution.resolved_user_id
                  ? memberNameById.get(resolution.resolved_user_id) ?? resolution.resolved_user_id
                  : null;
                const sourceLabel = resolution.source === "llm"
                  ? t(($) => $.run.roles.mapping_source_llm)
                  : resolution.source === "manual"
                    ? t(($) => $.run.roles.mapping_source_manual)
                    : null;
                return (
                  <article key={resolution.id} className="space-y-2 rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-xs text-muted-foreground">
                        {nodeRunTitleById.get(resolution.workflow_node_run_id) ?? t(($) => $.run.roles.unknown_node)}
                      </p>
                      <div className="flex shrink-0 items-center gap-1">
                        <Badge variant="outline" className="text-[10px]">
                          {resolution.slot_type === "worker" ? t(($) => $.run.roles.worker) : t(($) => $.run.roles.critic)}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px]">
                          {t(($) => ($.run.roles.status as Record<string, string>)[resolution.status] ?? resolution.status)}
                        </Badge>
                      </div>
                    </div>
                    <div
                      data-testid={`role-mapping-${resolution.id}`}
                      className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1.25fr)] items-center gap-2 rounded-md border bg-muted/25 p-2"
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                          <UserRoundCog className="size-3.5" />
                        </span>
                        <span className="min-w-0 truncate text-xs font-semibold" title={roleName}>{roleName}</span>
                      </span>
                      <ArrowRight className="size-3.5 shrink-0 text-primary" />
                      {editable ? (
                        <select
                          aria-label={t(($) => $.run.roles.select_member_for_role, { role: roleName })}
                          className="flex h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs"
                          value={selections[resolution.id] ?? ""}
                          onChange={(event) => setSelections((current) => ({ ...current, [resolution.id]: event.target.value }))}
                        >
                          <option value="">{t(($) => $.run.roles.select_member)}</option>
                          {activeMembers.map((member) => <option key={member.user_id} value={member.user_id}>{member.name}</option>)}
                        </select>
                      ) : resolvedMemberName ? (
                        <span className="flex min-w-0 items-center gap-1.5">
                          <CircleUserRound className="size-4 shrink-0 text-foreground/70" />
                          <span className="min-w-0 truncate text-xs font-semibold" title={resolvedMemberName}>{resolvedMemberName}</span>
                        </span>
                      ) : (
                        <span className="truncate text-xs text-muted-foreground">{t(($) => $.run.roles.mapping_pending)}</span>
                      )}
                    </div>
                    {sourceLabel ? (
                      <div className="flex justify-end">
                        <Badge variant="outline" className="text-[10px] text-primary">{sourceLabel}</Badge>
                      </div>
                    ) : null}
                    <p className="text-xs text-muted-foreground">{formatRoleDescription(t, resolution.role_name, resolution.role_description)}</p>
                    {resolution.reason_code ? (
                      <p className="text-[11px] text-muted-foreground">
                        {t(($) => $.run.roles.reason, {
                          reason: formatRoleResolutionReason(t, resolution.reason_code),
                        })}
                      </p>
                    ) : null}
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
          </aside>
        ) : null}
      </div>
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
