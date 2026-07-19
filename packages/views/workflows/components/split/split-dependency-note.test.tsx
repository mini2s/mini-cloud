// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SplitTask } from "@multica/core/types";
import { SplitDependencyNote } from "./split-dependency-note";

vi.mock("../../../i18n", () => ({
  useT: () => ({
    t: (selector: (value: { detail_panel: Record<string, string> }) => string) =>
      selector({
        detail_panel: {
          split_dep_will_appear_after_draft: "Dependencies will appear here after a draft is generated.",
          split_dep_can_start_in_parallel: "These child issues can start in parallel.",
        },
      }),
  }),
}));

function splitTask(id: string, dependsOn: string[] = []): SplitTask {
  return {
    id,
    node_run_id: "node-run-1",
    title: id,
    description: "",
    workflow_id: "workflow-1",
    depends_on: dependsOn,
    sort_order: 0,
    status: "draft",
    issue_id: null,
    run_id: null,
    version: 1,
    last_error: null,
    created_at: "",
    updated_at: "",
  };
}

describe("SplitDependencyNote", () => {
  it("renders each dependency relationship once", () => {
    render(<SplitDependencyNote tasks={[splitTask("task-1"), splitTask("task-2", ["task-1"])]} />);

    expect(screen.getAllByText("01 -> 02")).toHaveLength(1);
    expect(screen.getByTestId("split-dependency-summary")).toBeInTheDocument();
    expect(screen.queryByRole("code")).not.toBeInTheDocument();
  });
});
