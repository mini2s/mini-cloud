"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import {
  fmtCost,
  formatDuration,
  formatLocalTime,
  getTaskFileUrl,
  taskDetailOptions,
  useUpdateTaskManual,
  useUserNameMap,
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
import { useNavigation } from "../../navigation";
import { DRILLDOWN_LINK_CLASS } from "../components/drilldown-styles";
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
//   - The manual-override modal submits via useUpdateTaskManual and refreshes
//     the task detail after the real PUT succeeds.
//   - User/repo drill-downs use the host navigation adapter. Workdir remains
//     text because the migrated module has no workdir detail route.

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
  const paths = useWorkspacePaths();
  const { push } = useNavigation();
  const { resolveName } = useUserNameMap();
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
      title="Task 详情"
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
          人工调整
        </Button>
      }
      loading={q.isLoading}
      error={q.error}
      empty={!q.data?.task ? "暂无该 Task 数据" : undefined}
    >
      {/* Basic info. */}
      <Panel title="基础信息">
        <KvGrid>
          <Kv label="Task ID" mono>{task.task_id || "-"}</Kv>
          <Kv label="任务描述" wide>{task.title || "-"}</Kv>
          <Kv label="用户">
            {task.user_id ? (
              <button
                type="button"
                onClick={() => push(paths.metricsUserDetail(task.user_id!))}
                className={DRILLDOWN_LINK_CLASS}
              >
                {resolveName(task.user_id)}
              </button>
            ) : task.user_name ? resolveName(task.user_name) : "-"}
          </Kv>
          <Kv label="仓库">
            {task.repo_addr ? (
              <button
                type="button"
                onClick={() =>
                  push(
                    paths.metricsRepoDetail(
                      task.repo_addr!,
                      task.repo_branch || undefined,
                    ),
                  )
                }
                className={`break-all text-left font-mono ${DRILLDOWN_LINK_CLASS}`}
              >
                {repoDisplay}
              </button>
            ) : "-"}
          </Kv>
          <Kv label="工作目录">
            {task.work_dir_id ? (
              <button
                type="button"
                onClick={() =>
                  push(paths.metricsWorkdirDetail(task.work_dir_id!))
                }
                className={`break-all text-left font-mono ${DRILLDOWN_LINK_CLASS}`}
              >
                {task.work_dir || task.work_dir_id}
              </button>
            ) : task.work_dir || "-"}
          </Kv>
          <Kv label="开始时间">{formatLocalTime(task.start_time)}</Kv>
          <Kv label="结束时间">{formatLocalTime(task.end_time)}</Kv>
          <Kv label="系统">
            {task.client_os
              ? `${task.client_os} ${task.client_os_version || ""}`.trim()
              : "-"}
          </Kv>
          <Kv label="客户端">
            {task.client_ide
              ? `${task.client_ide} ${task.client_version || ""}`.trim()
              : "-"}
          </Kv>
          <Kv label="模式">{task.caller || "-"}</Kv>
        </KvGrid>
      </Panel>

      {/* Metrics. */}
      <Panel title="度量信息">
        <KvGrid>
          <Kv label="生成代码量">
            <span className="inline-flex items-center gap-2">
              {task.diff_lines ?? "-"} 行
              <FileLink href={getTaskFileUrl("summary", task.task_id)}>
                查看详情
              </FileLink>
            </span>
          </Kv>
          <Kv label="实际耗时">
            <ManualValue
              manual={task.task_real_minutes_manual}
              manualReason={task.task_real_minutes_reason_manual}
              original={task.task_real_minutes}
              originalReason={task.task_real_minutes_reason}
            />
          </Kv>
          <Kv label="传统开发时长预估">
            <ManualValue
              manual={task.task_ancient_minutes_manual}
              manualReason={task.task_ancient_minutes_reason_manual}
              original={task.task_ancient_minutes}
              originalReason={task.task_ancient_minutes_reason}
            />
          </Kv>
          <Kv label="API 请求次数">{conversations.length || "-"}</Kv>
          <Kv label="总 Tokens" title={`上行 ${totalUpstreamTokens} / 下行 ${totalDownstreamTokens}`}>
            {totalTokens > 0 ? totalTokens.toLocaleString() : "-"}
          </Kv>
          <Kv label="费用">
            {(task.cost ?? 0) > 0
              ? `${fmtCost(task.cost)} 元`
              : totalCostSum > 0
                ? `${fmtCost(totalCostSum)} 元`
                : "-"}
          </Kv>
        </KvGrid>
      </Panel>

      {/* Conversation history (linear timeline, no gaps — time_segments is dead code). */}
      <Panel
        title="对话历史"
        rightSlot={
          conversations.length > 0 ? (
            <FileLink href={getTaskFileUrl("conversation", task.task_id)}>
              查看原始数据
            </FileLink>
          ) : undefined
        }
      >
        {conversations.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">暂无对话记录</div>
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
                        系统消息（非用户提问）
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
                        Agent 自动轮次（无用户输入）
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
                          ? "收起"
                          : isSystemOnly
                            ? "展开原文"
                            : !input
                              ? "展开请求内容"
                              : "展开全文"}
                      </button>
                    )}
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{conv.model || conv.mode || "-"}</span>
                      {/* process_time is often missing; Go int64 turns null into 0 → treat 0 as no data. */}
                      <span>耗时 {conv.process_time ? `${conv.process_time} ms` : "-"}</span>
                      <span>
                        上行 {conv.upstream_tokens ?? "-"} / 下行 {conv.downstream_tokens ?? "-"}
                      </span>
                      <span>费用 {fmtCost(conv.cost) || "0.00"}</span>
                      <span>代码 {conv.diff_lines ?? "-"} 行</span>
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
          <DialogTitle>人工调整</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="实际耗时（分钟）">
            <Input
              type="number"
              min={0}
              step={10}
              value={real}
              onChange={(e) => setReal(e.target.value)}
            />
          </Field>
          <Field label="实际耗时理由">
            <Textarea
              rows={2}
              value={realReason}
              onChange={(e) => setRealReason(e.target.value)}
            />
          </Field>
          <Field label="传统开发时长预估（分钟）">
            <Input
              type="number"
              min={0}
              step={10}
              value={ancient}
              onChange={(e) => setAncient(e.target.value)}
            />
          </Field>
          <Field label="传统开发时长预估理由">
            <Textarea
              rows={2}
              value={ancientReason}
              onChange={(e) => setAncientReason(e.target.value)}
            />
          </Field>
          {updateManual.error ? (
            <ErrorBanner
              message={
                (updateManual.error as Error)?.message || "保存失败"
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
            取消
          </Button>
          <Button
            type="button"
            disabled={updateManual.isPending}
            onClick={handleSubmit}
          >
            {updateManual.isPending ? "保存中..." : "保存"}
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
          {original != null ? formatDuration(original) : "（AI 未出值）"}
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

function FileLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`text-xs ${DRILLDOWN_LINK_CLASS}`}
    >
      {children}
    </a>
  );
}
