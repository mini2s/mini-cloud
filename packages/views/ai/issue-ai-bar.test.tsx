import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderWithI18n } from "../test/i18n";
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

vi.mock("@multica/core/ai/task-listener", () => ({
  useCommandTaskListener: vi.fn(),
}));

function renderWithProviders(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithI18n(
    <QueryClientProvider client={qc}>{ui}</QueryClientProvider>,
  );
}

describe("IssueAiBar", () => {
  it("renders input bar", () => {
    renderWithProviders(<IssueAiBar issueId="issue-1" />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("calls onOptimisticIntent with parsed intent", async () => {
    const onOptimisticIntent = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(<IssueAiBar issueId="issue-1" onOptimisticIntent={onOptimisticIntent} />);

    await user.type(screen.getByRole("textbox"), "assign to Alice");
    await user.keyboard("{Enter}");

    expect(onOptimisticIntent).toHaveBeenCalledWith({
      type: "assign",
      target: "Alice",
      targetType: "member",
    });
  });
});
