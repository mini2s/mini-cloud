import { useMutation } from "@tanstack/react-query";
import { getApi } from "../api";
import type { CommandRequest, CommandResponse, AiContextType, CommandMode } from "./types";

interface SubmitCommandParams {
  contextType: AiContextType;
  contextId: string;
  userInput: string;
  mode: CommandMode;
  agentId?: string;
  messages?: { role: "user" | "assistant"; content: string }[];
}

export function useSubmitCommand() {
  return useMutation<CommandResponse, Error, SubmitCommandParams>({
    mutationFn: (params) => {
      const req: CommandRequest = {
        // workspace_id is injected by ApiClient via X-Workspace-ID header
        context_type: params.contextType,
        context_id: params.contextId,
        user_input: params.userInput,
        mode: params.mode,
      };
      if (params.agentId) {
        req.agent_id = params.agentId;
      }
      if (params.messages && params.messages.length > 0) {
        req.messages = params.messages;
      }
      return getApi().sendCommand(req);
    },
  });
}
