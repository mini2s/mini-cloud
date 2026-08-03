"use client";

import { toast } from "sonner";
import type { IssueAssigneeType } from "@multica/core/types";
import { useUpdateIssue } from "@multica/core/issues/mutations";
import { useWorkspaceId } from "@multica/core/hooks";
import { BacklogAgentHintDialog } from "../issues/components/backlog-agent-hint-dialog";
import { useRuntimeStartDialogs, type RuntimeExtras } from "../issues/hooks/use-runtime-start-dialogs";
import { useT } from "../i18n";

export function BacklogAgentHintModal({
  onClose,
  data,
}: {
  onClose: () => void;
  data: Record<string, unknown> | null;
}) {
  const { t } = useT("modals");
  const wsId = useWorkspaceId();
  const issueId = (data?.issueId as string) || "";
  const assigneeType = (data?.assigneeType as IssueAssigneeType | null) ?? null;
  const assigneeId = (data?.assigneeId as string | null) ?? null;
  const updateIssue = useUpdateIssue();
  const { maybeSelectRuntimeThen, dialogs: runtimeDialogs } = useRuntimeStartDialogs(wsId);

  const commitInProgress = (payload: { id: string; status: "in_progress" } & RuntimeExtras) => {
    updateIssue.mutate(payload, {
      onError: (err) =>
        toast.error(
          err instanceof Error && err.message
            ? err.message
            : t(($) => $.backlog_hint.toast_status_failed),
        ),
    });
    onClose();
  };

  return (
    <>
      {runtimeDialogs}
      <BacklogAgentHintDialog
        open
        onOpenChange={(v) => {
          if (!v) onClose();
        }}
        onDismissPermanently={() => {
          localStorage.setItem("multica:backlog-agent-hint-dismissed", "true");
        }}
        onMoveToInProgress={() => {
          if (!issueId) {
            onClose();
            return;
          }
          const basePayload = { id: issueId, status: "in_progress" as const };
          // This hint only fires for agent assignees; route through the same
          // runtime-selection path as the board so a built-in agent asks for a
          // runtime before starting (a non-builtin agent commits directly,
          // matching the board).
          if (assigneeType && assigneeId) {
            maybeSelectRuntimeThen(assigneeType, assigneeId, basePayload, commitInProgress);
            return;
          }
          commitInProgress(basePayload);
        }}
      />
    </>
  );
}
