import { describe, expect, it } from "vitest";
import {
  isBoundaryNode,
  isEndNode,
  isInvalidBoundaryConnection,
  isStartNode,
  parseNodeFormat,
  parseNodeShape,
  toWorkflowRuntimeDisplayStatus,
  type WorkflowNode,
} from "./workflow";

function makeNode(formatSchema: unknown): Pick<WorkflowNode, "format_schema"> {
  return { format_schema: formatSchema };
}

describe("workflow node format parsing", () => {
  it("parses and classifies workflow boundary nodes", () => {
    const start = makeNode({ type: "start", shape: "pill" });
    const end = makeNode({ type: "end", shape: "pill" });
    const task = makeNode({ shape: "rectangle" });

    expect(parseNodeFormat(start.format_schema).kind).toBe("start");
    expect(parseNodeFormat(end.format_schema).kind).toBe("end");
    expect(isStartNode(start)).toBe(true);
    expect(isEndNode(end)).toBe(true);
    expect(isBoundaryNode(task)).toBe(false);
  });

  it("rejects invalid boundary node connections", () => {
    const start = makeNode({ type: "start" });
    const end = makeNode({ type: "end" });
    const task = makeNode({});
    const annotation = makeNode({ type: "annotation" });

    expect(isInvalidBoundaryConnection(start, task)).toBe(false);
    expect(isInvalidBoundaryConnection(task, end)).toBe(false);
    expect(isInvalidBoundaryConnection(task, start)).toBe(true);
    expect(isInvalidBoundaryConnection(end, task)).toBe(true);
    expect(isInvalidBoundaryConnection(start, end)).toBe(true);
    expect(isInvalidBoundaryConnection(start, annotation)).toBe(true);
    expect(isInvalidBoundaryConnection(annotation, end)).toBe(true);
  });

  it("falls back to a task rectangle for non-object input", () => {
    expect(parseNodeFormat(null)).toEqual({
      kind: "task",
      shape: "rectangle",
      template_id: null,
      template_category: "action",
      gateway_kind: null,
      gateway_kind_valid: true,
      split_config: null,
      split_config_valid: true,
    });
  });

  it("parses gateway format with stable semantic fields", () => {
    expect(parseNodeFormat({
      type: "gateway",
      gateway_kind: "fork",
      shape: "diamond",
      template_id: "fork-gateway",
      template_category: "logic",
    })).toEqual({
      kind: "gateway",
      shape: "diamond",
      template_id: "fork-gateway",
      template_category: "logic",
      gateway_kind: "fork",
      gateway_kind_valid: true,
      split_config: null,
      split_config_valid: true,
    });
  });

  it("marks invalid gateway kind without crashing consumers", () => {
    expect(parseNodeFormat({ type: "gateway", gateway_kind: "split", shape: "circle" })).toEqual({
      kind: "gateway",
      shape: "rectangle",
      template_id: null,
      template_category: "action",
      gateway_kind: null,
      gateway_kind_valid: false,
      split_config: null,
      split_config_valid: true,
    });
  });

  it("keeps annotation format separate from shape-driven nodes", () => {
    expect(parseNodeFormat({ type: "annotation", template_id: "sticky-note", template_category: "annotation" }))
      .toMatchObject({
        kind: "annotation",
        shape: "rectangle",
        template_id: "sticky-note",
        template_category: "annotation",
      });
  });

  it("parses split format with split_config defaults and validation", () => {
    expect(parseNodeFormat({
      type: "split",
      template_id: "task-splitter",
      template_category: "logic",
      split_config: {
        mode: "pipeline",
        max_concurrency: 12,
        max_failures: 2,
      },
    })).toMatchObject({
      kind: "split",
      shape: "diamond",
      template_id: "task-splitter",
      template_category: "logic",
      split_config: {
        mode: "pipeline",
        max_concurrency: 12,
        max_failures: 2,
      },
      split_config_valid: true,
    });
  });

  it("ignores legacy default_issue_workflow_id on split nodes", () => {
    expect(parseNodeFormat({
      type: "split",
      split_config: {
        default_issue_workflow_id: "legacy-wf",
        mode: "pipeline",
        max_concurrency: 3,
        max_failures: 1,
      },
    }).split_config).toEqual({ mode: "pipeline", max_concurrency: 3, max_failures: 1 });
  });

  it("falls back invalid split_config to conservative defaults", () => {
    expect(parseNodeFormat({ type: "split", split_config: { mode: "fast", max_concurrency: 99, max_failures: -1 } }))
      .toMatchObject({
        kind: "split",
        split_config: {
          mode: "barrier",
          max_concurrency: 5,
          max_failures: 0,
        },
        split_config_valid: false,
      });
  });

	it("accepts split max_concurrency through 50 and rejects 51", () => {
		const base = { mode: "barrier", max_failures: 0 };
		expect(parseNodeFormat({ type: "split", split_config: { ...base, max_concurrency: 50 } }).split_config_valid).toBe(true);
		expect(parseNodeFormat({ type: "split", split_config: { ...base, max_concurrency: 51 } }).split_config_valid).toBe(false);
	});

  it("keeps parseNodeShape fallback behavior for invalid shapes", () => {
    expect(parseNodeShape({ shape: "circle" })).toBe("rectangle");
  });

  it("uses template category as the default semantic shape", () => {
    expect(parseNodeFormat({ template_category: "trigger" }).shape).toBe("pill");
    expect(parseNodeFormat({ template_category: "logic" }).shape).toBe("diamond");
    expect(parseNodeFormat({ template_category: "human" }).shape).toBe("hexagon");
    expect(parseNodeFormat({ template_category: "ai" }).shape).toBe("rectangle");
    expect(parseNodeFormat({ template_category: "unknown" }).shape).toBe("rectangle");
  });

  it("lets an explicit valid shape override the category default", () => {
    expect(parseNodeFormat({ template_category: "logic", shape: "hexagon" }).shape).toBe("hexagon");
    expect(parseNodeFormat({ template_category: "trigger", shape: "rectangle" }).shape).toBe("rectangle");
  });

  it("maps node run status to runtime display status", () => {
    expect(toWorkflowRuntimeDisplayStatus("pending")).toBe("pending");
    expect(toWorkflowRuntimeDisplayStatus("format_checking")).toBe("in_progress");
    expect(toWorkflowRuntimeDisplayStatus("format_ok")).toBe("in_progress");
    expect(toWorkflowRuntimeDisplayStatus("worker_assigned")).toBe("todo");
    expect(toWorkflowRuntimeDisplayStatus("awaiting_input")).toBe("in_progress");
    expect(toWorkflowRuntimeDisplayStatus("working")).toBe("in_progress");
    expect(toWorkflowRuntimeDisplayStatus("awaiting_critic")).toBe("reviewing");
    expect(toWorkflowRuntimeDisplayStatus("splitting")).toBe("in_progress");
    expect(toWorkflowRuntimeDisplayStatus("awaiting_split_review")).toBe("reviewing");
    expect(toWorkflowRuntimeDisplayStatus("split_active")).toBe("in_progress");
    expect(toWorkflowRuntimeDisplayStatus("critic_approved")).toBe("completed");
    expect(toWorkflowRuntimeDisplayStatus("failed")).toBe("failed");
    expect(toWorkflowRuntimeDisplayStatus("blocked")).toBe("blocked");
    expect(toWorkflowRuntimeDisplayStatus("cancelled")).toBe("cancelled");
    expect(toWorkflowRuntimeDisplayStatus("skipped")).toBe("cancelled");
  });

  it("downgrades unknown node run statuses to pending", () => {
    expect(toWorkflowRuntimeDisplayStatus("future_status")).toBe("pending");
  });
});
