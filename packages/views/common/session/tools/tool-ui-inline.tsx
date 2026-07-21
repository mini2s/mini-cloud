"use client";

import type {
  ToolCallMessagePartComponent,
  ToolCallMessagePartProps,
} from "@assistant-ui/react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@multica/ui/components/ui/collapsible";
import { cn } from "@multica/ui/lib/utils";
import { ChevronRight } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { useT } from "../../../i18n";
import { useCurrentConversationToolEntry } from "../runtime/conversation-tool-bridge";
import { ToolDiff } from "./tool-diff";
import {
  ToolCallShell,
  asRecord,
  basename,
  firstString,
  formatValue,
  shortenPath,
  truncate,
} from "./tool-ui-shared";

function summaryValue(
  args: Record<string, unknown> | undefined,
  keys: readonly string[],
): string {
  return truncate(firstString(args, keys));
}

function normalizeQuestionAnswers(
  value: unknown,
): readonly (readonly string[])[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((answer) =>
    Array.isArray(answer)
      ? answer.filter((item): item is string => typeof item === "string")
      : [],
  );
}

function FileSummary({ path }: { path: string }) {
  if (!path) return null;
  const label = truncate(shortenPath(path));
  return <span className="truncate opacity-60">{label}</span>;
}

export const ReadInline: ToolCallMessagePartComponent = memo(
  ({ args, status, isError }) => {
    const { t } = useT("chat");
    const record = asRecord(args);
    const path = firstString(record, [
      "filePath",
      "file_path",
      "path",
      "file",
    ]);
    return (
      <ToolCallShell
        toolName={t(($) => $.session.tools.names.read)}
        status={status}
        isError={isError}
        summary={<FileSummary path={path} />}
      />
    );
  },
);
ReadInline.displayName = "ReadInline";

function simpleInline(
  name: "grep" | "glob" | "web_search" | "web_fetch",
  keys: readonly string[],
): ToolCallMessagePartComponent {
  const Component: ToolCallMessagePartComponent = memo(
    ({ args, status, isError }) => {
      const { t } = useT("chat");
      const labels = {
        grep: t(($) => $.session.tools.names.grep),
        glob: t(($) => $.session.tools.names.glob),
        web_search: t(($) => $.session.tools.names.web_search),
        web_fetch: t(($) => $.session.tools.names.web_fetch),
      };
      const value = summaryValue(asRecord(args), keys);
      return (
        <ToolCallShell
          toolName={labels[name]}
          status={status}
          isError={isError}
          summary={value}
        />
      );
    },
  );
  Component.displayName = `${name}Inline`;
  return Component;
}

export const GrepInline = simpleInline("grep", ["pattern"]);
GrepInline.displayName = "GrepInline";

export const GlobInline = simpleInline("glob", ["pattern"]);
GlobInline.displayName = "GlobInline";

export const WebSearchInline = simpleInline("web_search", ["query"]);
WebSearchInline.displayName = "WebSearchInline";

export const WebFetchInline = simpleInline("web_fetch", ["url"]);
WebFetchInline.displayName = "WebFetchInline";

export const EditInline: ToolCallMessagePartComponent = memo(
  ({ args, result, status, isError }) => {
    const { t } = useT("chat");
    const record = asRecord(args);
    const path = firstString(record, [
      "filePath",
      "file_path",
      "path",
      "file",
    ]);
    const hasOldString =
      "oldString" in (record ?? {}) || "old_string" in (record ?? {});
    const isWrite =
      !hasOldString &&
      ("content" in (record ?? {}) || "contents" in (record ?? {}));
    return (
      <div>
        <ToolCallShell
          toolName={
            isWrite
              ? t(($) => $.session.tools.names.write)
              : t(($) => $.session.tools.names.edit)
          }
          status={status}
          isError={isError}
          summary={path ? basename(path) : undefined}
        />
        {status.type !== "running" ? (
          <ToolDiff
            args={record}
            result={result}
          />
        ) : null}
      </div>
    );
  },
);
EditInline.displayName = "EditInline";

export const WriteInline: ToolCallMessagePartComponent = EditInline;

export const TaskInline: ToolCallMessagePartComponent = memo(
  ({ args, result, status, isError }) => {
    const { t } = useT("chat");
    const [open, setOpen] = useState(false);
    const entry = useCurrentConversationToolEntry();
    const record = asRecord(args);
    const description =
      firstString(record, ["description", "prompt"]) ||
      entry?.task?.description ||
      entry?.progress.at(-1) ||
      "";
    const output = useMemo(() => formatValue(result), [result]);
    const hasOutput = result !== undefined && output.length > 0;

    return (
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1">
            <ToolCallShell
              toolName={t(($) => $.session.tools.names.task)}
              status={status}
              isError={isError}
              summary={description ? truncate(description) : undefined}
            />
          </div>
          {hasOutput ? (
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
        {hasOutput ? (
          <CollapsibleContent className="ml-5 mt-1 max-h-64 overflow-y-auto rounded-md border bg-muted/20 px-3 py-2 text-xs whitespace-pre-wrap">
            {output}
          </CollapsibleContent>
        ) : null}
      </Collapsible>
    );
  },
);
TaskInline.displayName = "TaskInline";

export const QuestionInline: ToolCallMessagePartComponent = memo(
  ({ args, result, status, isError }) => {
    const { t } = useT("chat");
    const entry = useCurrentConversationToolEntry();
    const record = asRecord(args);
    const questions = Array.isArray(record?.questions)
      ? record.questions
      : [];
    const firstQuestion = asRecord(questions[0]);
    const summary = firstString(firstQuestion, ["question", "header"]);
    const providerMetadata = asRecord(entry?.providerState?.metadata);
    const resultRecord = asRecord(result);
    const resultMetadata =
      asRecord(resultRecord?.metadata) ??
      asRecord(asRecord(resultRecord?.output)?.metadata);
    const metadataAnswers = normalizeQuestionAnswers(
      providerMetadata?.answers ?? resultMetadata?.answers,
    );
    const response = entry?.questionResponses.at(-1);
    const answers = metadataAnswers ?? response?.answers;
    const responseState =
      response?.state ?? (metadataAnswers ? "answered" : undefined);

    return (
      <div>
        <ToolCallShell
          toolName={t(($) => $.session.tools.names.question)}
          status={status}
          isError={isError}
          summary={summary ? truncate(summary) : undefined}
        />
        {responseState ? (
          <div className="ml-5 mt-1 space-y-2 rounded-md border bg-muted/20 px-3 py-2 text-xs">
            {responseState === "rejected" ? (
              <span className="text-muted-foreground">
                {t(($) => $.session.tools.question.dismissed)}
              </span>
            ) : (
              questions.map((question, index) => {
                const item = asRecord(question);
                const label = firstString(item, ["question", "header"]);
                const answer = answers?.[index] ?? [];
                return (
                  <div key={`${label}-${index}`} className="space-y-0.5">
                    {label ? (
                      <div className="text-muted-foreground">{label}</div>
                    ) : null}
                    <div>
                      {answer.join(", ") ||
                        t(($) => $.session.tools.question.no_answer)}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : null}
      </div>
    );
  },
);
QuestionInline.displayName = "QuestionInline";

const FALLBACK_SUMMARY_KEYS = [
  "filePath",
  "file_path",
  "path",
  "pattern",
  "command",
  "query",
  "url",
  "tool_name",
] as const;

function FallbackToolImpl({
  toolName,
  args,
  result,
  status,
  isError,
}: ToolCallMessagePartProps) {
  const { t } = useT("chat");
  const [open, setOpen] = useState(false);
  const record = asRecord(args);
  const summary = summaryValue(record, FALLBACK_SUMMARY_KEYS);
  const input = useMemo(() => formatValue(args), [args]);
  const output = useMemo(() => formatValue(result), [result]);
  const hasDetails =
    input.length > 0 || (result !== undefined && output.length > 0);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <ToolCallShell
            toolName={toolName}
            status={status}
            isError={isError}
            summary={summary}
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
        <CollapsibleContent className="ml-5 mt-1 max-h-72 space-y-3 overflow-y-auto rounded-md border bg-muted/20 px-3 py-2 text-xs">
          {input ? (
            <div>
              <div className="mb-1 font-medium text-muted-foreground">
                {t(($) => $.session.tool_input)}
              </div>
              <pre className="whitespace-pre-wrap break-words">{input}</pre>
            </div>
          ) : null}
          {result !== undefined ? (
            <div>
              <div className="mb-1 font-medium text-muted-foreground">
                {t(($) => $.session.tool_output)}
              </div>
              <pre className="whitespace-pre-wrap break-words">{output}</pre>
            </div>
          ) : null}
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}

export const FallbackTool = memo(FallbackToolImpl);
FallbackTool.displayName = "FallbackTool";
