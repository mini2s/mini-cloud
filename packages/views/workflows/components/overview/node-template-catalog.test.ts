import { describe, expect, it } from "vitest";
import { DEFAULT_SPLIT_PLANNER_AGENT_IDS } from "@multica/core/workflows/preflight-checks";
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
      "ai",
      "human",
      "annotation",
    ]);
    expect(NODE_TEMPLATES.some((template) => template.category === "trigger")).toBe(true);
    expect(NODE_TEMPLATES.some((template) => template.category === "ai")).toBe(true);
  });

  it("支持按标题、描述、tag 搜索", () => {
    expect(filterNodeTemplates("agent").map((template) => template.id)).toContain("ai-agent-task");
    expect(filterNodeTemplates("manual").map((template) => template.id)).toContain("manual-trigger");
    expect(filterNodeTemplates("review").map((template) => template.id)).toContain("human-review");
  });

  it("空搜索返回所有模板", () => {
    expect(filterNodeTemplates("")).toHaveLength(NODE_TEMPLATES.length);
    expect(filterNodeTemplates("   ")).toHaveLength(NODE_TEMPLATES.length);
  });

  it("根据模板生成 create-node payload", () => {
    const template = NODE_TEMPLATES.find((item) => item.id === "ai-agent-task");
    expect(template).toBeDefined();

    const request = buildCreateNodeRequestFromTemplate(template!, {
      x: 125.8,
      y: 240.2,
      stageId: "stage-1",
    });

    expect(request).toMatchObject({
      title: "Agent task",
      description: "Ask an agent to complete a workflow step.",
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
        template_id: "ai-agent-task",
        template_category: "ai",
      },
    });
  });

  it("注释模板生成 annotation format_schema", () => {
    const template = NODE_TEMPLATES.find((item) => item.id === "sticky-note");
    expect(template).toBeDefined();

    const request = buildCreateNodeRequestFromTemplate(template!, {
      x: -10,
      y: 30,
      stageId: null,
    });

    expect(request.title).toBe("Note");
    expect(request.position_x).toBe(-10);
    expect(request.stage_id).toBeNull();
    expect(request.format_schema).toMatchObject({
      type: "annotation",
      template_id: "sticky-note",
      template_category: "annotation",
    });
  });

  it("generates gateway node payloads with semantic format_schema", () => {
    const fork = NODE_TEMPLATES.find((item) => item.id === "fork-gateway");
    const join = NODE_TEMPLATES.find((item) => item.id === "join-gateway");

    expect(fork).toMatchObject({
      category: "logic",
      title: "Fork",
      shape: "diamond",
      worker_type: "agent",
      critic_type: "human",
    });
    expect(join).toMatchObject({
      category: "logic",
      title: "Join",
      shape: "diamond",
      worker_type: "agent",
      critic_type: "human",
    });

    expect(buildCreateNodeRequestFromTemplate(fork!, { x: 10, y: 0, stageId: "stage-1" }).format_schema)
      .toMatchObject({
        type: "gateway",
        gateway_kind: "fork",
        shape: "diamond",
        template_id: "fork-gateway",
        template_category: "logic",
      });
    expect(buildCreateNodeRequestFromTemplate(join!, { x: 10, y: 0, stageId: "stage-1" }).format_schema)
      .toMatchObject({
        type: "gateway",
        gateway_kind: "join",
        shape: "diamond",
        template_id: "join-gateway",
        template_category: "logic",
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
        worker_id: DEFAULT_SPLIT_PLANNER_AGENT_IDS[0],
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
});
