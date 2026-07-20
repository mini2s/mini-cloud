"use client";

import {
  resolveCloudProxyBaseUrl,
  useIssueConversationSession,
} from "@multica/core/conversations";
import { Button } from "@multica/ui/components/ui/button";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { RefreshCw } from "lucide-react";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { Session, type SessionMode } from "../../common/session";
import { ConversationRuntimeProvider } from "../../common/session/runtime/conversation-runtime-provider";
import { useT } from "../../i18n";

export function IssueConversationPanel({
  workspaceId,
  issueId,
  mode,
  active,
  onTakeover,
}: {
  workspaceId: string;
  issueId: string;
  mode: SessionMode;
  active: boolean;
  onTakeover: () => void;
}) {
  const { t } = useT("chat");
  const query = useIssueConversationSession(workspaceId, issueId, active);
  const resolution = useMemo(() => {
    if (!query.data || typeof window === "undefined") {
      return { descriptor: null, error: null };
    }
    try {
      return {
        descriptor: {
          ...query.data,
          proxyBaseUrl: resolveCloudProxyBaseUrl(
            query.data.proxyBaseUrl,
            window.location.origin,
          ),
        },
        error: null,
      };
    } catch (error) {
      console.error("[session] Invalid cloud proxy URL", error);
      return { descriptor: null, error };
    }
  }, [query.data]);
  const handleRuntimeError = useCallback(
    (error: unknown) => {
      console.error("[session] Runtime failed", error);
      toast.error(t(($) => $.session.load_error));
    },
    [t],
  );

  if (query.isPending) {
    return (
      <section
        className="mt-4 h-[clamp(420px,60vh,680px)] rounded-xl border bg-background p-5"
        role="status"
        aria-label={t(($) => $.session.loading)}
      >
        <div className="mx-auto max-w-4xl space-y-4">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-20 w-full" />
        </div>
      </section>
    );
  }

  if (query.isError || resolution.error || !resolution.descriptor) {
    return (
      <section className="mt-4 flex min-h-48 flex-col items-center justify-center gap-3 rounded-xl border bg-background p-6 text-center">
        <p className="text-sm text-muted-foreground">
          {t(($) => $.session.load_error)}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void query.refetch()}
        >
          <RefreshCw className="size-3.5" />
          {t(($) => $.session.retry)}
        </Button>
      </section>
    );
  }

  const descriptor = resolution.descriptor;
  return (
    <ConversationRuntimeProvider
      key={descriptor.conversationId}
      descriptor={descriptor}
      mode={mode}
      onError={handleRuntimeError}
    >
      <Session
        mode={mode}
        active={active}
        onTakeover={onTakeover}
      />
    </ConversationRuntimeProvider>
  );
}
