// @vitest-environment jsdom

// Regression test against the REAL i18n stack (no useT mock). The mocked-t
// tests in run-diagnostics-page.test.tsx cannot catch selector patterns that
// crash the i18next v26 selector proxy — this one renders through the real
// I18nProvider so a "Cannot read properties of undefined (reading 'length')"
// regression fails here instead of in the browser.

import { screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderWithI18n } from "../../test/i18n";
import { WorkflowRunDiagnosticsPage } from "./run-diagnostics-page";

const mocks = vi.hoisted(() => ({
  data: null as unknown,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey: unknown[] }) => {
    if (opts.queryKey?.[0] === "runtimes") return { data: [], isLoading: false };
    return { data: mocks.data, isLoading: false };
  },
}));

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@multica/core/platform", () => ({
  isEmbeddedInCostrict: () => false,
  postCostrictNavigateToSession: vi.fn(),
}));

vi.mock("@multica/core/workflows/queries", () => ({
  workflowRunCanvasSummaryOptions: () => ({ queryKey: ["canvas-summary"] }),
}));

vi.mock("@multica/core/runtimes/queries", () => ({
  runtimeListOptions: (wsId: string) => ({ queryKey: ["runtimes", wsId, "list"] }),
}));

vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({
    workflowRunDetail: (workflowId: string, runId: string) => `/ws/workflows/${workflowId}/runs/${runId}`,
    runtimeDetail: (id: string) => `/ws/runtimes/${id}`,
  }),
}));

vi.mock("../../navigation", () => ({
  useNavigation: () => ({ push: vi.fn() }),
}));

function dataWithFailedNode(hint: string) {
  return {
    run: {
      id: "run-1",
      workflow_id: "wf-1",
      workflow_title: "Release workflow",
      status: "failed",
    },
    node_runs: [{ id: "nr-1", node_title: "Design", status: "failed" }],
    node_runtime_summaries: [
      {
        workflow_node_id: "node-1",
        node_run_id: "nr-1",
        display_status: "blocked",
        active_actor_type: "agent",
        active_actor_id: null,
        duration_seconds: null,
        session_id: null,
        runtime_id: null,
        device_id: null,
        has_error: true,
        error_message: "Max turns reached",
        split_progress: null,
        diagnostics: { lifecycle_stage: "terminal", current_task: null, hint },
      },
    ],
  };
}

describe("WorkflowRunDiagnosticsPage with real i18n", () => {
  beforeEach(() => {
    mocks.data = null;
  });

  it("translates a known failure hint without crashing", () => {
    mocks.data = dataWithFailedNode("hint.failure.timeout");
    renderWithI18n(<WorkflowRunDiagnosticsPage workflowId="wf-1" runId="run-1" />);
    expect(screen.getByText("Task timed out")).toBeInTheDocument();
  });

  it("translates a stage hint without crashing", () => {
    mocks.data = dataWithFailedNode("hint.stage.terminal");
    renderWithI18n(<WorkflowRunDiagnosticsPage workflowId="wf-1" runId="run-1" />);
    expect(screen.getByText("This node has finished")).toBeInTheDocument();
  });

  it("falls back to the raw suffix for an unknown reason code", () => {
    mocks.data = dataWithFailedNode("hint.failure.brand_new_reason");
    renderWithI18n(<WorkflowRunDiagnosticsPage workflowId="wf-1" runId="run-1" />);
    expect(screen.getByText("brand_new_reason")).toBeInTheDocument();
  });

  it("translates the retry hint", () => {
    mocks.data = dataWithFailedNode("hint.running_retry");
    renderWithI18n(<WorkflowRunDiagnosticsPage workflowId="wf-1" runId="run-1" />);
    expect(screen.getByText("Previous attempt failed; retrying")).toBeInTheDocument();
  });

  it("interpolates attempt counts", () => {
    const data = dataWithFailedNode("hint.failure.timeout");
    (data.node_runtime_summaries[0]!.diagnostics as { current_task: unknown }).current_task = {
      task_id: "task-1",
      status: "failed",
      phase: "worker",
      attempt: 2,
      max_attempts: 3,
      dispatched_at: null,
      started_at: null,
      completed_at: null,
      failure_reason: "timeout",
      error: "Max turns reached",
    };
    mocks.data = data;
    renderWithI18n(<WorkflowRunDiagnosticsPage workflowId="wf-1" runId="run-1" />);
    expect(screen.getByText("Attempt 2/3")).toBeInTheDocument();
  });
});
