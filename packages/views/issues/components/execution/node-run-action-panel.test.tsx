import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WorkflowNodeRun } from "@multica/core/types";
import type { HumanNodeRunActionAccess } from "./node-run-action-access";
import { NodeRunActionPanel } from "./node-run-action-panel";

const mocks = vi.hoisted(() => ({
  submit: {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null as Error | null,
  },
  skip: {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null as Error | null,
  },
}));

vi.mock("@multica/core/workflows/queries", () => ({
  useSubmitNodeRun: () => mocks.submit,
  useSkipNodeRun: () => mocks.skip,
}));

vi.mock("../../../workflows/components/node-run-control-actions", () => ({
  NodeRunControlActions: () => null,
}));

vi.mock("../../../i18n", () => {
  const translations = {
    execution: {
      detail_panel: {
        execution_summary: "Execution summary",
        execution_summary_placeholder: "Optional: briefly describe the completed work",
        submit_result: "Submit result",
        submitting_result: "Submitting...",
        skip_node: "Skip node",
        skip_dialog_title: "Skip this node?",
        skip_dialog_description: "This node will be marked as skipped.",
        skip_dialog_cancel: "Cancel",
        skip_dialog_confirm: "Confirm skip",
      },
    },
  };
  return {
    useT: () => ({
      t: (selector: (value: typeof translations) => string) => selector(translations),
    }),
  };
});

const DENY: HumanNodeRunActionAccess = {
  canSubmit: false,
  canReview: false,
  canSkip: false,
  isAdminOverride: false,
};

const nodeRun = {
  id: "nr-1",
  status: "worker_assigned",
  worker_type: "human",
  worker_id: "user-1",
  critic_type: "human",
  critic_id: "user-2",
  runtime_id: null,
} as WorkflowNodeRun;

function renderPanel({
  access = DENY,
  status = "worker_assigned",
}: {
  access?: HumanNodeRunActionAccess;
  status?: WorkflowNodeRun["status"];
} = {}) {
  return render(
    <NodeRunActionPanel
      nodeRun={{ ...nodeRun, status }}
      access={access}
      wsId="ws-1"
      workflowId="wf-1"
      runId="run-1"
    />,
  );
}

describe("NodeRunActionPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.submit.isPending = false;
    mocks.submit.isError = false;
    mocks.submit.error = null;
    mocks.skip.isPending = false;
    mocks.skip.isError = false;
    mocks.skip.error = null;
  });

  it("submits an optional human worker summary", async () => {
    const user = userEvent.setup();
    renderPanel({ access: { ...DENY, canSubmit: true } });

    await user.type(screen.getByLabelText("Execution summary"), "  Implemented the game  ");
    await user.click(screen.getByRole("button", { name: "Submit result" }));

    expect(mocks.submit.mutate).toHaveBeenCalledWith({
      nodeRunId: "nr-1",
      workflowId: "wf-1",
      runId: "run-1",
      output: { summary: "Implemented the game" },
    });
  });

  it("submits an empty object when the summary is blank", async () => {
    renderPanel({ access: { ...DENY, canSubmit: true } });

    await userEvent.click(screen.getByRole("button", { name: "Submit result" }));

    expect(mocks.submit.mutate).toHaveBeenCalledWith(expect.objectContaining({ output: {} }));
  });

  it("requires confirmation before skipping", async () => {
    const user = userEvent.setup();
    renderPanel({ access: { ...DENY, canSkip: true } });

    await user.click(screen.getByRole("button", { name: "Skip node" }));
    expect(mocks.skip.mutate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm skip" }));

    expect(mocks.skip.mutate).toHaveBeenCalledWith({
      nodeRunId: "nr-1",
      workflowId: "wf-1",
      runId: "run-1",
    });
  });

  it("hides human actions when access is denied", () => {
    const { container } = renderPanel();

    expect(screen.queryByRole("button", { name: "Submit result" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip node" })).not.toBeInTheDocument();
    expect(container.firstChild).toBeNull();
  });

  it("disables the corresponding action while a mutation is pending", () => {
    mocks.submit.isPending = true;
    renderPanel({ access: { ...DENY, canSubmit: true } });

    expect(screen.getByRole("button", { name: "Submitting..." })).toBeDisabled();
  });

  it("shows mutation errors next to the actions", () => {
    mocks.submit.isError = true;
    mocks.submit.error = new Error("Submission failed");
    renderPanel({ access: { ...DENY, canSubmit: true } });

    expect(screen.getByRole("alert")).toHaveTextContent("Submission failed");
  });

  it("aligns node actions consistently in the detail section", () => {
    renderPanel({ access: { ...DENY, canSubmit: true, canSkip: true } });

    const toolbar = screen.getByTestId("node-run-action-toolbar");
    expect(toolbar).toHaveClass(
      "grid",
      "grid-cols-[repeat(2,minmax(0,7rem))]",
      "justify-start",
      "gap-3",
    );
    expect(screen.getByRole("button", { name: "Submit result" })).toHaveClass("w-full", "min-w-0");
    expect(screen.getByRole("button", { name: "Skip node" })).toHaveClass("w-full", "min-w-0");
  });
});
