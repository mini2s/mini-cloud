"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@multica/ui/components/ui/collapsible";
import { cn } from "@multica/ui/lib/utils";
import { Check, ChevronRight, Copy, Terminal } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import { useT } from "../../../i18n";
import { useCurrentConversationToolEntry } from "../runtime/conversation-tool-bridge";
import {
  ToolCallShell,
  asRecord,
  copyText,
  firstString,
  formatValue,
  numberValue,
  truncate,
} from "./tool-ui-shared";

export type ParsedBashResult = {
  stdout: string;
  stderr: string;
  rawOutput: string;
  exitCode?: number;
};

export function parseBashResult(result: unknown): ParsedBashResult {
  if (typeof result === "string") {
    try {
      const parsed = JSON.parse(result);
      if (asRecord(parsed)) return parseBashResult(parsed);
    } catch {
      return { stdout: result, stderr: "", rawOutput: "" };
    }
  }
  const record = asRecord(result);
  if (!record) return { stdout: "", stderr: "", rawOutput: "" };

  const nestedValue = record.output ?? record.result ?? record.data;
  const nested = asRecord(nestedValue);
  const nestedParsed = nested ? parseBashResult(nested) : undefined;
  const metadata = asRecord(record.metadata);
  const exitCodeCandidates = [
    record.exitCode,
    record.exit_code,
    record.code,
    metadata?.exit,
    nestedParsed?.exitCode,
  ];
  const exitCode = exitCodeCandidates.find(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  const stdout =
    firstString(record, ["stdout", "out", "text", "content"]) ||
    firstString(metadata, ["stdout", "out", "text", "content"]) ||
    nestedParsed?.stdout ||
    (typeof nestedValue === "string" ? nestedValue : "");
  const stderr =
    firstString(record, ["stderr", "err", "error"]) ||
    firstString(metadata, ["stderr", "err", "error"]) ||
    nestedParsed?.stderr ||
    "";
  const rawOutput =
    stdout || stderr
      ? ""
      : nestedParsed?.rawOutput ||
        (nestedValue !== undefined && !nested
          ? formatValue(nestedValue)
          : formatValue(record));

  return {
    stdout,
    stderr,
    rawOutput,
    ...(exitCode !== undefined ? { exitCode: numberValue(exitCode) } : {}),
  };
}

export const BashTool: ToolCallMessagePartComponent = memo(
  ({ args, result, status, isError }) => {
    const { t } = useT("chat");
    const entry = useCurrentConversationToolEntry();
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const record = asRecord(args);
    const command = firstString(record, ["command"]);
    const description = firstString(record, ["description"]);
    const parsed = useMemo(() => parseBashResult(result), [result]);
    const progress = entry?.progress.join("\n") ?? "";
    const displayOutput =
      parsed.stdout || parsed.stderr || parsed.rawOutput || progress;
    const failed =
      isError === true ||
      (parsed.exitCode !== undefined && parsed.exitCode !== 0);
    const hasDetails = Boolean(command || displayOutput);

    const handleCopy = useCallback(async () => {
      const value = [
        command ? `$ ${command}` : "",
        progress,
        parsed.stdout,
        parsed.stderr,
        parsed.rawOutput,
      ]
        .filter(Boolean)
        .join("\n");
      await copyText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    }, [command, parsed, progress]);

    return (
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1">
            <ToolCallShell
              toolName={t(($) => $.session.tools.names.bash)}
              status={status}
              isError={failed}
              summary={description || (command ? truncate(command) : undefined)}
              trailing={
                parsed.exitCode !== undefined && status.type !== "running" ? (
                  <span className="shrink-0 font-mono text-[11px] opacity-60">
                    {t(($) => $.session.tools.bash.exit_code, {
                      code: parsed.exitCode,
                    })}
                  </span>
                ) : undefined
              }
            />
          </div>
          {hasDetails ? (
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
        {hasDetails ? (
          <CollapsibleContent className="relative ml-5 mt-1 max-h-96 overflow-y-auto rounded-md border bg-muted/40 p-3 font-mono text-xs">
            <button
              type="button"
              className="absolute right-1.5 top-1.5 rounded-sm p-1 text-muted-foreground hover:bg-background hover:text-foreground"
              onClick={() => void handleCopy()}
              aria-label={
                copied
                  ? t(($) => $.session.tools.copied)
                  : t(($) => $.session.tools.copy)
              }
            >
              {copied ? (
                <Check className="size-3.5" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </button>
            {command ? (
              <div className="mb-2 pr-7 text-muted-foreground">
                <Terminal className="mr-1 inline size-3.5" />$ {command}
              </div>
            ) : null}
            {progress && status.type === "running" ? (
              <pre className="whitespace-pre-wrap break-words text-muted-foreground">
                {progress}
              </pre>
            ) : null}
            {parsed.stdout ? (
              <pre className="whitespace-pre-wrap break-words text-foreground">
                {parsed.stdout}
              </pre>
            ) : null}
            {parsed.stderr ? (
              <pre
                className={cn(
                  "whitespace-pre-wrap break-words text-destructive",
                  parsed.stdout && "mt-2",
                )}
              >
                {parsed.stderr}
              </pre>
            ) : null}
            {parsed.rawOutput ? (
              <pre className="whitespace-pre-wrap break-words text-foreground">
                {parsed.rawOutput}
              </pre>
            ) : null}
          </CollapsibleContent>
        ) : null}
      </Collapsible>
    );
  },
);
BashTool.displayName = "BashTool";
