import { describe, expect, it } from "vitest";
import type { Agent } from "../types";
import { agentListOptions } from "./queries";

function agent(id: string, name: string): Agent {
  return {
    id,
    workspace_id: "ws-1",
    runtime_id: "runtime-1",
    name,
    description: "",
    instructions: "",
    avatar_url: null,
    runtime_mode: "local",
    runtime_config: {},
    custom_env: {},
    custom_args: [],
    custom_env_redacted: false,
    visibility: "workspace",
    status: "idle",
    max_concurrent_tasks: 1,
    model: "",
    plugin_id: null,
    is_builtin: true,
    owner_id: null,
    skills: [],
    created_at: "",
    updated_at: "",
    archived_at: null,
    archived_by: null,
  };
}

describe("agentListOptions", () => {
  it("deduplicates legacy built-in agents returned twice by older servers", () => {
    const options = agentListOptions("ws-1");
    const duplicate = agent("agent-1", "Legacy built-in");

    expect(options.select?.([duplicate, { ...duplicate }, agent("agent-2", "Other")]))
      .toEqual([duplicate, agent("agent-2", "Other")]);
  });
});
