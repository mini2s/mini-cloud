import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { WorkflowNodeRun } from "@multica/core/types";
import { NodeRunControlActions } from "./node-run-control-actions";

const mocks = vi.hoisted(() => ({
  permissionAllowed: true,
  runtimeCanControl: true,
  sessionCanObserve: true,
  embedded: true,
  takeover: { mutate: vi.fn(), isPending: false },
  handback: { mutate: vi.fn(), isPending: false },
  finalize: { mutate: vi.fn(), isPending: false },
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { can_control: mocks.runtimeCanControl } }),
}));

vi.mock("@multica/core/workflows/queries", () => ({
  useSessionPermission: () => ({
    data: { can_observe: mocks.sessionCanObserve, can_control: false },
  }),
  useTakeoverNodeRun: () => mocks.takeover,
  useHandbackNodeRun: () => mocks.handback,
  useFinalizeNodeRun: () => mocks.finalize,
}));

vi.mock("@multica/core/runtimes/queries", () => ({
  myRuntimePermissionOptions: () => ({ queryKey: ["runtime", "permission"] }),
}));

vi.mock("@multica/core/permissions", () => ({
  useNodeRunControlPermission: () => ({ allowed: mocks.permissionAllowed }),
}));

vi.mock("@multica/core/platform", () => ({
  isEmbeddedInCostrict: () => mocks.embedded,
  postCostrictNavigateToSession: () => true,
}));

vi.mock("../../i18n", () => {
  const translations = {
    node_run: {
      take_over: "Take over",
      taking_over: "Taking over...",
      open_session: "Open session",
      hand_back: "Hand back",
      handing_back: "Handing back...",
      finalize_approve: "Approve",
      finalize_reject: "Reject",
      finalizing: "Finalizing...",
      open_session_missing: "Session unavailable",
      no_control_permission: "No permission",
      take_over_wrong_status: "Wrong status",
      hand_back_wrong_status: "Wrong status",
      finalize_wrong_status: "Wrong status",
      toast_takeover_success: "Taken over",
      toast_takeover_failed: "Takeover failed",
      toast_handback_success: "Handed back",
      toast_handback_failed: "Handback failed",
      toast_finalize_approved: "Approved",
      toast_finalize_rejected: "Rejected",
      toast_finalize_failed: "Finalize failed",
    },
  };
  return {
    useT: () => ({
      t: (selector: (value: typeof translations) => string) => selector(translations),
    }),
  };
});

const baseNodeRun = {
  id: "nr-1",
  status: "working",
  runtime_id: "rt-1",
  session_id: null,
  completed_at: null,
} as WorkflowNodeRun;

function renderControls(
  overrides: Partial<WorkflowNodeRun>,
  options: { alwaysShow?: boolean; showOpenSession?: boolean } = {},
) {
  return render(
    <NodeRunControlActions
      nodeRun={{ ...baseNodeRun, ...overrides }}
      workflowId="wf-1"
      runId="run-1"
      wsId="ws-1"
      alwaysShow={options.alwaysShow}
      showOpenSession={options.showOpenSession}
    />,
  );
}

describe("NodeRunControlActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.permissionAllowed = true;
    mocks.runtimeCanControl = true;
    mocks.sessionCanObserve = true;
    mocks.embedded = true;
  });

  it("shows takeover for a controllable working runtime", () => {
    renderControls({ status: "working", runtime_id: "rt-1", completed_at: null });

    expect(screen.getByRole("button", { name: "Take over" })).toBeInTheDocument();
  });

  it("keeps takeover available when session observation is forbidden", () => {
    mocks.sessionCanObserve = false;
    renderControls({
      status: "working",
      runtime_id: "rt-1",
      session_id: "sess-1",
      completed_at: null,
    });

    expect(screen.getByRole("button", { name: "Take over" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open session" })).not.toBeInTheDocument();
  });

  it("shows handback and finalize for a taken-over blocked runtime", () => {
    renderControls({
      status: "blocked",
      runtime_id: "rt-1",
      session_id: "sess-1",
      completed_at: null,
    });

    const handback = screen.getByRole("button", { name: "Hand back" });
    const reject = screen.getByRole("button", { name: "Reject" });
    const approve = screen.getByRole("button", { name: "Approve" });
    expect(handback).toHaveClass("min-w-20");
    expect(reject).toHaveClass("min-w-20");
    expect(approve).toHaveClass("min-w-20");
    expect(reject.compareDocumentPosition(approve) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("hides handback and finalize for a terminal blocked runtime", () => {
    renderControls({
      status: "blocked",
      runtime_id: "rt-1",
      completed_at: "2026-07-29T00:00:00Z",
    });

    expect(screen.queryByRole("button", { name: "Hand back" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });

  it("keeps terminal controls and session entry hidden when no CSC session exists", () => {
    renderControls(
      {
        status: "blocked",
        runtime_id: "rt-1",
        completed_at: "2026-07-29T00:00:00Z",
      },
      { alwaysShow: true },
    );

    expect(screen.queryByRole("button", { name: "Open session" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hand back" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("can hide the duplicate session action while keeping takeover follow-up controls", () => {
    renderControls(
      {
        status: "blocked",
        runtime_id: "rt-1",
        session_id: "sess-1",
        completed_at: null,
      },
      { showOpenSession: false },
    );

    expect(screen.queryByRole("button", { name: "Open session" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hand back" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });
});
