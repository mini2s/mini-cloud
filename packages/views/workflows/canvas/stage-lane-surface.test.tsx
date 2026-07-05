// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n } from "../../test/i18n";
import { StageLaneSurface } from "./stage-lane-surface";
import type { CanvasModel, CanvasNode, CanvasStage } from "@multica/core/workflows/canvas";

function stage(id: string): CanvasStage {
  return {
    id,
    workflowId: "workflow-1",
    name: id,
    description: "",
    sortOrder: 0,
    nodeCount: 1,
    source: null,
    isVirtual: false,
  };
}

function node(id: string, stageId: string): CanvasNode {
  return {
    id,
    workflowId: "workflow-1",
    title: id,
    description: "",
    position: { x: 0, y: 0 },
    sortOrder: 0,
    stageId,
    shape: "rectangle",
    formatSchema: null,
    workerType: "agent",
    workerId: null,
    criticType: "human",
    criticId: null,
    criticApiUrl: null,
    source: {} as CanvasNode["source"],
    runtime: null,
  };
}

function model(): CanvasModel {
  const stages = [stage("stage-1")];
  const nodes = [node("node-1", "stage-1")];
  return {
    stages,
    nodes,
    edges: [],
    nodesById: new Map(nodes.map((item) => [item.id, item])),
    edgesById: new Map(),
  };
}

describe("StageLaneSurface", () => {
  it("renders stages and nodes", () => {
    renderWithI18n(<StageLaneSurface model={model()} variant="definition" selectedNodeId={null} />);
    expect(screen.getByText("stage-1")).toBeTruthy();
    expect(screen.getByText("node-1")).toBeTruthy();
  });

  it("calls onNodeSelect when a node is clicked", () => {
    const onNodeSelect = vi.fn();
    renderWithI18n(<StageLaneSurface model={model()} variant="definition" selectedNodeId={null} onNodeSelect={onNodeSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /node-1/ }));
    expect(onNodeSelect).toHaveBeenCalledWith("node-1");
  });
});
