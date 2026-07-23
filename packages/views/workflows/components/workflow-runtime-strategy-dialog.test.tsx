// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@multica/core/i18n/react";
import { WorkflowRuntimeStrategyDialog } from "./workflow-runtime-strategy-dialog";
import enWorkflows from "../../locales/en/workflows.json";

describe("WorkflowRuntimeStrategyDialog", () => {
  it("starts a direct run with the workflow default policy", () => {
    const onConfirm = vi.fn();

    render(
      <I18nProvider locale="en" resources={{ en: { workflows: enWorkflows } }}>
        <WorkflowRuntimeStrategyDialog
          mode="run"
          workflowTitle="Release"
          initialValue={{ policy: "issue_creator_first", runtimeId: null }}
          runtimes={[]}
          loading={false}
          directRun
          onConfirm={onConfirm}
          onClose={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByText(/direct test run has no issue creator/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    expect(onConfirm).toHaveBeenCalledWith({
      policy: "issue_creator_first",
      runtimeId: null,
    });
  });

  it("requires a runtime for specified-runtime-first", () => {
    render(
      <I18nProvider locale="en" resources={{ en: { workflows: enWorkflows } }}>
        <WorkflowRuntimeStrategyDialog
          mode="default"
          workflowTitle="Release"
          initialValue={{ policy: "specified_runtime_first", runtimeId: null }}
          runtimes={[]}
          loading={false}
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("No runtime is available in this workspace.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save default" })).toBeDisabled();
  });
});
