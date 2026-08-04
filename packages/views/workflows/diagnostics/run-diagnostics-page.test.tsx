// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { WorkflowRunDiagnosticsPage, nodeStepStates, sessionLogPath } from "./run-diagnostics-page";

const mocks = vi.hoisted(() => ({
  data: null as unknown,
  runtimes: [] as unknown[],
  embedded: false,
  sessionPosts: [] as Array<{ sessionId: string; newTab: boolean }>,
  pushed: [] as string[],
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey: unknown[] }) => {
    if (opts.queryKey?.[0] === "runtimes") return { data: mocks.runtimes, isLoading: false };
    return { data: mocks.data, isLoading: false };
  },
}));

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@multica/core/platform", () => ({
  isEmbeddedInCostrict: () => mocks.embedded,
  postCostrictNavigateToSession: (args: { sessionId: string; newTab: boolean }) => {
    mocks.sessionPosts.push(args);
    return true;
  },
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
  useNavigation: () => ({
    push: (path: string) => {
      mocks.pushed.push(path);
    },
  }),
}));

vi.mock("../../layout/page-header", () => ({
  PageHeader: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

const translations = {
  detail: { not_found: "Not found" },
  run: {
    status: { running: "Running", completed: "Completed", failed: "Failed", cancelled: "Cancelled" },
    diagnostics: {
      title: "Run diagnostics",
      stage: {
        pending: "Pending dispatch",
        dispatching: "Dispatching",
        dispatched: "Dispatched",
        running: "Running",
        awaiting_review: "Awaiting review",
        terminal: "Finished",
      },
      step_dispatch: "Dispatch",
      step_claim: "Claim",
      step_execute: "Execute",
      attempt: "Attempt {{current}}/{{max}}",
      dispatched_at: "Dispatched {{time}}",
      started_at: "Started {{time}}",
      no_task: "No task dispatched yet",
      error: "Error",
      summary_nodes: "{{completed}}/{{total}} nodes completed",
      runtime: "Runtime",
      runtime_offline: "offline",
      view_session: "View session",
      duration: "Duration {{value}}",
      node_started_at: "Node started {{time}}",
      node_completed_at: "Node finished {{time}}",
      deliverables: "Deliverables: {{submitted}}/{{total}} submitted, {{approved}} approved",
      worker_output: "Worker output",
      critic_output: "Critic output",
      work_dir: "Working directory",
      session_log: "Conversation log",
      copy_path: "Copy path",
      copied: "Copied",
      hint: {
        stage: {
          pending: "Waiting for upstream nodes to complete",
          dispatching: "Task queued, waiting for a runtime to claim it",
          dispatched: "Runtime claimed the task, execution is starting",
          running: "Task is executing",
          awaiting_review: "Waiting for review or input",
          terminal: "This node has finished",
        },
        running_retry: "Previous attempt failed; retrying",
        failure: {
          timeout: "Task timed out",
          agent_empty_output: "Agent produced no output",
        },
      },
    },
  },
};

vi.mock("../../i18n", () => ({
  useT: () => ({
    t: (selector: (value: typeof translations) => string) => selector(translations),
  }),
}));

function summary(overrides: Record<string, unknown>) {
  return {
    workflow_node_id: "node-1",
    node_run_id: "nr-1",
    display_status: "in_progress",
    active_actor_type: "agent",
    active_actor_id: null,
    duration_seconds: null,
    session_id: null,
    runtime_id: null,
    device_id: null,
    has_error: false,
    error_message: "",
    split_progress: null,
    diagnostics: null,
    ...overrides,
  };
}

function baseData(nodeRuns: unknown[], summaries: unknown[]) {
  return {
    run: {
      id: "run-1",
      workflow_id: "wf-1",
      workflow_title: "Release workflow",
      status: "running",
    },
    node_runs: nodeRuns,
    node_runtime_summaries: summaries,
  };
}

describe("WorkflowRunDiagnosticsPage", () => {
  beforeEach(() => {
    mocks.data = null;
    mocks.runtimes = [];
    mocks.embedded = false;
    mocks.sessionPosts = [];
    mocks.pushed = [];
  });

  it("shows not-found when the run is missing", () => {
    mocks.data = { run: null, node_runs: [], node_runtime_summaries: [] };
    render(<WorkflowRunDiagnosticsPage workflowId="wf-1" runId="run-1" />);
    expect(screen.getByText("Not found")).toBeInTheDocument();
  });

  it("renders each node with its lifecycle stage", () => {
    mocks.data = baseData(
      [
        { id: "nr-1", node_title: "Design", status: "working" },
        { id: "nr-2", node_title: "Implement", status: "pending" },
      ],
      [
        summary({
          node_run_id: "nr-1",
          diagnostics: { lifecycle_stage: "running", current_task: null, hint: "hint.stage.running" },
        }),
        summary({
          workflow_node_id: "node-2",
          node_run_id: "nr-2",
          display_status: "pending",
          diagnostics: { lifecycle_stage: "pending", current_task: null, hint: "hint.stage.pending" },
        }),
      ],
    );
    render(<WorkflowRunDiagnosticsPage workflowId="wf-1" runId="run-1" />);
    expect(screen.getByText("Design")).toBeInTheDocument();
    expect(screen.getByText("Implement")).toBeInTheDocument();
    // "Running" appears both in the run-status badge and the node stage badge.
    expect(screen.getAllByText("Running").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Pending dispatch")).toBeInTheDocument();
  });

  it("expands failed nodes by default and shows the error", () => {
    mocks.data = baseData(
      [{ id: "nr-1", node_title: "Design", status: "failed" }],
      [
        summary({
          display_status: "blocked",
          has_error: true,
          error_message: "Max turns reached",
          diagnostics: {
            lifecycle_stage: "terminal",
            hint: "hint.failure.timeout",
            current_task: {
              task_id: "task-1",
              status: "failed",
              phase: "worker",
              attempt: 2,
              max_attempts: 3,
              dispatched_at: "2026-08-04T09:00:00Z",
              started_at: null,
              completed_at: null,
              failure_reason: "timeout",
              error: "Max turns reached",
            },
          },
        }),
      ],
    );
    render(<WorkflowRunDiagnosticsPage workflowId="wf-1" runId="run-1" />);
    // Failed rows start expanded — error text visible without clicking.
    expect(screen.getAllByText("Max turns reached").length).toBeGreaterThan(0);
    expect(screen.getByText("Task timed out")).toBeInTheDocument();
    expect(screen.getByText("Attempt {{current}}/{{max}}")).toBeInTheDocument();
  });

  it("keeps healthy nodes collapsed until clicked", () => {
    mocks.data = baseData(
      [{ id: "nr-1", node_title: "Design", status: "working" }],
      [
        summary({
          diagnostics: {
            lifecycle_stage: "running",
            hint: "hint.stage.running",
            current_task: {
              task_id: "task-1",
              status: "running",
              phase: "worker",
              attempt: 1,
              max_attempts: 3,
              dispatched_at: null,
              started_at: null,
              completed_at: null,
              failure_reason: "",
              error: "",
            },
          },
        }),
      ],
    );
    render(<WorkflowRunDiagnosticsPage workflowId="wf-1" runId="run-1" />);
    expect(screen.queryByText("Task is executing")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Design"));
    expect(screen.getByText("Task is executing")).toBeInTheDocument();
  });

  it("falls back to the raw status when diagnostics is null (older server)", () => {
    mocks.data = baseData(
      [{ id: "nr-1", node_title: "Design", status: "working" }],
      [summary({ diagnostics: null })],
    );
    render(<WorkflowRunDiagnosticsPage workflowId="wf-1" runId="run-1" />);
    expect(screen.getByText("working")).toBeInTheDocument();
  });

  it("shows the raw reason suffix for unknown failure hint keys (enum drift)", () => {
    mocks.data = baseData(
      [{ id: "nr-1", node_title: "Design", status: "failed" }],
      [
        summary({
          display_status: "blocked",
          has_error: true,
          error_message: "boom",
          diagnostics: {
            lifecycle_stage: "terminal",
            hint: "hint.failure.some_new_reason",
            current_task: null,
          },
        }),
      ],
    );
    render(<WorkflowRunDiagnosticsPage workflowId="wf-1" runId="run-1" />);
    expect(screen.getByText("some_new_reason")).toBeInTheDocument();
  });

  it("navigates back to the run page from the header", () => {
    mocks.data = baseData([], []);
    render(<WorkflowRunDiagnosticsPage workflowId="wf-1" runId="run-1" />);
    fireEvent.click(screen.getByText("Release workflow"));
    expect(mocks.pushed).toEqual(["/ws/workflows/wf-1/runs/run-1"]);
  });

  it("shows the runtime name with an offline marker and links to the runtime detail", () => {
    mocks.runtimes = [{ id: "rt-1", name: "gpu-runner", status: "offline" }];
    mocks.data = baseData(
      [{ id: "nr-1", node_title: "Design", status: "failed" }],
      [
        summary({
          display_status: "blocked",
          has_error: true,
          runtime_id: "rt-1",
          diagnostics: { lifecycle_stage: "terminal", current_task: null, hint: "hint.stage.terminal" },
        }),
      ],
    );
    render(<WorkflowRunDiagnosticsPage workflowId="wf-1" runId="run-1" />);
    const runtimeButton = screen.getByRole("button", { name: /gpu-runner/ });
    expect(runtimeButton).toHaveTextContent("(offline)");
    fireEvent.click(runtimeButton);
    expect(mocks.pushed).toEqual(["/ws/runtimes/rt-1"]);
  });

  it("offers a session link only when embedded in CoStrict", () => {
    mocks.data = baseData(
      [{ id: "nr-1", node_title: "Design", status: "failed" }],
      [
        summary({
          display_status: "blocked",
          has_error: true,
          session_id: "sess-1",
          diagnostics: { lifecycle_stage: "terminal", current_task: null, hint: "hint.stage.terminal" },
        }),
      ],
    );
    const { unmount } = render(<WorkflowRunDiagnosticsPage workflowId="wf-1" runId="run-1" />);
    expect(screen.queryByRole("button", { name: "View session" })).not.toBeInTheDocument();
    unmount();

    mocks.embedded = true;
    render(<WorkflowRunDiagnosticsPage workflowId="wf-1" runId="run-1" />);
    fireEvent.click(screen.getByRole("button", { name: "View session" }));
    expect(mocks.sessionPosts).toEqual([{ sessionId: "sess-1", newTab: true }]);
  });

  it("shows duration, node timeline and deliverable progress", () => {
    mocks.data = baseData(
      [{ id: "nr-1", node_title: "Design", status: "completed", started_at: "2026-08-04T09:00:00Z", completed_at: "2026-08-04T09:05:00Z" }],
      [
        summary({
          display_status: "completed",
          duration_seconds: 300,
          required_deliverables_total: 2,
          required_deliverables_submitted: 2,
          required_deliverables_approved: 1,
          diagnostics: { lifecycle_stage: "terminal", current_task: null, hint: "hint.stage.terminal" },
        }),
      ],
    );
    render(<WorkflowRunDiagnosticsPage workflowId="wf-1" runId="run-1" />);
    fireEvent.click(screen.getByText("Design"));
    expect(screen.getByText("Duration {{value}}")).toBeInTheDocument();
    expect(screen.getByText("Node started {{time}}")).toBeInTheDocument();
    expect(screen.getByText("Node finished {{time}}")).toBeInTheDocument();
    expect(
      screen.getByText("Deliverables: {{submitted}}/{{total}} submitted, {{approved}} approved"),
    ).toBeInTheDocument();
  });

  it("renders worker and critic outputs as collapsible blocks", () => {
    mocks.data = baseData(
      [{
        id: "nr-1",
        node_title: "Design",
        status: "completed",
        worker_output: "Here is the design doc",
        critic_output: { verdict: "approved" },
      }],
      [
        summary({
          display_status: "completed",
          diagnostics: { lifecycle_stage: "terminal", current_task: null, hint: "hint.stage.terminal" },
        }),
      ],
    );
    render(<WorkflowRunDiagnosticsPage workflowId="wf-1" runId="run-1" />);
    fireEvent.click(screen.getByText("Design"));
    expect(screen.getByText("Worker output")).toBeInTheDocument();
    expect(screen.getByText("Here is the design doc")).toBeInTheDocument();
    expect(screen.getByText("Critic output")).toBeInTheDocument();
    expect(screen.getByText(/"verdict": "approved"/)).toBeInTheDocument();
  });

  it("shows the work dir and derived session log path, each with a copy button", () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mocks.data = baseData(
      [{ id: "nr-1", node_title: "Design", status: "completed" }],
      [
        summary({
          display_status: "completed",
          diagnostics: {
            lifecycle_stage: "terminal",
            hint: "hint.stage.terminal",
            current_task: {
              task_id: "task-1",
              status: "completed",
              phase: "worker",
              attempt: 1,
              max_attempts: 3,
              dispatched_at: null,
              started_at: null,
              completed_at: null,
              failure_reason: "",
              error: "",
              session_id: "sess-abc",
              work_dir: "/home/dev/work space",
            },
          },
        }),
      ],
    );
    render(<WorkflowRunDiagnosticsPage workflowId="wf-1" runId="run-1" />);
    fireEvent.click(screen.getByText("Design"));
    expect(screen.getByText("/home/dev/work space")).toBeInTheDocument();
    expect(
      screen.getByText("~/.costrict/projects/-home-dev-work-space/sess-abc.jsonl"),
    ).toBeInTheDocument();

    const copyButtons = screen.getAllByTitle("Copy path");
    expect(copyButtons).toHaveLength(2);
    fireEvent.click(copyButtons[0]!);
    expect(writeText).toHaveBeenCalledWith("/home/dev/work space");
    fireEvent.click(copyButtons[1]!);
    expect(writeText).toHaveBeenCalledWith("~/.costrict/projects/-home-dev-work-space/sess-abc.jsonl");
  });

  it("omits the session log row when the task has no session id", () => {
    mocks.data = baseData(
      [{ id: "nr-1", node_title: "Design", status: "completed" }],
      [
        summary({
          display_status: "completed",
          diagnostics: {
            lifecycle_stage: "terminal",
            hint: "hint.stage.terminal",
            current_task: {
              task_id: "task-1",
              status: "completed",
              phase: "worker",
              attempt: 1,
              max_attempts: 3,
              dispatched_at: null,
              started_at: null,
              completed_at: null,
              failure_reason: "",
              error: "",
              session_id: "",
              work_dir: "/home/dev/work",
            },
          },
        }),
      ],
    );
    render(<WorkflowRunDiagnosticsPage workflowId="wf-1" runId="run-1" />);
    fireEvent.click(screen.getByText("Design"));
    expect(screen.getByText("/home/dev/work")).toBeInTheDocument();
    expect(screen.queryByText(/\.jsonl/)).not.toBeInTheDocument();
  });
});

describe("sessionLogPath", () => {
  it("derives the Claude Code projects path from work dir and session id", () => {
    expect(sessionLogPath("/Users/dev/repo", "abc-123")).toBe(
      "~/.costrict/projects/-Users-dev-repo/abc-123.jsonl",
    );
  });

  it("sanitizes every non-alphanumeric character", () => {
    expect(sessionLogPath("/tmp/a b/c_d.e", "s")).toBe("~/.costrict/projects/-tmp-a-b-c-d-e/s.jsonl");
  });
});

describe("nodeStepStates", () => {
  const task = (overrides: Record<string, unknown>) => ({
    task_id: "task-1",
    status: "running",
    phase: "worker",
    attempt: 1,
    max_attempts: 3,
    dispatched_at: null,
    started_at: null,
    completed_at: null,
    failure_reason: "",
    error: "",
    session_id: "",
    work_dir: "",
    ...overrides,
  });

  it("marks every step untouched for a terminal node cancelled before dispatch", () => {
    // Fail-fast sibling: node was cancelled without ever receiving a task.
    // Showing dispatch/claim/execute as done would contradict "no task yet".
    expect(
      nodeStepStates({ lifecycle_stage: "terminal", current_task: null, hint: "hint.stage.terminal" }),
    ).toEqual(["todo", "todo", "todo"]);
  });

  it("marks all steps done for a completed task", () => {
    expect(
      nodeStepStates({
        lifecycle_stage: "terminal",
        current_task: task({ status: "completed" }),
        hint: "hint.stage.terminal",
      }),
    ).toEqual(["done", "done", "done"]);
  });

  it("marks execute failed for a failed task that was claimed", () => {
    expect(
      nodeStepStates({
        lifecycle_stage: "terminal",
        current_task: task({ status: "failed", started_at: "2026-08-04T09:00:00Z" }),
        hint: "hint.failure.agent_error",
      }),
    ).toEqual(["done", "done", "failed"]);
  });

  it("marks only dispatch done for a task cancelled while dispatched", () => {
    expect(
      nodeStepStates({
        lifecycle_stage: "terminal",
        current_task: task({ status: "cancelled", dispatched_at: "2026-08-04T09:00:00Z" }),
        hint: "hint.stage.terminal",
      }),
    ).toEqual(["done", "todo", "todo"]);
  });

  it("marks every step untouched for a task cancelled while still queued", () => {
    expect(
      nodeStepStates({
        lifecycle_stage: "terminal",
        current_task: task({ status: "cancelled" }),
        hint: "hint.stage.terminal",
      }),
    ).toEqual(["todo", "todo", "todo"]);
  });

  it("keeps in-flight stages unchanged", () => {
    expect(nodeStepStates({ lifecycle_stage: "dispatching", current_task: null, hint: "" }))
      .toEqual(["active", "todo", "todo"]);
    expect(nodeStepStates({ lifecycle_stage: "dispatched", current_task: null, hint: "" }))
      .toEqual(["done", "active", "todo"]);
    expect(nodeStepStates({ lifecycle_stage: "running", current_task: null, hint: "" }))
      .toEqual(["done", "done", "active"]);
    expect(nodeStepStates({ lifecycle_stage: "pending", current_task: null, hint: "" }))
      .toEqual(["todo", "todo", "todo"]);
    expect(nodeStepStates(null)).toEqual(["todo", "todo", "todo"]);
  });
});
