# Dynamic Task Splitting Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 关闭 `analysis-dynamic-task-splitting-review.md` 中经当前代码复核后仍成立的 Critical、Major 和低成本 Minor 缺口，使动态任务拆分的数据契约、API、调度语义、可观测性和 UI 与设计规范一致。

**Architecture:** 保持 `SplitOrchestrator` 作为拆分生命周期唯一编排入口，HTTP handler 只负责认证、请求解析和稳定错误映射；PostgreSQL/sqlc 负责批量原子性和 dispatch 幂等约束；React Query 继续持有运行态服务端数据。先收敛跨端契约，再修复后端事务与调度，最后接入预检和共享视图，避免前端建立在不稳定响应之上。

**Tech Stack:** Go 1.26.1、Chi、pgx/sqlc、PostgreSQL 17、TypeScript strict、Zod、TanStack Query、React 19、Vitest、Testing Library。

## Global Constraints

- 第一阶段只支持 workflow 作为子 issue 执行方式；不得恢复 `suggested_assignee_*` 概念。
- Split 草案批量写入必须在单个 DB 事务中完成，任一校验或写入失败整批回滚。
- `split_generate`、`split_repair`、`split_chat` 任务不得创建、更新、分配或批量修改 issue；只读、评论、附件和 draft API 保持允许。
- `pipeline` 在初始可运行子任务派发成功后释放下游；后续子任务失败只更新 split group 聚合状态，不回写已完成父节点。
- `barrier` 的失败计数包含 `failed` 和 `cancelled`，并由 `max_failures` 控制父节点结果。
- API 响应必须通过 Zod `parseWithFallback`，新增或修改响应字段必须有 malformed-response 测试。
- `packages/core/` 不引入 react-dom、localStorage、process.env 或 UI 库；`packages/views/` 不引入 `next/*` 或 `react-router-dom`。
- UI 使用语义化 design token；代码注释使用英文；产品文案同时更新英文和中文 locale。
- 不修改已发布 migration 的历史内容；schema 收敛使用新的 `141_*` migration，并运行 `make sqlc` 更新生成代码。
- 每个任务完成后执行其目标测试；全部任务完成后执行 `make check`。

## Review Reconciliation

当前代码已覆盖评审 #7（pipeline 立即完成）、#19 的 approve 侧 `confirm_empty`、#24（initial dispatch 失败触发 reconcile）以及基础版 issue 创建/更新拦截。计划不重复实现这些路径，而是补齐空草案 submit、所有写入口覆盖和回归测试。

以下评审项按“实现正确、规范漏记”处理：#11 partial unique index、#13 `dispatch_key`/`last_error`、#18 workflow-options 资源路由、#29 child cluster 本地 SVG edge layer、#37 操作端点、#38 workflow run dispatch key、#39 操作索引。Task 1 将这些事实写回设计规范；不为纯路径或渲染实现差异引入兼容路由和 ReactFlow 重构。

## File Structure

- `server/migrations/141_workflow_split_contract_cleanup.{up,down}.sql`：删除未使用的前瞻字段，保留正式 split contract。
- `server/pkg/db/queries/workflow_split_task.sql`：原子 claim/finalize、取消状态分类和批量操作所需 SQL。
- `server/pkg/db/queries/workflow_node_run.sql`：活跃 split 与父 issue 的删除保护查询。
- `server/pkg/protocol/events.go`：split 生命周期事件名的唯一来源。
- `server/internal/service/workflow_split.go`：草案事务、空草案、调度幂等、事件和错误类型。
- `server/internal/service/workflow.go`：支持 dispatch key 的 workflow run 创建入口。
- `server/internal/handler/workflow_split.go`：稳定响应字段、人工新增草案、错误码映射。
- `server/internal/handler/handler.go`、`server/internal/handler/issue.go`：统一识别 split phase 并覆盖所有 issue 写入口。
- `packages/core/types/workflow.ts`、`packages/core/api/schemas.ts`：前端 split contract 与防漂移默认值。
- `packages/core/workflows/preflight-checks.ts`：完整 split preflight 检查。
- `packages/views/workflows/components/node-config-panel.tsx`：配置面板顺序、完整 readiness、连接摘要和试跑动作。
- `packages/views/workflows/components/split/*`：生成态、草案来源/版本、依赖图、取消和完成态。
- `packages/views/issues/components/execution/runtime-node-card.tsx`：split 收起态 mode badge。
- `docs/superpowers/specs/dynamic-task-splitting-design.md`：记录最终 schema、路由和渲染决策。

---

### Task 1: 收敛数据库、Go 与 TypeScript Split Contract

**Files:**
- Create: `server/migrations/141_workflow_split_contract_cleanup.up.sql`
- Create: `server/migrations/141_workflow_split_contract_cleanup.down.sql`
- Modify: `server/internal/handler/workflow_run.go`
- Modify: `server/internal/handler/workflow_node_run_response_test.go`
- Modify: `server/internal/handler/workflow_split.go`
- Modify: `server/internal/handler/workflow_split_test.go`
- Modify: `packages/core/types/workflow.ts`
- Modify: `packages/core/api/schemas.ts`
- Modify: `packages/core/api/schemas.test.ts`
- Modify: `docs/superpowers/specs/dynamic-task-splitting-design.md`
- Regenerate: `server/pkg/db/generated/`

**Interfaces:**
- Consumes: `db.MulticaWorkflowNodeRun.SplitConfigVersion`, `db.MulticaWorkflowSplitTask.DraftKey`, `DraftSource`。
- Produces: `WorkflowNodeRun.split_config_version: number`；`SplitTask.workflow_id: string`、`draft_key: string | null`、`draft_source: "agent" | "chat" | "recovered"`；对应 HTTP JSON 字段。

- [ ] **Step 1: 写失败的 Go response 测试**

在 `workflow_node_run_response_test.go` 增加：

```go
func TestWorkflowNodeRunToResponseIncludesSplitConfigVersion(t *testing.T) {
	nodeRun := db.MulticaWorkflowNodeRun{SplitConfigVersion: 7}

	resp := workflowNodeRunToResponse(nodeRun)
	if resp.SplitConfigVersion != 7 {
		t.Fatalf("SplitConfigVersion = %d, want 7", resp.SplitConfigVersion)
	}
}
```

在 `workflow_split_test.go` 增加一个 response 单元测试：

```go
func TestSplitTaskToResponseIncludesDraftMetadata(t *testing.T) {
	task := db.MulticaWorkflowSplitTask{
		WorkflowID:  parseUUID("11111111-1111-1111-1111-111111111111"),
		DraftKey:    pgtype.Text{String: "api", Valid: true},
		DraftSource: service.DraftSourceRecovered,
	}

	resp := splitTaskToResponse(task)
	if resp.WorkflowID == nil || *resp.WorkflowID != "11111111-1111-1111-1111-111111111111" {
		t.Fatalf("WorkflowID = %v", resp.WorkflowID)
	}
	if resp.DraftKey == nil || *resp.DraftKey != "api" || resp.DraftSource != "recovered" {
		t.Fatalf("draft metadata = %v / %q", resp.DraftKey, resp.DraftSource)
	}
}
```

- [ ] **Step 2: 写失败的 Zod contract 测试**

在 `schemas.test.ts` 增加：

```ts
it("parses split config versions and draft provenance", () => {
  const nodeRun = WorkflowNodeRunSchema.parse({
    id: "nr-1",
    workflow_run_id: "run-1",
    workflow_node_id: "node-1",
    split_config_version: 4,
  });
  const split = SplitTasksResponseSchema.parse({
    tasks: [{
      id: "task-1",
      node_run_id: "nr-1",
      workflow_id: "wf-1",
      draft_key: "backend",
      draft_source: "recovered",
    }],
  });

  expect(nodeRun.split_config_version).toBe(4);
  expect(split.tasks[0]).toMatchObject({
    workflow_id: "wf-1",
    draft_key: "backend",
    draft_source: "recovered",
  });
});

it("defaults additive split fields from an older server response", () => {
  const nodeRun = WorkflowNodeRunSchema.parse({
    id: "nr-1",
    workflow_run_id: "run-1",
    workflow_node_id: "node-1",
  });
  expect(nodeRun.split_config_version).toBe(1);
});
```

将 `SplitTasksResponseSchema` 从文件内私有常量改为具名导出，供测试直接使用。

- [ ] **Step 3: 运行测试确认 contract 缺失**

Run:

```bash
cd server && go test ./internal/handler/ -run "TestWorkflowNodeRunToResponseIncludesSplitConfigVersion|TestSplitTaskToResponseIncludesDraftMetadata" -count=1
pnpm --filter @multica/core exec vitest run api/schemas.test.ts
```

Expected: Go 编译因 response 字段不存在而失败；Vitest 因 schema 未返回新字段而失败。

- [ ] **Step 4: 添加 schema cleanup migration 并重新生成 sqlc**

`141_workflow_split_contract_cleanup.up.sql`：

```sql
ALTER TABLE multica_workflow_split_task
  DROP COLUMN IF EXISTS suggested_assignee_type,
  DROP COLUMN IF EXISTS suggested_assignee_id;

ALTER TABLE multica_workflow_node_run
  DROP COLUMN IF EXISTS split_initial_dispatch_completed;
```

`141_workflow_split_contract_cleanup.down.sql`：

```sql
ALTER TABLE multica_workflow_split_task
  ADD COLUMN IF NOT EXISTS suggested_assignee_type TEXT,
  ADD COLUMN IF NOT EXISTS suggested_assignee_id UUID;

ALTER TABLE multica_workflow_node_run
  ADD COLUMN IF NOT EXISTS split_initial_dispatch_completed BOOLEAN NOT NULL DEFAULT false;
```

Run: `make sqlc`

Expected: `server/pkg/db/generated/models.go` 不再包含三个删除字段，所有 query 重新生成成功。

- [ ] **Step 5: 实现 server response 字段**

在 `WorkflowNodeRunResponse` 和 converter 中加入：

```go
SplitConfigVersion int64 `json:"split_config_version"`
```

```go
SplitConfigVersion: nr.SplitConfigVersion,
```

在 `SplitTaskResponse` 和 converter 中加入：

```go
DraftKey    *string `json:"draft_key"`
DraftSource string  `json:"draft_source"`
```

```go
DraftKey:    textToPtr(task.DraftKey),
DraftSource: task.DraftSource,
```

- [ ] **Step 6: 实现 TypeScript 类型与防漂移 schema**

在 `workflow.ts` 中使用：

```ts
export type SplitDraftSource = "agent" | "chat" | "recovered";

export interface WorkflowNodeRun {
  // existing fields stay unchanged
  split_review_chat_session_id: string | null;
  split_config_version: number;
}

export interface SplitTask {
  id: string;
  node_run_id: string;
  title: string;
  description: string;
  workflow_id: string;
  depends_on: string[];
  sort_order: number;
  status: SplitTaskStatus;
  issue_id: string | null;
  run_id: string | null;
  version: number;
  draft_key: string | null;
  draft_source: SplitDraftSource;
  last_error: SplitTaskLastError | null;
  created_at: string;
  updated_at: string;
}
```

在 `schemas.ts` 中加入兼容性默认值：

```ts
export const SplitTaskSchema = z.object({
  // existing required identifiers stay unchanged
  workflow_id: z.string().default(""),
  draft_key: z.string().nullable().default(null),
  draft_source: z.enum(["agent", "chat", "recovered"]).catch("agent"),
  // existing fields stay unchanged
}).loose();

export const WorkflowNodeRunSchema = z.object({
  // existing fields stay unchanged
  split_review_chat_session_id: z.string().nullable().default(null),
  split_config_version: z.number().int().positive().default(1),
}).loose();
```

同时为 `EMPTY_WORKFLOW_NODE_RUN` 添加 `split_config_version: 1`。

- [ ] **Step 7: 更新设计规范中的实现决策**

在数据模型和 API 章节明确写入以下内容：

```markdown
- `dispatch_key TEXT`：split task 每次派发尝试的幂等键；格式为 `split-task:<task-id>:attempt:<version>`。
- `last_error JSONB`：保存结构化的子 workflow 启动失败信息。
- `multica_workflow_run.dispatch_key TEXT`：确保同一 split task attempt 最多创建一个 child run。
- `(node_run_id, draft_key)` 唯一索引仅覆盖 `status <> 'discarded'`，因此 discarded key 可被后续新草案复用。
- `GET /api/workflows/{id}/split/issue-workflow-options` 中 `{id}` 即 parent workflow id；不提供并行兼容路由。
- `draft-submit`、`reset-original` 和 draft delete 是恢复与审核流程的正式操作端点。
- Runtime child cluster 使用父 ReactFlow node 内的 SVG edge layer；child card 不是独立 ReactFlow node，语义与可访问标签由 cluster 组件提供。
```

删除规范中对 `split_initial_dispatch_completed` 的隐含依赖；pipeline 释放以 node run 终态和 split task 聚合状态分离实现。

- [ ] **Step 8: 运行 contract 验证**

Run:

```bash
cd server && go test ./internal/handler/ -run "TestWorkflowNodeRunToResponse|TestSplitTaskToResponse" -count=1
pnpm --filter @multica/core exec vitest run api/schemas.test.ts
pnpm --filter @multica/core typecheck
```

Expected: 全部 PASS；TypeScript 不再要求 `workflow_id` 的 null 分支。

- [ ] **Step 9: Commit**

```bash
git add server/migrations/141_workflow_split_contract_cleanup.* server/pkg/db/generated server/internal/handler/workflow_run.go server/internal/handler/workflow_node_run_response_test.go server/internal/handler/workflow_split.go server/internal/handler/workflow_split_test.go packages/core/types/workflow.ts packages/core/api/schemas.ts packages/core/api/schemas.test.ts docs/superpowers/specs/dynamic-task-splitting-design.md
git commit -m "fix(workflow): align split contracts across backend and frontend"
```

---

### Task 2: 让 Draft Batch 原子化并恢复人工新增路径

**Files:**
- Modify: `server/internal/service/workflow_split.go`
- Modify: `server/internal/service/workflow_split_test.go`
- Modify: `server/internal/handler/workflow_split.go`
- Modify: `server/internal/handler/workflow_split_test.go`

**Interfaces:**
- Consumes: `SplitDraftTaskRequest`、`SplitOrchestrator.runInTx`、`validateSplitDraftTaskAccess`。
- Produces: `AddSplitDraftTasks(ctx, nodeRun, taskID, agentID, requests) error` 单事务批量 upsert；`AddManualSplitDraftTask(ctx, nodeRun, req) error` 人工审核新增。

- [ ] **Step 1: 写 batch rollback 集成测试**

在 `workflow_split_test.go` 增加测试：第一条合法，第二条引用不存在的 key，响应 400 后数据库中两条都不存在。

```go
func TestBatchAddSplitDraftTasksRollsBackWholeBatch(t *testing.T) {
	f := createSplitGenerateFixture(t, "barrier")
	taskID := startSplitGenerationTask(t, f)
	req := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/draft-tasks/batch", map[string]any{
		"tasks": []map[string]any{
			{"draft_key": "first", "title": "First", "description": "First task", "depends_on": []string{}},
			{"draft_key": "second", "title": "Second", "description": "Second task", "depends_on": []string{"missing"}},
		},
	})
	req.Header.Set("X-Agent-ID", f.agentID)
	req.Header.Set("X-Task-ID", taskID)
	req = withURLParam(req, "nodeRunId", f.splitNodeRunID)
	w := httptest.NewRecorder()

	testHandler.BatchAddSplitDraftTasks(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400: %s", w.Code, w.Body.String())
	}
	tasks, err := testHandler.Queries.ListSplitTasksByNodeRun(context.Background(), parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatal(err)
	}
	if len(tasks) != 0 {
		t.Fatalf("tasks = %d, want atomic rollback", len(tasks))
	}
}
```

- [ ] **Step 2: 写人工新增草案测试**

```go
func TestAddSplitDraftTaskAllowsHumanReviewer(t *testing.T) {
	f := createSplitApproveFixture(t, "barrier")
	req := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/draft-tasks", map[string]any{
		"title": "Manual security review",
		"description": "Review permissions",
		"workflow_id": f.childWorkflowID,
		"depends_on": []string{f.taskAID},
	})
	req = withURLParam(req, "nodeRunId", f.splitNodeRunID)
	w := httptest.NewRecorder()

	testHandler.AddSplitDraftTask(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", w.Code, w.Body.String())
	}
	var body SplitTasksResponse
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	created := body.Tasks[len(body.Tasks)-1]
	if created.DraftSource != service.DraftSourceChat || created.WorkflowID == nil {
		t.Fatalf("manual draft = %+v", created)
	}
}
```

- [ ] **Step 3: 运行测试确认现有 handler 行为失败**

Run: `cd server && go test ./internal/handler/ -run "TestBatchAddSplitDraftTasksRollsBackWholeBatch|TestAddSplitDraftTaskAllowsHumanReviewer" -count=1`

Expected: batch 留下第一条记录；人工请求因缺少 `X-Task-ID` 返回 400。

- [ ] **Step 4: 抽取单事务 upsert helper**

在 service 中保留现有单条 API，但让单条和批量共同调用：

```go
func (s *SplitOrchestrator) AddSplitDraftTask(
	ctx context.Context,
	nodeRun db.MulticaWorkflowNodeRun,
	taskID, agentID pgtype.UUID,
	req SplitDraftTaskRequest,
) error {
	return s.AddSplitDraftTasks(ctx, nodeRun, taskID, agentID, []SplitDraftTaskRequest{req})
}

func (s *SplitOrchestrator) AddSplitDraftTasks(
	ctx context.Context,
	nodeRun db.MulticaWorkflowNodeRun,
	taskID, agentID pgtype.UUID,
	requests []SplitDraftTaskRequest,
) error {
	task, err := s.validateSplitDraftTaskAccess(ctx, nodeRun, taskID, agentID)
	if err != nil {
		return err
	}
	draftSource := DraftSourceAgent
	if isSplitChatPhase(task.Context) {
		draftSource = DraftSourceChat
	}
	return s.WfService.runInTx(ctx, func(qtx *db.Queries) error {
		for _, req := range requests {
			if err := s.upsertSplitDraftTask(ctx, qtx, nodeRun, req, draftSource); err != nil {
				return err
			}
		}
		current, err := qtx.ListSplitTasksByNodeRun(ctx, nodeRun.ID)
		if err != nil {
			return fmt.Errorf("reload split draft tasks: %w", err)
		}
		return validateDraftSplitTaskRows(current)
	})
}
```

`upsertSplitDraftTask` 接收 `q *db.Queries`，包含现有 `AddSplitDraftTask` 事务体中的 trim、默认 workflow、key/dependency、sort order 和 `UpsertSplitDraftTaskByKey` 逻辑；helper 内不得再开启事务或最终 reload。

- [ ] **Step 5: 在 handler 中一次调用 batch service**

```go
requests := make([]service.SplitDraftTaskRequest, 0, len(req.Tasks))
for _, task := range req.Tasks {
	requests = append(requests, service.SplitDraftTaskRequest{
		Key:           task.DraftKey,
		Title:         task.Title,
		Description:   task.Description,
		DependsOnKeys: task.DependsOn,
	})
}
if err := h.SplitOrchestrator.AddSplitDraftTasks(r.Context(), nodeRun, taskID, agentID, requests); err != nil {
	writeError(w, splitDraftErrorStatus(err), err.Error())
	return
}
```

- [ ] **Step 6: 实现人工 reviewer 分支**

为人工请求新增独立 payload，并以 header 是否同时存在作为明确分流条件：

```go
type CreateManualSplitDraftTaskRequest struct {
	Title       string   `json:"title"`
	Description string   `json:"description"`
	WorkflowID  string   `json:"workflow_id"`
	DependsOn   []string `json:"depends_on"`
}
```

`AddSplitDraftTask` 的开头使用：

```go
if r.Header.Get("X-Task-ID") == "" && r.Header.Get("X-Agent-ID") == "" {
	h.addManualSplitDraftTask(w, r, nodeRun)
	return
}
```

`addManualSplitDraftTask` 必须：要求 `nodeRun.Status == awaiting_split_review`；解析并验证 workflow；确认每个 dependency 属于同一 node run 且不是 discarded；使用 `CreateSplitTask` 写 `DraftKey: pgtype.Text{}`、`DraftSource: chat`、`Status: draft`、`SortOrder: max(active sort_order)+1`；随后返回完整 response。若只提供一个 agent header，仍按 agent 路径返回 400/403，不能降级成人工身份。

- [ ] **Step 7: 运行 draft API 测试**

Run: `cd server && go test ./internal/handler/ -run "Test(Add|BatchAdd|Patch|Delete|Submit)SplitDraft" -count=1`

Expected: 全部 PASS，包含原有 agent 安全契约测试。

- [ ] **Step 8: Commit**

```bash
git add server/internal/service/workflow_split.go server/internal/service/workflow_split_test.go server/internal/handler/workflow_split.go server/internal/handler/workflow_split_test.go
git commit -m "fix(workflow): make split draft writes atomic"
```

---

### Task 3: 补齐空草案 Submit 与稳定 API 错误契约

**Files:**
- Modify: `server/internal/service/workflow_split.go`
- Modify: `server/internal/service/workflow_split_test.go`
- Modify: `server/internal/handler/workflow_split.go`
- Modify: `server/internal/handler/workflow_split_test.go`

**Interfaces:**
- Produces: `SplitAPIError{Code string, Status SplitErrorStatus, Err error}`；`splitAPIErrorResponse(error) (httpStatus int, code string)`。
- Error codes: `draft_task_conflict`、`split_config_conflict`、`split_task_limit_exceeded`、`invalid_split_task_workflow`、`invalid_split_task_dependency`。

- [ ] **Step 1: 写空草案 submit 测试**

```go
func TestSubmitSplitDraftTasksAllowsEmptyPlan(t *testing.T) {
	f := createSplitGenerateFixture(t, "barrier")
	taskID := startSplitGenerationTask(t, f)
	req := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/draft-submit", nil)
	req.Header.Set("X-Agent-ID", f.agentID)
	req.Header.Set("X-Task-ID", taskID)
	req = withURLParam(req, "nodeRunId", f.splitNodeRunID)
	w := httptest.NewRecorder()

	testHandler.SubmitSplitDraftTasks(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", w.Code, w.Body.String())
	}
	nodeRun, err := testHandler.Queries.GetWorkflowNodeRun(context.Background(), parseUUID(f.splitNodeRunID))
	if err != nil || nodeRun.Status != service.NodeRunStatusAwaitingSplitReview {
		t.Fatalf("node run = %+v, err = %v", nodeRun, err)
	}
}
```

- [ ] **Step 2: 写 approve 错误映射测试表**

```go
func TestSplitAPIErrorStatus(t *testing.T) {
	tests := []struct {
		err    error
		status int
		code   string
	}{
		{service.NewSplitAPIError(service.SplitErrorConflict, "draft_task_conflict", errors.New("version changed")), 409, "draft_task_conflict"},
		{service.NewSplitAPIError(service.SplitErrorUnprocessable, "invalid_split_task_workflow", errors.New("inactive")), 422, "invalid_split_task_workflow"},
		{service.NewSplitAPIError(service.SplitErrorUnprocessable, "split_task_limit_exceeded", errors.New("too many")), 422, "split_task_limit_exceeded"},
	}
	for _, tt := range tests {
		status, code := splitAPIErrorResponse(tt.err)
		if status != tt.status || code != tt.code {
			t.Fatalf("got %d/%q, want %d/%q", status, code, tt.status, tt.code)
		}
	}
}
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd server && go test ./internal/handler/ -run "TestSubmitSplitDraftTasksAllowsEmptyPlan|TestSplitAPIErrorStatus" -count=1`

Expected: 空 submit 返回 400；错误类型和 mapper 尚不存在。

- [ ] **Step 4: 允许空草案通过 graph 校验**

将 `validateDraftSplitTaskRows` 的尾部改为：

```go
if len(plans) == 0 {
	return nil
}
return validateSplitTaskGraph(plans)
```

保留 approve 的 `confirm_empty` 校验，确保 submit 允许空计划但创建动作仍需人工显式确认。

- [ ] **Step 5: 定义结构化 service error**

在 `workflow_split.go` 中加入：

```go
type SplitErrorStatus string

const (
	SplitErrorConflict      SplitErrorStatus = "conflict"
	SplitErrorUnprocessable SplitErrorStatus = "unprocessable"
)

type SplitAPIError struct {
	Status SplitErrorStatus
	Code   string
	Err    error
}

func (e *SplitAPIError) Error() string { return e.Err.Error() }
func (e *SplitAPIError) Unwrap() error { return e.Err }

func NewSplitAPIError(status SplitErrorStatus, code string, err error) error {
	return &SplitAPIError{Status: status, Code: code, Err: err}
}
```

在 `ApproveSplit`、`PatchSplitConfig` 和 draft update 的冲突/校验分支返回上述错误；不要再让 handler 通过 `strings.Contains` 判断版本冲突。

- [ ] **Step 6: 统一 handler JSON 错误映射**

```go
func splitAPIErrorResponse(err error) (int, string) {
	var splitErr *service.SplitAPIError
	if !errors.As(err, &splitErr) {
		return http.StatusBadRequest, "invalid_split_request"
	}
	switch splitErr.Status {
	case service.SplitErrorConflict:
		return http.StatusConflict, splitErr.Code
	case service.SplitErrorUnprocessable:
		return http.StatusUnprocessableEntity, splitErr.Code
	default:
		return http.StatusBadRequest, splitErr.Code
	}
}

func writeSplitAPIError(w http.ResponseWriter, err error) {
	status, code := splitAPIErrorResponse(err)
	writeJSON(w, status, map[string]any{"code": code, "error": err.Error()})
}
```

`ApproveSplitTasks`、`PatchSplitConfig`、`PatchSplitDraftTask`、`BatchPatchSplitDraftTasks` 和 `RetrySplitTask` 使用 `writeSplitAPIError`。保留未分类语法错误为 400。

- [ ] **Step 7: 运行 service 与 handler 测试**

Run:

```bash
cd server && go test ./internal/service/ -run "TestValidateDraft|TestResolveSplit" -count=1
cd server && go test ./internal/handler/ -run "Test(Submit|Approve|Patch|Retry)Split" -count=1
```

Expected: 全部 PASS；版本冲突为 409，workflow/limit/dependency 校验为 422。

- [ ] **Step 8: Commit**

```bash
git add server/internal/service/workflow_split.go server/internal/service/workflow_split_test.go server/internal/handler/workflow_split.go server/internal/handler/workflow_split_test.go
git commit -m "fix(workflow): stabilize split validation errors"
```

---

### Task 4: 实现 Child Workflow Dispatch Key 幂等

**Files:**
- Modify: `server/pkg/db/queries/workflow_split_task.sql`
- Modify: `server/internal/service/workflow.go`
- Modify: `server/internal/service/workflow_split.go`
- Modify: `server/internal/service/workflow_split_test.go`
- Modify: `server/internal/handler/workflow_split_test.go`
- Regenerate: `server/pkg/db/generated/`

**Interfaces:**
- Produces: `StartRunForIssueWithDispatchKey(..., dispatchKey string)`；`splitTaskDispatchKey(task) string`，格式 `split-task:<id>:attempt:<version>`。
- Invariant: 同一个 split task version 重试调度时返回同一个 workflow run；`version` 递增后产生新 run。

- [ ] **Step 1: 写 dispatch key 单元测试**

```go
func TestSplitTaskDispatchKeyUsesTaskVersionAsAttempt(t *testing.T) {
	task := db.MulticaWorkflowSplitTask{
		ID:      pgtype.UUID{Bytes: [16]byte{1}, Valid: true},
		Version: 3,
	}
	got := splitTaskDispatchKey(task)
	want := "split-task:01000000-0000-0000-0000-000000000000:attempt:3"
	if got != want {
		t.Fatalf("dispatch key = %q, want %q", got, want)
	}
}
```

增加 handler 集成测试：对已创建 child task 连续调用两次 schedule，断言 `run_id` 相同且 `multica_workflow_run.dispatch_key` 等于 task dispatch key；retry 后 version 增 1 且新 run id 不同。

- [ ] **Step 2: 运行测试确认 helper 和行为缺失**

Run: `cd server && go test ./internal/service/ ./internal/handler/ -run "TestSplitTaskDispatchKey|TestRetrySplitTaskCreatesNewDispatchAttempt" -count=1`

Expected: helper 不存在或 workflow run 的 dispatch key 为空。

- [ ] **Step 3: 调整 claim/finalize SQL**

```sql
-- name: ClaimSplitTaskForRunStart :one
UPDATE multica_workflow_split_task
SET dispatch_key = $2,
    updated_at = now()
WHERE id = $1
  AND status = 'created'
  AND run_id IS NULL
  AND dispatch_key IS NULL
RETURNING *;

-- name: UpdateSplitTaskRunIDWithDispatchKey :exec
UPDATE multica_workflow_split_task
SET run_id = $2,
    status = 'running',
    updated_at = now()
WHERE id = $1
  AND dispatch_key = $3
  AND run_id IS NULL;
```

Run: `make sqlc`

Expected: `ClaimSplitTaskForRunStartParams` 包含 `DispatchKey string`。

- [ ] **Step 4: 为 WorkflowService 增加幂等创建入口**

将 `StartRun` 的事务体抽为私有 `startRun(ctx, workflow, ..., dispatchKey string)`：dispatch key 为空时调用 `CreateWorkflowRun`；非空时调用 `CreateWorkflowRunWithDispatchKey`。如果 upsert 返回已有 run，先 `ListWorkflowNodeRunsByRun`；已有 node runs 时直接返回，不重复创建。

公开 wrapper：

```go
func (s *WorkflowService) StartRunForIssueWithDispatchKey(
	ctx context.Context,
	workflow db.MulticaWorkflow,
	issue db.MulticaIssue,
	triggeredByType string,
	triggeredByID string,
	runtimeID pgtype.UUID,
	dispatchKey string,
) (*db.MulticaWorkflowRun, []db.MulticaWorkflowNodeRun, error) {
	input, err := json.Marshal(map[string]any{
		"title": issue.Title,
		"description": textToString(issue.Description),
	})
	if err != nil {
		return nil, nil, fmt.Errorf("marshal issue input: %w", err)
	}
	run, err := s.startRun(ctx, workflow, triggeredByType, triggeredByID, input, runtimeID, dispatchKey)
	if err != nil {
		return nil, nil, err
	}
	nodeRuns, err := s.Queries.ListWorkflowNodeRunsByRun(ctx, run.ID)
	if err != nil {
		return nil, nil, fmt.Errorf("list node runs: %w", err)
	}
	return run, nodeRuns, nil
}
```

- [ ] **Step 5: 在线程调度中贯穿 dispatch key**

```go
func splitTaskDispatchKey(task db.MulticaWorkflowSplitTask) string {
	return fmt.Sprintf("split-task:%s:attempt:%d", util.UUIDToString(task.ID), task.Version)
}
```

`ScheduleReadyTasks` claim 时传入 key；`startChildTaskRun` 使用 `StartRunForIssueWithDispatchKey`，末尾改用：

```go
return s.Queries.UpdateSplitTaskRunIDWithDispatchKey(ctx, db.UpdateSplitTaskRunIDWithDispatchKeyParams{
	ID:          task.ID,
	RunID:       run.ID,
	DispatchKey: splitTaskDispatchKey(task),
})
```

`ResetSplitTaskForRetry` 继续清空旧 key 并递增 version，新 attempt 自动得到新 key。

- [ ] **Step 6: 运行幂等与重试测试**

Run:

```bash
cd server && go test ./internal/service/ -run "TestSplitTaskDispatchKey" -count=1
cd server && go test ./internal/handler/ -run "Test(ApproveSplitTasks|RetrySplitTask)" -count=1
```

Expected: 全部 PASS；重复 schedule 不创建第二个 workflow run。

- [ ] **Step 7: Commit**

```bash
git add server/pkg/db/queries/workflow_split_task.sql server/pkg/db/generated server/internal/service/workflow.go server/internal/service/workflow_split.go server/internal/service/workflow_split_test.go server/internal/handler/workflow_split_test.go
git commit -m "fix(workflow): make split child dispatch idempotent"
```

---

### Task 5: 完整限制 Split Phase 副作用并保护父 Issue

**Files:**
- Modify: `server/internal/handler/handler.go`
- Modify: `server/internal/handler/issue.go`
- Modify: `server/internal/handler/workflow_split_test.go`
- Modify: `server/internal/handler/issue_batch_test.go`
- Modify: `server/pkg/db/queries/workflow_node_run.sql`
- Regenerate: `server/pkg/db/generated/`

**Interfaces:**
- Produces: `runningSplitPhaseTask(r) (db.MulticaAgentTaskQueue, bool)`，只信任 running task 且验证 `X-Agent-ID` 与 task agent 一致。
- Produces: `HasActiveSplitNodeRunForIssue(issueID, workspaceID) bool` 查询，覆盖 `splitting`、`awaiting_split_review`、`split_active`。

- [ ] **Step 1: 写 split phase 表驱动识别测试**

覆盖 context：`split_generate`、`split_repair`、`split_chat` 以及兼容现有 dispatcher 的 `phase=split, repair=true/false`；覆盖 queued/completed task、agent header 不匹配和普通 worker。三个正式 phase 的 running task 返回 true，其余返回 false。

```go
func TestRunningSplitPhaseTaskRecognizesAllSplitPhases(t *testing.T) {
	for _, phase := range []string{"split_generate", "split_repair", "split_chat"} {
		t.Run(phase, func(t *testing.T) {
			f := createSplitGenerateFixture(t, "barrier")
			taskID := createRunningWorkflowTask(t, f.agentID, f.splitNodeRunID, map[string]any{
				"type": "workflow", "phase": phase,
			})
			req := newRequest("POST", "/api/issues", nil)
			req.Header.Set("X-Agent-ID", f.agentID)
			req.Header.Set("X-Task-ID", taskID)
			if _, ok := testHandler.runningSplitPhaseTask(req); !ok {
				t.Fatalf("phase %q was not recognized", phase)
			}
		})
	}
}
```

- [ ] **Step 2: 写所有 issue 写入口拒绝测试**

用同一 running `split_chat` task 分别调用 `CreateIssue`、`UpdateIssue`、`BatchUpdateIssues`、`BatchDeleteIssues`，断言均为 403 且数据库无变化。现有单条 create/update 测试保留并扩展 repair/chat phase。

- [ ] **Step 3: 写父 issue 删除保护测试**

```go
func TestDeleteIssueRejectsParentWithActiveSplit(t *testing.T) {
	f := createSplitApproveFixture(t, "barrier")
	req := newRequest("DELETE", "/api/issues/"+f.parentIssueID, nil)
	req = withURLParam(req, "id", f.parentIssueID)
	w := httptest.NewRecorder()

	testHandler.DeleteIssue(w, req)

	if w.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409: %s", w.Code, w.Body.String())
	}
}
```

- [ ] **Step 4: 运行测试确认覆盖缺口**

Run: `cd server && go test ./internal/handler/ -run "Test(RunningSplitPhase|SplitPhaseTaskCannot|DeleteIssueRejectsParentWithActiveSplit)" -count=1`

Expected: 新 phase、batch 写入口和父删除测试失败。

- [ ] **Step 5: 实现可信 split phase 识别**

```go
func (h *Handler) runningSplitPhaseTask(r *http.Request) (db.MulticaAgentTaskQueue, bool) {
	taskID, err := util.ParseUUID(r.Header.Get("X-Task-ID"))
	if err != nil {
		return db.MulticaAgentTaskQueue{}, false
	}
	agentID, err := util.ParseUUID(r.Header.Get("X-Agent-ID"))
	if err != nil {
		return db.MulticaAgentTaskQueue{}, false
	}
	task, err := h.Queries.GetAgentTask(r.Context(), taskID)
	if err != nil || task.Status != "running" || task.AgentID != agentID {
		return db.MulticaAgentTaskQueue{}, false
	}
	var payload struct {
		Type   string `json:"type"`
		Phase  string `json:"phase"`
		Repair bool   `json:"repair"`
	}
	if json.Unmarshal(task.Context, &payload) != nil || payload.Type != "workflow" {
		return db.MulticaAgentTaskQueue{}, false
	}
	switch payload.Phase {
	case "split_generate", "split_repair", "split_chat":
		return task, true
	case "split":
		return task, true
	default:
		return db.MulticaAgentTaskQueue{}, false
	}
}
```

所有单条和 batch issue 写 handler 在解析请求后、产生副作用前调用此 helper，并统一返回 `403 split phase tasks cannot mutate issues`。

- [ ] **Step 6: 添加活跃 split 查询与删除门禁**

SQL：

```sql
-- name: HasActiveSplitNodeRunForIssue :one
SELECT EXISTS (
  SELECT 1
  FROM multica_workflow_run wr
  JOIN multica_workflow_node_run wnr ON wnr.workflow_run_id = wr.id
  JOIN multica_workflow_node wn ON wn.id = wnr.workflow_node_id
  WHERE wr.workspace_id = $2
    AND (wr.input ->> 'issue_id' = $1::text OR EXISTS (
      SELECT 1 FROM multica_issue origin_issue
      WHERE origin_issue.id = $1
        AND origin_issue.workflow_run_id = wr.id
    ))
    AND wn.format_schema ->> 'type' = 'split'
    AND wnr.status IN ('splitting', 'awaiting_split_review', 'split_active')
) AS active;
```

若当前 workflow run input 没有 `issue_id`，在执行前先调整 `StartRunForIssue` input 加入 `issue_id`；测试固定该 contract。`DeleteIssue` 和 `BatchDeleteIssues` 对每个 root target 先调用查询，命中时返回 409，且不得开始取消 task 或删除 descendants。

Run: `make sqlc`

- [ ] **Step 7: 运行 handler 回归测试**

Run:

```bash
cd server && go test ./internal/handler/ -run "Test(SplitPhase|DeleteIssue|BatchDeleteIssues|BatchUpdateIssues)" -count=1
```

Expected: 全部 PASS；评论和附件 handler 测试不受影响。

- [ ] **Step 8: Commit**

```bash
git add server/internal/handler/handler.go server/internal/handler/issue.go server/internal/handler/workflow_split_test.go server/internal/handler/issue_batch_test.go server/pkg/db/queries/workflow_node_run.sql server/pkg/db/generated server/internal/service/workflow.go
git commit -m "fix(handler): block split phase issue side effects"
```

---

### Task 6: 修正 Cancel 与 Barrier 失败聚合

**Files:**
- Modify: `server/pkg/db/queries/workflow_split_task.sql`
- Modify: `server/internal/service/workflow_split.go`
- Modify: `server/internal/service/workflow_split_test.go`
- Modify: `server/internal/handler/workflow_split_test.go`
- Regenerate: `server/pkg/db/generated/`

**Interfaces:**
- Produces: 取消时未物化 draft/approved → `discarded`；已物化但未启动 → `skipped`；已运行或已有 issue → `cancelled`。
- Barrier failure count: `failed + cancelled`。

- [ ] **Step 1: 写状态聚合单元测试**

```go
func TestResolveSplitStatusCountsCancelledAsBarrierFailure(t *testing.T) {
	tasks := []splitTaskPlan{
		{ID: "a", Status: SplitTaskStatusDone},
		{ID: "b", Status: SplitTaskStatusCancelled},
	}
	if got := resolveSplitStatus(SplitModeBarrier, 0, tasks); got != NodeRunStatusFailed {
		t.Fatalf("status = %s, want failed", got)
	}
	if got := resolveSplitStatus(SplitModeBarrier, 1, tasks); got != NodeRunStatusCompleted {
		t.Fatalf("status = %s, want completed", got)
	}
}
```

增加 cancel 集成测试，构造 draft、created、running 三条，断言分别 discarded、skipped、cancelled。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd server && go test ./internal/service/ ./internal/handler/ -run "TestResolveSplitStatusCountsCancelled|TestCancelSplitNodeClassifiesTasks" -count=1`

Expected: cancelled 未计数；所有 open task 都变为 cancelled。

- [ ] **Step 3: 修改 barrier 聚合**

```go
case SplitTaskStatusFailed, SplitTaskStatusCancelled:
	failures++
case SplitTaskStatusDone, SplitTaskStatusSkipped, SplitTaskStatusDiscarded:
	continue
```

- [ ] **Step 4: 分类取消 SQL**

```sql
-- name: CancelOpenSplitTasksByNodeRun :exec
UPDATE multica_workflow_split_task
SET status = CASE
      WHEN issue_id IS NULL THEN 'discarded'
      WHEN run_id IS NULL THEN 'skipped'
      ELSE 'cancelled'
    END,
    updated_at = now()
WHERE node_run_id = $1
  AND status NOT IN ('done', 'failed', 'cancelled', 'skipped', 'discarded');
```

Run: `make sqlc`

- [ ] **Step 5: 运行 cancel 与聚合回归测试**

Run: `cd server && go test ./internal/service/ ./internal/handler/ -run "Test(ResolveSplitStatus|CancelSplitNode)" -count=1`

Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add server/pkg/db/queries/workflow_split_task.sql server/pkg/db/generated server/internal/service/workflow_split.go server/internal/service/workflow_split_test.go server/internal/handler/workflow_split_test.go
git commit -m "fix(workflow): classify split cancellation outcomes"
```

---

### Task 7: 发布完整 Split 生命周期事件

**Files:**
- Modify: `server/pkg/protocol/events.go`
- Modify: `server/internal/service/workflow_split.go`
- Modify: `server/internal/service/workflow_split_test.go`

**Interfaces:**
- Produces: 八个 `protocol.EventSplit*` 常量；`SplitLifecycleEventPayload`；`publishSplitEvent(...)`。
- Payload 固定字段: `workflow_node_run_id`、`workflow_run_id`、`agent_task_id`、`planner_agent_id`、`elapsed_ms`，事件特有字段以可选 JSON 字段补充。

- [ ] **Step 1: 写事件 payload 与顺序测试**

创建 `events.New()`，订阅八个 event type；执行 generate → draft add → submit → approve，断言事件至少按以下顺序出现：generation_dispatched、context_rendered、draft_added、draft_submitted、review_ready、child_issue_created、approved。另用无效 submit 触发 `draft_submit_failed`。

```go
func collectSplitEvents(bus *events.Bus) *[]events.Event {
	got := make([]events.Event, 0)
	for _, eventType := range []string{
		protocol.EventSplitGenerationDispatched,
		protocol.EventSplitContextRendered,
		protocol.EventSplitDraftAdded,
		protocol.EventSplitDraftSubmitFailed,
		protocol.EventSplitDraftSubmitted,
		protocol.EventSplitReviewReady,
		protocol.EventSplitApproved,
		protocol.EventSplitChildIssueCreated,
	} {
		bus.Subscribe(eventType, func(event events.Event) { got = append(got, event) })
	}
	return &got
}
```

- [ ] **Step 2: 运行测试确认零事件**

Run: `cd server && go test ./internal/service/ -run TestSplitLifecycleEvents -count=1`

Expected: event slice 为空。

- [ ] **Step 3: 添加 protocol 常量和 payload**

```go
const (
	EventSplitGenerationDispatched = "split_generation_dispatched"
	EventSplitContextRendered      = "split_context_rendered"
	EventSplitDraftAdded           = "split_draft_added"
	EventSplitDraftSubmitFailed    = "split_draft_submit_failed"
	EventSplitDraftSubmitted       = "split_draft_submitted"
	EventSplitReviewReady          = "split_review_ready"
	EventSplitApproved             = "split_approved"
	EventSplitChildIssueCreated    = "split_child_issue_created"
)
```

```go
type SplitLifecycleEventPayload struct {
	WorkflowNodeRunID string `json:"workflow_node_run_id"`
	WorkflowRunID     string `json:"workflow_run_id"`
	AgentTaskID       string `json:"agent_task_id,omitempty"`
	PlannerAgentID    string `json:"planner_agent_id,omitempty"`
	ElapsedMS         int64  `json:"elapsed_ms,omitempty"`
	SplitTaskID       string `json:"split_task_id,omitempty"`
	ChildIssueID      string `json:"child_issue_id,omitempty"`
	Error             string `json:"error,omitempty"`
}
```

- [ ] **Step 4: 实现统一 publish helper**

```go
func (s *SplitOrchestrator) publishSplitEvent(
	eventType string,
	run db.MulticaWorkflowRun,
	nodeRun db.MulticaWorkflowNodeRun,
	payload SplitLifecycleEventPayload,
) {
	if s.Bus == nil {
		return
	}
	payload.WorkflowNodeRunID = util.UUIDToString(nodeRun.ID)
	payload.WorkflowRunID = util.UUIDToString(nodeRun.WorkflowRunID)
	if payload.PlannerAgentID == "" && nodeRun.WorkerID.Valid {
		payload.PlannerAgentID = util.UUIDToString(nodeRun.WorkerID)
	}
	s.Bus.Publish(events.Event{
		Type:        eventType,
		WorkspaceID: util.UUIDToString(run.WorkspaceID),
		ActorType:   "system",
		Payload:     payload,
	})
}
```

- [ ] **Step 5: 在事务成功边界发布事件**

事件必须在对应 DB 操作成功后发布：dispatch/context 在 agent task 创建并 link 后；draft_added 在 upsert transaction commit 后逐条发布；submit_failed 在 submit 返回错误前；submitted/review_ready 在状态 transition 成功后；child_issue_created 在 approve transaction commit 后按 child 列表发布；approved 在全部 materialize 完成后发布。不得在事务内 Publish，以免回滚后留下虚假事件。

- [ ] **Step 6: 运行事件与 split 主流程测试**

Run:

```bash
cd server && go test ./internal/service/ -run "TestSplitLifecycleEvents|TestSplit" -count=1
cd server && go test ./internal/handler/ -run "Test(Generate|Submit|Approve)Split" -count=1
```

Expected: 全部 PASS；每个事件 payload 含 node run 和 workflow run id。

- [ ] **Step 7: Commit**

```bash
git add server/pkg/protocol/events.go server/internal/service/workflow_split.go server/internal/service/workflow_split_test.go
git commit -m "feat(workflow): publish split lifecycle events"
```

---

### Task 8: 完成 Split Preflight 检查与 Check ID 语义

**Files:**
- Modify: `packages/core/workflows/preflight-checks.ts`
- Modify: `packages/core/workflows/preflight-checks.test.ts`

**Interfaces:**
- Produces check IDs: `split-planner-missing`、`split-planner-not-specialized`、`split-default-issue-workflow-invalid`、`split-max-concurrency-invalid`。
- `max_concurrency` 合法范围: integer `1..50`，与 approve 单次 task 上限一致。

- [ ] **Step 1: 写四类失败测试**

```ts
it("uses split-specific planner check ids", () => {
  const split = makeNode({
    worker_id: null,
    format_schema: { type: "split", split_config: validSplitConfig },
  });
  expect(checkWorkerMissing([split])[0]?.checkId).toBe("split-planner-missing");
  const custom = { ...split, worker_type: "agent", worker_id: "custom" };
  expect(checkSplitWorkerSpecialized([custom], new Set())[0]?.checkId)
    .toBe("split-planner-not-specialized");
});

it("rejects unknown child workflow ids", () => {
  const issues = checkSplitChildWorkflowConfig([makeSplitNode("missing-wf")], []);
  expect(issues).toContainEqual(expect.objectContaining({
    checkId: "split-default-issue-workflow-invalid",
    blocking: true,
  }));
});

it.each([0, -1, 1.5, 51])("rejects max_concurrency=%s", (value) => {
  const issues = checkSplitMaxConcurrency([makeSplitNode("wf-2", value)]);
  expect(issues[0]?.checkId).toBe("split-max-concurrency-invalid");
});
```

- [ ] **Step 2: 运行测试确认缺失/命名不符**

Run: `pnpm --filter @multica/core exec vitest run workflows/preflight-checks.test.ts`

Expected: 新 check IDs 不在 union，unknown workflow 未报错，concurrency helper 不存在。

- [ ] **Step 3: 更新 ID union 和现有 emit**

将 `worker-missing` 保留给普通 node；split node emit `split-planner-missing`。将 `split-worker-non-specialized` 重命名为 `split-planner-not-specialized`，同步所有测试和 UI key 使用。

- [ ] **Step 4: 实现 invalid workflow 与 concurrency 检查**

在 `checkSplitChildWorkflowConfig` 中，当 ID 非空、非 self 且 map 中不存在时加入：

```ts
issues.push({
  checkId: "split-default-issue-workflow-invalid",
  severity: "error",
  blocking: true,
  nodeId: node.id,
  nodeTitle: node.title,
  message: "Split default issue workflow is unavailable",
});
```

新增：

```ts
export function checkSplitMaxConcurrency(nodes: WorkflowNode[]): PreflightIssue[] {
  return nodes.flatMap((node) => {
    const format = parseNodeFormat(node.format_schema);
    if (format.kind !== "split") return [];
    const value = format.split_config?.max_concurrency;
    if (Number.isInteger(value) && value! >= 1 && value! <= 50) return [];
    return [{
      checkId: "split-max-concurrency-invalid" as const,
      severity: "error" as const,
      blocking: true,
      nodeId: node.id,
      nodeTitle: node.title,
      message: "Split concurrency must be an integer from 1 to 50",
    }];
  });
}
```

在 `runAllPreflightChecks` 中加入 `...checkSplitMaxConcurrency(nodes)`。

- [ ] **Step 5: 运行 core 测试与类型检查**

Run:

```bash
pnpm --filter @multica/core exec vitest run workflows/preflight-checks.test.ts
pnpm --filter @multica/core typecheck
```

Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/core/workflows/preflight-checks.ts packages/core/workflows/preflight-checks.test.ts
git commit -m "fix(core): complete split workflow preflight checks"
```

---

### Task 9: 对齐 Split 节点配置面板

**Files:**
- Modify: `packages/views/workflows/components/node-config-panel.tsx`
- Modify: `packages/views/workflows/components/node-config-panel.test.tsx`
- Modify: `packages/views/workflows/components/overview/workflow-panorama-page.tsx`
- Modify: `packages/views/locales/en/workflows.json`
- Modify: `packages/views/locales/zh/workflows.json`

**Interfaces:**
- Consumes: 当前 workflow panorama 已有 `onTestRun`/`useStartWorkflowRun` 行为、`runAllPreflightChecks` 输出。
- Produces: `NodeConfigPanel` props `preflightIssues?: PreflightIssue[]`、`incomingCount?: number`、`outgoingCount?: number`、`onTrialRun?: () => void`。

- [ ] **Step 1: 写面板顺序和内容测试**

渲染 split node 后断言 section test ids 顺序为 `readiness`、`primary`、`worker-critic`、`split-behavior`、`connections`、`actions`；传入一个 warning 后 readiness 显示该 warning；connection summary 显示 `2 upstream / 1 downstream`；Actions 中存在 `Trial run`。

```ts
const sectionIds = screen.getAllByTestId(/node-detail-section-/).map((node) => node.dataset.sectionId);
expect(sectionIds).toEqual([
  "readiness",
  "primary",
  "worker-critic",
  "split-behavior",
  "connections",
  "actions",
]);
```

- [ ] **Step 2: 运行测试确认当前顺序与控件缺失**

Run: `pnpm --filter @multica/views exec vitest run workflows/components/node-config-panel.test.tsx`

Expected: 当前 `split-behavior` 位于 worker/critic 前，connections 和 Trial run 缺失。

- [ ] **Step 3: 扩展 props 并调整 section 顺序**

```ts
interface NodeConfigPanelProps {
  // existing props stay unchanged
  preflightIssues?: PreflightIssue[];
  incomingCount?: number;
  outgoingCount?: number;
  onTrialRun?: () => void;
}
```

只对 `isSplit` 渲染 connection summary：

```tsx
<NodeDetailSection
  sectionId="connections"
  icon={<GitFork className="size-4" />}
  title={t(($) => $.detail_panel.section_connections)}
  subtitle={t(($) => $.detail_panel.section_connections_desc)}
>
  <div className="grid grid-cols-2 gap-2 text-xs">
    <div className="rounded-md border bg-muted/20 p-2">
      {t(($) => $.detail_panel.connection_upstream_count, { count: incomingCount })}
    </div>
    <div className="rounded-md border bg-muted/20 p-2">
      {t(($) => $.detail_panel.connection_downstream_count, { count: outgoingCount })}
    </div>
  </div>
</NodeDetailSection>
```

readiness 渲染传入的全部 blocking 和 warning issues，不在 panel 内重复运行 preflight。

- [ ] **Step 4: 接入 panorama 已有 test-run 行为**

由 `workflow-panorama-page.tsx` 计算选中 node 的 incoming/outgoing edge count 和 `preflightResult.issues.filter(issue => issue.nodeId === selectedNode.id)`，将现有 test-run callback 传为 `onTrialRun`。Action button：

```tsx
<Button type="button" variant="outline" onClick={onTrialRun} disabled={disabled || !onTrialRun}>
  <Play className="size-4" />
  {t(($) => $.detail_panel.trial_run)}
</Button>
```

- [ ] **Step 5: 更新英文和中文文案**

至少加入 `connection_upstream_count`、`connection_downstream_count`、`trial_run`，并将英文 `split_failure_tolerance_label` 改为 `Failure policy`，中文保持“失败策略”。

- [ ] **Step 6: 运行 views 测试**

Run:

```bash
pnpm --filter @multica/views exec vitest run workflows/components/node-config-panel.test.tsx workflows/components/split/split-config-panel.test.tsx workflows/components/overview/workflow-panorama-page.test.tsx
pnpm --filter @multica/views typecheck
```

Expected: 全部 PASS。

- [ ] **Step 7: Commit**

```bash
git add packages/views/workflows/components/node-config-panel.tsx packages/views/workflows/components/node-config-panel.test.tsx packages/views/workflows/components/overview/workflow-panorama-page.tsx packages/views/locales/en/workflows.json packages/views/locales/zh/workflows.json
git commit -m "fix(views): complete split node configuration panel"
```

---

### Task 10: 完成 Split 审核面板状态与草案可追溯性

**Files:**
- Modify: `packages/views/workflows/components/split/split-review-panel.tsx`
- Modify: `packages/views/workflows/components/split/split-review-panel.test.tsx`
- Modify: `packages/views/workflows/components/split/split-draft-ledger.tsx`
- Modify: `packages/views/workflows/components/split/split-draft-ledger.test.tsx`
- Modify: `packages/views/workflows/components/split/split-dependency-note.tsx`
- Modify: `packages/views/workflows/components/split/split-dependency-note.test.tsx`
- Modify: `packages/views/locales/en/workflows.json`
- Modify: `packages/views/locales/zh/workflows.json`

**Interfaces:**
- Consumes: `WorkflowNodeRun.started_at`、worker label、`SplitTask.version/draft_source`、`SplitProgress`。
- Produces: `useElapsedSeconds(startedAt, active)`；60 秒慢生成提示；取消影响数；completed summary。

- [ ] **Step 1: 写生成态 fake-timer 测试**

```ts
it("shows planner, elapsed time, and the slow-generation message after 60 seconds", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-19T00:01:01Z"));
  renderPanel({
    nodeRun: { ...baseNodeRun, status: "splitting", started_at: "2026-07-19T00:00:00Z" },
    plannerName: "Split Planner Code",
  });
  expect(screen.getByText("Split Planner Code")).toBeInTheDocument();
  expect(screen.getByText("1:01")).toBeInTheDocument();
  expect(screen.getByText("Planner is still generating drafts")).toBeInTheDocument();
  vi.useRealTimers();
});
```

- [ ] **Step 2: 写 ledger、dependency、cancel 和 completed 测试**

断言 recovered task 显示 `Recovered`、每行显示 `v7`；dependency 容器包含 `font-mono`；取消 dialog 以 active child 数渲染 `3 child tasks will be cancelled`；completed 状态显示总数、done/failed/cancelled 聚合和 child issue 列表。

- [ ] **Step 3: 运行测试确认 UI 缺失**

Run:

```bash
pnpm --filter @multica/views exec vitest run workflows/components/split/split-review-panel.test.tsx workflows/components/split/split-draft-ledger.test.tsx workflows/components/split/split-dependency-note.test.tsx
```

Expected: 新断言失败。

- [ ] **Step 4: 实现 elapsed hook 与 splitting state**

```ts
function useElapsedSeconds(startedAt: string | null | undefined, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || !startedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active, startedAt]);
  if (!startedAt) return 0;
  return Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1_000));
}
```

生成态展示 planner、格式化 elapsed；`elapsedSeconds >= 60` 时显示慢生成提示。计时器只在 splitting 或 chat pending 时启用。

- [ ] **Step 5: 渲染 draft provenance、version 与 monospace 依赖图**

在 ledger row metadata 添加：

```tsx
<span className="text-[11px] text-muted-foreground">v{task.version}</span>
{task.draft_source === "recovered" ? (
  <Badge variant="outline">{t(($) => $.detail_panel.split_draft_recovered)}</Badge>
) : null}
```

`SplitDependencyNote` 的文本图容器加入 `font-mono`，可访问 label 列表保持普通字体。

- [ ] **Step 6: 完成取消与 completed 状态**

```ts
const affectedTaskCount = tasks.filter((task) =>
  !["done", "failed", "cancelled", "skipped", "discarded"].includes(task.status),
).length;
```

dialog 描述使用 count 插值。completed 不复用通用 verdict 空壳，渲染 `SplitProgressBadge`、总数、done/failed/cancelled 三项和现有 child issue rows。

- [ ] **Step 7: 更新 locale 并运行 views 验证**

新增中英文 key：`split_planner_label`、`split_elapsed`、`split_generation_slow`、`split_draft_recovered`、`split_cancel_affected_count`、`split_completed_summary`。

Run:

```bash
pnpm --filter @multica/views exec vitest run workflows/components/split
pnpm --filter @multica/views typecheck
```

Expected: 全部 PASS，无 fake timer 泄漏。

- [ ] **Step 8: Commit**

```bash
git add packages/views/workflows/components/split packages/views/locales/en/workflows.json packages/views/locales/zh/workflows.json
git commit -m "fix(views): complete split review lifecycle states"
```

---

### Task 11: 在 Runtime Split 收起态显示 Mode Badge

**Files:**
- Modify: `packages/views/issues/components/execution/runtime-node-card.tsx`
- Modify: `packages/views/issues/components/execution/runtime-node-card.test.tsx`

**Interfaces:**
- Consumes: `parseNodeFormat(node.format_schema).split_config.mode`。
- Produces: split runtime card 的 `Barrier` / `Pipeline` outline badge。

- [ ] **Step 1: 写 barrier/pipeline 表驱动测试**

```ts
it.each([
  ["barrier", "Barrier"],
  ["pipeline", "Pipeline"],
])("shows %s mode on collapsed split cards", (mode, label) => {
  renderRuntimeNodeCard({
    ...splitNode,
    format_schema: { type: "split", split_config: { ...splitConfig, mode } },
  });
  expect(screen.getByText(label)).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试确认 badge 缺失**

Run: `pnpm --filter @multica/views exec vitest run issues/components/execution/runtime-node-card.test.tsx`

Expected: 找不到 Barrier/Pipeline 文本。

- [ ] **Step 3: 实现 mode badge**

解析 node format，并在 split card 标题 metadata 行加入：

```tsx
{isSplit ? (
  <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
    {splitMode === "pipeline"
      ? t(($) => $.detail_panel.split_mode_pipeline)
      : t(($) => $.detail_panel.split_mode_barrier)}
  </Badge>
) : null}
```

保持现有 card 固定高度，不因 badge 改变节点尺寸；长标题继续 truncate。

- [ ] **Step 4: 运行 runtime card 和 panorama 测试**

Run:

```bash
pnpm --filter @multica/views exec vitest run issues/components/execution/runtime-node-card.test.tsx issues/components/execution/runtime-canvas-node.test.tsx issues/components/execution/execution-panorama-page.test.tsx
```

Expected: 全部 PASS，child cluster SVG edge 测试保持不变。

- [ ] **Step 5: Commit**

```bash
git add packages/views/issues/components/execution/runtime-node-card.tsx packages/views/issues/components/execution/runtime-node-card.test.tsx
git commit -m "fix(views): show split mode in runtime cards"
```

---

### Task 12: 全量验证与评审报告闭环

**Files:**
- Modify: `analysis-dynamic-task-splitting-review.md`

**Interfaces:**
- Consumes: Tasks 1-11 的 commit 与测试结果。
- Produces: 每个原始 finding 的最终状态表，状态只能是 `fixed`、`documented-decision`、`already-fixed-before-plan`。

- [ ] **Step 1: 更新评审报告状态附录**

在报告末尾添加：

```markdown
## 整改状态（2026-07-19）

| 原编号 | 状态 | 证据 |
|---|---|---|
| 1-6 | fixed | contract cleanup、events、副作用门禁及对应测试 |
| 7, 19, 24 | already-fixed-before-plan | pipeline/approve 现有回归测试；本轮补充空 submit |
| 8, 14-17, 20-23 | fixed | dispatch、事务、错误映射、取消和删除保护测试 |
| 9-10, 32-33 | fixed | preflight 单元测试 |
| 11, 13, 18, 29, 37-39 | documented-decision | 设计规范的数据模型/API/runtime edge 决策 |
| 25-28, 30-31, 34-36, 40-45 | fixed | shared views、schema 和 locale 测试 |
```

将报告顶部评级改为“历史快照”，避免读者误以为整改后的分支仍是 55-60%。

- [ ] **Step 2: 运行生成代码与格式检查**

Run:

```bash
make sqlc
gofmt -w server/internal/service/workflow.go server/internal/service/workflow_split.go server/internal/service/workflow_split_test.go server/internal/handler/handler.go server/internal/handler/issue.go server/internal/handler/workflow_run.go server/internal/handler/workflow_split.go server/internal/handler/workflow_split_test.go
pnpm lint
```

Expected: sqlc 无 diff；gofmt 完成；lint PASS。

- [ ] **Step 3: 运行完整验证**

Run: `make check`

Expected: TypeScript typecheck、Vitest、Go tests、E2E 全部 PASS。

- [ ] **Step 4: 检查工作树只包含计划内文件**

Run: `git status --short`

Expected: 仅显示 Tasks 1-12 列出的文件；不存在临时日志、测试数据库文件或构建产物。

- [ ] **Step 5: Commit 报告闭环**

```bash
git add analysis-dynamic-task-splitting-review.md
git commit -m "docs: close dynamic task splitting review findings"
```

