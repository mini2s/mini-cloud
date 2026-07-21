# Workflow UI/UX 优化实施计划

> **给 agentic workers 的要求：** 实施本计划时必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`。所有步骤使用 checkbox（`- [ ]`）跟踪。

**目标：** 将当前 Workflow 编辑器从“形状画布”推进为更接近 n8n 工作台心智的编排界面，优先完成节点能力选择器、清晰空态、节点数据面板、发布前检查常驻和基础键盘可访问性。

**架构：** 第一批只修改共享前端包，不改 Go API、数据库和跨端路由。业务 UI 放在 `packages/views/workflows/components/` 及其 `overview/` 子目录；服务端数据继续由 TanStack Query 管理，编辑器临时状态继续使用 `packages/core/workflows/store.ts`。

**技术栈：** TypeScript strict mode、React、TanStack Query、Zustand、ReactFlow、Base UI/shadcn 组件、Vitest + Testing Library。

---

## 范围

本计划覆盖不改后端即可交付的第一批优化：

- `Add node` 从形状按钮升级为能力选择器。
- 空白画布引导从“创建矩形”升级为“选择起点”。
- 右侧节点面板改为 `配置 / 数据 / 运行` tabs。
- Preflight 发布检查常驻化，并明确保存与发布/启用的关系。
- 补齐主要画布节点的 ARIA 与键盘触发。

不在本计划内：

- Workflow edge 类型落库，例如 condition、error、critic、data-flow。
- Pin、Mock、Dirty 数据持久化。
- 将历史运行数据写回编辑器作为 replay input。
- 后端发布版本、回滚、审计日志。

这些需要 API 或数据模型设计，后续单独制定计划。

## 文件边界

- 新建 `packages/views/workflows/components/overview/node-template-catalog.ts`
  - 节点模板分类、搜索、默认 `CreateNodeRequest` 构造。
- 新建 `packages/views/workflows/components/overview/node-template-catalog.test.ts`
  - 覆盖模板分类、搜索、payload 构造。
- 新建 `packages/views/workflows/components/overview/node-template-picker.tsx`
  - Add node popover 内容，提供搜索和分类列表。
- 新建 `packages/views/workflows/components/overview/node-template-picker.test.tsx`
  - 覆盖搜索、分类渲染、点击选择。
- 修改 `packages/views/workflows/components/overview/workflow-panorama-page.tsx`
  - 移除形状 palette，接入 picker。
  - 空态 CTA 打开 picker。
  - 常驻 Preflight/Publish strip。
  - 查询最近运行数据并传给节点面板。
- 新建 `packages/views/workflows/components/node-data-preview.tsx`
  - 只读展示 selected node 的最近运行状态、worker output、critic output、critic comment。
- 新建 `packages/views/workflows/components/node-data-preview.test.tsx`
  - 覆盖空态、有输出、有评审意见。
- 修改 `packages/views/workflows/components/node-config-panel.tsx`
  - 增加 `配置 / 数据 / 运行` tabs。
- 修改 `packages/views/workflows/components/overview/preflight-bar.tsx`
  - 支持常驻 all-clear、unsaved 状态文案、publish disabled reason。
- 修改 `packages/views/workflows/components/overview/preflight-bar.test.tsx`
  - 覆盖 all-clear 常驻、未保存禁用发布、阻断问题禁用发布。
- 修改 `packages/views/workflows/components/overview/reactflow-nodes/compact-worker-node.tsx`
  - 增加 `role="button"`、`tabIndex`、`aria-label`、Enter/Space 打开。
- 修改 `packages/views/workflows/components/overview/reactflow-nodes/compact-worker-node.test.tsx`
  - 覆盖 ARIA 和键盘交互。
- 修改 `packages/views/locales/en/workflows.json`
  - 新增 picker、tabs、publish strip 文案。
- 修改 `packages/views/locales/zh-Hans/workflows.json`
  - 新增中文文案。

## Task 1：节点模板目录

**文件：**

- 新建：`packages/views/workflows/components/overview/node-template-catalog.ts`
- 新建：`packages/views/workflows/components/overview/node-template-catalog.test.ts`

- [ ] **Step 1：先写失败测试**

新建 `packages/views/workflows/components/overview/node-template-catalog.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import {
  buildCreateNodeRequestFromTemplate,
  filterNodeTemplates,
  NODE_TEMPLATE_CATEGORIES,
  NODE_TEMPLATES,
} from "./node-template-catalog";

describe("node-template-catalog", () => {
  it("按 workflow 能力分类组织模板", () => {
    expect(NODE_TEMPLATE_CATEGORIES.map((c) => c.id)).toEqual([
      "trigger",
      "action",
      "logic",
      "ai",
      "human",
      "annotation",
    ]);
    expect(NODE_TEMPLATES.some((t) => t.category === "trigger")).toBe(true);
    expect(NODE_TEMPLATES.some((t) => t.category === "ai")).toBe(true);
  });

  it("支持按标题、描述、tag 搜索", () => {
    expect(filterNodeTemplates("agent").map((t) => t.id)).toContain("ai-agent-task");
    expect(filterNodeTemplates("manual").map((t) => t.id)).toContain("manual-trigger");
    expect(filterNodeTemplates("review").map((t) => t.id)).toContain("human-review");
  });

  it("空搜索返回所有模板", () => {
    expect(filterNodeTemplates("")).toHaveLength(NODE_TEMPLATES.length);
    expect(filterNodeTemplates("   ")).toHaveLength(NODE_TEMPLATES.length);
  });

  it("根据模板生成 create-node payload", () => {
    const template = NODE_TEMPLATES.find((t) => t.id === "ai-agent-task")!;
    const req = buildCreateNodeRequestFromTemplate(template, {
      x: 125.8,
      y: 240.2,
      stageId: "stage-1",
    });

    expect(req).toMatchObject({
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
    const template = NODE_TEMPLATES.find((t) => t.id === "sticky-note")!;
    const req = buildCreateNodeRequestFromTemplate(template, {
      x: -10,
      y: 30,
      stageId: null,
    });

    expect(req.title).toBe("Note");
    expect(req.position_x).toBe(0);
    expect(req.stage_id).toBeNull();
    expect(req.format_schema).toMatchObject({
      type: "annotation",
      template_id: "sticky-note",
      template_category: "annotation",
    });
  });
});
```

- [ ] **Step 2：运行测试确认失败**

```bash
pnpm --filter @multica/views exec vitest run workflows/components/overview/node-template-catalog.test.ts
```

预期：失败，因为 `node-template-catalog.ts` 尚不存在。

- [ ] **Step 3：实现模板目录**

新建 `packages/views/workflows/components/overview/node-template-catalog.ts`：

```ts
import type { CreateNodeRequest, CriticType, NodeShape, WorkerType } from "@multica/core/types";

export type NodeTemplateCategoryId =
  | "trigger"
  | "action"
  | "logic"
  | "ai"
  | "human"
  | "annotation";

export interface NodeTemplateCategory {
  id: NodeTemplateCategoryId;
  labelKey: string;
  descriptionKey: string;
}

export interface NodeTemplate {
  id: string;
  category: NodeTemplateCategoryId;
  title: string;
  description: string;
  tags: string[];
  shape: NodeShape;
  worker_type: WorkerType;
  critic_type: CriticType;
  annotation?: boolean;
}

export const NODE_TEMPLATE_CATEGORIES: NodeTemplateCategory[] = [
  { id: "trigger", labelKey: "trigger", descriptionKey: "trigger_description" },
  { id: "action", labelKey: "action", descriptionKey: "action_description" },
  { id: "logic", labelKey: "logic", descriptionKey: "logic_description" },
  { id: "ai", labelKey: "ai", descriptionKey: "ai_description" },
  { id: "human", labelKey: "human", descriptionKey: "human_description" },
  { id: "annotation", labelKey: "annotation", descriptionKey: "annotation_description" },
];

export const NODE_TEMPLATES: NodeTemplate[] = [
  {
    id: "manual-trigger",
    category: "trigger",
    title: "Manual trigger",
    description: "Start this workflow from a button or manual run.",
    tags: ["start", "manual", "trigger"],
    shape: "pill",
    worker_type: "human",
    critic_type: "human",
  },
  {
    id: "agent-task",
    category: "action",
    title: "Task",
    description: "Create a normal task for a member, agent, or squad.",
    tags: ["task", "action", "worker"],
    shape: "rectangle",
    worker_type: "agent",
    critic_type: "human",
  },
  {
    id: "condition-branch",
    category: "logic",
    title: "Decision",
    description: "Represent a branch or approval decision.",
    tags: ["if", "condition", "branch", "decision"],
    shape: "diamond",
    worker_type: "human",
    critic_type: "human",
  },
  {
    id: "ai-agent-task",
    category: "ai",
    title: "Agent task",
    description: "Ask an agent to complete a workflow step.",
    tags: ["ai", "agent", "automation"],
    shape: "rectangle",
    worker_type: "agent",
    critic_type: "human",
  },
  {
    id: "human-review",
    category: "human",
    title: "Human review",
    description: "Pause for a person to review or approve output.",
    tags: ["human", "review", "approval"],
    shape: "hexagon",
    worker_type: "human",
    critic_type: "human",
  },
  {
    id: "sticky-note",
    category: "annotation",
    title: "Note",
    description: "Add context, assumptions, or handoff notes to the canvas.",
    tags: ["note", "annotation", "comment"],
    shape: "rectangle",
    worker_type: "human",
    critic_type: "human",
    annotation: true,
  },
];

export function filterNodeTemplates(query: string): NodeTemplate[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return NODE_TEMPLATES;
  return NODE_TEMPLATES.filter((template) => {
    const haystack = [
      template.title,
      template.description,
      template.category,
      ...template.tags,
    ].join(" ").toLocaleLowerCase();
    return haystack.includes(q);
  });
}

export function buildCreateNodeRequestFromTemplate(
  template: NodeTemplate,
  input: { x: number; y: number; stageId: string | null },
): CreateNodeRequest {
  const format_schema = template.annotation
    ? {
        type: "annotation",
        template_id: template.id,
        template_category: template.category,
      }
    : {
        shape: template.shape,
        template_id: template.id,
        template_category: template.category,
      };

  return {
    title: template.title,
    description: template.description,
    position_x: Math.max(0, Math.round(input.x)),
    position_y: 0,
    stage_id: input.stageId,
    format_schema,
    worker_type: template.worker_type,
    worker_id: null,
    critic_type: template.critic_type,
    critic_id: null,
    critic_api_url: null,
  };
}
```

- [ ] **Step 4：运行测试确认通过**

```bash
pnpm --filter @multica/views exec vitest run workflows/components/overview/node-template-catalog.test.ts
```

预期：通过。

- [ ] **Step 5：提交**

```bash
git add packages/views/workflows/components/overview/node-template-catalog.ts packages/views/workflows/components/overview/node-template-catalog.test.ts
git commit -m "feat(workflows): add node template catalog"
```

## Task 2：节点能力选择器 UI

**文件：**

- 新建：`packages/views/workflows/components/overview/node-template-picker.tsx`
- 新建：`packages/views/workflows/components/overview/node-template-picker.test.tsx`
- 修改：`packages/views/locales/en/workflows.json`
- 修改：`packages/views/locales/zh-Hans/workflows.json`

- [ ] **Step 1：补充 i18n 文案**

在两个 locale 文件的 `panorama` 下增加 `node_picker`。

英文：

```json
"node_picker": {
  "search_placeholder": "Search nodes or actions...",
  "empty": "No matching nodes",
  "trigger": "Triggers",
  "trigger_description": "Start a workflow",
  "action": "Actions",
  "action_description": "Do work in a step",
  "logic": "Logic",
  "logic_description": "Branch or route work",
  "ai": "AI",
  "ai_description": "Agent-powered steps",
  "human": "Human",
  "human_description": "Review or approval",
  "annotation": "Notes",
  "annotation_description": "Explain the canvas"
}
```

中文：

```json
"node_picker": {
  "search_placeholder": "搜索节点或动作...",
  "empty": "没有匹配的节点",
  "trigger": "触发器",
  "trigger_description": "启动工作流",
  "action": "动作",
  "action_description": "执行一个步骤",
  "logic": "逻辑",
  "logic_description": "分支或路由任务",
  "ai": "AI",
  "ai_description": "由 Agent 执行的步骤",
  "human": "人工",
  "human_description": "评审或审批",
  "annotation": "注释",
  "annotation_description": "解释画布内容"
}
```

- [ ] **Step 2：先写失败测试**

新建 `packages/views/workflows/components/overview/node-template-picker.test.tsx`，覆盖：

```tsx
it("渲染分类和模板", () => {
  render(<NodeTemplatePicker onSelect={vi.fn()} />);
  expect(screen.getByText("Triggers")).toBeInTheDocument();
  expect(screen.getByText("Manual trigger")).toBeInTheDocument();
  expect(screen.getByText("Agent task")).toBeInTheDocument();
});

it("按搜索词过滤模板", () => {
  render(<NodeTemplatePicker onSelect={vi.fn()} />);
  fireEvent.change(screen.getByPlaceholderText("Search nodes or actions..."), {
    target: { value: "review" },
  });
  expect(screen.getByText("Human review")).toBeInTheDocument();
  expect(screen.queryByText("Manual trigger")).not.toBeInTheDocument();
});

it("点击模板后回传被选择的模板", () => {
  const onSelect = vi.fn();
  render(<NodeTemplatePicker onSelect={onSelect} />);
  fireEvent.click(screen.getByRole("button", { name: /Agent task/ }));
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "ai-agent-task" }));
});
```

测试文件需要 mock `../../../i18n`，返回 Task 2 Step 1 中的英文 key。

- [ ] **Step 3：运行测试确认失败**

```bash
pnpm --filter @multica/views exec vitest run workflows/components/overview/node-template-picker.test.tsx
```

预期：失败，因为 picker 文件不存在。

- [ ] **Step 4：实现 picker**

新建 `packages/views/workflows/components/overview/node-template-picker.tsx`：

```tsx
"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@multica/ui/components/ui/input";
import { ScrollArea } from "@multica/ui/components/ui/scroll-area";
import { cn } from "@multica/ui/lib/utils";
import { useT } from "../../../i18n";
import {
  filterNodeTemplates,
  NODE_TEMPLATE_CATEGORIES,
  type NodeTemplate,
} from "./node-template-catalog";

interface NodeTemplatePickerProps {
  onSelect: (template: NodeTemplate) => void;
}

export function NodeTemplatePicker({ onSelect }: NodeTemplatePickerProps) {
  const { t } = useT("workflows");
  const [query, setQuery] = useState("");
  const templates = useMemo(() => filterNodeTemplates(query), [query]);

  return (
    <div className="w-[360px]" data-testid="node-template-picker">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t(($) => $.panorama.node_picker.search_placeholder)}
          className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
        />
      </div>
      <ScrollArea className="max-h-[420px]">
        <div className="p-2">
          {templates.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              {t(($) => $.panorama.node_picker.empty)}
            </div>
          ) : (
            NODE_TEMPLATE_CATEGORIES.map((category) => {
              const items = templates.filter((template) => template.category === category.id);
              if (items.length === 0) return null;
              return (
                <section key={category.id} className="py-1">
                  <div className="px-2 pb-1">
                    <div className="text-xs font-medium text-foreground">
                      {t(($) => $.panorama.node_picker[category.labelKey as keyof typeof $.panorama.node_picker])}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {t(($) => $.panorama.node_picker[category.descriptionKey as keyof typeof $.panorama.node_picker])}
                    </div>
                  </div>
                  <div className="space-y-1">
                    {items.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => onSelect(template)}
                        className={cn(
                          "flex w-full flex-col rounded-md px-2.5 py-2 text-left transition-colors",
                          "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        )}
                        aria-label={`${template.title}: ${template.description}`}
                      >
                        <span className="text-sm font-medium">{template.title}</span>
                        <span className="line-clamp-2 text-xs text-muted-foreground">
                          {template.description}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
```

- [ ] **Step 5：运行 picker 和 i18n 测试**

```bash
pnpm --filter @multica/views exec vitest run workflows/components/overview/node-template-picker.test.tsx locales/parity.test.ts
```

预期：通过。

- [ ] **Step 6：提交**

```bash
git add packages/views/workflows/components/overview/node-template-picker.tsx packages/views/workflows/components/overview/node-template-picker.test.tsx packages/views/locales/en/workflows.json packages/views/locales/zh-Hans/workflows.json
git commit -m "feat(workflows): add node template picker"
```

## Task 3：接入 Panorama 编辑器

**文件：**

- 修改：`packages/views/workflows/components/overview/workflow-panorama-page.tsx`
- 修改：`packages/views/workflows/components/overview/workflow-panorama-page.test.tsx`

- [ ] **Step 1：添加集成测试**

在 `workflow-panorama-page.test.tsx` 添加两个用例：

```tsx
it("从 Add node picker 创建模板节点", async () => {
  render(<WorkflowPanoramaPage workflowId="wf-1" />);
  fireEvent.click(screen.getByRole("button", { name: /Add node/i }));
  fireEvent.click(screen.getByRole("button", { name: /Agent task/i }));

  expect(mocks.createNodeMutate).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "Agent task",
      worker_type: "agent",
      format_schema: expect.objectContaining({
        template_id: "ai-agent-task",
        template_category: "ai",
      }),
    }),
    expect.any(Object),
  );
});

it("first-step guide 打开 picker，而不是直接创建默认矩形", () => {
  mocks.stagesData = [
    { id: "stage-1", workflow_id: "wf-1", name: "Build", description: "", sort_order: 0, node_count: 0, created_at: "", updated_at: "" },
  ];
  mocks.nodesData = [];

  render(<WorkflowPanoramaPage workflowId="wf-1" />);
  fireEvent.click(screen.getByRole("button", { name: /Add node/i }));

  expect(screen.getByTestId("node-template-picker")).toBeInTheDocument();
  expect(mocks.createNodeMutate).not.toHaveBeenCalled();
});
```

测试 mock 需要补齐 Task 2 中的 picker 文案。

- [ ] **Step 2：运行测试确认失败**

```bash
pnpm --filter @multica/views exec vitest run workflows/components/overview/workflow-panorama-page.test.tsx
```

预期：失败，因为当前页面仍使用形状 palette。

- [ ] **Step 3：替换形状 palette**

在 `workflow-panorama-page.tsx`：

- 删除本地 `SHAPE_LABELS`、`SHAPES`、`isNodeShape`、`DRAG_SHAPE_MIME`、`handleDragStart`、`handleClickToPlace`。
- 增加 import：

```ts
import { NodeTemplatePicker } from "./node-template-picker";
import {
  buildCreateNodeRequestFromTemplate,
  type NodeTemplate,
} from "./node-template-catalog";
```

- 将 `onShapeDrop` prop 改为：

```ts
onTemplateDrop: (template: NodeTemplate, position: { x: number; y: number }) => void;
```

- 将 Add node popover 内容替换为：

```tsx
<Popover open={popoverOpen} onOpenChange={setPopoverOpen} modal={false}>
  <PopoverTrigger>
    <Button variant="outline" size="sm" aria-label={t(($) => $.detail.add_node)}>
      <Plus className="size-3.5 mr-1" />
      {t(($) => $.detail.add_node)}
    </Button>
  </PopoverTrigger>
  <PopoverContent className="w-auto p-0" align="start" side="bottom">
    <NodeTemplatePicker
      onSelect={(template) => {
        const center = reactFlowInstance.screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        });
        onTemplateDrop(template, center);
        setPopoverOpen(false);
      }}
    />
  </PopoverContent>
</Popover>
```

- 将 first-step guide 按钮改为只打开 picker：

```tsx
<Button
  variant="default"
  size="sm"
  onClick={(event) => {
    event.stopPropagation();
    setPopoverOpen(true);
  }}
>
  <Plus className="h-3.5 w-3.5 mr-1" />
  {t(($) => $.detail.add_node)}
</Button>
```

- 用模板创建节点：

```ts
const handleTemplateDrop = useCallback(
  (template: NodeTemplate, position: { x: number; y: number }) => {
    const stage = findStageAtY(position.y, stages);
    createNodeMutation.mutate(
      buildCreateNodeRequestFromTemplate(template, {
        x: position.x,
        y: position.y,
        stageId: stage?.id ?? null,
      }),
      {
        onSuccess: (created) => {
          pushServerAction({ type: "create-node", nodeId: created.id });
        },
      },
    );
  },
  [createNodeMutation, stages, pushServerAction],
);
```

- 将 `onShapeDrop={handleShapeDrop}` 改为 `onTemplateDrop={handleTemplateDrop}`。

- [ ] **Step 4：运行相关测试**

```bash
pnpm --filter @multica/views exec vitest run workflows/components/overview/node-template-catalog.test.ts workflows/components/overview/node-template-picker.test.tsx workflows/components/overview/workflow-panorama-page.test.tsx
```

预期：通过。

- [ ] **Step 5：提交**

```bash
git add packages/views/workflows/components/overview/workflow-panorama-page.tsx packages/views/workflows/components/overview/workflow-panorama-page.test.tsx
git commit -m "feat(workflows): create nodes from template picker"
```

## Task 4：节点面板 tabs 和运行数据预览

**文件：**

- 新建：`packages/views/workflows/components/node-data-preview.tsx`
- 新建：`packages/views/workflows/components/node-data-preview.test.tsx`
- 修改：`packages/views/workflows/components/node-config-panel.tsx`
- 修改：`packages/views/workflows/components/overview/workflow-panorama-page.tsx`
- 修改：`packages/views/locales/en/workflows.json`
- 修改：`packages/views/locales/zh-Hans/workflows.json`

- [ ] **Step 1：补充 i18n 文案**

在两个 locale 文件的 `node` 下增加：

```json
"tabs": {
  "config": "Config",
  "data": "Data",
  "runs": "Runs"
},
"data_preview": {
  "empty": "No run data for this node yet.",
  "status": "Latest status",
  "worker_output": "Worker output",
  "critic_output": "Critic output",
  "critic_comment": "Critic comment"
}
```

中文：

```json
"tabs": {
  "config": "配置",
  "data": "数据",
  "runs": "运行"
},
"data_preview": {
  "empty": "此节点暂无运行数据。",
  "status": "最近状态",
  "worker_output": "执行输出",
  "critic_output": "评审输出",
  "critic_comment": "评审意见"
}
```

- [ ] **Step 2：先写 NodeDataPreview 测试**

新建 `packages/views/workflows/components/node-data-preview.test.tsx`，覆盖：

```tsx
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
```

`baseRun` 使用完整 `WorkflowNodeRun` fixture，字段参考 `packages/core/types/workflow.ts`。

- [ ] **Step 3：实现 NodeDataPreview**

新建 `packages/views/workflows/components/node-data-preview.tsx`：

```tsx
"use client";

import type { WorkflowNodeRun, NodeRunStatus } from "@multica/core/types";
import { Badge } from "@multica/ui/components/ui/badge";
import { useT } from "../i18n";

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  if (value == null) return null;
  return (
    <section className="space-y-1.5">
      <h4 className="text-xs font-medium text-muted-foreground">{label}</h4>
      <pre className="max-h-48 overflow-auto rounded-md border bg-muted/30 p-2 text-[11px] leading-relaxed">
        {JSON.stringify(value, null, 2)}
      </pre>
    </section>
  );
}

export function NodeDataPreview({ nodeRun }: { nodeRun: WorkflowNodeRun | null }) {
  const { t } = useT("workflows");

  if (!nodeRun) {
    return (
      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        {t(($) => $.node.data_preview.empty)}
      </div>
    );
  }

  const status = nodeRun.status as NodeRunStatus;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">
          {t(($) => $.node.data_preview.status)}
        </span>
        <Badge variant="secondary" className="h-5 text-[11px]">
          {t(($) => ($.node_run.status as Record<string, string>)[status] ?? status)}
        </Badge>
      </div>
      <JsonBlock label={t(($) => $.node.data_preview.worker_output)} value={nodeRun.worker_output} />
      <JsonBlock label={t(($) => $.node.data_preview.critic_output)} value={nodeRun.critic_output} />
      {nodeRun.critic_comment && (
        <section className="space-y-1.5">
          <h4 className="text-xs font-medium text-muted-foreground">
            {t(($) => $.node.data_preview.critic_comment)}
          </h4>
          <p className="rounded-md border bg-muted/30 p-2 text-xs leading-relaxed">
            {nodeRun.critic_comment}
          </p>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 4：给 NodeConfigPanel 增加 tabs**

在 `node-config-panel.tsx`：

- 增加 import：

```ts
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@multica/ui/components/ui/tabs";
import { NodeDataPreview } from "./node-data-preview";
import type { WorkflowNodeRun } from "@multica/core/types";
```

- props 增加：

```ts
recentNodeRun?: WorkflowNodeRun | null;
```

- 函数参数增加默认值：

```ts
recentNodeRun = null,
```

- 将现有表单内容移动到 `TabsContent value="config"`，新增：

```tsx
<Tabs defaultValue="config" className="flex min-h-0 flex-1 flex-col">
  <div className="border-b px-4 py-2">
    <TabsList className="h-8">
      <TabsTrigger value="config" className="text-xs">{t(($) => $.node.tabs.config)}</TabsTrigger>
      <TabsTrigger value="data" className="text-xs">{t(($) => $.node.tabs.data)}</TabsTrigger>
      <TabsTrigger value="runs" className="text-xs">{t(($) => $.node.tabs.runs)}</TabsTrigger>
    </TabsList>
  </div>
  <TabsContent value="config" className="m-0 min-h-0 flex-1 overflow-y-auto px-4 py-4">
    {/* 现有配置表单 JSX 放这里，不改 handler */}
  </TabsContent>
  <TabsContent value="data" className="m-0 min-h-0 flex-1 overflow-y-auto px-4 py-4">
    <NodeDataPreview nodeRun={recentNodeRun} />
  </TabsContent>
  <TabsContent value="runs" className="m-0 min-h-0 flex-1 overflow-y-auto px-4 py-4">
    <NodeDataPreview nodeRun={recentNodeRun} />
  </TabsContent>
</Tabs>
```

- [ ] **Step 5：在 panorama 查询最近运行数据**

在 `workflow-panorama-page.tsx` 的 workflow query import 中加入：

```ts
workflowRunsOptions,
workflowNodeRunsOptions,
```

新增查询：

```ts
const { data: recentRuns = [] } = useQuery(workflowRunsOptions(wsId, workflowId));
const latestRunId = recentRuns[0]?.id ?? null;
const { data: recentNodeRuns = [] } = useQuery({
  ...workflowNodeRunsOptions(wsId, workflowId, latestRunId ?? ""),
  enabled: !!latestRunId,
});
```

新增派生数据：

```ts
const selectedRecentNodeRun = useMemo(
  () => selectedNode ? recentNodeRuns.find((run) => run.workflow_node_id === selectedNode.id) ?? null : null,
  [recentNodeRuns, selectedNode],
);
```

传入面板：

```tsx
recentNodeRun={selectedRecentNodeRun}
```

- [ ] **Step 6：运行测试**

```bash
pnpm --filter @multica/views exec vitest run workflows/components/node-data-preview.test.tsx workflows/components/overview/workflow-panorama-page.test.tsx locales/parity.test.ts
```

预期：通过。

- [ ] **Step 7：提交**

```bash
git add packages/views/workflows/components/node-data-preview.tsx packages/views/workflows/components/node-data-preview.test.tsx packages/views/workflows/components/node-config-panel.tsx packages/views/workflows/components/overview/workflow-panorama-page.tsx packages/views/workflows/components/overview/workflow-panorama-page.test.tsx packages/views/locales/en/workflows.json packages/views/locales/zh-Hans/workflows.json
git commit -m "feat(workflows): add node inspector data tabs"
```

## Task 5：发布条常驻和保存/发布语义

**文件：**

- 修改：`packages/views/workflows/components/overview/preflight-bar.tsx`
- 修改：`packages/views/workflows/components/overview/preflight-bar.test.tsx`
- 修改：`packages/views/workflows/components/overview/workflow-panorama-page.tsx`
- 修改：`packages/views/locales/en/workflows.json`
- 修改：`packages/views/locales/zh-Hans/workflows.json`

- [ ] **Step 1：补充文案**

在 `preflight` 下增加：

```json
"bar_saved_all_clear": "Saved and ready to publish",
"bar_unsaved_all_clear": "Save changes before publishing",
"bar_active": "Published workflow is active",
"bar_publish_disabled_unsaved": "Save first"
```

中文：

```json
"bar_saved_all_clear": "已保存，可以发布",
"bar_unsaved_all_clear": "发布前请先保存更改",
"bar_active": "工作流已发布并启用",
"bar_publish_disabled_unsaved": "先保存"
```

- [ ] **Step 2：先改测试**

在 `preflight-bar.test.tsx` 增加：

```tsx
it("无问题时展示可发布状态", () => {
  render(
    <PreflightBar
      result={{ issues: [], blockingCount: 0, warningCount: 0, passed: true }}
      hasUnsavedEdits={false}
      workflowStatus="draft"
      onNavigateToNode={vi.fn()}
      onPublish={vi.fn()}
      onDismiss={vi.fn()}
    />,
  );

  expect(screen.getByText("Saved and ready to publish")).toBeInTheDocument();
  expect(screen.getByTestId("preflight-publish-btn")).not.toBeDisabled();
});

it("有未保存改动时禁用发布", () => {
  render(
    <PreflightBar
      result={{ issues: [], blockingCount: 0, warningCount: 0, passed: true }}
      hasUnsavedEdits
      workflowStatus="draft"
      onNavigateToNode={vi.fn()}
      onPublish={vi.fn()}
      onDismiss={vi.fn()}
    />,
  );

  expect(screen.getByText("Save changes before publishing")).toBeInTheDocument();
  expect(screen.getByTestId("preflight-publish-btn")).toBeDisabled();
  expect(screen.getByTestId("preflight-publish-btn")).toHaveTextContent("Save first");
});
```

- [ ] **Step 3：更新 PreflightBar**

在 `preflight-bar.tsx`：

- props 增加：

```ts
import type { WorkflowStatus } from "@multica/core/types";

hasUnsavedEdits?: boolean;
workflowStatus?: WorkflowStatus;
```

- 增加状态计算：

```ts
const publishDisabled = hasBlocking || hasUnsavedEdits || isPublishing;
const publishLabel = hasUnsavedEdits
  ? t(($) => $.preflight.bar_publish_disabled_unsaved)
  : isPublishing
    ? t(($) => $.preflight.bar_publishing)
    : t(($) => $.preflight.bar_publish);
const allClearLabel = workflowStatus === "active"
  ? t(($) => $.preflight.bar_active)
  : hasUnsavedEdits
    ? t(($) => $.preflight.bar_unsaved_all_clear)
    : t(($) => $.preflight.bar_saved_all_clear);
```

- 无问题时展示 `allClearLabel`。
- 按钮 disabled 使用 `publishDisabled`。
- 无问题时不显示 Dismiss。

- [ ] **Step 4：让 PreflightBar 在非空编辑器中常驻**

在 `workflow-panorama-page.tsx` 将：

```tsx
{!preflightDismissed && !preflightResult.passed && !showFirstStageGuide && (
```

替换为：

```tsx
{!showFirstStageGuide && visibleNodes.length > 0 && (!preflightDismissed || preflightResult.passed) && (
```

传入：

```tsx
hasUnsavedEdits={hasUnsavedEdits}
workflowStatus={workflow.status}
```

- [ ] **Step 5：运行测试**

```bash
pnpm --filter @multica/views exec vitest run workflows/components/overview/preflight-bar.test.tsx workflows/components/overview/workflow-panorama-page.test.tsx locales/parity.test.ts
```

预期：通过。

- [ ] **Step 6：提交**

```bash
git add packages/views/workflows/components/overview/preflight-bar.tsx packages/views/workflows/components/overview/preflight-bar.test.tsx packages/views/workflows/components/overview/workflow-panorama-page.tsx packages/views/locales/en/workflows.json packages/views/locales/zh-Hans/workflows.json
git commit -m "feat(workflows): clarify publish readiness"
```

## Task 6：画布节点键盘和 ARIA

**文件：**

- 修改：`packages/views/workflows/components/overview/reactflow-nodes/compact-worker-node.tsx`
- 修改：`packages/views/workflows/components/overview/reactflow-nodes/compact-worker-node.test.tsx`
- 修改：`packages/views/workflows/components/overview/workflow-panorama-page.tsx`

- [ ] **Step 1：先写失败测试**

在 `compact-worker-node.test.tsx` 增加：

```tsx
it("worker node 是可键盘聚焦的 button", () => {
  renderCompactWorkerNode({ selected: false, data: baseData });
  const node = screen.getByRole("button", { name: /Agent task.*Not configured/i });
  expect(node).toHaveAttribute("tabIndex", "0");
});

it("Enter 和 Space 调用打开回调", () => {
  const onOpen = vi.fn();
  renderCompactWorkerNode({
    selected: false,
    data: { ...baseData, onOpen },
  });

  const node = screen.getByRole("button");
  fireEvent.keyDown(node, { key: "Enter" });
  fireEvent.keyDown(node, { key: " " });

  expect(onOpen).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2：更新 CompactWorkerNode**

在 `compact-worker-node.tsx`：

- `CompactWorkerNodeData` 增加：

```ts
onOpen?: (nodeId: string) => void;
```

- 增加键盘处理：

```ts
const openNode = () => nodeData.onOpen?.(nodeData.node.id);
const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  openNode();
};
```

- 根节点增加：

```tsx
role="button"
tabIndex={0}
aria-label={`${displayName}. ${subtitle}`}
onDoubleClick={openNode}
onKeyDown={handleKeyDown}
```

- [ ] **Step 3：从 panorama 注入 onOpen**

在 `workflow-panorama-page.tsx`：

- `apiNodesToReactFlowNodes` 签名增加：

```ts
onOpenNode: (nodeId: string) => void,
```

- worker node data 增加：

```ts
onOpen: onOpenNode,
```

- 在组件中用 `useCallback` 定义：

```ts
const openNodePanel = useCallback((nodeId: string) => {
  selectNode(nodeId);
  setConfigPanelOpen(true);
}, [selectNode]);
```

- 调用 `apiNodesToReactFlowNodes(...)` 时传入 `openNodePanel`。

- [ ] **Step 4：运行测试**

```bash
pnpm --filter @multica/views exec vitest run workflows/components/overview/reactflow-nodes/compact-worker-node.test.tsx workflows/components/overview/workflow-panorama-page.test.tsx
```

预期：通过。

- [ ] **Step 5：提交**

```bash
git add packages/views/workflows/components/overview/reactflow-nodes/compact-worker-node.tsx packages/views/workflows/components/overview/reactflow-nodes/compact-worker-node.test.tsx packages/views/workflows/components/overview/workflow-panorama-page.tsx
git commit -m "fix(workflows): improve canvas node keyboard access"
```

## Task 7：验证

**文件：**

- 无代码修改。

- [ ] **Step 1：运行聚焦测试**

```bash
pnpm --filter @multica/views exec vitest run workflows/components/overview/node-template-catalog.test.ts workflows/components/overview/node-template-picker.test.tsx workflows/components/node-data-preview.test.tsx workflows/components/overview/preflight-bar.test.tsx workflows/components/overview/reactflow-nodes/compact-worker-node.test.tsx workflows/components/overview/workflow-panorama-page.test.tsx
```

预期：通过。

- [ ] **Step 2：运行 views 包测试**

```bash
pnpm --filter @multica/views test
```

预期：通过。

- [ ] **Step 3：运行 TypeScript 检查**

```bash
pnpm typecheck
```

预期：通过。

- [ ] **Step 4：手动烟测**

启动：

```bash
make dev
```

检查：

- 空 Workflow 不再静默创建默认矩形节点。
- `Add node` 打开可搜索的节点能力选择器。
- 选择 `Agent task` 会创建带 agent 默认配置的节点。
- 点击节点能打开右侧面板。
- `配置 / 数据 / 运行` tabs 在 384px 面板内不溢出。
- 有未保存改动时，发布条提示先保存。
- 无阻断问题且已保存时，发布按钮可用。
- 键盘焦点能到达 compact worker node，Enter 能打开面板。

## 后续独立计划

1. **语义边**
   - 为 `WorkflowEdge.condition` 约定结构：`kind`、`label`、`severity`。
   - 渲染 condition、error、rework、critic 等不同边样式。

2. **运行回放和 Dirty Data**
   - 增加“从历史运行打开编辑器”。
   - 用 `node.updated_at` 与 `nodeRun.completed_at` 判断数据是否过期。
   - 设计 Pin/Mock 数据的存储位置和 API。

3. **生产发布模型**
   - 区分保存、发布、启用、回滚和审计。
   - 后端暴露 draft revision 与 published revision。

## 自检

- 覆盖范围：计划覆盖差距报告中的 P0 项，包括节点发现、空态、节点数据上下文、发布 readiness 和键盘可访问性。
- 占位检查：没有使用空泛占位描述；需要后端支持的内容已拆为后续独立计划。
- 类型一致性：`NodeTemplate`、`NodeTemplateCategoryId`、`buildCreateNodeRequestFromTemplate`、`recentNodeRun`、`hasUnsavedEdits` 都在使用前定义，命名保持一致。
