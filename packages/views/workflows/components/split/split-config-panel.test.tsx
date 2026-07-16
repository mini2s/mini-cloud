// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SplitConfigPanel } from "./split-config-panel";
import type { SplitConfig, Workflow } from "@multica/core/types";

vi.mock("../../../i18n", () => {
  const translations = {
    detail_panel: {
      split_title: "Split settings",
      split_subtitle: "Configure child issue release behavior.",
      split_review_required_title: "Human review is required",
      split_review_required_hint: "Generated split tasks always stop for human review before child issues are created.",
      split_default_issue_workflow_label: "Default issue workflow",
      split_default_issue_workflow_placeholder: "Select default issue workflow...",
      split_release_mode_label: "Release downstream work",
      split_release_after_finish: "After child issues finish",
      split_release_after_created: "After child issues are created",
      split_mode_hint: "Barrier waits for child tasks; Pipeline releases downstream after issue creation.",
      split_concurrency_question: "How many child issues can run at once?",
      split_concurrency_hint: "Run at most this many child issues at once.",
      split_failure_tolerance_label: "Failure tolerance",
      split_max_failures_hint: "Barrier mode fails the parent split when child failures exceed this number.",
    },
  };
  return {
    useT: () => ({
      t: (selector: (value: typeof translations) => string) => selector(translations),
    }),
  };
});

const config: SplitConfig = {
  default_issue_workflow_id: "child-wf-1",
  mode: "barrier",
  max_concurrency: 3,
  max_failures: 1,
};

const childWorkflows = [
  { id: "child-wf-1", title: "Implementation workflow", status: "active" },
  { id: "draft-wf", title: "Draft workflow", status: "draft" },
] as Workflow[];

describe("SplitConfigPanel", () => {
  it("renders user-facing split behavior copy and sends changes", () => {
    const onChange = vi.fn();

    render(
      <SplitConfigPanel
        config={config}
        childWorkflows={childWorkflows}
        currentWorkflowId="wf-1"
        onChange={onChange}
      />,
    );

    expect(screen.getByText("Release downstream work")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "After child issues finish" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "After child issues are created" })).toBeInTheDocument();
    expect(screen.getByLabelText("How many child issues can run at once?")).toHaveValue(3);
    expect(screen.getByLabelText("Failure tolerance")).toHaveValue(1);
    expect(screen.queryByText("Draft workflow")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "After child issues are created" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...config, mode: "pipeline" });

    fireEvent.change(screen.getByLabelText("How many child issues can run at once?"), {
      target: { value: "9" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ ...config, max_concurrency: 9 });
  });

  it("disables controls without calling onChange", () => {
    const onChange = vi.fn();

    render(
      <SplitConfigPanel
        config={config}
        childWorkflows={childWorkflows}
        disabled
        onChange={onChange}
      />,
    );

    expect(screen.getByLabelText("Default issue workflow")).toBeDisabled();
    expect(screen.getByRole("button", { name: "After child issues are created" })).toBeDisabled();
    expect(screen.getByLabelText("How many child issues can run at once?")).toBeDisabled();
    expect(screen.getByLabelText("Failure tolerance")).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });
});
