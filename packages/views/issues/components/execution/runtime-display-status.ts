import type { GatewayKind, WorkflowRuntimeDisplayStatus } from "@multica/core/types";
import type { useT } from "@multica/views/i18n";
import type { DrawerTone } from "../../../common/node-deliverable-drawer-ui";

type IssueTranslator = ReturnType<typeof useT<"issues">>["t"];

export function runtimeDisplayStatusText(
  t: IssueTranslator,
  status: WorkflowRuntimeDisplayStatus,
  gatewayKind: GatewayKind | null = null,
): string {
  if (gatewayKind === "fork" && status === "completed") {
    return t(($) => $.execution.display_status.dispatched);
  }
  if (gatewayKind === "join" && status === "completed") {
    return t(($) => $.execution.display_status.joined);
  }
  if (gatewayKind === "join" && (status === "pending" || status === "todo")) {
    return t(($) => $.execution.display_status.waiting_upstream);
  }
  switch (status) {
    case "pending":
      return t(($) => $.execution.display_status.pending);
    case "todo":
      return t(($) => $.execution.display_status.todo);
    case "in_progress":
      return t(($) => $.execution.display_status.in_progress);
    case "reviewing":
      return t(($) => $.execution.display_status.reviewing);
    case "completed":
      return t(($) => $.execution.display_status.completed);
    case "failed":
      return t(($) => $.execution.display_status.failed);
    case "blocked":
      return t(($) => $.execution.display_status.blocked);
    case "cancelled":
      return t(($) => $.execution.display_status.cancelled);
  }
}

export function runtimeDisplayStatusTone(status: WorkflowRuntimeDisplayStatus): DrawerTone {
  switch (status) {
    case "todo":
      return "amber";
    case "in_progress":
      return "blue";
    case "reviewing":
      return "violet";
    case "completed":
      return "emerald";
    case "failed":
    case "blocked":
      return "red";
    case "pending":
    case "cancelled":
      return "zinc";
  }
}
