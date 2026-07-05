import type { RuntimeNodeOverlay } from "./types";

export type RuntimeNodeTone = "muted" | "active" | "attention" | "danger" | "blocked" | "success";
export type RuntimeNodeAction = "approve" | "reject" | "retry" | "skip" | "takeover" | "handback" | "complete";

export interface RuntimeNodePresentation {
  tone: RuntimeNodeTone;
  label: string;
  isRunning: boolean;
  isAwaitingInput: boolean;
  actions: RuntimeNodeAction[];
}

export function getRuntimeNodePresentation(runtime: RuntimeNodeOverlay | null): RuntimeNodePresentation {
  if (!runtime) {
    return { tone: "muted", label: "not started", isRunning: false, isAwaitingInput: false, actions: [] };
  }

  switch (runtime.status) {
    case "format_checking":
    case "working":
    case "critic_reviewing":
    case "self_recovering":
      return { tone: "active", label: runtime.status, isRunning: true, isAwaitingInput: false, actions: [] };
    case "awaiting_input":
      return { tone: "attention", label: runtime.status, isRunning: false, isAwaitingInput: true, actions: [] };
    case "awaiting_critic":
      return { tone: "attention", label: runtime.status, isRunning: false, isAwaitingInput: false, actions: ["approve", "reject", "skip"] };
    case "failed":
      return { tone: "danger", label: runtime.status, isRunning: false, isAwaitingInput: false, actions: ["retry", "skip", "complete"] };
    case "blocked":
      return { tone: "blocked", label: runtime.status, isRunning: false, isAwaitingInput: false, actions: ["takeover", "handback", "complete", "skip"] };
    case "completed":
    case "critic_approved":
      return { tone: "success", label: runtime.status, isRunning: false, isAwaitingInput: false, actions: [] };
    case "format_failed":
      return { tone: "danger", label: runtime.status, isRunning: false, isAwaitingInput: false, actions: ["retry"] };
    case "worker_assigned":
      return { tone: "active", label: runtime.status, isRunning: true, isAwaitingInput: false, actions: [] };
    case "critic_rework":
      return { tone: "attention", label: runtime.status, isRunning: false, isAwaitingInput: false, actions: [] };
    default:
      return { tone: "muted", label: runtime.status, isRunning: false, isAwaitingInput: false, actions: [] };
  }
}
