"use client";

import {
  AuiIf,
  ComposerPrimitive,
  ThreadPrimitive,
} from "@assistant-ui/react";
import { Button } from "@multica/ui/components/ui/button";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { ArrowDown, ArrowUp, CornerDownRight, Loader2, Square } from "lucide-react";
import { useT } from "../../i18n";
import type { SessionMode } from "./session";
import { ConversationInteractionFallback } from "./runtime/conversation-interaction-fallback";
import { useSessionRuntimeState } from "./session-runtime-state";
import { SessionMessage } from "./session-message";

function SessionLoading() {
  const { t } = useT("chat");
  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-5 py-5" role="status" aria-label={t(($) => $.session.loading)}>
      <div className="space-y-2">
        <Skeleton className="h-3.5 w-3/4" />
        <Skeleton className="h-3.5 w-1/2" />
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-9 w-52 rounded-2xl" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="h-3.5 w-5/6" />
        <Skeleton className="h-3.5 w-1/3" />
      </div>
    </div>
  );
}

function SessionError({
  retry,
}: {
  retry: (() => void) | undefined;
}) {
  const { t } = useT("chat");
  return (
    <div
      className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center gap-3 px-5 py-8 text-center"
      role="alert"
    >
      <p className="text-sm text-muted-foreground">
        {t(($) => $.session.load_error)}
      </p>
      {retry && (
        <Button type="button" variant="outline" size="sm" onClick={retry}>
          {t(($) => $.session.retry)}
        </Button>
      )}
    </div>
  );
}

function Composer() {
  const { t } = useT("chat");
  const { isLoading, isCancelling } = useSessionRuntimeState();
  return (
    <ComposerPrimitive.Root className="rounded-xl border bg-background p-2 shadow-sm focus-within:border-ring">
      <ComposerPrimitive.Input
        rows={1}
        disabled={isLoading}
        placeholder={t(($) => $.session.composer_placeholder)}
        aria-label={t(($) => $.session.composer_aria)}
        className="max-h-28 min-h-10 w-full resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
      />
      <div className="flex justify-end pt-1">
        <AuiIf condition={(state) => !state.thread.isRunning}>
          <ComposerPrimitive.Send asChild>
            <Button type="button" size="icon-sm" aria-label={t(($) => $.session.send)}>
              <ArrowUp className="size-4" />
            </Button>
          </ComposerPrimitive.Send>
        </AuiIf>
        <AuiIf condition={(state) => state.thread.isRunning}>
          <ComposerPrimitive.Cancel asChild>
            <Button
              type="button"
              size="icon-sm"
              disabled={isCancelling}
              aria-label={
                isCancelling
                  ? t(($) => $.session.cancelling)
                  : t(($) => $.session.stop)
              }
            >
              {isCancelling ? (
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
              ) : (
                <Square className="size-3.5 fill-current" />
              )}
            </Button>
          </ComposerPrimitive.Cancel>
        </AuiIf>
      </div>
    </ComposerPrimitive.Root>
  );
}

function TakeoverBar({ onTakeover }: { onTakeover: () => void }) {
  const { t } = useT("chat");
  return (
    <div className="flex min-h-16 flex-col gap-3 rounded-xl border bg-background px-3 py-2 shadow-sm sm:flex-row sm:items-center">
      <p className="min-w-0 flex-1 text-xs text-muted-foreground">
        {t(($) => $.session.observe_description)}
      </p>
      <Button size="sm" className="sm:ml-auto" onClick={onTakeover}>
        <CornerDownRight className="size-3.5" />
        {t(($) => $.session.takeover)}
      </Button>
    </div>
  );
}

export function SessionThread({
  mode,
  onTakeover,
}: {
  mode: SessionMode;
  onTakeover: () => void;
}) {
  const { t } = useT("chat");
  const { isLoading, error, retry } = useSessionRuntimeState();
  return (
    <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col bg-background">
      <ThreadPrimitive.Viewport className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain scroll-smooth">
        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-5 pt-4">
          {isLoading ? (
            <SessionLoading />
          ) : error !== undefined ? (
            <SessionError retry={retry} />
          ) : (
            <div className="flex flex-col gap-5 pb-6">
              <ThreadPrimitive.Messages components={{ Message: SessionMessage }} />
            </div>
          )}
          <ThreadPrimitive.ViewportFooter className="sticky bottom-0 mt-auto flex flex-col items-stretch gap-2 bg-gradient-to-t from-background via-background to-transparent pb-4 pt-8">
            <ThreadPrimitive.ScrollToBottom asChild>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                className="absolute -top-2 self-center rounded-full disabled:invisible"
                aria-label={t(($) => $.session.scroll_to_bottom)}
              >
                <ArrowDown className="size-4" />
              </Button>
            </ThreadPrimitive.ScrollToBottom>
            <ConversationInteractionFallback />
            {error !== undefined ? null : mode === "observe" ? (
              <TakeoverBar onTakeover={onTakeover} />
            ) : (
              <Composer />
            )}
          </ThreadPrimitive.ViewportFooter>
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}
