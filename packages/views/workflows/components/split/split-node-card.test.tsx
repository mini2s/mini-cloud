// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SplitNodeCard } from "./split-node-card";
import type { SplitConfig } from "@multica/core/types";

vi.mock("@multica/views/i18n", () => ({
  useT: () => ({
    t: (
      selector: (resources: {
        detail_panel: Record<string, string>;
      }) => string,
      values?: Record<string, string | number>,
    ) => {
      const resources = {
        detail_panel: {
          split_node_generating_draft_tasks: "Generating draft tasks",
          split_node_review_tasks: "Review {{count}} tasks",
          split_node_mode_concurrency: "{{mode}} · concurrency {{concurrency}}",
          split_node_mode_label: "{{mode}}",
          split_node_concurrency_label: "Concurrency {{concurrency}}",
          split_node_failure_label: "Max failures {{max}}",
          split_node_child_workflow_missing: "No child workflow",
        },
      };
      return selector(resources).replace(/\{\{(\w+)\}\}/g, (_match, key) => String(values?.[key] ?? ""));
    },
  }),
}));

const config: SplitConfig = {
  mode: "barrier",
  max_concurrency: 5,
  max_failures: 1,
};

describe("SplitNodeCard", () => {
  it("shows split mode, concurrency, failure tolerance, and child workflow context", () => {
    render(
      <SplitNodeCard
        title="Task split"
        config={config}
        childWorkflowName="Implementation workflow"
      />,
    );

    expect(screen.getByText("Task split")).toBeInTheDocument();
    expect(screen.getByText("barrier")).toBeInTheDocument();
    expect(screen.getByText("Concurrency 5")).toBeInTheDocument();
    expect(screen.getByText("Max failures 1")).toBeInTheDocument();
    expect(screen.getByText("Implementation workflow")).toBeInTheDocument();
    expect(screen.queryByText(/After child issues/)).not.toBeInTheDocument();
  });

  it("uses pipeline as the card mode label without explanatory panel copy", () => {
    render(
      <SplitNodeCard
        title="Task split"
        config={{ ...config, mode: "pipeline", max_failures: 0 }}
      />,
    );

    expect(screen.getByText("pipeline")).toBeInTheDocument();
    expect(screen.getByText("No child workflow")).toBeInTheDocument();
    expect(screen.queryByText(/Max failures/)).not.toBeInTheDocument();
  });
});
