"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronRight, Circle, Copy, LoaderCircle, Monitor, X } from "lucide-react";
import { useWorkspaceId } from "@multica/core/hooks";
import { isEmbeddedInCostrict, postCostrictNavigateToSession } from "@multica/core/platform";
import { workflowRunCanvasSummaryOptions, splitTasksOptions } from "@multica/core/workflows/queries";
import { runtimeListOptions } from "@multica/core/runtimes/queries";
import type {
  RuntimeDevice,
  WorkflowNodeDiagnostics,
  WorkflowNodeRun,
  WorkflowNodeRuntimeSummary,
  WorkflowRun,
  WorkflowRunStatus,
} from "@multica/core/types";
import { useWorkspacePaths } from "@multica/core/paths";
import { PageHeader } from "../../layout/page-header";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Badge } from "@multica/ui/components/ui/badge";
import { useNavigation } from "../../navigation";
import { useT } from "../../i18n";
import { formatRuntimeDuration } from "../../issues/components/execution/runtime-node-duration";

type Translator = ReturnType<typeof useT<"workflows">>["t"];

interface RunDiagnosticsPageProps {
  workflowId: string;
  runId: string;
}

const TERMINAL_DISPLAY_STATUSES = new Set(["completed", "blocked", "cancelled"]);

function formatRunStatus(t: Translator, status: string): string {
  switch (status as WorkflowRunStatus) {
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

// The i18next selector API returns the full key path for missing keys
// ("run.diagnostics.stage.xxx"). When that happens, surface just the raw
// suffix so a newer server's enum value stays readable (enum drift
// downgrades, never crashes).
function unkey(translated: string, keyPrefix: string, raw: string): string {
  return translated === `${keyPrefix}${raw}` ? raw : translated;
}

function stageLabel(t: Translator, stage: string): string {
  return unkey(
    t(($) => ($.run.diagnostics.stage as Record<string, string>)[stage] ?? stage),
    "run.diagnostics.stage.",
    stage,
  );
}

function splitStatusLabel(t: Translator, status: string): string {
  return unkey(
    t(($) => ($.run.diagnostics.split_status as Record<string, string>)[status] ?? status),
    "run.diagnostics.split_status.",
    status,
  );
}

// The backend sends i18n keys ("hint.failure.timeout", "hint.stage.running").
// Translate by indexing the hint tables inside the selector — the i18next
// selector proxy only supports direct property access, so walking the
// resource tree with a loop crashes it.
function hintText(t: Translator, hint: string): string {
  if (hint === "hint.running_retry") {
    return t(($) => $.run.diagnostics.hint.running_retry);
  }
  if (hint.startsWith("hint.failure.")) {
    const reason = hint.slice("hint.failure.".length);
    return unkey(
      t(($) => ($.run.diagnostics.hint.failure as Record<string, string>)[reason] ?? reason),
      "run.diagnostics.hint.failure.",
      reason,
    );
  }
  if (hint.startsWith("hint.stage.")) {
    const stage = hint.slice("hint.stage.".length);
    return unkey(
      t(($) => ($.run.diagnostics.hint.stage as Record<string, string>)[stage] ?? stage),
      "run.diagnostics.hint.stage.",
      stage,
    );
  }
  return hint;
}

function formatTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString();
}

type StepState = "done" | "active" | "failed" | "todo";

function splitStepState(status: string): StepState {
  switch (status) {
    case "done":
      return "done";
    case "running":
      return "active";
    case "failed":
      return "failed";
    default:
      return "todo";
  }
}

function StepIcon({ state }: { state: StepState }) {
  switch (state) {
    case "done":
      return <Check className="size-3 text-emerald-500" />;
    case "active":
      return <LoaderCircle className="size-3 animate-spin text-blue-500" />;
    case "failed":
      return <X className="size-3 text-destructive" />;
    default:
      return <Circle className="size-3 text-muted-foreground/40" />;
  }
}

// Lifecycle progression shown per node: dispatch → claim → execute.
// Derived from the backend-computed lifecycle_stage plus the current task's
// real state. A terminal node WITHOUT a task was cancelled before dispatch
// (fail-fast sibling) — showing all steps done would contradict "no task
// dispatched yet", so every step stays untouched.
export function nodeStepStates(
  diagnostics: WorkflowNodeDiagnostics | null,
): [StepState, StepState, StepState] {
  const stage = diagnostics?.lifecycle_stage;
  const task = diagnostics?.current_task ?? null;
  switch (stage) {
    case "dispatching":
      return ["active", "todo", "todo"];
    case "dispatched":
      return ["done", "active", "todo"];
    case "running":
    case "awaiting_review":
      return ["done", "done", "active"];
    case "terminal": {
      if (!task) return ["todo", "todo", "todo"];
      if (task.status === "completed") return ["done", "done", "done"];
      // A cancelled task's status alone can't tell how far it got — key off
      // the timestamps: no dispatched_at means it never left the queue.
      const dispatched =
        Boolean(task.dispatched_at) ||
        task.status === "dispatched" ||
        task.status === "running" ||
        task.status === "failed";
      const claimed =
        Boolean(task.started_at) ||
        task.status === "running" ||
        task.status === "failed";
      const execute: StepState = task.status === "failed" ? "failed" : "todo";
      return [dispatched ? "done" : "todo", claimed ? "done" : "todo", execute];
    }
    case "pending":
    default:
      return ["todo", "todo", "todo"];
  }
}

interface NodeDiagnosticsRowProps {
  nodeRun: WorkflowNodeRun;
  summary: WorkflowNodeRuntimeSummary | null;
  runtime: RuntimeDevice | null;
  wsId: string;
  t: Translator;
}

// Node run outputs arrive as unknown JSON — render strings verbatim and
// pretty-print objects, never trust the shape.
function outputText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

// CoStrict/Claude Code stores session transcripts under
// <configHome>/projects/<sanitized cwd>/<sessionId>.jsonl, where sanitize
// replaces every non-alphanumeric character with "-". The config home can be
// overridden by env vars on the runtime host, so this is best-effort — it
// matches the default (~/.costrict, legacy ~/.claude) layout.
export function sessionLogPath(workDir: string, sessionId: string): string {
  const sanitized = workDir.replace(/[^a-zA-Z0-9]/g, "-");
  return `~/.costrict/projects/${sanitized}/${sessionId}.jsonl`;
}

function CopyablePath({ label, path, t }: { label: string; path: string; t: Translator }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="shrink-0">{label}:</span>
      <code className="min-w-0 flex-1 truncate rounded bg-muted/40 px-1.5 py-0.5 font-mono text-[11px]">
        {path}
      </code>
      <button
        type="button"
        title={copied ? t(($) => $.run.diagnostics.copied) : t(($) => $.run.diagnostics.copy_path)}
        className="shrink-0 rounded p-0.5 hover:bg-muted hover:text-foreground transition-colors"
        onClick={() => {
          void navigator.clipboard?.writeText(path);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? (
          <Check className="size-3 text-emerald-500" />
        ) : (
          <Copy className="size-3" />
        )}
      </button>
    </div>
  );
}

function NodeDiagnosticsRow({ nodeRun, summary, runtime, wsId, t }: NodeDiagnosticsRowProps) {
  const navigation = useNavigation();
  const wsPaths = useWorkspacePaths();
  const diagnostics = summary?.diagnostics ?? null;
  const failed = summary?.has_error === true || nodeRun.status === "failed" || nodeRun.status === "blocked";
  const [open, setOpen] = useState(failed);
  const steps = nodeStepStates(diagnostics);
  const task = diagnostics?.current_task ?? null;
  const errorMessage = summary?.error_message?.trim() || task?.error?.trim() || "";
  // Split children live in a separate table, so they only load when the row
  // is expanded. split_progress (already in the summary) is the signal that
  // this node has children at all.
  const hasSplit = summary?.split_progress != null;
  const { data: splitData } = useQuery({
    ...splitTasksOptions(wsId, nodeRun.id),
    enabled: open && hasSplit,
  });
  const splitTasks = [...(splitData?.tasks ?? [])].sort((a, b) => a.sort_order - b.sort_order);

  const stepLabels = [
    t(($) => $.run.diagnostics.step_dispatch),
    t(($) => $.run.diagnostics.step_claim),
    t(($) => $.run.diagnostics.step_execute),
  ];

  const sessionId = summary?.session_id ?? nodeRun.session_id ?? null;
  const runtimeId = summary?.runtime_id ?? nodeRun.runtime_id ?? null;
  const durationLabel =
    summary?.duration_seconds != null ? formatRuntimeDuration(summary.duration_seconds) : null;
  const nodeStartedAt = formatTime(nodeRun.started_at);
  const nodeCompletedAt = formatTime(nodeRun.completed_at);
  const deliverablesTotal = summary?.required_deliverables_total ?? 0;
  const workerOutput = outputText(nodeRun.worker_output);
  const criticOutput = outputText(nodeRun.critic_output);
  const workDir = task?.work_dir?.trim() || "";
  const logSessionId = task?.session_id?.trim() || sessionId || "";

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{nodeRun.node_title}</span>
        {diagnostics ? (
          <span className="flex shrink-0 items-center gap-3">
            {stepLabels.map((label, i) => (
              <span key={label} className="flex items-center gap-1 text-xs text-muted-foreground">
                <StepIcon state={steps[i]!} />
                {label}
              </span>
            ))}
          </span>
        ) : null}
        <Badge variant="secondary" className="shrink-0 text-[10px]">
          {diagnostics ? stageLabel(t, diagnostics.lifecycle_stage) : (nodeRun.status as string)}
        </Badge>
      </button>

      {open ? (
        <div className="space-y-2 border-t px-3 py-2">
          {diagnostics?.hint ? (
            <p className="text-xs text-muted-foreground">{hintText(t, diagnostics.hint)}</p>
          ) : null}

          {task ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {task.attempt > 0 && task.max_attempts > 0 ? (
                <span>{t(($) => $.run.diagnostics.attempt, { current: task.attempt, max: task.max_attempts })}</span>
              ) : null}
              {formatTime(task.dispatched_at) ? (
                <span>{t(($) => $.run.diagnostics.dispatched_at, { time: formatTime(task.dispatched_at) })}</span>
              ) : null}
              {formatTime(task.started_at) ? (
                <span>{t(($) => $.run.diagnostics.started_at, { time: formatTime(task.started_at) })}</span>
              ) : null}
              {task.phase ? (
                <Badge variant="outline" className="text-[10px]">{task.phase}</Badge>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t(($) => $.run.diagnostics.no_task)}</p>
          )}

          {durationLabel || nodeStartedAt || nodeCompletedAt ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {durationLabel ? (
                <span>{t(($) => $.run.diagnostics.duration, { value: durationLabel })}</span>
              ) : null}
              {nodeStartedAt ? (
                <span>{t(($) => $.run.diagnostics.node_started_at, { time: nodeStartedAt })}</span>
              ) : null}
              {nodeCompletedAt ? (
                <span>{t(($) => $.run.diagnostics.node_completed_at, { time: nodeCompletedAt })}</span>
              ) : null}
            </div>
          ) : null}

          {runtimeId || sessionId ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {runtimeId ? (
                <button
                  type="button"
                  className="flex items-center gap-1 hover:text-foreground transition-colors"
                  onClick={() => navigation.push(wsPaths.runtimeDetail(runtimeId))}
                >
                  <Monitor className="size-3" />
                  {t(($) => $.run.diagnostics.runtime)}: {runtime?.name ?? `${runtimeId.slice(0, 8)}…`}
                  {runtime?.status === "offline" ? (
                    <span className="text-destructive">({t(($) => $.run.diagnostics.runtime_offline)})</span>
                  ) : null}
                </button>
              ) : null}
              {sessionId && isEmbeddedInCostrict() ? (
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => postCostrictNavigateToSession({ sessionId, newTab: true })}
                >
                  {t(($) => $.run.diagnostics.view_session)}
                </button>
              ) : null}
            </div>
          ) : null}

          {deliverablesTotal > 0 ? (
            <p className="text-xs text-muted-foreground">
              {t(($) => $.run.diagnostics.deliverables, {
                submitted: summary?.required_deliverables_submitted ?? 0,
                total: deliverablesTotal,
                approved: summary?.required_deliverables_approved ?? 0,
              })}
            </p>
          ) : null}

          {hasSplit ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                {t(($) => $.run.diagnostics.split_tasks, {
                  done: summary?.split_progress?.done ?? 0,
                  total: summary?.split_progress?.total ?? 0,
                })}
              </p>
              {splitTasks.map((child) => (
                <div key={child.id} className="space-y-0.5">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <StepIcon state={splitStepState(child.status)} />
                    <span className="min-w-0 flex-1 truncate text-foreground/90">{child.title}</span>
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {splitStatusLabel(t, child.status)}
                    </Badge>
                    {child.issue_id ? (
                      <button
                        type="button"
                        className="shrink-0 text-primary hover:underline"
                        onClick={() => navigation.push(wsPaths.issueDetail(child.issue_id!))}
                      >
                        {t(($) => $.run.diagnostics.split_task_issue)}
                      </button>
                    ) : null}
                    {child.workflow_id && child.run_id ? (
                      <button
                        type="button"
                        className="shrink-0 text-primary hover:underline"
                        onClick={() =>
                          navigation.push(wsPaths.workflowRunDiagnostics(child.workflow_id!, child.run_id!))
                        }
                      >
                        {t(($) => $.run.diagnostics.entry)}
                      </button>
                    ) : null}
                  </div>
                  {child.last_error?.message ? (
                    <p className="pl-5 text-[11px] text-destructive">{child.last_error.message}</p>
                  ) : null}
                  {formatTime(child.materialize_next_attempt_at) ? (
                    <p className="pl-5 text-[11px] text-muted-foreground">
                      {t(($) => $.run.diagnostics.split_task_retry_at, {
                        time: formatTime(child.materialize_next_attempt_at),
                      })}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {workDir ? (
            <div className="space-y-1">
              <CopyablePath label={t(($) => $.run.diagnostics.work_dir)} path={workDir} t={t} />
              {logSessionId ? (
                <CopyablePath
                  label={t(($) => $.run.diagnostics.session_log)}
                  path={sessionLogPath(workDir, logSessionId)}
                  t={t}
                />
              ) : null}
            </div>
          ) : null}

          {workerOutput ? (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors">
                {t(($) => $.run.diagnostics.worker_output)}
              </summary>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2">
                {workerOutput}
              </pre>
            </details>
          ) : null}
          {criticOutput ? (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors">
                {t(($) => $.run.diagnostics.critic_output)}
              </summary>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2">
                {criticOutput}
              </pre>
            </details>
          ) : null}

          {errorMessage ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-destructive">{t(($) => $.run.diagnostics.error)}</p>
              <p className="rounded-md bg-destructive/5 px-2.5 py-2 text-xs text-destructive">{errorMessage}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function WorkflowRunDiagnosticsPage({ workflowId, runId }: RunDiagnosticsPageProps) {
  const { t } = useT("workflows");
  const wsId = useWorkspaceId();
  const wsPaths = useWorkspacePaths();
  const navigation = useNavigation();
  const { data, isLoading } = useQuery(workflowRunCanvasSummaryOptions(wsId, workflowId, runId));
  const { data: runtimeList } = useQuery(runtimeListOptions(wsId));
  // The runtime list powers id → name lookup; tolerate any unexpected shape.
  const runtimeById = new Map(
    (Array.isArray(runtimeList) ? runtimeList : []).map((r) => [r.id, r]),
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Skeleton className="h-[400px] w-[600px]" />
      </div>
    );
  }

  const run: WorkflowRun | null = data?.run ?? null;
  if (!run || !run.id) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">{t(($) => $.detail.not_found)}</p>
      </div>
    );
  }

  const nodeRuns = data?.node_runs ?? [];
  const summaries = data?.node_runtime_summaries ?? [];
  const summaryByNodeRunId = new Map(summaries.map((s) => [s.node_run_id, s]));
  const completedCount = summaries.filter((s) => TERMINAL_DISPLAY_STATUSES.has(s.display_status)).length;

  return (
    <div className="flex h-full flex-col">
      <PageHeader className="justify-between px-5 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => navigation.push(wsPaths.workflowRunDetail(workflowId, runId))}
          >
            {run.workflow_title}
          </button>
          <span className="text-muted-foreground">/</span>
          <h1 className="text-sm font-medium">{t(($) => $.run.diagnostics.title)}</h1>
          <Badge variant="secondary" className="text-[10px] px-1.5 h-4">
            {formatRunStatus(t, run.status)}
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground">
          {t(($) => $.run.diagnostics.summary_nodes, { completed: completedCount, total: nodeRuns.length })}
        </span>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-3xl space-y-2">
          {nodeRuns.map((nodeRun) => {
            const summary = summaryByNodeRunId.get(nodeRun.id) ?? null;
            const runtimeId = summary?.runtime_id ?? nodeRun.runtime_id ?? null;
            return (
              <NodeDiagnosticsRow
                key={nodeRun.id}
                nodeRun={nodeRun}
                summary={summary}
                runtime={runtimeId ? (runtimeById.get(runtimeId) ?? null) : null}
                wsId={wsId}
                t={t}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
