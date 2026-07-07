import { describe, expect, it } from "vitest";
import { workflowNodeInfoAreaClassName } from "./workflow-node-shape";
import type { NodeShape } from "@multica/core/types";

describe("workflow node shape helpers", () => {
  it("keeps every node information area on the same left-aligned grid", () => {
    const shapes: NodeShape[] = ["rectangle", "diamond", "pill", "hexagon"];
    const classes = shapes.map((shape) => workflowNodeInfoAreaClassName(shape));

    expect(new Set(classes).size).toBe(1);
    expect(classes[0]).not.toContain("px-10");
    expect(classes[0]).not.toContain("px-6");
  });
});
