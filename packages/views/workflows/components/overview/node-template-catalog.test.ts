import { describe, expect, it } from "vitest";
import {
  buildCreateNodeRequestFromTemplate,
  filterNodeTemplates,
  NODE_TEMPLATE_CATEGORIES,
  NODE_TEMPLATES,
} from "./node-template-catalog";

describe("node-template-catalog", () => {
  it("按 workflow 能力分类组织模板", () => {
    expect(NODE_TEMPLATE_CATEGORIES.map((category) => category.id)).toEqual([
      "trigger",
      "action",
      "logic",
    ]);
    expect(NODE_TEMPLATES.some((template) => template.category === "trigger")).toBe(true);
    expect(NODE_TEMPLATES.some((template) => template.category === "action")).toBe(true);
  });

  it("支持按标题、描述、tag 搜索", () => {
    expect(filterNodeTemplates("task").map((template) => template.id)).toContain("agent-task");
    expect(filterNodeTemplates("task").map((template) => template.id)).toContain("task-splitter");
    expect(filterNodeTemplates("start").map((template) => template.id)).toContain("workflow-start");
  });

  it("空搜索返回所有模板", () => {
    expect(filterNodeTemplates("")).toHaveLength(NODE_TEMPLATES.length);
    expect(filterNodeTemplates("   ")).toHaveLength(NODE_TEMPLATES.length);
  });

  it("根据模板生成 create-node payload", () => {
    const template = NODE_TEMPLATES.find((item) => item.id === "agent-task");
    expect(template).toBeDefined();

    const request = buildCreateNodeRequestFromTemplate(template!, {
      x: 125.8,
      y: 240.2,
      stageId: "stage-1",
    });

    expect(request).toMatchObject({
      title: "Task",
      description: "Create a normal task for a member, agent, or squad.",
      position_x: 126,
      position_y: 0,
      stage_id: "stage-1",
      worker_type: "agent",
      worker_id: null,
      critic_type: "human",
      critic_id: null,
      critic_api_url: null,
      format_schema: {
        shape: "rectangle",
        template_id: "agent-task",
        template_category: "action",
      },
    });
  });

  it("generates split node payloads with conservative split defaults", () => {
    const split = NODE_TEMPLATES.find((item) => item.id === "task-splitter");

    expect(split).toMatchObject({
      category: "logic",
      title: "Task split",
      shape: "rectangle",
      worker_type: "agent",
      critic_type: "human",
    });

    expect(buildCreateNodeRequestFromTemplate(split!, { x: 240, y: 80, stageId: "stage-2" }))
      .toMatchObject({
        title: "Task split",
        stage_id: "stage-2",
        worker_id: null,
        format_schema: {
          type: "split",
          shape: "rectangle",
          template_id: "task-splitter",
          template_category: "logic",
          split_config: {
            default_issue_workflow_id: null,
            mode: "barrier",
            max_concurrency: 5,
            max_failures: 0,
          },
        },
      });
  });

  it("builds boundary payloads without actor assignments", () => {
    const start = NODE_TEMPLATES.find((item) => item.id === "workflow-start")!;
    const end = NODE_TEMPLATES.find((item) => item.id === "workflow-end")!;

    expect(buildCreateNodeRequestFromTemplate(start, { x: 10, y: 20, stageId: "stage-1" }))
      .toMatchObject({
        title: "Start",
        stage_id: "stage-1",
        worker_type: "human",
        worker_id: null,
        critic_type: "human",
        critic_id: null,
        critic_api_url: null,
        format_schema: { type: "start", shape: "pill", template_id: "workflow-start" },
      });
    expect((buildCreateNodeRequestFromTemplate(end, { x: 30, y: 20, stageId: null })
      .format_schema as Record<string, unknown>).type).toBe("end");
  });
});
