import { describe, expect, it } from "vitest";
import { parseNodeFormat, parseNodeShape, toWorkflowRuntimeDisplayStatus } from "./workflow";

describe("workflow node format parsing", () => {
  it("falls back to a task rectangle for non-object input", () => {
    expect(parseNodeFormat(null)).toEqual({
      kind: "task",
      shape: "rectangle",
      template_id: null,
      template_category: "action",
      gateway_kind: null,
      gateway_kind_valid: true,
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
    expect(toWorkflowRuntimeDisplayStatus("critic_approved")).toBe("completed");
    expect(toWorkflowRuntimeDisplayStatus("failed")).toBe("blocked");
    expect(toWorkflowRuntimeDisplayStatus("cancelled")).toBe("cancelled");
    expect(toWorkflowRuntimeDisplayStatus("skipped")).toBe("cancelled");
  });

  it("downgrades unknown node run statuses to pending", () => {
    expect(toWorkflowRuntimeDisplayStatus("future_status")).toBe("pending");
  });
});
