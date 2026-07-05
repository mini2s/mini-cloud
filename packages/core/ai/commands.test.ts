import { describe, it, expect, vi } from "vitest";
import { getApi } from "../api";

// Mock the api module so getApi() returns a mock with sendCommand
vi.mock("../api", () => ({
  getApi: vi.fn(() => ({
    sendCommand: vi.fn().mockResolvedValue({ task_id: "task-1", agent_id: "agent-1" }),
  })),
}));

describe("useSubmitCommand", () => {
  it("getApi().sendCommand returns expected shape", async () => {
    const api = getApi();
    const result = await api.sendCommand({
      context_type: "issue",
      context_id: "MUL-123",
      user_input: "状态改为 done",
      mode: "command",
    });
    expect(result).toEqual({ task_id: "task-1", agent_id: "agent-1" });
  });
});
