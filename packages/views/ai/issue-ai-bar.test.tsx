import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IssueAiBar } from "./issue-ai-bar";

vi.mock("@multica/core/ai/commands", () => ({
  useSubmitCommand: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ task_id: "task-1", agent_id: "agent-1" }),
    isPending: false,
    isError: false,
    error: null,
  }),
}));

vi.mock("@multica/core/ai/issue-commands", () => ({
  parseIssueCommand: (input: string) => {
    if (input.includes("assign to")) return { type: "assign", target: "Alice", targetType: "member" };
    return { type: "unknown" };
  },
}));

describe("IssueAiBar", () => {
  it("renders input bar", () => {
    render(<IssueAiBar issueId="issue-1" />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("calls onOptimisticIntent with parsed intent", async () => {
    const onOptimisticIntent = vi.fn();
    const user = userEvent.setup();

    render(<IssueAiBar issueId="issue-1" onOptimisticIntent={onOptimisticIntent} />);

    await user.type(screen.getByRole("textbox"), "assign to Alice");
    await user.keyboard("{Enter}");

    expect(onOptimisticIntent).toHaveBeenCalledWith({
      type: "assign",
      target: "Alice",
      targetType: "member",
    });
  });
});
