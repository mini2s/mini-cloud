"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  fmtCost,
  formatDuration,
  formatLocalTime,
  taskDetailOptions,
  useUpdateTaskManual,
  type Conversation,
  type TaskListItem,
  type UpdateTaskManualRequest,
} from "@multica/core/efficiency";
import { Pencil } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Textarea } from "@multica/ui/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { DetailShell } from "./detail-shell";
import { ErrorBanner, Kv, KvGrid, Panel } from "./shared";

// Task detail page. Ports the source TaskDetail to the shared-views layer:
// basic info + metrics + conversation timeline + manual-override modal.
//
// Caliber (matches source):
//   - efficiency_ratio is a PERCENTAGE ratio (300 = 300%, rendered directly,
//     never ×100 / never via formatV2Ratio).
//   - cost via fmtCost (2dp).
//
// Wiring vs source:
//   - The manual-override modal submits via useUpdateTaskManual (mock-aware:
//     mock phase returns success without hitting the network, then invalidates
//     the task-detail cache; real path calls the NOT_WIRED api stub until the
//     backend mounts /api/v2/efficiency/tasks/{id}/manual).
//   - No getTaskFileUrl external links (raw-data / summary file) — that helper
//     isn't in the data layer.
//   - No router: user/repo/workdir render as text.

interface TaskDetailProps {
  taskId: string;
  onBack: () => void;
}

const DISPLAY_LIMIT = 200;

// Noise tags the采集 side injects into user_input (task-notification /
// system-reminder / environment_details / local-command-* / etc.). They are
// not user questions; stripped before display so the timeline shows real
// prompts. Matches source NOISE_TAG_RE.
const NOISE_TAG_RE =
  /^<(task-notification|system-reminder|environment_details|local-command-stdout|local-command-caveat|command-name|command-message|command-args|file_content|workspace_diagnostics)>/;

function extractUserQuestion(raw?: string): string {
  let s = (raw || "").trim();
  for (;;) {
    const m = s.match(NOISE_TAG_RE);
    if (!m) break;
    const close = `</${m[1]}>`;
    const idx = s.indexOf(close);
    if (idx === -1) return ""; // unclosed injection block → entire string is system content
    s = s.slice(idx + close.length).trim();
  }
  // Strip trailing appended environment_details blocks too.
  return s.replace(/<environment_details>[\s\S]*?<\/environment_details>/g, "").trim();
}

export function TaskDetail({ taskId, onBack }: TaskDetailProps) {
  const wsId = useWorkspaceId();
  const q = useQuery(taskDetailOptions(wsId, taskId));

  const task: TaskListItem = useMemo(
    () => q.data?.task ?? ({ task_id: taskId } as TaskListItem),
    [q.data?.task, taskId],
  );
  const conversations: Conversation[] = q.data?.conversations ?? [];

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [manualOpen, setManualOpen] = useState(false);

  // Front-end aggregates from conversations (matches source §7.4).
  const totalUpstreamTokens = useMemo(
    () => conversations.reduce((s, c) => s + (c.upstream_tokens || 0), 0),
    [conversations],
  );
  const totalDownstreamTokens = useMemo(
    () => conversations.reduce((s, c) => s + (c.downstream_tokens || 0), 0),
    [conversations],
  );
  const totalTokens = totalUpstreamTokens + totalDownstreamTokens;
  const totalCostSum = useMemo(
    () => conversations.reduce((s, c) => s + (c.cost || 0), 0),
    [conversations],
  );

  const repoDisplay =
    task.repo_addr && task.repo_branch
      ? `${task.repo_addr}#${task.repo_branch}`
      : task.repo_addr || "-";

  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <DetailShell
      onBack={onBack}
      title="Task detail"
      subtitle={task.task_id || "-"}
      headerExtra={
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setManualOpen(true)}
          disabled={!q.data?.task}
        >
          <Pencil className="h-3.5 w-3.5" />
          Manual adjust
        </Button>
      }
      loading={q.isLoading}
      error={q.error}
      empty={!q.data?.task ? "No data for this task." : undefined}
    >
      {/* Basic info. */}
      <Panel title="Basic info">
        <KvGrid>
          <Kv label="Task ID" mono>{task.task_id || "-"}</Kv>
          <Kv label="Title" wide>{task.title || "-"}</Kv>
          <Kv label="User">{task.user_name || task.user_id || "-"}</Kv>
          <Kv label="Repo">{repoDisplay}</Kv>
          <Kv label="Workdir">{task.work_dir || task.work_dir_id || "-"}</Kv>
          <Kv label="Start time">{formatLocalTime(task.start_time)}</Kv>
          <Kv label="End time">{formatLocalTime(task.end_time)}</Kv>
          <Kv label="OS">
            {task.client_os
              ? `${task.client_os} ${task.client_os_version || ""}`.trim()
              : "-"}
          </Kv>
          <Kv label="Client">
            {task.client_ide
              ? `${task.client_ide} ${task.client_version || ""}`.trim()
              : "-"}
          </Kv>
          <Kv label="Mode">{task.caller || "-"}</Kv>
        </KvGrid>
      </Panel>

      {/* Metrics. */}
      <Panel title="Metrics">
        <KvGrid>
          <Kv label="Generated code">
            <span className="inline-flex items-center gap-2">
              {task.diff_lines ?? "-"} lines
            </span>
          </Kv>
          <Kv label="Actual time">
            <ManualValue
              manual={task.task_real_minutes_manual}
              manualReason={task.task_real_minutes_reason_manual}
              original={task.task_real_minutes}
              originalReason={task.task_real_minutes_reason}
            />
          </Kv>
          <Kv label="Baseline estimate">
            <ManualValue
              manual={task.task_ancient_minutes_manual}
              manualReason={task.task_ancient_minutes_reason_manual}
              original={task.task_ancient_minutes}
              originalReason={task.task_ancient_minutes_reason}
            />
          </Kv>
          <Kv label="API requests">{conversations.length || "-"}</Kv>
          <Kv label="Total tokens" title={`upstream ${totalUpstreamTokens} / downstream ${totalDownstreamTokens}`}>
            {totalTokens > 0 ? totalTokens.toLocaleString() : "-"}
          </Kv>
          <Kv label="Cost">
            {(task.cost ?? 0) > 0
              ? `${fmtCost(task.cost)}`
              : totalCostSum > 0
                ? `${fmtCost(totalCostSum)}`
                : "-"}
          </Kv>
        </KvGrid>
      </Panel>

      {/* Conversation history (linear timeline, no gaps — time_segments is dead code). */}
      <Panel title="Conversation history" hint={`${conversations.length}`}>
        {conversations.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">No conversation records</div>
        ) : (
          <ol className="relative ml-2 space-y-4 border-l-2 border-border">
            {conversations.map((conv, idx) => {
              const key = `${idx}_conv`;
              const isExpanded = expanded.has(key);
              const input = conv.user_input || "";
              // Prefer the real user question; if stripping noise leaves
              // nothing, the whole turn is a system message (collapsed).
              const question = extractUserQuestion(input);
              const isSystemOnly = !!input && !question;
              const text = question || input;
              const truncated = text.length > DISPLAY_LIMIT && !isExpanded;
              const shown = truncated ? `${text.substring(0, DISPLAY_LIMIT)}...` : text;
              return (
                <li key={conv.id ?? idx} className="ml-5">
                  <span
                    className="absolute -left-[7px] h-3 w-3 rounded-full bg-success ring-2 ring-card"
                    aria-hidden="true"
                  />
                  <div className="mb-1 text-xs text-muted-foreground">
                    {formatLocalTime(conv.start_time)}
                  </div>
                  <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3">
                    {question && (
                      <pre className="m-0 max-h-[600px] overflow-y-auto whitespace-pre-wrap break-all rounded-md bg-background/60 px-3 py-2 text-xs leading-relaxed text-card-foreground">
                        {shown}
                      </pre>
                    )}
                    {isSystemOnly && (
                      <div className="text-xs text-muted-foreground">
                        System message (not a user question)
                        {isExpanded && (
                          <pre className="m-0 mt-1.5 max-h-[600px] overflow-y-auto whitespace-pre-wrap break-all rounded-md bg-background/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                            {shown}
                          </pre>
                        )}
                      </div>
                    )}
                    {/* Agent-loop turns with no user_input carry content in request_content. */}
                    {!input && (
                      <div className="text-xs text-muted-foreground">
                        Agent auto-turn (no user input)
                        {isExpanded && !!conv.request_content && (
                          <pre className="m-0 mt-1.5 max-h-[600px] overflow-y-auto whitespace-pre-wrap break-all rounded-md bg-background/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                            {conv.request_content}
                          </pre>
                        )}
                      </div>
                    )}
                    {(text.length > DISPLAY_LIMIT || isSystemOnly || (!input && !!conv.request_content)) && (
                      <button
                        type="button"
                        onClick={() => toggleExpand(key)}
                        className="text-xs text-primary hover:underline focus:outline-none"
                      >
                        {isExpanded
                          ? "Collapse"
                          : isSystemOnly
                            ? "Show raw"
                            : !input
                              ? "Show request"
                              : "Show full"}
                      </button>
                    )}
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{conv.model || conv.mode || "-"}</span>
                      {/* process_time is often missing; Go int64 turns null into 0 → treat 0 as no data. */}
                      <span>latency {conv.process_time ? `${conv.process_time} ms` : "-"}</span>
                      <span>
                        upstream {conv.upstream_tokens ?? "-"} / downstream {conv.downstream_tokens ?? "-"}
                      </span>
                      <span>cost {fmtCost(conv.cost) || "0.00"}</span>
                      <span>code {conv.diff_lines ?? "-"} lines</span>
                      {conv.error_code && (
                        <span className="text-destructive">
                          {conv.error_code}: {conv.error_reason}
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Panel>

      {q.data?.task && (
        <TaskManualDialog
          open={manualOpen}
          task={task}
          onOpenChange={setManualOpen}
        />
      )}
    </DetailShell>
  );
}

// ---- manual-override modal (§7.6) ----

/**
 * Manual override dialog. Seeds the form from the task's current manual (or
 * fallback AI) values on each open; submits via useUpdateTaskManual. 4 fields
 * (real/ancient minutes + reasons) — empty minutes parse to null (clears the
 * override), matching the source.
 */
function TaskManualDialog({
  open,
  task,
  onOpenChange,
}: {
  open: boolean;
  task: TaskListItem;
  onOpenChange: (open: boolean) => void;
}) {
  const updateManual = useUpdateTaskManual();
  const [real, setReal] = useState("");
  const [realReason, setRealReason] = useState("");
  const [ancient, setAncient] = useState("");
  const [ancientReason, setAncientReason] = useState("");

  // Seed on open: manual value takes precedence over the AI original.
  useEffect(() => {
    if (!open) return;
    const r = task.task_real_minutes_manual ?? task.task_real_minutes ?? null;
    const a =
      task.task_ancient_minutes_manual ?? task.task_ancient_minutes ?? null;
    setReal(r == null ? "" : String(r));
    setRealReason(task.task_real_minutes_reason_manual || "");
    setAncient(a == null ? "" : String(a));
    setAncientReason(task.task_ancient_minutes_reason_manual || "");
  }, [open, task]);

  function handleSubmit() {
    const body: UpdateTaskManualRequest = {
      task_real_minutes_manual: real === "" ? null : Number(real),
      task_real_minutes_reason_manual: realReason,
      task_ancient_minutes_manual: ancient === "" ? null : Number(ancient),
      task_ancient_minutes_reason_manual: ancientReason,
    };
    updateManual.mutate(
      { taskId: task.task_id, body },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manual adjust</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Actual time (minutes)">
            <Input
              type="number"
              step={10}
              value={real}
              onChange={(e) => setReal(e.target.value)}
            />
          </Field>
          <Field label="Actual time reason">
            <Textarea
              rows={2}
              value={realReason}
              onChange={(e) => setRealReason(e.target.value)}
            />
          </Field>
          <Field label="Baseline estimate (minutes)">
            <Input
              type="number"
              step={10}
              value={ancient}
              onChange={(e) => setAncient(e.target.value)}
            />
          </Field>
          <Field label="Baseline estimate reason">
            <Textarea
              rows={2}
              value={ancientReason}
              onChange={(e) => setAncientReason(e.target.value)}
            />
          </Field>
          {updateManual.error ? (
            <ErrorBanner
              message={
                (updateManual.error as Error)?.message || "Failed to save."
              }
            />
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={updateManual.isPending}
            onClick={handleSubmit}
          >
            {updateManual.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

// ---- manual-override display (actual time / baseline estimate share this) ----
// Shows the manual value when present, with the struck-through AI original
// beside it. The source paired each with a (?) tooltip (reason); we render the
// reason via the `title` attribute on the value span for parity without a
// custom icon component.
function ManualValue({
  manual,
  manualReason,
  original,
  originalReason,
}: {
  manual?: number | null;
  manualReason?: string;
  original?: number | null;
  originalReason?: string;
}) {
  if (manual != null) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span title={manualReason}>{formatDuration(manual)}</span>
        <span
          className="line-through text-muted-foreground"
          title={originalReason}
        >
          {original != null ? formatDuration(original) : "(no AI value)"}
        </span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5" title={originalReason}>
      {formatDuration(original)}
    </span>
  );
}
