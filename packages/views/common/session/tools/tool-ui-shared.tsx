"use client";

import { cn } from "@multica/ui/lib/utils";
import {
  AlertCircle,
  Check,
  CircleAlert,
  Loader2,
  X,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCurrentConversationToolEntry } from "../runtime/conversation-tool-bridge";

export type ToolCallStatusLike =
  | {
      type: string;
      reason?: string;
    }
  | undefined;

export type ResolvedToolStatus =
  | "running"
  | "requires-action"
  | "completed"
  | "error"
  | "cancelled";

export function asRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

export function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function firstString(
  record: Record<string, unknown> | undefined,
  keys: readonly string[],
): string {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
}

export function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function basename(filepath: string): string {
  const parts = filepath.split("/").filter(Boolean);
  return parts.at(-1) ?? filepath;
}

export function shortenPath(filepath: string, depth = 2): string {
  const parts = filepath.split("/").filter(Boolean);
  return parts.length <= depth ? filepath : parts.slice(-depth).join("/");
}

export function truncate(value: string, max = 80): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

export function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

export function getPatchInfo(patchText: string): {
  files: readonly string[];
  added: number;
  removed: number;
} {
  if (!patchText) return { files: [], added: 0, removed: 0 };

  const files = [
    ...new Set(
      [
        ...patchText.matchAll(
          /^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s+(.+)$/gm,
        ),
      ]
        .map((match) => basename(match[1]?.trim() ?? ""))
        .filter(Boolean),
    ),
  ];
  let added = 0;
  let removed = 0;
  for (const line of patchText.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  }
  return { files, added, removed };
}

export function resolveToolStatus({
  status,
  isError,
  providerStatus,
  hasInteraction,
  taskStatus,
}: {
  status?: ToolCallStatusLike;
  isError?: boolean;
  providerStatus?: unknown;
  hasInteraction?: boolean;
  taskStatus?: unknown;
}): ResolvedToolStatus {
  if (
    isError === true ||
    providerStatus === "error" ||
    taskStatus === "failed" ||
    (status?.type === "incomplete" &&
      status.reason !== "cancelled" &&
      status.reason !== "other")
  ) {
    return "error";
  }
  if (hasInteraction || status?.type === "requires-action") {
    return "requires-action";
  }
  if (providerStatus === "completed" || taskStatus === "completed") {
    return "completed";
  }
  if (status?.type === "incomplete" && status.reason === "cancelled") {
    return "cancelled";
  }
  if (
    providerStatus === "pending" ||
    providerStatus === "running" ||
    taskStatus === "running" ||
    status?.type === "running"
  ) {
    return "running";
  }
  return "completed";
}

export function useResolvedToolStatus(
  status?: ToolCallStatusLike,
  isError?: boolean,
): ResolvedToolStatus {
  const entry = useCurrentConversationToolEntry();
  return resolveToolStatus({
    status,
    isError,
    providerStatus: entry?.providerState?.status,
    hasInteraction:
      (entry?.permissions.length ?? 0) > 0 ||
      (entry?.questions.length ?? 0) > 0,
    taskStatus: entry?.task?.status,
  });
}

const STATUS_ICON: Record<
  ResolvedToolStatus,
  { icon: LucideIcon; className: string }
> = {
  running: {
    icon: Loader2,
    className: "animate-spin motion-reduce:animate-none",
  },
  "requires-action": { icon: AlertCircle, className: "text-amber-600" },
  completed: { icon: Check, className: "" },
  error: { icon: CircleAlert, className: "text-destructive" },
  cancelled: { icon: X, className: "text-muted-foreground" },
};

export function ToolStatusIcon({
  resolvedStatus,
  completeIcon,
}: {
  resolvedStatus: ResolvedToolStatus;
  completeIcon?: ReactNode;
}) {
  if (resolvedStatus === "completed" && completeIcon) return completeIcon;
  const definition = STATUS_ICON[resolvedStatus];
  const Icon = definition.icon;
  return (
    <Icon
      className={cn("size-3.5 shrink-0", definition.className)}
      aria-hidden="true"
    />
  );
}

export function ToolCallShell({
  toolName,
  status,
  isError,
  summary,
  trailing,
  className,
}: {
  toolName: string;
  status?: ToolCallStatusLike;
  isError?: boolean;
  summary?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  const resolvedStatus = useResolvedToolStatus(status, isError);
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 py-0.5 text-sm text-muted-foreground",
        resolvedStatus === "error" && "text-destructive",
        resolvedStatus === "cancelled" && "line-through opacity-60",
        className,
      )}
      data-tool-status={resolvedStatus}
    >
      <ToolStatusIcon resolvedStatus={resolvedStatus} />
      <span className="min-w-0 truncate font-medium">{toolName}</span>
      {summary ? (
        <span className="min-w-0 truncate opacity-60">{summary}</span>
      ) : null}
      {trailing}
    </div>
  );
}

const QUESTION_TOOL_NAMES = new Set([
  "question",
  "ask_question",
  "askuserquestion",
  "ask_user_question",
  "ask_user_questions",
  "request_user_input",
  "requestuserinput",
]);

export function isQuestionToolName(value: unknown): boolean {
  return (
    typeof value === "string" &&
    QUESTION_TOOL_NAMES.has(value.toLowerCase())
  );
}
