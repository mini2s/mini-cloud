// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SplitTask } from "@multica/core/types";
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
  suggested_assignee_type: "member",
  suggested_assignee_id: "3b91177b-06bc-43ba-ab51-1e34b2a3131a",
  depends_on: [],
  sort_order: 0,
  status: "draft",
  issue_id: null,
  run_id: null,
  created_at: "",
  updated_at: "",
};

describe("SplitDraftLedger", () => {
  it("keeps long assignee ids from consuming the draft title column", () => {
    render(<SplitDraftLedger tasks={[baseTask]} />);

    const meta = screen.getByTestId("split-draft-meta-task-1");
    const assignee = screen.getByText("member:3b91177b-06bc-43ba-ab51-1e34b2a3131a");

    expect(screen.getByTestId("split-draft-row-task-1")).toBeInTheDocument();
    expect(meta).toHaveClass("grid", "min-w-0", "gap-2");
    expect(assignee).toHaveClass("max-w-[12rem]", "truncate");
  });
});
