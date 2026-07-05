// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "../../test/i18n";
import { WorkflowCanvasShell } from "./workflow-canvas-shell";
import type { CanvasModel } from "@multica/core/workflows/canvas";

const model: CanvasModel = {
  stages: [],
  nodes: [],
  edges: [],
  nodesById: new Map(),
  edgesById: new Map(),
};

describe("WorkflowCanvasShell", () => {
  it("passes edit capability to children", () => {
    renderWithI18n(
      <WorkflowCanvasShell mode="edit" model={model}>
        {({ capabilities }) => <span>{capabilities.canEditDefinition ? "editable" : "readonly"}</span>}
      </WorkflowCanvasShell>,
    );
    expect(screen.getByText("editable")).toBeTruthy();
  });

  it("passes runtime capability in readonly runtime mode", () => {
    renderWithI18n(
      <WorkflowCanvasShell mode="readonly-runtime" model={model}>
        {({ capabilities }) => <span>{capabilities.canRunActions ? "runtime" : "no-runtime"}</span>}
      </WorkflowCanvasShell>,
    );
    expect(screen.getByText("runtime")).toBeTruthy();
  });
});
