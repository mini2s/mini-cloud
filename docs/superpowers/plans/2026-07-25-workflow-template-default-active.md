# Workflow Template Default Active Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 模板实例创建后默认启用，并确保模板不会被列出或直接作为可运行 workflow 使用。

**Architecture:** 服务层负责克隆默认状态及运行准入约束；Core 查询层显式区分实例列表与模板列表；共享 View 只消费可运行实例，不再实现模板懒克隆。现有模板管理接口保持独立。

**Tech Stack:** Go 1.26、PostgreSQL/sqlc、TypeScript、TanStack Query、React、Vitest。

## Global Constraints

- React Query owns all server state；不把 workflow 数据复制到 Zustand。
- `packages/core/` 不引入 react-dom、localStorage 或 process.env。
- `packages/views/` 不引入 Next.js 或 react-router-dom API。
- 测试先失败再写最小实现；不修改普通空白 workflow 的 `draft` 默认值。
- 不迁移既有派生 workflow，不改变模板专用 `template=true` 查询。

---

### Task 1: 模板克隆默认启用并禁止直接运行模板

**Files:**
- Modify: `server/internal/service/workflow_template_test.go`
- Modify: `server/internal/service/workflow.go`

**Interfaces:**
- Consumes: `WorkflowService.CloneWorkflowFromTemplate(...)` 与 `WorkflowService.StartRun(...)`。
- Produces: 克隆实例 `Status == "active"`；模板启动返回 `workflow template cannot be run` 错误。

- [ ] **Step 1: 修改克隆测试期望，并新增模板运行拒绝测试**

```go
if cloned.Status != "active" {
    t.Fatalf("expected status 'active', got %q", cloned.Status)
}

func TestStartRunRejectsTemplate(t *testing.T) {
    svc := &WorkflowService{}
    _, err := svc.StartRun(context.Background(), db.MulticaWorkflow{
        Status: "active", IsTemplate: true,
    }, "member", "", nil, pgtype.UUID{})
    if err == nil || err.Error() != "workflow template cannot be run" {
        t.Fatalf("got error %v, want workflow template cannot be run", err)
    }
}
```

- [ ] **Step 2: 运行测试并确认因旧行为失败**

Run: `cd server && go test ./internal/service -run 'TestCloneWorkflowFromTemplate|TestStartRunRejectsTemplate' -count=1`

Expected: 克隆状态得到 `draft`，模板启动未返回预期错误。

- [ ] **Step 3: 写最小服务实现**

将 `CreateWorkflowFromTemplateParams.Status` 改为 `"active"`；在 `startRun` 的 active 状态检查后加入：

```go
if workflow.IsTemplate {
    return nil, errors.New("workflow template cannot be run")
}
```

- [ ] **Step 4: 运行目标 Go 测试并确认通过**

Run: `cd server && go test ./internal/service -run 'TestCloneWorkflowFromTemplate|TestStartRunRejectsTemplate' -count=1`

Expected: PASS。

### Task 2: Core 可运行列表显式排除模板

**Files:**
- Modify: `packages/core/workflows/queries.test.ts`
- Modify: `packages/core/workflows/queries.ts`

**Interfaces:**
- Consumes: `api.listWorkflows(wsId, template?)`。
- Produces: `workflowListOptions` 和 `workflowActiveListOptions` 请求 `template=false`；活动列表仅返回 `status=active && is_template=false`。

- [ ] **Step 1: mock API 并写查询行为测试**

```ts
const listWorkflows = vi.fn();
vi.mock("../api", () => ({ api: { listWorkflows } }));

await workflowListOptions("ws-1").queryFn!({} as never);
expect(listWorkflows).toHaveBeenCalledWith("ws-1", false);

const selected = workflowActiveListOptions("ws-1").select!({
  workflows: [activeInstance, activeTemplate, draftInstance],
  total: 3,
});
expect(selected).toEqual([activeInstance]);
```

- [ ] **Step 2: 运行 Core 测试并确认旧查询参数/过滤失败**

Run: `pnpm --filter @multica/core exec vitest run workflows/queries.test.ts`

Expected: `listWorkflows` 只收到 `wsId`，且活动模板出现在选择结果中。

- [ ] **Step 3: 写最小查询实现**

两个普通列表 queryFn 改为 `api.listWorkflows(wsId, false)`；活动列表过滤改为：

```ts
data.workflows.filter((workflow) => workflow.status === "active" && workflow.is_template === false)
```

- [ ] **Step 4: 运行 Core 测试并确认通过**

Run: `pnpm --filter @multica/core exec vitest run workflows/queries.test.ts`

Expected: PASS。

### Task 3: Issue 运行选择器移除模板注入与懒克隆

**Files:**
- Modify: `packages/views/issues/components/pickers/assignee-picker.test.tsx`
- Modify: `packages/views/issues/components/pickers/assignee-picker.tsx`

**Interfaces:**
- Consumes: `workflowActiveListOptions(wsId)` 返回的活动实例。
- Produces: workflow 分组只展示活动实例；点击实例继续进入现有 runtime strategy 流程。

- [ ] **Step 1: 为模板查询提供独立 fixture 并写不可见断言**

```tsx
const templateWorkflow = { ...workflows[0], id: "template-1", title: "Release template", is_template: true };

it("does not include templates in runnable workflow options", () => {
  render(<AssigneePicker assigneeType={null} assigneeId={null} open onOpenChange={vi.fn()} onUpdate={vi.fn()} />);
  expect(screen.getByText("Release workflow")).toBeInTheDocument();
  expect(screen.queryByText("Release template")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: 运行 View 测试并确认旧合并逻辑使断言失败**

Run: `pnpm --filter @multica/views exec vitest run issues/components/pickers/assignee-picker.test.tsx`

Expected: FAIL，页面显示 `Release template`。

- [ ] **Step 3: 删除模板查询、合并数组与点击时懒克隆分支**

保留 `handleWorkflowClick` 的实例 runtime strategy 逻辑，并直接从 `activeWorkflows` 构造 `filteredWorkflows`。删除不再使用的 `api`、`useQueryClient`、`workflowTemplateListOptions` 导入。

- [ ] **Step 4: 运行 View 测试并确认通过**

Run: `pnpm --filter @multica/views exec vitest run issues/components/pickers/assignee-picker.test.tsx`

Expected: PASS。

### Task 4: 综合验证

**Files:**
- Verify only: all modified production and test files。

**Interfaces:**
- Consumes: Tasks 1-3 的全部行为。
- Produces: 可交付的跨层回归证据。

- [ ] **Step 1: 格式化 Go 文件**

Run: `cd server && gofmt -w internal/service/workflow.go internal/service/workflow_template_test.go`

- [ ] **Step 2: 运行相关测试集合**

Run: `cd server && go test ./internal/service -count=1`

Run: `pnpm --filter @multica/core exec vitest run workflows/queries.test.ts`

Run: `pnpm --filter @multica/views exec vitest run issues/components/pickers/assignee-picker.test.tsx`

- [ ] **Step 3: 运行静态检查**

Run: `pnpm typecheck`

Expected: 全部命令退出码为 0。

- [ ] **Step 4: 检查最终差异**

Run: `git diff --check && git status --short`

Expected: 无空白错误，变更仅包含计划内文件。

