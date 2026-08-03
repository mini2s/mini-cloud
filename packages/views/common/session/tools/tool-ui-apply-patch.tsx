"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { PatchDiff } from "@pierre/diffs/react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@multica/ui/components/ui/collapsible";
import { cn } from "@multica/ui/lib/utils";
import { ChevronRight } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { useT } from "../../../i18n";
import {
  ToolCallShell,
  asRecord,
  firstString,
  getPatchInfo,
} from "./tool-ui-shared";

type PatchBlock = {
  type: "Update" | "Add" | "Delete";
  path: string;
  body: string;
};

function parsePatchBlocks(patchText: string): PatchBlock[] {
  const cleaned = patchText
    .replace(/^\*\*\*\s*Begin Patch\s*$/gm, "")
    .replace(/^\*\*\*\s*End Patch\s*$/gm, "")
    .trim();
  const header = /^\*\*\*\s+(Update|Add|Delete)\s+File:\s+(.+)$/gm;
  const blocks: PatchBlock[] = [];
  let lastIndex = 0;

  for (const match of cleaned.matchAll(header)) {
    const previous = blocks.at(-1);
    if (previous) previous.body = cleaned.slice(lastIndex, match.index);
    blocks.push({
      type: match[1] as PatchBlock["type"],
      path: match[2]?.trim() ?? "",
      body: "",
    });
    lastIndex = (match.index ?? 0) + match[0].length;
  }
  const last = blocks.at(-1);
  if (last) last.body = cleaned.slice(lastIndex);
  return blocks;
}

function blockToUnifiedDiff(block: PatchBlock): string {
  const diffLines = block.body
    .split("\n")
    .filter((line) => {
      if (/^@@.*@@\s*$/.test(line)) return false;
      return (
        line.startsWith("+") ||
        line.startsWith("-") ||
        line.startsWith(" ")
      );
    });
  const { path, type } = block;
  const header = [
    `diff --git a/${path} b/${path}`,
    type === "Add" ? "new file mode 100644" : undefined,
    type === "Delete" ? "deleted file mode 100644" : undefined,
    type === "Add" ? "--- /dev/null" : `--- a/${path}`,
    type === "Delete" ? "+++ /dev/null" : `+++ b/${path}`,
  ].filter(Boolean);
  if (diffLines.length === 0) return header.join("\n");

  const normalizedLines =
    type === "Add"
      ? diffLines.map((line) => (line.startsWith("+") ? line : `+${line}`))
      : type === "Delete"
        ? diffLines.map((line) =>
            line.startsWith("-") ? line : `-${line}`,
          )
        : diffLines;
  const oldCount = normalizedLines.filter(
    (line) => !line.startsWith("+"),
  ).length;
  const newCount = normalizedLines.filter(
    (line) => !line.startsWith("-"),
  ).length;
  const hunk =
    type === "Add"
      ? `@@ -0,0 +1,${newCount} @@`
      : type === "Delete"
        ? `@@ -1,${oldCount} +0,0 @@`
        : `@@ -1,${Math.max(oldCount, 1)} +1,${Math.max(newCount, 1)} @@`;
  return `${header.join("\n")}\n${hunk}\n${normalizedLines.join("\n")}`;
}

export function normalizeApplyPatch(patchText: string): string {
  const trimmed = patchText.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("diff --git") || trimmed.startsWith("Index:")) {
    return trimmed;
  }
  const blocks = parsePatchBlocks(trimmed);
  return blocks.length > 0
    ? blocks.map(blockToUnifiedDiff).join("\n")
    : trimmed;
}

export const ApplyPatchTool: ToolCallMessagePartComponent = memo(
  ({ args, result, status, isError }) => {
    const { t } = useT("chat");
    const [open, setOpen] = useState(false);
    const record = asRecord(args);
    const resultRecord = asRecord(result);
    const patchText =
      firstString(record, ["patchText", "patch_text", "patch"]) ||
      firstString(resultRecord, ["patchText", "patch_text", "patch"]);
    const unifiedPatch = useMemo(
      () => normalizeApplyPatch(patchText),
      [patchText],
    );
    const patchInfo = useMemo(() => getPatchInfo(patchText), [patchText]);
    const hasDiff = unifiedPatch.length > 0 && status.type !== "running";
    const summary =
      patchInfo.files.length === 1
        ? patchInfo.files[0]
        : patchInfo.files.length > 1
          ? t(($) => $.session.tools.patch.files, {
              count: patchInfo.files.length,
            })
          : undefined;

    return (
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1">
            <ToolCallShell
              toolName={t(($) => $.session.tools.names.apply_patch)}
              status={status}
              isError={isError}
              summary={summary}
              trailing={
                status.type !== "running" &&
                (patchInfo.added > 0 || patchInfo.removed > 0) ? (
                  <span className="flex shrink-0 gap-1 font-mono text-[11px]">
                    {patchInfo.added > 0 ? (
                      <span className="text-emerald-600">
                        +{patchInfo.added}
                      </span>
                    ) : null}
                    {patchInfo.removed > 0 ? (
                      <span className="text-red-600">
                        -{patchInfo.removed}
                      </span>
                    ) : null}
                  </span>
                ) : undefined
              }
            />
          </div>
          {hasDiff ? (
            <CollapsibleTrigger
              className="rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={
                open
                  ? t(($) => $.session.tools.hide_details)
                  : t(($) => $.session.tools.show_details)
              }
            >
              <ChevronRight
                className={cn(
                  "size-3.5 transition-transform motion-reduce:transition-none",
                  open && "rotate-90",
                )}
              />
            </CollapsibleTrigger>
          ) : null}
        </div>
        {hasDiff ? (
          <CollapsibleContent className="ml-5 mt-1 overflow-hidden rounded-md border">
            <PatchDiff
              patch={unifiedPatch}
              options={{
                theme: { dark: "pierre-dark", light: "pierre-light" },
                diffStyle: "unified",
                overflow: "wrap",
              }}
            />
          </CollapsibleContent>
        ) : null}
      </Collapsible>
    );
  },
);
ApplyPatchTool.displayName = "ApplyPatchTool";
