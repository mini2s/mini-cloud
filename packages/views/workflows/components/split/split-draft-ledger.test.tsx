// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SplitTask, Workflow } from "@multica/core/types";
import { SplitDraftLedger } from "./split-draft-ledger";

vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({
    issueDetail: (id: string) => `/test/issues/${id}`,
  }),
}));

vi.mock("../../../navigation", () => ({
  AppLink: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const baseTask: SplitTask = {
  id: "task-1",
  node_run_id: "node-run-1",
  title: "A very long child issue title that must stay readable in the review panel",
  description: "A detailed description that should keep the title column usable.",
  workflow_id: "workflow-1",
  depends_on: [],
  sort_order: 0,
  status: "draft",
  issue_id: null,
  run_id: null,
  version: 1,
  last_error: null,
  created_at: "",
  updated_at: "",
};

const workflows: Workflow[] = [{
  id: "workflow-1",
  workspace_id: "ws-1",
  title: "Implementation workflow",
  description: "",
  status: "active",
  max_retries: 3,
  created_by_type: "member",
  created_by_id: "user-1",
  node_count: 1,
  is_template: false,
  source_template_id: null,
  created_at: "",
  updated_at: "",
}];

describe("SplitDraftLedger", () => {
  it("keeps workflow controls from consuming the draft title column", () => {
    render(<SplitDraftLedger tasks={[baseTask]} workflows={workflows} />);

    const meta = screen.getByTestId("split-draft-meta-task-1");
    const workflow = screen.getByLabelText("Execution workflow for A very long child issue title that must stay readable in the review panel");

    expect(screen.getByTestId("split-draft-row-task-1")).toBeInTheDocument();
    expect(meta).toHaveClass("grid", "min-w-0", "gap-2");
    expect(workflow).toHaveClass("min-w-[12rem]");
  });

  it("marks task-level workflow blockers inside the affected draft row", () => {
    render(<SplitDraftLedger tasks={[{ ...baseTask, workflow_id: null }]} workflows={workflows} />);

    const row = screen.getByTestId("split-draft-row-task-1");

    expect(screen.getByTestId("split-draft-risk-task-1")).toHaveTextContent("Missing execution workflow");
    expect(row).toHaveClass("border-destructive/30");
  });
});
