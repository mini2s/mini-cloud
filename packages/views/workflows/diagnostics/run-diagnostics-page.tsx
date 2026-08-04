"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronRight, Circle, LoaderCircle, X } from "lucide-react";
import { useWorkspaceId } from "@multica/core/hooks";
import { workflowRunCanvasSummaryOptions } from "@multica/core/workflows/queries";
import type {
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
// Derived from the backend-computed lifecycle_stage so the stage machine
// lives in exactly one place.
function nodeStepStates(diagnostics: WorkflowNodeDiagnostics | null): [StepState, StepState, StepState] {
  const stage = diagnostics?.lifecycle_stage;
  switch (stage) {
    case "dispatching":
      return ["active", "todo", "todo"];
    case "dispatched":
      return ["done", "active", "todo"];
    case "running":
    case "awaiting_review":
      return ["done", "done", "active"];
    case "terminal":
      return ["done", "done", "done"];
    case "pending":
    default:
      return ["todo", "todo", "todo"];
  }
}

interface NodeDiagnosticsRowProps {
  nodeRun: WorkflowNodeRun;
  summary: WorkflowNodeRuntimeSummary | null;
  t: Translator;
}

function NodeDiagnosticsRow({ nodeRun, summary, t }: NodeDiagnosticsRowProps) {
  const diagnostics = summary?.diagnostics ?? null;
  const failed = summary?.has_error === true || nodeRun.status === "failed" || nodeRun.status === "blocked";
  const [open, setOpen] = useState(failed);
  const steps = nodeStepStates(diagnostics);
  const task = diagnostics?.current_task ?? null;
  const errorMessage = summary?.error_message?.trim() || task?.error?.trim() || "";

  const stepLabels = [
    t(($) => $.run.diagnostics.step_dispatch),
    t(($) => $.run.diagnostics.step_claim),
    t(($) => $.run.diagnostics.step_execute),
  ];

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
                <StepIcon state={failed && i === 2 ? "failed" : steps[i]!} />
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
          {nodeRuns.map((nodeRun) => (
            <NodeDiagnosticsRow
              key={nodeRun.id}
              nodeRun={nodeRun}
              summary={summaryByNodeRunId.get(nodeRun.id) ?? null}
              t={t}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
