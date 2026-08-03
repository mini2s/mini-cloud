"use client";

import { PatchDiff } from "@pierre/diffs/react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@multica/ui/components/ui/collapsible";
import { cn } from "@multica/ui/lib/utils";
import { ChevronRight, FileDiff } from "lucide-react";
import { useMemo, useState } from "react";
import { useCurrentConversationToolEntry } from "../runtime/conversation-tool-bridge";
import {
  asRecord,
  basename,
  firstString,
  numberValue,
} from "./tool-ui-shared";

export type ConversationFileDiff = {
  file: string;
  patch: string;
  additions: number;
  deletions: number;
  status: "added" | "deleted" | "modified";
};

function lineCount(value: string): number {
  return value.length === 0 ? 0 : value.replace(/\n$/, "").split("\n").length;
}

function changedLines(prefix: "+" | "-", value: string): string[] {
  if (!value) return [];
  return value
    .replace(/\n$/, "")
    .split("\n")
    .map((line) => `${prefix}${line}`);
}

function ensureUnifiedPatch(
  file: string,
  patch: string,
  status: ConversationFileDiff["status"],
): string {
  const trimmed = patch.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("diff --git") || trimmed.startsWith("Index:")) {
    return trimmed;
  }

  const patchPath = file.replace(/^\/+/, "");
  const header = [
    `diff --git a/${patchPath} b/${patchPath}`,
    status === "added" ? "new file mode 100644" : undefined,
    status === "deleted" ? "deleted file mode 100644" : undefined,
    status === "added" ? "--- /dev/null" : `--- a/${patchPath}`,
    status === "deleted" ? "+++ /dev/null" : `+++ b/${patchPath}`,
  ].filter(Boolean);
  return `${header.join("\n")}\n${trimmed}`;
}

export function normalizeConversationFileDiff({
  args,
  result,
  providerMetadata,
}: {
  args: Record<string, unknown> | undefined;
  result?: unknown;
  providerMetadata?: Record<string, unknown>;
}): ConversationFileDiff | undefined {
  const resultRecord = asRecord(result);
  const resultMetadata =
    asRecord(resultRecord?.metadata) ??
    asRecord(asRecord(resultRecord?.output)?.metadata);
  const metadata = providerMetadata ?? resultMetadata;
  const filediff =
    asRecord(metadata?.filediff) ??
    asRecord(metadata?.fileDiff) ??
    asRecord(resultMetadata?.filediff) ??
    asRecord(resultMetadata?.fileDiff);
  const file = firstString(
    {
      ...args,
      ...metadata,
      ...filediff,
    },
    ["file", "filePath", "file_path", "filepath", "path"],
  );
  if (!file) return undefined;

  const oldString =
    firstString(filediff, ["before", "oldString", "old_string"]) ||
    firstString(args, ["oldString", "old_string"]);
  const newString =
    firstString(filediff, ["after", "newString", "new_string"]) ||
    firstString(args, [
      "newString",
      "new_string",
      "content",
      "contents",
    ]);
  const explicitPatch =
    firstString(filediff, ["patch", "diff"]) ||
    firstString(metadata, ["patch", "diff"]) ||
    firstString(resultRecord, ["patch", "diff"]);

  const status: ConversationFileDiff["status"] =
    filediff?.status === "added" ||
    filediff?.status === "deleted" ||
    filediff?.status === "modified"
      ? filediff.status
      : oldString.length === 0 && newString.length > 0
        ? "added"
        : oldString.length > 0 && newString.length === 0
          ? "deleted"
          : "modified";

  const generatedPatch =
    oldString !== newString
      ? [
          `@@ -1,${Math.max(lineCount(oldString), 1)} +1,${Math.max(lineCount(newString), 1)} @@`,
          ...changedLines("-", oldString),
          ...changedLines("+", newString),
        ].join("\n")
      : "";
  const patch = ensureUnifiedPatch(
    file,
    explicitPatch || generatedPatch,
    status,
  );
  if (!patch) return undefined;

  return {
    file,
    patch,
    additions:
      numberValue(filediff?.additions) ||
      numberValue(metadata?.additions) ||
      lineCount(newString),
    deletions:
      numberValue(filediff?.deletions) ||
      numberValue(metadata?.deletions) ||
      numberValue(metadata?.removals) ||
      lineCount(oldString),
    status,
  };
}

export function ToolDiff({
  args,
  result,
  className,
}: {
  args?: Record<string, unknown>;
  result?: unknown;
  className?: string;
}) {
  const entry = useCurrentConversationToolEntry();
  const [open, setOpen] = useState(false);
  const providerMetadata = asRecord(entry?.providerState?.metadata);
  const diff = useMemo(
    () =>
      normalizeConversationFileDiff({
        args,
        result,
        providerMetadata,
      }),
    [args, providerMetadata, result],
  );

  if (!diff) return null;

  const fileLabel = basename(diff.file);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn("ml-5 mt-1", className)}
    >
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <CollapsibleTrigger className="flex min-w-0 items-center gap-1.5 rounded-sm py-1 text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 transition-transform motion-reduce:transition-none",
              open && "rotate-90",
            )}
          />
          <FileDiff className="size-3.5 shrink-0" />
          <span className="truncate">{fileLabel}</span>
        </CollapsibleTrigger>
        <span className="flex shrink-0 items-center gap-1 font-mono">
          {diff.additions > 0 ? (
            <span className="text-emerald-600">+{diff.additions}</span>
          ) : null}
          {diff.deletions > 0 ? (
            <span className="text-red-600">-{diff.deletions}</span>
          ) : null}
        </span>
      </div>
      <CollapsibleContent className="overflow-hidden rounded-md border">
        <PatchDiff
          patch={diff.patch}
          options={{
            theme: { dark: "pierre-dark", light: "pierre-light" },
            diffStyle: "unified",
            overflow: "wrap",
          }}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}
