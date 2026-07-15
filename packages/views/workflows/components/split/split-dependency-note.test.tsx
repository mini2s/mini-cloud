// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SplitTask } from "@multica/core/types";
import { SplitDependencyNote } from "./split-dependency-note";

function splitTask(id: string, dependsOn: string[] = []): SplitTask {
  return {
    id,
    node_run_id: "node-run-1",
    title: id,
    description: "",
    suggested_assignee_type: null,
    suggested_assignee_id: null,
    depends_on: dependsOn,
    sort_order: 0,
    status: "draft",
    issue_id: null,
    run_id: null,
    created_at: "",
    updated_at: "",
  };
}

describe("SplitDependencyNote", () => {
  it("renders each dependency relationship once", () => {
    render(<SplitDependencyNote tasks={[splitTask("task-1"), splitTask("task-2", ["task-1"])]} />);

    expect(screen.getAllByText("01 -> 02")).toHaveLength(1);
  });
});
