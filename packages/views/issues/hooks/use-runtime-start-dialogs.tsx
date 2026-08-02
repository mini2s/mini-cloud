"use client";

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { runtimeListOptions } from "@multica/core/runtimes/queries";
import { agentListOptions } from "@multica/core/workspace/queries";
import { workflowActiveListOptions } from "@multica/core/workflows/queries";
import type { IssueAssigneeType, WorkflowRuntimeSelectionPolicy } from "@multica/core/types";
import { RuntimeSelectDialog } from "../../agents/components/runtime-select-dialog";
import {
  WorkflowRuntimeStrategyDialog,
  type WorkflowRuntimeStrategyValue,
} from "../../workflows/components/workflow-runtime-strategy-dialog";
import { useUsableWorkflowRuntimes } from "../../workflows/components/use-usable-workflow-runtimes";

// A "start" is any operation that moves an issue into execution (status =
// in_progress): the create-issue "运行任务" button, dragging to in_progress on
// the board, the detail StatusPicker, the actions menu, the backlog hint. Such
// an operation may need a runtime chosen first — for a workflow assignee
// (runtime strategy) or a built-in agent (runtime). This hook centralizes that
// decision + the dialogs so every start path behaves identically and the
// runtime popup only fires at run time, never at assignee-selection time.

export type RuntimeExtras = {
  runtime_id?: string;
  runtime_selection_policy?: WorkflowRuntimeSelectionPolicy;
};

type PendingStart = {
  basePayload: Record<string, unknown>;
  commit: (payload: Record<string, unknown>) => void;
  kind: "agent" | "workflow";
  agentName?: string;
  workflowTitle?: string;
  initialValue?: WorkflowRuntimeStrategyValue;
};

export function useRuntimeStartDialogs(wsId: string) {
  const { data: runtimes = [], isLoading: runtimesLoading } = useQuery(runtimeListOptions(wsId));
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: workflows = [] } = useQuery(workflowActiveListOptions(wsId));
  const usableWorkflowRuntimes = useUsableWorkflowRuntimes(runtimes);
  const [pending, setPending] = useState<PendingStart | null>(null);

  // maybeSelectRuntimeThen runs the start: if the assignee needs a runtime
  // chosen first, it opens the right dialog and returns false (the caller must
  // NOT also commit — the dialog's confirm commits). Otherwise it commits the
  // basePayload directly and returns true. Generic in P so the caller keeps its
  // payload type; the pending slot is cast to a loose record internally because
  // React state cannot hold a generic.
  const maybeSelectRuntimeThen = <P extends object>(
    assigneeType: IssueAssigneeType | null | undefined,
    assigneeId: string | null | undefined,
    basePayload: P,
    commit: (payload: P & RuntimeExtras) => void,
  ): boolean => {
    const looseCommit = commit as unknown as (payload: Record<string, unknown>) => void;
    const loosePayload = basePayload as unknown as Record<string, unknown>;

    if (assigneeType === "workflow" && assigneeId) {
      const workflow = workflows.find((w) => w.id === assigneeId);
      setPending({
        basePayload: loosePayload,
        commit: looseCommit,
        kind: "workflow",
        workflowTitle: workflow?.title ?? "",
        initialValue: {
          policy: workflow?.default_runtime_selection_policy ?? "idle_first",
          runtimeId: workflow?.default_runtime_id ?? null,
        },
      });
      return false;
    }
    if (assigneeType === "agent" && assigneeId) {
      const agent = agents.find((a) => a.id === assigneeId);
      if (agent?.is_builtin) {
        const online = runtimes.filter((r) => r.status === "online");
        if (online.length === 0) {
          // No runtimes: proceed without one (backend auto-selects / falls back).
          commit(basePayload);
          return true;
        }
        if (online.length === 1) {
          // Single runtime: auto-select, no dialog.
          commit({ ...basePayload, runtime_id: online[0]!.id });
          return true;
        }
        setPending({
          basePayload: loosePayload,
          commit: looseCommit,
          kind: "agent",
          agentName: agent.name,
        });
        return false;
      }
    }
    commit(basePayload);
    return true;
  };

  const dialogs: ReactNode = (
    <>
      {pending?.kind === "agent" && (
        <RuntimeSelectDialog
          agentName={pending.agentName ?? ""}
          runtimes={runtimes.filter((r) => r.status === "online")}
          loading={runtimesLoading}
          allowAuto
          onClose={() => setPending(null)}
          onConfirm={(runtimeId: string | null) => {
            if (!runtimeId) return;
            pending.commit({ ...pending.basePayload, runtime_id: runtimeId });
            setPending(null);
          }}
        />
      )}
      {pending?.kind === "workflow" && (
        <WorkflowRuntimeStrategyDialog
          mode="run"
          workflowTitle={pending.workflowTitle ?? ""}
          initialValue={pending.initialValue ?? { policy: "idle_first", runtimeId: null }}
          runtimes={usableWorkflowRuntimes.runtimes}
          loading={runtimesLoading || usableWorkflowRuntimes.isLoading}
          directRun
          onClose={() => setPending(null)}
          onConfirm={(value: WorkflowRuntimeStrategyValue) => {
            pending.commit({
              ...pending.basePayload,
              runtime_id: value.runtimeId ?? undefined,
              runtime_selection_policy: value.policy,
            });
            setPending(null);
          }}
        />
      )}
    </>
  );

  return { maybeSelectRuntimeThen, dialogs };
}
