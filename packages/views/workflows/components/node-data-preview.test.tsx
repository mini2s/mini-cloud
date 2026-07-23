// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NodeDataPreview } from "./node-data-preview";
import type { WorkflowNodeRun } from "@multica/core/types";

vi.mock("../../i18n", () => {
  const translations = {
    node: {
      data_preview: {
        empty: "No run data for this node yet.",
        status: "Latest status",
        worker_output: "Worker output",
        critic_output: "Critic output",
        critic_comment: "Critic comment",
      },
    },
    node_run: {
      status: {
        completed: "Completed",
      },
    },
  };

  return {
    useT: () => ({
      t: (selector: (value: typeof translations) => string) => selector(translations),
    }),
  };
});

const baseRun: WorkflowNodeRun = {
  id: "node-run-1",
  workflow_run_id: "run-1",
  workflow_node_id: "node-1",
  node_title: "Agent task",
  status: "completed",
  retry_count: 0,
  worker_type: "agent",
  worker_id: "agent-1",
  worker_output: { summary: "Done" },
  worker_agent_task_id: null,
  critic_type: "human",
  critic_id: "member-1",
  critic_output: { approved: true },
  critic_comment: "Looks good",
  critic_agent_task_id: null,
  agent_task_id: null,
  session_id: null,
  runtime_id: null,
  runtime_selection_reason: null,
  failure_reason: null,
  device_id: null,
  split_review_chat_session_id: null,
  split_config_version: 1,
  started_at: "2026-07-07T10:00:00Z",
  completed_at: "2026-07-07T10:02:00Z",
  created_at: "2026-07-07T10:00:00Z",
  updated_at: "2026-07-07T10:02:00Z",
};

describe("NodeDataPreview", () => {
  it("没有 node run 时显示空态", () => {
    render(<NodeDataPreview nodeRun={null} />);
    expect(screen.getByText("No run data for this node yet.")).toBeInTheDocument();
  });

  it("显示最近状态和输出", () => {
    render(<NodeDataPreview nodeRun={baseRun} />);

    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Worker output")).toBeInTheDocument();
    expect(screen.getByText(/"summary": "Done"/)).toBeInTheDocument();
    expect(screen.getByText("Critic comment")).toBeInTheDocument();
    expect(screen.getByText("Looks good")).toBeInTheDocument();
  });
});
