import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@multica/core/i18n/react";
import enCommon from "../../locales/en/common.json";
import enIssues from "../../locales/en/issues.json";

const TEST_RESOURCES = { en: { common: enCommon, issues: enIssues } };

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockItems: import("@multica/core/issues").TaskStreamItem[] = [];

vi.mock("@multica/core/issues", () => ({
  useTaskStream: (issueId: string) => ({
    items: mockItems.filter((i) => i.issue_id === issueId),
    reset: vi.fn(),
  }),
}));

import { CSCStreamPanel } from "./csc-stream-panel";

function renderPanel(issueId = "issue-1") {
  return render(
    <I18nProvider locale="en" resources={TEST_RESOURCES}>
      <CSCStreamPanel issueId={issueId} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  mockItems.length = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CSCStreamPanel", () => {
  it("renders the empty waiting state", () => {
    renderPanel();
    expect(screen.getByText(/Waiting for CSC agent output/)).toBeTruthy();
  });

  it("renders text stream items", async () => {
    mockItems.push({
      task_id: "task-1",
      issue_id: "issue-1",
      workspace_id: "ws-1",
      seq: 1,
      type: "text",
      content: "hello world",
      ts: 1,
    });
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("hello world")).toBeTruthy();
    });
  });

  it("ignores stream items for other issues", () => {
    mockItems.push({
      task_id: "task-1",
      issue_id: "issue-2",
      workspace_id: "ws-1",
      seq: 1,
      type: "text",
      content: "wrong issue",
      ts: 1,
    });
    renderPanel("issue-1");

    expect(screen.queryByText("wrong issue")).toBeNull();
    expect(screen.getByText(/Waiting for CSC agent output/)).toBeTruthy();
  });

  it("renders tool_use and tool_result items", async () => {
    mockItems.push({
      task_id: "task-1",
      issue_id: "issue-1",
      seq: 1,
      type: "tool_use",
      tool: "read_file",
      input: { path: "README.md" },
      ts: 1,
    });
    mockItems.push({
      task_id: "task-1",
      issue_id: "issue-1",
      seq: 2,
      type: "tool_result",
      tool: "read_file",
      output: "# Hello",
      ts: 2,
    });
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText(/Tool: read_file/)).toBeTruthy();
      expect(screen.getByText(/Result: read_file/)).toBeTruthy();
      expect(screen.getByText(/# Hello/)).toBeTruthy();
    });
  });
});
