// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@multica/core/i18n/react";
import type { AgentRuntime } from "@multica/core/types";
import { WorkflowRuntimeStrategyDialog } from "./workflow-runtime-strategy-dialog";
import enWorkflows from "../../locales/en/workflows.json";

function runtime(
  id: string,
  name: string,
  status: "online" | "offline",
  ownerId: string | null = null,
): AgentRuntime {
  return {
    id,
    workspace_id: "ws-1",
    daemon_id: id,
    name,
    runtime_mode: "local",
    provider: "csc",
    launch_header: "",
    status,
    device_info: "",
    metadata: {},
    owner_id: ownerId,
    visibility: "public",
    last_seen_at: "",
    created_at: "",
    updated_at: "",
  };
}

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

  it("treats a saved offline runtime as unavailable", () => {
    render(
      <I18nProvider locale="en" resources={{ en: { workflows: enWorkflows } }}>
        <WorkflowRuntimeStrategyDialog
          mode="default"
          workflowTitle="Release"
          initialValue={{ policy: "specified_runtime_first", runtimeId: "r1" }}
          runtimes={[runtime("r1", "Offline Runtime", "offline")]}
          loading={false}
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("No runtime is available in this workspace.")).toBeInTheDocument();
    expect(
      screen.getByText(/saved runtime is offline, no longer available/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save default" })).toBeDisabled();
  });

  it("shows only online runtimes and preserves their owner names", () => {
    render(
      <I18nProvider locale="en" resources={{ en: { workflows: enWorkflows } }}>
        <WorkflowRuntimeStrategyDialog
          mode="default"
          workflowTitle="Release"
          initialValue={{ policy: "specified_runtime_first", runtimeId: null }}
          runtimes={[
            runtime("r1", "Online Runtime", "online", "user-1"),
            runtime("r2", "Offline Runtime", "offline", "user-2"),
          ]}
          loading={false}
          getMemberName={(userId) =>
            userId === "user-1" ? "Alice" : "Bob"
          }
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("combobox"));

    expect(
      document.querySelector("[data-slot='select-content']"),
    ).toHaveAttribute("data-align-trigger", "false");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option")).toHaveTextContent("Online Runtime");
    expect(screen.getByRole("option")).toHaveTextContent("Alice");
    expect(screen.queryByText("Offline Runtime")).not.toBeInTheDocument();
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
  });
});
