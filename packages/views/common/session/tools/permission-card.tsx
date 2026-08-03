"use client";

import { Badge } from "@multica/ui/components/ui/badge";
import { Button } from "@multica/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@multica/ui/components/ui/card";
import {
  CheckCircle2,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { useRef, useState } from "react";
import { useT } from "../../../i18n";
import {
  asRecord,
  firstString,
  formatValue,
} from "./tool-ui-shared";

export type ConversationPermissionRequest = {
  id: string;
  permission: string;
  title: string;
  patterns: readonly string[];
  toolInput?: unknown;
};

export function normalizePermissionRequest(
  value: unknown,
): ConversationPermissionRequest | undefined {
  const record = asRecord(value);
  const id = firstString(record, ["id", "requestID", "requestId"]);
  if (!id) return undefined;
  const metadata = asRecord(record?.metadata);
  const patterns = Array.isArray(record?.patterns)
    ? record.patterns.filter(
        (pattern): pattern is string => typeof pattern === "string",
      )
    : [];
  return {
    id,
    permission:
      firstString(record, ["permission", "toolName", "tool_name"]) ||
      "tool",
    title: firstString(record, ["title"]),
    patterns,
    ...(metadata?.input !== undefined
      ? { toolInput: metadata.input }
      : {}),
  };
}

export function PermissionCard({
  request,
  canInteract,
  onRespond,
}: {
  request: ConversationPermissionRequest;
  canInteract: boolean;
  onRespond: (
    decision: "once" | "always" | "reject",
  ) => Promise<void>;
}) {
  const { t } = useT("chat");
  const [submitting, setSubmitting] = useState<
    "once" | "always" | "reject" | null
  >(null);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submissionRef = useRef(false);

  const respond = async (decision: "once" | "always" | "reject") => {
    if (!canInteract || submissionRef.current) return;
    submissionRef.current = true;
    setSubmitting(decision);
    setError(null);
    try {
      await onRespond(decision);
      setSubmitted(true);
    } catch (responseError) {
      submissionRef.current = false;
      setError(
        responseError instanceof Error
          ? responseError.message
          : t(($) => $.session.tools.permission.submit_failed),
      );
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <Card size="sm" className="min-w-0">
      <CardHeader>
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-md bg-amber-500/10 p-2 text-amber-700">
            {submitted ? (
              <CheckCircle2 className="size-4" />
            ) : (
              <ShieldAlert className="size-4" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle>
              {submitted
                ? t(($) => $.session.tools.permission.submitted)
                : t(($) => $.session.tools.permission.approval_required)}
            </CardTitle>
            <CardDescription className="mt-1 text-xs">
              {request.title ||
                t(($) => $.session.tools.permission.request_description, {
                  tool: request.permission,
                })}
            </CardDescription>
          </div>
          <Badge variant={submitted ? "outline" : "secondary"}>
            {request.permission}
          </Badge>
        </div>
      </CardHeader>
      {request.patterns.length > 0 || request.toolInput !== undefined ? (
        <CardContent className="space-y-3">
          {request.patterns.length > 0 ? (
            <div className="flex max-w-full gap-2 overflow-x-auto">
              {request.patterns.map((pattern) => (
                <Badge
                  key={pattern}
                  variant="outline"
                  className="shrink-0 font-mono"
                >
                  {pattern}
                </Badge>
              ))}
            </div>
          ) : null}
          {request.toolInput !== undefined ? (
            <pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap break-words">
              {formatValue(request.toolInput)}
            </pre>
          ) : null}
        </CardContent>
      ) : null}
      {!submitted ? (
        <CardFooter className="flex flex-wrap gap-2">
          {canInteract ? (
            <>
              <Button
                type="button"
                size="xs"
                disabled={submitting !== null}
                onClick={() => void respond("once")}
              >
                {submitting === "once" ? (
                  <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
                ) : null}
                {t(($) => $.session.tools.permission.allow_once)}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="xs"
                disabled={submitting !== null}
                onClick={() => void respond("always")}
              >
                {submitting === "always" ? (
                  <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
                ) : null}
                {t(($) => $.session.tools.permission.always)}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={submitting !== null}
                onClick={() => void respond("reject")}
              >
                {submitting === "reject" ? (
                  <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
                ) : null}
                {t(($) => $.session.tools.permission.reject)}
              </Button>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">
              {t(($) => $.session.tools.permission.takeover_required)}
            </span>
          )}
          {error ? (
            <span className="w-full text-xs text-destructive" role="alert">
              {error}
            </span>
          ) : null}
        </CardFooter>
      ) : null}
    </Card>
  );
}
