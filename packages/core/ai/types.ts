export type AiContextType = "workflow" | "issue" | "inbox" | "agent";

export type CommandMode = "chat" | "command";

export interface CommandRequest {
  context_type: AiContextType;
  context_id: string;
  user_input: string;
  mode: CommandMode;
  // workspace_id is NOT sent — ApiClient injects it via X-Workspace-ID header
}

export interface CommandResponse {
  task_id: string;
  agent_id: string;
}
