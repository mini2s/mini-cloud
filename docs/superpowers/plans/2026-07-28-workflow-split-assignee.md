# Workflow Split Assignee Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让拆分规划器只生成子 issue 草稿，由拆分节点的人工审核者逐项选择成员、数智人、团队或 workflow，批准后通过普通 issue 分配链路按依赖和并发限制执行。

**Architecture:** `SplitOrchestrator` 继续拥有拆分草稿、拓扑调度和父节点释放语义；新增统一的 `IssueAssignmentService`，让普通 issue handler 与拆分调度复用同一套执行者校验和分配副作用。PostgreSQL 保存草稿计划执行者和乐观锁版本，React Query 保存审核态服务端数据；旧 `run_id` 任务保留窄兼容分支，新任务完全以子 issue 状态为准。

**Tech Stack:** Go 1.26.1、Chi、pgx/sqlc、PostgreSQL 17、TypeScript strict、Zod、TanStack Query、React 19、Vitest、Testing Library。

## Global Constraints

- 执行者类型只能是 `member`、`agent`、`squad` 或 `workflow`。
- 拆分节点审核者只允许直接成员，或最终解析为成员的角色；不得配置数智人、团队或 API 审核者。
- `SplitConfig` 只保留 `mode`、`max_concurrency` 和 `max_failures`；新代码忽略历史 `default_issue_workflow_id`。
- 拆分生成 API 与 CLI 不接受 `assignee_type` 或 `assignee_id`；只有人工审核更新接口可以写入执行者。
- 每个未丢弃草稿必须同时具有合法的 `assignee_type` 与 `assignee_id` 才能批准。
- 只有节点直接配置的审核者，或本次 workflow run 中审核角色解析出的实际成员，可以修改、丢弃和批准草稿。
- 批准中的执行者复验、草稿状态更新和子 issue 创建必须位于同一事务，任一步失败整体回滚。
- 无未完成依赖且有并发名额的子 issue 立即写入计划执行者；其余子 issue 先保持未分配，计划执行者只保存在 split task。
- 新拆分任务不得写入旧 `workflow_id`、`run_id` 或 `dispatch_key`；仅 `run_id IS NOT NULL` 的历史任务继续走旧 child workflow 终态逻辑。
- API 响应必须通过 Zod `parseWithFallback`；新增响应字段必须覆盖缺失、错误类型和 `null` 数组。
- `packages/core/` 不引入 react-dom、localStorage、process.env 或 UI 库；`packages/views/` 不引入 `next/*` 或 `react-router-dom`。
- 产品文案同时更新 `packages/views/locales/en/workflows.json` 与 `packages/views/locales/zh-Hans/workflows.json`；代码注释只使用英文。
- 不修改已发布 migration；使用新的 `146_workflow_split_assignee` migration 并运行 `make sqlc`。
- 只运行本计划列出的相关模块测试，不执行 `make check`、`pnpm test` 或 `make test` 全量测试。

## File Structure

- `server/migrations/146_workflow_split_assignee.{up,down}.sql`：增加计划执行者字段、约束和未批准历史草稿迁移。
- `server/pkg/db/queries/workflow_split_task.sql`：创建空执行者草稿、CAS 更新执行者、幂等 claim/状态同步。
- `server/pkg/db/queries/issue.sql`：以未分配条件原子写入计划执行者，并按 issue 终态查找 split task。
- `server/internal/service/issue_assignment.go`：普通 issue 与 split 共用的执行者校验、写入和提交后执行副作用。
- `server/internal/service/workflow_split.go`：审核者授权、批准事务、依赖/并发调度、issue 状态同步和旧任务兼容。
- `server/internal/handler/workflow.go`：拆分节点审核者的创建/更新边界校验。
- `server/internal/handler/workflow_split.go`：审核写接口的身份解析、422/403/409 映射和响应字段。
- `server/internal/handler/handler.go`、`server/internal/handler/issue.go`：装配统一分配服务，并把子 issue 状态变化送入 split orchestrator。
- `packages/core/types/workflow.ts`、`packages/core/api/schemas.ts`、`packages/core/api/client.ts`、`packages/core/workflows/queries.ts`：跨端 split assignee contract 与缓存刷新。
- `packages/core/workflows/preflight-checks.ts`：删除默认 workflow 检查，增加人工审核者检查。
- `packages/views/workflows/components/node-config-panel.tsx`、`split/split-config-panel.tsx`：移除默认 workflow，限制审核者配置。
- `packages/views/workflows/components/split/split-review-panel.tsx`、`split-draft-ledger.tsx`：逐项执行者选择、只读权限和批准阻断。
- `packages/views/locales/{en,zh-Hans}/workflows.json`：配置、审核、错误和运行结果文案。

---

### Task 1: 扩展 Split Task 数据契约并迁移历史草稿

**Files:**
- Create: `server/migrations/146_workflow_split_assignee.up.sql`
- Create: `server/migrations/146_workflow_split_assignee.down.sql`
- Modify: `server/pkg/db/queries/workflow_split_task.sql`
- Modify: `server/pkg/db/queries/issue.sql`
- Modify: `server/internal/handler/workflow_split.go`
- Modify: `server/internal/handler/workflow_split_test.go`
- Regenerate: `server/pkg/db/generated/`

**Interfaces:**
- Consumes: `multica_workflow_split_task.version`、历史 `workflow_id/run_id`、`UpdateSplitTaskDraftFields` CAS。
- Produces: `assignee_type TEXT NULL`、`assignee_id UUID NULL`；`SetSplitTaskAssignee(id, node_run_id, version, assignee_type, assignee_id)`；`AssignSplitChildIssueIfUnassigned(id, assignee_type, assignee_id)`。

- [ ] **Step 1: 写 migration 与 query 的失败集成测试**

在 `server/internal/handler/workflow_split_test.go` 增加：

```go
func TestSplitTaskAssigneeMigrationAndCAS(t *testing.T) {
	f := createSplitApproveFixture(t, "barrier")
	taskID := parseUUID(f.taskAID)

	updated, err := testHandler.Queries.SetSplitTaskAssignee(context.Background(), db.SetSplitTaskAssigneeParams{
		ID: taskID, NodeRunID: parseUUID(f.splitNodeRunID), Version: 1,
		AssigneeType: pgtype.Text{String: "agent", Valid: true},
		AssigneeID: parseUUID(f.agentID),
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Version != 2 || updated.AssigneeType.String != "agent" || updated.AssigneeID != parseUUID(f.agentID) {
		t.Fatalf("updated split task = %+v", updated)
	}
	_, err = testHandler.Queries.SetSplitTaskAssignee(context.Background(), db.SetSplitTaskAssigneeParams{
		ID: taskID, NodeRunID: parseUUID(f.splitNodeRunID), Version: 1,
		AssigneeType: pgtype.Text{String: "member", Valid: true},
		AssigneeID: parseUUID(testUserID),
	})
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("stale update error = %v, want pgx.ErrNoRows", err)
	}
}
```

- [ ] **Step 2: 运行测试确认 sqlc 接口不存在**

Run: `cd server && go test ./internal/handler/ -run TestSplitTaskAssigneeMigrationAndCAS -count=1`

Expected: 编译失败，提示 `SetSplitTaskAssignee` 或对应字段未定义。

- [ ] **Step 3: 新增 migration**

`146_workflow_split_assignee.up.sql` 使用：

```sql
ALTER TABLE multica_workflow_split_task
  ADD COLUMN assignee_type TEXT,
  ADD COLUMN assignee_id UUID;

ALTER TABLE multica_workflow_split_task
  ALTER COLUMN workflow_id DROP NOT NULL;

UPDATE multica_workflow_split_task
SET assignee_type = 'workflow',
    assignee_id = workflow_id,
    workflow_id = NULL,
    updated_at = now()
WHERE status IN ('draft', 'discarded')
  AND issue_id IS NULL
  AND run_id IS NULL
  AND workflow_id IS NOT NULL;

ALTER TABLE multica_workflow_split_task
  ADD CONSTRAINT workflow_split_task_assignee_pair_check
    CHECK ((assignee_type IS NULL) = (assignee_id IS NULL)),
  ADD CONSTRAINT workflow_split_task_assignee_type_check
    CHECK (assignee_type IS NULL OR assignee_type IN ('member', 'agent', 'squad', 'workflow'));

CREATE INDEX idx_workflow_split_task_assignee
  ON multica_workflow_split_task(assignee_type, assignee_id)
  WHERE assignee_id IS NOT NULL;
```

`146_workflow_split_assignee.down.sql` 只做可逆结构回退，并明确不能恢复非 workflow 执行者语义：

```sql
UPDATE multica_workflow_split_task
SET workflow_id = assignee_id
WHERE workflow_id IS NULL AND assignee_type = 'workflow';

DROP INDEX IF EXISTS idx_workflow_split_task_assignee;
ALTER TABLE multica_workflow_split_task
  DROP CONSTRAINT IF EXISTS workflow_split_task_assignee_type_check,
  DROP CONSTRAINT IF EXISTS workflow_split_task_assignee_pair_check,
  DROP COLUMN IF EXISTS assignee_id,
  DROP COLUMN IF EXISTS assignee_type;
```

- [ ] **Step 4: 修改 sqlc queries**

从 `CreateSplitTask` 与 `UpsertSplitDraftTaskByKey` 的列和值中删除 `workflow_id`；upsert 冲突时不得覆盖已有人工执行者。新增：

```sql
-- name: SetSplitTaskAssignee :one
UPDATE multica_workflow_split_task
SET assignee_type = $4,
    assignee_id = $5,
    version = version + 1,
    updated_at = now()
WHERE id = $1
  AND node_run_id = $2
  AND version = $3
  AND status = 'draft'
RETURNING *;

-- name: AssignSplitChildIssueIfUnassigned :one
UPDATE multica_issue
SET assignee_type = $2,
    assignee_id = $3,
    updated_at = now()
WHERE id = $1
  AND assignee_type IS NULL
  AND assignee_id IS NULL
  AND status NOT IN ('done', 'cancelled')
RETURNING *;

-- name: GetSplitTaskByIssueID :one
SELECT * FROM multica_workflow_split_task
WHERE issue_id = $1;
```

将 `UpdateSplitTaskDraftFields` 的 `workflow_id` 参数删除；保留标题、描述、依赖、丢弃与 `version` CAS。

- [ ] **Step 5: 重新生成 sqlc 并更新 response**

Run: `make sqlc`

在 `SplitTaskResponse` 与 `splitTaskToResponse` 中加入：

```go
AssigneeType *string `json:"assignee_type"`
AssigneeID   *string `json:"assignee_id"`
```

```go
AssigneeType: textToPtr(task.AssigneeType),
AssigneeID:   uuidToPtr(task.AssigneeID),
```

保留 `workflow_id` 与 `run_id` 响应字段，供已运行旧任务展示；新任务二者为空。

- [ ] **Step 6: 运行相关数据库/response 测试**

Run:

```bash
cd server && go test ./internal/handler/ -run "TestSplitTaskAssigneeMigrationAndCAS|TestSplitTaskToResponse" -count=1
```

Expected: PASS；CAS 旧版本返回 `pgx.ErrNoRows`，response 同时携带 assignee 与历史运行字段。

- [ ] **Step 7: Commit**

```bash
git add server/migrations/146_workflow_split_assignee.* server/pkg/db/queries/workflow_split_task.sql server/pkg/db/queries/issue.sql server/pkg/db/generated server/internal/handler/workflow_split.go server/internal/handler/workflow_split_test.go
git commit -m "feat(workflow): store split task assignees"
```

---

### Task 2: 收敛 Split 配置与人工审核者规则

**Files:**
- Modify: `server/internal/handler/workflow.go`
- Modify: `server/internal/handler/workflow_node_member_status_test.go`
- Modify: `server/internal/service/workflow_split.go`
- Modify: `server/internal/service/workflow_split_test.go`
- Modify: `server/pkg/db/queries/workflow_node_run.sql`
- Regenerate: `server/pkg/db/generated/`
- Modify: `packages/core/types/workflow.ts`
- Modify: `packages/core/types/workflow.test.ts`
- Modify: `packages/core/workflows/preflight-checks.ts`
- Modify: `packages/core/workflows/preflight-checks.test.ts`

**Interfaces:**
- Consumes: `workflowmeta.KindOf(format_schema)`、`critic_id`、`critic_role_id`、`GetWorkflowRoleResolutionByNodeRunSlot(nodeRunID, "critic")`。
- Produces: `SplitConfig { mode, max_concurrency, max_failures }`；`validateSplitReviewerConfig(formatSchema []byte, criticType string, criticID, criticRoleID pgtype.UUID, criticAPIURL pgtype.Text) error`；`resolveSplitReviewer(ctx, nodeRun) (pgtype.UUID, error)`。

- [ ] **Step 1: 写后端审核者边界测试**

在 handler 测试中覆盖创建和更新：

```go
func TestCreateSplitNodeRejectsAutomatedCritic(t *testing.T) {
	req := createWorkflowNodeRequest(t, workflowID, map[string]any{
		"title": "Split", "format_schema": map[string]any{"type": "split"},
		"worker_type": "agent", "worker_id": plannerAgentID,
		"critic_type": "agent", "critic_id": reviewerAgentID,
	})
	w := httptest.NewRecorder()
	testHandler.CreateWorkflowNode(w, req)
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422: %s", w.Code, w.Body.String())
	}
}
```

再增加三个表驱动 case：`human + active user id` 成功、`human + critic_role_id` 成功、`api/squad` 返回 422；Update 使用同一组断言。

- [ ] **Step 2: 写 SplitConfig 与 preflight 失败测试**

```ts
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

it("blocks split nodes with automated reviewers", () => {
  const issues = runPreflight({
    nodes: [makeNode({ format_schema: { type: "split" }, critic_type: "agent", critic_id: "agent-1" })],
  });
  expect(issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ checkId: "split-reviewer-invalid", blocking: true }),
  ]));
});
```

- [ ] **Step 3: 运行测试确认旧默认 workflow 与自动审核者仍被接受**

Run:

```bash
cd server && go test ./internal/handler/ -run "Test(Create|Update)SplitNode" -count=1
pnpm --filter @multica/core exec vitest run types/workflow.test.ts workflows/preflight-checks.test.ts
```

Expected: Go 测试因缺少 split 专用校验失败；TypeScript 仍返回 `default_issue_workflow_id` 并执行旧 child workflow 检查。

- [ ] **Step 4: 实现后端节点配置校验**

在 `workflow.go` 增加并让 Create/Update 在写库前调用：

```go
func validateSplitReviewerConfig(formatSchema []byte, criticType string, criticID, criticRoleID pgtype.UUID, criticAPIURL pgtype.Text) error {
	if workflowmeta.KindOf(formatSchema) != "split" {
		return nil
	}
	if criticAPIURL.Valid || criticType != "human" || (criticID.Valid == criticRoleID.Valid) {
		return errors.New("split reviewer must be one workspace member or one member role")
	}
	return nil
}
```

Update 时用请求与 `currentNode` 合并出的最终 `format_schema/critic_type/critic_id/critic_role_id/critic_api_url` 校验，避免局部 PATCH 绕过规则；错误统一映射 422。直接成员继续走 `validateWorkflowHumanActor` 检查 active membership，角色继续走 `parseWorkflowRoleID` 检查同工作区。

- [ ] **Step 5: 简化后端和前端 SplitConfig**

Go：

```go
type SplitConfig struct {
	Mode           string `json:"mode"`
	MaxConcurrency int32  `json:"max_concurrency"`
	MaxFailures    int32  `json:"max_failures"`
}
```

删除 `parseSplitConfig` 的 `default_issue_workflow_id` 必填分支，并删除 Generate、materialize、Approve、Schedule、chat context 中所有基于 `cfg.DefaultIssueWorkflowID` 的 `validateIssueWorkflow` 调用。

TypeScript：

```ts
export interface SplitConfig {
  mode: SplitMode;
  max_concurrency: number;
  max_failures: number;
}
```

`parseNodeFormat` 不读取历史默认 workflow，`split_config_valid` 只验证 mode、并发数 1..50 和非负失败数。删除 `SplitIssueWorkflowPreflightContext`、`checkSplitChildWorkflowConfig` 及其 check IDs，新增 `checkSplitReviewer` 只接受：`critic_type === "human"` 且 `critic_id`、`critic_role_id` 恰有一个。

- [ ] **Step 6: 在运行时解析并验证实际审核者**

在 `workflow_split.go` 增加：

```go
var ErrSplitReviewerUnresolved = errors.New("split reviewer role did not resolve to an active workspace member")

func (s *SplitOrchestrator) resolveSplitReviewer(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) (pgtype.UUID, error) {
	if nodeRun.CriticType != "human" || !nodeRun.CriticID.Valid {
		return pgtype.UUID{}, ErrSplitReviewerUnresolved
	}
	run, err := s.Queries.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
	if err != nil { return pgtype.UUID{}, err }
	member, err := s.Queries.GetMemberByUserAndWorkspace(ctx, db.GetMemberByUserAndWorkspaceParams{
		UserID: nodeRun.CriticID, WorkspaceID: run.WorkspaceID,
	})
	if err != nil || member.Status != "active" {
		return pgtype.UUID{}, ErrSplitReviewerUnresolved
	}
	return nodeRun.CriticID, nil
}
```

角色解析后的 `nodeRun.CriticID` 已由 workflow role resolution 快照写为实际 user id；在生成结束、准备转入 `awaiting_split_review` 前调用该函数。失败时把 node run 转为 `blocked`，`failure_reason` 写 `split_reviewer_unresolved`，不得展示可审核状态。

在 `workflow_node_run.sql` 新增原子状态更新并运行 `make sqlc`：

```sql
-- name: BlockSplitNodeRunForReviewerResolution :one
UPDATE multica_workflow_node_run
SET status = 'blocked',
    failure_reason = 'split_reviewer_unresolved',
    updated_at = now()
WHERE id = $1
  AND status IN ('splitting', 'awaiting_split_review')
RETURNING *;
```

角色解析失败时调用该 query，并通过现有 `OnNodeStatusChanged` 发布状态更新；并发调用拿到 `pgx.ErrNoRows` 后 reload，已 blocked 视为幂等成功。

- [ ] **Step 7: 运行配置与运行时测试**

Run:

```bash
cd server && go test ./internal/handler/ -run "Test(Create|Update)SplitNode" -count=1
cd server && go test ./internal/service/ -run "TestParseSplitConfig|TestResolveSplitReviewer" -count=1
pnpm --filter @multica/core exec vitest run types/workflow.test.ts workflows/preflight-checks.test.ts
```

Expected: PASS；历史默认 workflow 被忽略，自动审核者被前后端一致阻断，未解析角色不能进入审核态。

- [ ] **Step 8: Commit**

```bash
git add server/internal/handler/workflow.go server/internal/handler/workflow_node_member_status_test.go server/internal/service/workflow_split.go server/internal/service/workflow_split_test.go server/pkg/db/queries/workflow_node_run.sql server/pkg/db/generated packages/core/types/workflow.ts packages/core/types/workflow.test.ts packages/core/workflows/preflight-checks.ts packages/core/workflows/preflight-checks.test.ts
git commit -m "fix(workflow): require human split reviewers"
```

---

### Task 3: 建立审核者授权与执行者更新 API

**Files:**
- Modify: `server/internal/service/workflow_split.go`
- Modify: `server/internal/handler/workflow_split.go`
- Modify: `server/internal/handler/workflow_split_test.go`
- Modify: `server/cmd/server/router.go`
- Modify: `server/cmd/cs-workflow/cmd_workflow_split_test.go`

**Interfaces:**
- Consumes: `resolveSplitReviewer(ctx, nodeRun)`、请求上下文 user id、`SetSplitTaskAssignee`。
- Produces: `RequireSplitReviewer(ctx, nodeRun, actorUserID) error`；`PATCH /api/node-runs/{nodeRunId}/split/draft-tasks/{taskId}/assignee` body `{assignee_type, assignee_id, expected_version}`。

- [ ] **Step 1: 写权限与错误码集成测试**

增加表驱动测试：

```go
func TestPatchSplitTaskAssigneeEnforcesReviewerAndVersion(t *testing.T) {
	tests := []struct {
		name string
		userID string
		body map[string]any
		want int
	}{
		{"reviewer", testUserID, map[string]any{"assignee_type": "agent", "assignee_id": agentID, "expected_version": 1}, 200},
		{"other member", otherUserID, map[string]any{"assignee_type": "agent", "assignee_id": agentID, "expected_version": 1}, 403},
		{"invalid type", testUserID, map[string]any{"assignee_type": "api", "assignee_id": agentID, "expected_version": 1}, 422},
		{"stale version", testUserID, map[string]any{"assignee_type": "agent", "assignee_id": agentID, "expected_version": 0}, 409},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := newRequestAs(tt.userID, http.MethodPatch, "/api/node-runs/"+nodeRunID+"/split/draft-tasks/"+taskID+"/assignee", tt.body)
			req = withURLParam(req, "nodeRunId", nodeRunID)
			req = withURLParam(req, "taskId", taskID)
			w := httptest.NewRecorder()
			testHandler.PatchSplitTaskAssignee(w, req)
			if w.Code != tt.want { t.Fatalf("status = %d, want %d: %s", w.Code, tt.want, w.Body.String()) }
		})
	}
}
```

再添加四类有效执行者、缺少一半字段、不存在对象、跨工作区对象、archived agent/squad、inactive/default workflow 的 422 case。直接 reviewer 和 role-resolved reviewer 各有一个 200 case。

增加规划器输入隔离测试：向 batch draft JSON 的 task 中注入 `assignee_type/assignee_id` 必须返回 400 且不写草稿；CLI 以 `workflow split draft add node-run-1 --key a --title A --description A --assignee-type agent --assignee-id agent-1` 调用时必须由 Cobra 返回 `unknown flag`，且 HTTP recorder 零请求。

- [ ] **Step 2: 运行测试确认路由与授权不存在**

Run: `cd server && go test ./internal/handler/ -run "TestPatchSplitTaskAssignee" -count=1`

Expected: 404 或编译失败。

- [ ] **Step 3: 实现 reviewer guard**

先扩展稳定错误枚举与 HTTP 映射：

```go
const (
	SplitErrorForbidden SplitErrorStatus = "forbidden"
)
```

`writeSplitAPIError` 将 `SplitErrorForbidden` 映射为 HTTP 403；已有 bad request/conflict/unprocessable 映射保持不变。

```go
func (s *SplitOrchestrator) RequireSplitReviewer(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun, actorUserID pgtype.UUID) error {
	reviewerID, err := s.resolveSplitReviewer(ctx, nodeRun)
	if err != nil { return err }
	if reviewerID != actorUserID {
		return NewSplitAPIError(SplitErrorForbidden, "split_reviewer_required", errors.New("only the split reviewer may change or approve drafts"))
	}
	return nil
}
```

在 `PatchSplitDraftTask`、`BatchPatchSplitDraftTasks`、人工 `AddSplitDraftTask`、`DeleteSplitDraftTask`、`SubmitSplitDraftTasks`、`ApproveSplitTasks` 和 `CancelSplitNode` 的人工分支最前面调用同一 guard。GET 保持所有工作区成员可读；规划器带 `X-Agent-ID/X-Task-ID` 的 draft generate/chat 写入继续走现有 split-phase capability，不调用人工 reviewer guard。

- [ ] **Step 4: 实现 assignee endpoint**

请求类型：

```go
type PatchSplitTaskAssigneeRequest struct {
	AssigneeType   string `json:"assignee_type"`
	AssigneeID     string `json:"assignee_id"`
	ExpectedVersion int64 `json:"expected_version"`
}
```

handler 执行顺序固定为：加载 node run 与 task、要求 `awaiting_split_review`、require user、调用 reviewer guard、解析 UUID、调用现有 `h.validateAssigneePair`、调用 `SetSplitTaskAssignee`。把 `validateAssigneePair` 的 400/403 统一映射为 split endpoint 的 422 `invalid_split_task_assignee`；Task 4 抽取服务后只替换验证调用，不改变 endpoint contract。身份不符返回 403；CAS `pgx.ErrNoRows` 返回 409 `draft_task_conflict`。

`BatchAddSplitDraftTasks` 和单条 planner draft decoder 使用 `json.Decoder.DisallowUnknownFields()`，确保嵌套 task 中的 assignee 字段不能被 Go 静默忽略；人工 assignee endpoint 使用独立 request type，不与 planner payload 复用。

路由增加：

```go
r.Patch("/api/node-runs/{nodeRunId}/split/draft-tasks/{taskId}/assignee", h.PatchSplitTaskAssignee)
```

- [ ] **Step 5: 让批准接口忽略客户端批准列表权限绕过**

保留 `approved_task_ids` 作为当前 UI contract，但在事务内要求集合与数据库中全部 `status = 'draft'` 的未丢弃任务完全一致；未知 ID、遗漏 active draft 或夹带其他 node run 的 ID 返回 422。`confirm_empty` 只允许所有草稿均已显式 discarded。

把 service 签名改为显式携带审核者身份：

```go
func (s *SplitOrchestrator) ApproveSplit(
	ctx context.Context,
	nodeRun db.MulticaWorkflowNodeRun,
	actorUserID pgtype.UUID,
	req SplitApproveRequest,
) error
```

handler 只传认证上下文中的 user id；service 在事务锁内再次解析 reviewer 并比较 actor，避免仅靠事务外 guard。

- [ ] **Step 6: 运行审核 API 测试**

Run:

```bash
cd server && go test ./internal/handler/ -run "Test(PatchSplitTaskAssignee|PatchSplitDraft|BatchPatchSplitDraft|DeleteSplitDraft|ApproveSplit|CancelSplit)" -count=1
```

Expected: PASS；所有人工写入口共享 reviewer 权限，非法执行者为 422，冲突为 409。

- [ ] **Step 7: Commit**

```bash
git add server/internal/service/workflow_split.go server/internal/handler/workflow_split.go server/internal/handler/workflow_split_test.go server/cmd/server/router.go server/cmd/cs-workflow/cmd_workflow_split_test.go
git commit -m "feat(workflow): authorize split draft reviewers"
```

---

### Task 4: 抽取普通 Issue 分配服务

**Files:**
- Create: `server/internal/service/issue_assignment.go`
- Create: `server/internal/service/issue_assignment_test.go`
- Modify: `server/internal/handler/handler.go`
- Modify: `server/internal/handler/issue.go`
- Modify: `server/internal/handler/handler_test.go`
- Modify: `server/internal/handler/workflow_split.go`

**Interfaces:**
- Consumes: `db.Queries`、`TaskService`、`WorkflowService`、现有 agent privacy predicate 与 workflow sub-issue callback。
- Produces: `AssigneeRef`、`IssueAssignmentHooks`、`ValidateAssignee(ctx, q, workspaceID, actor, assignee) error`、`AfterIssueAssigned(ctx, prev, issue, actor, runtimeSelection) error`。

- [ ] **Step 1: 写服务级失败测试**

```go
func TestIssueAssignmentServiceValidatesAllAssigneeTypes(t *testing.T) {
	tests := []struct { kind string; id pgtype.UUID; wantErr bool }{
		{"member", activeUserID, false},
		{"agent", activeAgentID, false},
		{"squad", activeSquadID, false},
		{"workflow", activeWorkflowID, false},
		{"agent", crossWorkspaceAgentID, true},
		{"workflow", defaultWorkflowID, true},
	}
	for _, tt := range tests {
		err := svc.ValidateAssignee(ctx, queries, workspaceID, actor, service.AssigneeRef{Type: tt.kind, ID: tt.id})
		if (err != nil) != tt.wantErr { t.Fatalf("%s validation error = %v", tt.kind, err) }
	}
}
```

再写 `AfterIssueAssigned` 测试，断言 agent/squad 触发既有自动执行，member 等待人工或按现有工作区规则挂默认 workflow，workflow 启动指定 workflow；重复调用不会产生第二个 run/task。

- [ ] **Step 2: 运行测试确认服务不存在**

Run: `cd server && go test ./internal/service/ -run TestIssueAssignmentService -count=1`

Expected: 编译失败，提示 `IssueAssignmentService` 未定义。

- [ ] **Step 3: 定义聚合服务与稳定错误**

```go
type AssigneeRef struct {
	Type string
	ID   pgtype.UUID
}

type AssignmentActor struct {
	Type string
	ID   pgtype.UUID
}

type RuntimeSelection struct {
	Policy    string
	RuntimeID pgtype.UUID
}

type IssueAssignmentHooks struct {
	CanAccessPrivateAgent func(context.Context, db.MulticaAgent, AssignmentActor, pgtype.UUID) bool
	CreateWorkflowSubIssues func(context.Context, db.MulticaIssue, db.MulticaWorkflowRun, []db.MulticaWorkflowNodeRun) error
}

type IssueAssignmentService struct {
	Queries *db.Queries
	Tasks *TaskService
	Workflows *WorkflowService
	Hooks IssueAssignmentHooks
}
```

定义 `ErrInvalidAssignee` 与 `ErrForbiddenAssignee` 包装类型，使普通 issue handler 维持现有 400/403 contract，split handler 将 invalid 映射 422、forbidden 映射 422（审核者不可选择其无权访问的私有 agent）。

验证签名固定为：

```go
func (s *IssueAssignmentService) ValidateAssignee(
	ctx context.Context,
	q *db.Queries,
	workspaceID pgtype.UUID,
	actor AssignmentActor,
	assignee AssigneeRef,
) error
```

所有实体读取必须使用参数 `q`，不得在方法内回退到 `s.Queries`；普通 HTTP create/update 传 `h.Queries`，批准事务传 `qtx`，依赖释放事务也传 `qtx`。

- [ ] **Step 4: 搬迁验证逻辑**

将 `validateAssigneePair` 的四类查询和 active/default/private 检查移入 `ValidateAssignee`；handler 负责把 optional JSON pair 转为 `*AssigneeRef`，缺一字段仍返回 400。服务只接收完整 `AssigneeRef`，不接受半对字段。

同时把 `PatchSplitTaskAssignee` 从 `h.validateAssigneePair` 切换到 `h.IssueAssignmentService.ValidateAssignee`；继续把所有 invalid/forbidden assignment error 映射为既定 422，不改变 Task 3 的响应 contract。

- [ ] **Step 5: 搬迁分配副作用**

把 CreateIssue/UpdateIssue 中 assignee-change 后的逻辑收敛为：

```go
if assigneeChanged {
	if err := h.IssueAssignmentService.AfterIssueAssigned(
		r.Context(), prevIssue, issue,
		service.AssignmentActor{Type: actorType, ID: parseUUID(actorID)},
		service.RuntimeSelection{Policy: runtimeSelectionPolicy, RuntimeID: runtimePreference},
	); err != nil {
		slog.Warn("issue assignment side effects failed", "issue_id", uuidToString(issue.ID), "error", err)
	}
}
```

`AfterIssueAssigned` 先取消旧 task；然后保持现有分支语义：agent、squad、member 的默认 workflow/fallback，workflow 的指定 run、node sub-issues、issue `workflow_id/workflow_run_id` stamp 和 root dispatch。所有幂等检查继续基于已有 task、`issue.WorkflowRunID` 和 workflow dispatch key。

- [ ] **Step 6: 装配服务并注入 split orchestrator**

在 `Handler` 增加：

```go
IssueAssignmentService *service.IssueAssignmentService
```

`New` 中先创建 assignment service，再传给更新后的构造函数：

```go
splitOrchestrator := service.NewSplitOrchestrator(queries, txStarter, workflowSvc, assignmentSvc, bus, store)
```

- [ ] **Step 7: 运行普通 issue 分配回归测试**

Run:

```bash
cd server && go test ./internal/service/ -run TestIssueAssignmentService -count=1
cd server && go test ./internal/handler/ -run "Test(CreateIssue|UpdateIssue|.*Assign.*|.*Assignee.*)" -count=1
```

Expected: PASS；普通 issue 的 HTTP 状态和四类分配副作用不变。

- [ ] **Step 8: Commit**

```bash
git add server/internal/service/issue_assignment.go server/internal/service/issue_assignment_test.go server/internal/handler/handler.go server/internal/handler/issue.go server/internal/handler/handler_test.go server/internal/handler/workflow_split.go
git commit -m "refactor(issue): centralize assignment behavior"
```

---

### Task 5: 按依赖与并发分配子 Issue，并同步终态

**Files:**
- Modify: `server/internal/service/workflow_split.go`
- Modify: `server/internal/service/workflow_split_test.go`
- Modify: `server/internal/handler/handler.go`
- Modify: `server/internal/handler/issue.go`
- Modify: `server/internal/handler/task_lifecycle.go`
- Modify: `server/internal/handler/workflow_split.go`
- Modify: `server/internal/handler/workflow_split_test.go`
- Modify: `server/internal/handler/workflow_issue_sync_test.go`
- Modify: `server/cmd/server/router.go`

**Interfaces:**
- Consumes: `IssueAssignmentService.ValidateAssignee/AfterIssueAssigned`、`AssignSplitChildIssueIfUnassigned`、`GetSplitTaskByIssueID`。
- Produces: `HandleChildIssueStatusChanged(ctx, prev, issue) error`；新任务 issue 驱动状态；`run_id IS NOT NULL` 旧任务 workflow-run 驱动状态。

- [ ] **Step 1: 写批准原子性和初始分配测试**

```go
func TestApproveSplitCreatesAllIssuesAndAssignsOnlyReadyTasks(t *testing.T) {
	f := createAssigneeSplitFixture(t, "barrier", 1)
	assignSplitTask(t, f.taskAID, "agent", f.agentID)
	assignSplitTask(t, f.taskBID, "member", f.memberUserID) // B depends on A.

	approveSplit(t, f)
	a := loadChildIssue(t, f.taskAID)
	b := loadChildIssue(t, f.taskBID)
	if a.AssigneeType.String != "agent" || !a.AssigneeID.Valid { t.Fatalf("A = %+v", a) }
	if b.AssigneeType.Valid || b.AssigneeID.Valid { t.Fatalf("B must start unassigned: %+v", b) }
}
```

增加：任何 active draft 缺执行者时 422 且零 issue；跨工作区执行者在批准前失效时整体回滚；拓扑顺序稳定；重复批准不重复创建；并发 1 时第二个无依赖 task 保持未分配。

- [ ] **Step 2: 写 issue 终态与释放测试**

覆盖：A `done` 后 B 获得计划执行者；A `cancelled` 后 split task cancelled 并计失败；重复 done 通知不重复触发；分配释放时执行者失效把 task 标记 failed 且 `last_error.code = split_assignee_invalidated`；member 不产生裸 agent task；agent/squad/workflow 走普通 issue 分配副作用；agent/squad 最终 task failure 和指定 workflow run failure 将 split task 标记 failed；普通 issue rerun 成功后 split task 恢复 running，且不会创建 split 专用 retry 记录。

- [ ] **Step 3: 运行测试确认现有实现仍直接启动 child workflow**

Run:

```bash
cd server && go test ./internal/handler/ -run "TestApproveSplitCreatesAllIssuesAndAssignsOnlyReadyTasks|TestSplitChildIssue" -count=1
```

Expected: 失败；现有批准把所有 child issue 分配给 workflow，调度器按 `run_id` 而非 issue 状态运行。

- [ ] **Step 4: 重写批准事务**

`ApproveSplit` 在锁定 node run 后按以下顺序执行：

```go
reviewerID, err := s.resolveSplitReviewer(ctx, lockedNodeRun)
if err != nil || reviewerID != actorUserID { return reviewerError(err) }

current, err := qtx.ListSplitTasksByNodeRun(ctx, nodeRun.ID)
if err != nil { return fmt.Errorf("list split tasks: %w", err) }
allowed, plans, err := s.validateApprovedSplitTasks(ctx, qtx, lockedNodeRun, current, approvedIDs)
if err != nil { return err }
orderedIDs, err := topologicalSplitTaskIDs(plans)
if err != nil { return err }
byID := splitTaskMap(allowed)
for _, id := range orderedIDs {
	task := byID[id]
	issue, err := s.createUnassignedSplitChildIssue(ctx, qtx, parentIssue, task)
	if err != nil { return err }
	if err := qtx.UpdateSplitTaskIssueID(ctx, db.UpdateSplitTaskIssueIDParams{ID: task.ID, IssueID: issue.ID}); err != nil {
		return fmt.Errorf("set split task issue_id: %w", err)
	}
}
assignedIssues, err := s.assignReadySplitIssues(ctx, qtx, lockedNodeRun, allowed)
if err != nil { return err }
```

`CreateIssueWithOrigin` 对所有新 child issue 使用空 `AssigneeType/AssigneeID/WorkflowID/WorkflowRunID`。只有 `readySplitTaskIDs` 返回的任务调用 `AssignSplitChildIssueIfUnassigned` 写计划执行者。事务提交后逐个调用 `AfterIssueAssigned`；若提交后副作用失败，保留 issue 的 assignee，记录结构化错误并允许普通 issue 重试入口处理，批准事务本身不伪装回滚。

- [ ] **Step 5: 把调度 claim 从 run 改为 issue assignment**

`ScheduleReadyTasks` 统计“已分配且 issue 非终态”的 task 数量作为 `max_concurrency` 占用，不再以 `run_id/status=running` 计数。对 ready task：

```go
assignee := AssigneeRef{Type: task.AssigneeType.String, ID: task.AssigneeID}
reviewerID, err := s.resolveSplitReviewer(ctx, nodeRun)
if err != nil { return err }
reviewerActor := AssignmentActor{Type: "member", ID: reviewerID}
if err := s.Assignments.ValidateAssignee(ctx, qtx, run.WorkspaceID, reviewerActor, assignee); err != nil {
	return s.failSplitAssignment(ctx, task, err)
}
issue, err := qtx.AssignSplitChildIssueIfUnassigned(ctx, db.AssignSplitChildIssueIfUnassignedParams{
	ID: task.IssueID, AssigneeType: task.AssigneeType, AssigneeID: task.AssigneeID,
})
```

提交后调用 `AfterIssueAssigned`。`status` 从 `approved/created` 变为 `running` 仅表示 issue 已分配且未终态，不再表示存在 child workflow run。

- [ ] **Step 6: 接入子 issue 状态变化**

新增：

```go
func (s *SplitOrchestrator) HandleChildIssueStatusChanged(ctx context.Context, prev, issue db.MulticaIssue) error {
	if prev.Status == issue.Status || !issue.OriginType.Valid || issue.OriginType.String != "workflow_split" { return nil }
	task, err := s.Queries.GetSplitTaskByIssueID(ctx, issue.ID)
	if errors.Is(err, pgx.ErrNoRows) { return nil }
	if err != nil { return err }
	if task.RunID.Valid { return nil }
	switch issue.Status {
	case "done":
		_, err = s.Queries.UpdateSplitTaskStatus(ctx, db.UpdateSplitTaskStatusParams{ID: task.ID, Status: SplitTaskStatusDone})
	case "cancelled":
		_, err = s.Queries.UpdateSplitTaskStatus(ctx, db.UpdateSplitTaskStatusParams{ID: task.ID, Status: SplitTaskStatusCancelled})
	default:
		return nil
	}
	if err != nil { return err }
	if err := s.ScheduleReadyTasks(ctx, task.NodeRunID); err != nil { return err }
	return s.reconcileParentNode(ctx, task.NodeRunID)
}
```

在 `publishIssueStatusChanged` 或所有统一 issue status update 出口调用该 hook，确保 UI、agent 和 workflow 更新都覆盖；重复通知依赖条件更新与 CAS 保持幂等。

新增两个普通执行生命周期桥接方法：

```go
func (s *SplitOrchestrator) HandleChildExecutionFailed(ctx context.Context, issueID pgtype.UUID, cause error) error
func (s *SplitOrchestrator) HandleChildExecutionRetried(ctx context.Context, issueID pgtype.UUID) error
```

`HandleChildExecutionFailed` 只处理 `run_id IS NULL` 的新 split task，以 `status IN ('running','created')` 条件更新为 `failed`，写 `last_error.code = "split_child_execution_failed"`，然后 reconcile barrier；普通 `TaskService.OnTaskFailed` 在确认自动重试未创建后调用它，workflow assignee 的 `OnRunTerminal(failed)` 通过 `GetDirectIssueByWorkflowRun` 找到 issue 后调用它。`HandleChildExecutionRetried` 由现有 `/api/issues/{id}/rerun` 成功路径调用，以 `status = 'failed'` 条件恢复 `running` 并清空 `last_error`。这两个桥接只观察普通执行链路，不创建、调度或重试执行引擎任务。

- [ ] **Step 7: 收窄旧兼容分支并更新释放语义**

`HandleChildRunTerminal` 首先要求 split task `run_id IS NOT NULL`，只更新历史任务。删除新任务的 `ClaimSplitTaskForRunStart/startChildTaskRun/RetrySplitTask` 调用路径；保留这些 helper 仅由 legacy 分支引用并加 `task.RunID.Valid` guard。

删除 `POST /api/node-runs/{nodeRunId}/split/tasks/{taskId}/retry` 路由、`RetrySplitTaskRequest` handler 和新任务可达的 `RetrySplitTask` service 方法。历史 `run_id` 任务只需要继续接收其既有 workflow run 终态，不开放新的 split retry；所有新任务重试统一使用普通 issue `/api/issues/{id}/rerun`。

`resolveSettledSplitStatus` 调整为：

```go
if mode == SplitModePipeline && allIssuesCreated(plans) { return true, NodeRunStatusCompleted }
if mode == SplitModeBarrier && allIssuesTerminal(plans) {
	if failedOrCancelledCount(plans) > maxFailures { return true, NodeRunStatusFailed }
	return true, NodeRunStatusCompleted
}
return false, NodeRunStatusSplitActive
```

其中 `pipeline` 在所有未丢弃 issue 创建成功后立即释放，不等待 assignment 副作用；`barrier` 将 `failed/cancelled/skipped` 计入失败数。自动执行失败由上述普通执行生命周期桥接写入 `failed`，UI 和重试仍使用普通 issue 的失败记录与 `/rerun` 入口；拆分模块不新增 retry endpoint，也不自行重启 agent、squad 或 workflow。

- [ ] **Step 8: 运行调度与历史兼容测试**

Run:

```bash
cd server && go test ./internal/service/ -run "Test(ReadySplitTaskIDs|ResolveSettledSplitStatus|SplitTask)" -count=1
cd server && go test ./internal/handler/ -run "Test(ApproveSplit|ScheduleReadyTasks|SplitChildIssue|HandleChildRunTerminal|WorkflowIssueSync)" -count=1
```

Expected: PASS；新任务按 issue 状态推进，旧 `run_id` fixture 继续按 workflow run 终态完成。

- [ ] **Step 9: Commit**

```bash
git add server/internal/service/workflow_split.go server/internal/service/workflow_split_test.go server/internal/handler/handler.go server/internal/handler/issue.go server/internal/handler/task_lifecycle.go server/internal/handler/workflow_split.go server/internal/handler/workflow_split_test.go server/internal/handler/workflow_issue_sync_test.go server/cmd/server/router.go
git commit -m "feat(workflow): schedule split issues by assignee"
```

---

### Task 6: 更新 TypeScript API Contract 与 React Query Mutation

**Files:**
- Modify: `packages/core/types/workflow.ts`
- Modify: `packages/core/api/schemas.ts`
- Modify: `packages/core/api/schemas.test.ts`
- Modify: `packages/core/api/client.ts`
- Modify: `packages/core/workflows/queries.ts`
- Modify: `packages/core/workflows/queries.test.ts`

**Interfaces:**
- Consumes: Task 1/3 HTTP 字段和 endpoint。
- Produces: `SplitTask.assignee_type/assignee_id`；`PatchSplitTaskAssigneeRequest`；`usePatchSplitTaskAssignee(wsId)`。

- [ ] **Step 1: 写 Zod 防漂移测试**

```ts
it("parses split task assignees and tolerates older responses", () => {
  const current = SplitTasksResponseSchema.parse({ tasks: [{
    id: "task-1", node_run_id: "nr-1", title: "A", description: "",
    assignee_type: "squad", assignee_id: "squad-1", depends_on: [],
    sort_order: 0, status: "draft", issue_id: null, run_id: null,
    workflow_id: null, version: 2, draft_key: null, draft_source: "agent",
    last_error: null, created_at: "", updated_at: "",
  }] });
  expect(current.tasks[0]).toMatchObject({ assignee_type: "squad", assignee_id: "squad-1" });

  const old = SplitTasksResponseSchema.parse({ tasks: [{ id: "task-2", node_run_id: "nr-1" }] });
  expect(old.tasks[0]).toMatchObject({ assignee_type: null, assignee_id: null });
});

it("falls back when split tasks is null", () => {
  expect(SplitTasksResponseSchema.parse({ tasks: null }).tasks).toEqual([]);
});
```

- [ ] **Step 2: 运行测试确认字段和 null fallback 缺失**

Run: `pnpm --filter @multica/core exec vitest run api/schemas.test.ts`

Expected: 类型或 schema 断言失败。

- [ ] **Step 3: 更新类型和 schema**

```ts
export type SplitTaskAssigneeType = "member" | "agent" | "squad" | "workflow";

export interface SplitTask {
  workflow_id: string | null;
  assignee_type: SplitTaskAssigneeType | null;
  assignee_id: string | null;
}

export interface PatchSplitTaskAssigneeRequest {
  assignee_type: SplitTaskAssigneeType;
  assignee_id: string;
  expected_version: number;
}
```

Schema 使用：

```ts
assignee_type: z.enum(["member", "agent", "squad", "workflow"]).nullable().default(null),
assignee_id: z.string().nullable().default(null),
workflow_id: z.string().nullable().default(null),
```

并把 response 的 `tasks` 定义为 `z.array(SplitTaskSchema).nullish().transform((value) => value ?? [])`。保留 `.loose()` 和所有旧字段 fallback，避免旧桌面客户端白屏。

删除 `RetrySplitTaskRequest`、`api.retrySplitTask` 和 `useRetrySplitTask`；运行结果页只能通过 child issue 的普通 rerun 操作重试自动执行，member assignee 不渲染 rerun。

- [ ] **Step 4: 增加 client 与 mutation**

```ts
async patchSplitTaskAssignee(
  nodeRunId: string,
  taskId: string,
  req: PatchSplitTaskAssigneeRequest,
): Promise<SplitTasksResponse> {
  const raw = await this.fetch<unknown>(
    `/api/node-runs/${nodeRunId}/split/draft-tasks/${taskId}/assignee`,
    { method: "PATCH", body: JSON.stringify(req) },
  );
  return parseWithFallback(raw, SplitTasksResponseSchema, EMPTY_SPLIT_TASKS_RESPONSE, {
    endpoint: "PATCH /api/node-runs/:id/split/draft-tasks/:taskId/assignee",
  });
}
```

Mutation：

```ts
export function usePatchSplitTaskAssignee(wsId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ nodeRunId, taskId, request }: SplitMutationVars & {
      taskId: string; request: PatchSplitTaskAssigneeRequest;
    }) => api.patchSplitTaskAssignee(nodeRunId, taskId, request),
    onSuccess: (data, vars) => queryClient.setQueryData(splitKeys.tasks(wsId, vars.nodeRunId), data),
    onSettled: (_data, _error, vars) => queryClient.invalidateQueries({ queryKey: splitKeys.tasks(wsId, vars.nodeRunId) }),
  });
}
```

- [ ] **Step 5: 写并运行 mutation cache 测试**

测试 mock `api.patchSplitTaskAssignee` 返回 version 2，断言 mutation 传递 exact request，成功后缓存为 version 2，settled 后 invalidation key 包含 `wsId/nodeRunId`。

Run:

```bash
pnpm --filter @multica/core exec vitest run api/schemas.test.ts workflows/queries.test.ts
pnpm --filter @multica/core typecheck
```

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/core/types/workflow.ts packages/core/api/schemas.ts packages/core/api/schemas.test.ts packages/core/api/client.ts packages/core/workflows/queries.ts packages/core/workflows/queries.test.ts
git commit -m "feat(core): expose split task assignee updates"
```

---

### Task 7: 更新节点配置 UI 与前置检查文案

**Files:**
- Modify: `packages/views/workflows/components/split/split-config-panel.tsx`
- Modify: `packages/views/workflows/components/split/split-config-panel.test.tsx`
- Modify: `packages/views/workflows/components/node-config-panel.tsx`
- Modify: `packages/views/workflows/components/node-config-panel.test.tsx`
- Modify: `packages/views/workflows/components/overview/node-template-catalog.ts`
- Modify: `packages/views/workflows/components/overview/node-template-catalog.test.ts`
- Modify: `packages/views/locales/en/workflows.json`
- Modify: `packages/views/locales/zh-Hans/workflows.json`

**Interfaces:**
- Consumes: Task 2 的三字段 `SplitConfig` 与 reviewer preflight。
- Produces: split config 面板只编辑 mode/concurrency/failures；split reviewer UI 只暴露 member/role。

- [ ] **Step 1: 写配置 UI 失败测试**

```tsx
it("does not render a default child workflow control", () => {
  render(<SplitConfigPanel config={{ mode: "barrier", max_concurrency: 5, max_failures: 0 }} onChange={onChange} />);
  expect(screen.queryByLabelText("Child issue default workflow")).not.toBeInTheDocument();
});

it("limits split reviewers to members and roles", async () => {
  renderNodeConfig(makeSplitNode());
  expect(screen.getByLabelText("Reviewer category")).toHaveTextContent("Member");
  expect(screen.getByLabelText("Reviewer category")).toHaveTextContent("Role");
  expect(screen.getByLabelText("Reviewer category")).not.toHaveTextContent("Digital Human");
  expect(screen.getByLabelText("Reviewer category")).not.toHaveTextContent("Squad");
  expect(screen.getByLabelText("Reviewer category")).not.toHaveTextContent("API");
});
```

- [ ] **Step 2: 运行测试确认旧控件仍存在**

Run:

```bash
pnpm --filter @multica/views exec vitest run workflows/components/split/split-config-panel.test.tsx workflows/components/node-config-panel.test.tsx
```

Expected: default workflow select 仍可见，reviewer category 仍包含自动类型。

- [ ] **Step 3: 删除默认 workflow UI 和数据流**

`SplitConfigPanelProps` 改为：

```ts
interface SplitConfigPanelProps {
  config: SplitConfig;
  disabled?: boolean;
  onChange: (next: SplitConfig) => void;
}
```

删除 `childWorkflows/currentWorkflowId`、active workflow filter 和 select。`node-config-panel.tsx` 的 split 默认值改为：

```ts
const DEFAULT_SPLIT_CONFIG: SplitConfig = {
  mode: "barrier",
  max_concurrency: 5,
  max_failures: 0,
};
```

删除 panorama、template catalog 和 node edit 中对 `default_issue_workflow_id` 的读写；catalog fixture 只保留三个字段。

- [ ] **Step 4: 限制 split reviewer controls**

为 split 分支使用专用选项：

```ts
const splitReviewerCategoryOptions: Array<{ value: ParticipantCategory; label: string }> = [
  { value: "member", label: t(($) => $.detail_panel.participant_member) },
  { value: "role", label: t(($) => $.detail_panel.participant_role) },
];
```

成员选择器固定 `allowedTypes={["member"]}`，角色选择保留现有 role dropdown。加载历史非法配置时显示 blocking badge，并要求用户重新选择 member/role 后才能保存；不得把 agent/squad/API 静默改成 member。

- [ ] **Step 5: 更新英中文案**

删除 `split_default_issue_workflow_*` 和 `check/detail_split_default_issue_workflow_*` keys。更新：

```json
"split_critic_subtitle": "Only a workspace member or a role resolved to a member can review and assign generated drafts.",
"check_split_reviewer_invalid": "Reviewer must be a member or member role",
"detail_split_reviewer_invalid": "Choose one workspace member or a role that resolves to a workspace member"
```

中文对应：

```json
"split_critic_subtitle": "仅工作区成员或最终解析为成员的角色可以审核并分配拆分草稿。",
"check_split_reviewer_invalid": "审核者必须是成员或成员角色",
"detail_split_reviewer_invalid": "请选择一名工作区成员，或最终解析为工作区成员的角色"
```

- [ ] **Step 6: 运行配置 UI 相关测试**

Run:

```bash
pnpm --filter @multica/views exec vitest run workflows/components/split/split-config-panel.test.tsx workflows/components/node-config-panel.test.tsx workflows/components/overview/node-template-catalog.test.ts
pnpm --filter @multica/views typecheck
```

Expected: PASS；无默认 workflow 配置入口，split reviewer 只有 member/role。

- [ ] **Step 7: Commit**

```bash
git add packages/views/workflows/components/split/split-config-panel.tsx packages/views/workflows/components/split/split-config-panel.test.tsx packages/views/workflows/components/node-config-panel.tsx packages/views/workflows/components/node-config-panel.test.tsx packages/views/workflows/components/overview/node-template-catalog.ts packages/views/workflows/components/overview/node-template-catalog.test.ts packages/views/locales/en/workflows.json packages/views/locales/zh-Hans/workflows.json
git commit -m "fix(views): simplify split node assignment config"
```

---

### Task 8: 实现逐项执行者审核与运行结果展示

**Files:**
- Modify: `packages/views/workflows/components/split/split-draft-ledger.tsx`
- Modify: `packages/views/workflows/components/split/split-draft-ledger.test.tsx`
- Modify: `packages/views/workflows/components/split/split-review-panel.tsx`
- Modify: `packages/views/workflows/components/split/split-review-panel.test.tsx`
- Modify: `packages/views/issues/components/pickers/assignee-picker.tsx`
- Modify: `packages/views/issues/components/pickers/assignee-picker.test.tsx`
- Modify: `packages/views/locales/en/workflows.json`
- Modify: `packages/views/locales/zh-Hans/workflows.json`

**Interfaces:**
- Consumes: `SplitTask.assignee_type/assignee_id`、`usePatchSplitTaskAssignee`、普通 `AssigneePicker` 四类数据。
- Produces: 每条 active draft 的 assignee picker；`readOnly` 时 actor 展示；批准按钮仅在 reviewer 且全部已分配时启用。

- [ ] **Step 1: 写 ledger 失败测试**

```tsx
it("renders the shared four-type assignee picker for every active draft", async () => {
  renderLedger({ tasks: [draftA, draftB], readOnly: false });
  expect(screen.getAllByLabelText(/Assignee for/)).toHaveLength(2);
  await user.click(screen.getByLabelText("Assignee for Task A"));
  expect(screen.getByText("Members")).toBeInTheDocument();
  expect(screen.getByText("Digital Humans")).toBeInTheDocument();
  expect(screen.getByText("Squads")).toBeInTheDocument();
  expect(screen.getByText("Workflows")).toBeInTheDocument();
});

it("shows child issue assignee and issue status after creation", () => {
  renderLedger({ tasks: [createdTask], taskIssueBySourceId: new Map([[createdTask.id, childIssue]]) });
  expect(screen.getByText("Alice")).toBeInTheDocument();
  expect(screen.getByText("In progress")).toBeInTheDocument();
  expect(screen.queryByText(/workflow run/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: 写 review panel 权限、阻断和冲突测试**

覆盖：两条 active draft 有一条未分配时批准 disabled 且显示计数；全部分配时 summary 显示“已分配任务数 2”；其他成员只读且没有修改/丢弃/批准动作；409 后同时 refetch split tasks 和 assignee option queries；422 后保留面板并刷新 options；不出现批量分配控件。

- [ ] **Step 3: 运行测试确认 UI 仍使用 workflow select**

Run:

```bash
pnpm --filter @multica/views exec vitest run workflows/components/split/split-draft-ledger.test.tsx workflows/components/split/split-review-panel.test.tsx
```

Expected: 四类 picker 与 reviewer read-only 断言失败。

- [ ] **Step 4: 让 AssigneePicker 支持不可清空的嵌入模式**

增加可选 props：

```ts
allowUnassigned?: boolean;
ariaLabel?: string;
```

函数参数解构时使用 `allowUnassigned = true`；当 `allowUnassigned={false}` 时不渲染 Unassigned item。其余成员、agent、squad、workflow 查询、可见性、runtime 选择和 archived filter 完全复用现有实现。补测试确保默认行为不变，split 模式隐藏 Unassigned。

- [ ] **Step 5: 替换 ledger workflow select**

Props 改为：

```ts
interface SplitDraftLedgerProps {
  tasks: SplitTask[];
  taskIssueBySourceId?: ReadonlyMap<string, Issue>;
  readOnly?: boolean;
  onAssigneeChange?: (task: SplitTask, assignee: { assignee_type: SplitTaskAssigneeType; assignee_id: string }) => void;
  onDraftSave?: (task: SplitTask, updates: { title: string; description: string }) => Promise<void>;
  onDiscardChange?: (task: SplitTask, discarded: boolean) => void;
}
```

editable active draft 渲染：

```tsx
<AssigneePicker
  assigneeType={task.assignee_type}
  assigneeId={task.assignee_id}
  allowedTypes={["member", "agent", "squad", "workflow"]}
  allowUnassigned={false}
  ariaLabel={t(($) => $.detail_panel.split_assignee_for, { title: task.title })}
  onUpdate={(update) => {
    if (update.assignee_type && update.assignee_id) {
      onAssigneeChange?.(task, {
        assignee_type: update.assignee_type,
        assignee_id: update.assignee_id,
      });
    }
  }}
/>
```

只读或已创建行用 `ActorAvatar + useActorName` 展示计划/实际执行者；有 child issue 时以 `childIssue.assignee_*` 和 `childIssue.status` 为准，不再显示 workflow name、run status 或 retry action。

- [ ] **Step 6: 更新 review panel mutation 与批准条件**

```ts
const activeTasks = tasks.filter((task) => task.status !== "discarded");
const unassignedCount = activeTasks.filter(
  (task) => !task.assignee_type || !task.assignee_id,
).length;
const currentUserId = useAuthStore((state) => state.user?.id ?? null);
const canEditReview = nodeRun?.status === "awaiting_split_review" && nodeRun?.critic_id === currentUserId;
const canApprove = canEditReview && activeTasks.length > 0 && unassignedCount === 0;
```

`handleAssigneeChange` 发送 task.version；409/422 都执行 `refetchSplitTasks()`，并 invalidate/refetch members、agents、squads、workflows 选项。传给 ledger 的 `readOnly={!canEditReview}`，discard/approve/cancel 动作同样受 `canEditReview` 控制。role reviewer 在 run snapshot 上已经是实际 `critic_id`，因此前端不自行解析 role。

摘要把 distinct workflow 数替换为已分配 task 数：

```ts
const assignedCount = activeTasks.filter((task) => task.assignee_type && task.assignee_id).length;
```

- [ ] **Step 7: 更新英中文案**

新增/替换：

```json
"split_assignee_for": "Assignee for {{title}}",
"split_assigned_tasks_summary": "{{assigned}} of {{tasks}} child issues assigned · {{dependencies}} dependency chains",
"split_assignment_required": "Assign every active child issue before approval",
"split_assignment_conflict": "This draft changed. The latest tasks and assignees have been loaded.",
"split_reviewer_read_only": "Only the configured reviewer can edit or approve this plan."
```

中文：

```json
"split_assignee_for": "{{title}} 的执行者",
"split_assigned_tasks_summary": "{{tasks}} 个子 issue 中已分配 {{assigned}} 个 · {{dependencies}} 条依赖链",
"split_assignment_required": "批准前请为每个未丢弃的子 issue 分配执行者",
"split_assignment_conflict": "草稿已变化，已加载最新任务和执行者。",
"split_reviewer_read_only": "只有节点配置的审核者可以编辑或批准此计划。"
```

- [ ] **Step 8: 运行共享 UI 相关测试**

Run:

```bash
pnpm --filter @multica/views exec vitest run issues/components/pickers/assignee-picker.test.tsx workflows/components/split/split-draft-ledger.test.tsx workflows/components/split/split-review-panel.test.tsx
pnpm --filter @multica/views typecheck
```

Expected: PASS；四类执行者可逐项选择，缺失分配或非 reviewer 时不能批准，运行后只显示 issue 执行者与状态。

- [ ] **Step 9: 运行最终相关模块验证**

Run:

```bash
cd server && go test ./internal/service/ -run "Test(IssueAssignmentService|ParseSplitConfig|ResolveSplitReviewer|ReadySplitTaskIDs|ResolveSettledSplitStatus|SplitTask)" -count=1
cd server && go test ./internal/handler/ -run "Test(CreateSplitNode|UpdateSplitNode|PatchSplitTaskAssignee|PatchSplitDraft|ApproveSplit|ScheduleReadyTasks|SplitChildIssue|HandleChildRunTerminal|WorkflowIssueSync|.*Assignee.*)" -count=1
pnpm --filter @multica/core exec vitest run types/workflow.test.ts api/schemas.test.ts workflows/preflight-checks.test.ts workflows/queries.test.ts
pnpm --filter @multica/views exec vitest run workflows/components/split/split-config-panel.test.tsx workflows/components/node-config-panel.test.tsx workflows/components/overview/node-template-catalog.test.ts workflows/components/split/split-draft-ledger.test.tsx workflows/components/split/split-review-panel.test.tsx issues/components/pickers/assignee-picker.test.tsx
pnpm --filter @multica/core typecheck
pnpm --filter @multica/views typecheck
```

Expected: 全部 PASS；不运行仓库全量测试。

- [ ] **Step 10: Commit**

```bash
git add packages/views/workflows/components/split/split-draft-ledger.tsx packages/views/workflows/components/split/split-draft-ledger.test.tsx packages/views/workflows/components/split/split-review-panel.tsx packages/views/workflows/components/split/split-review-panel.test.tsx packages/views/issues/components/pickers/assignee-picker.tsx packages/views/issues/components/pickers/assignee-picker.test.tsx packages/views/locales/en/workflows.json packages/views/locales/zh-Hans/workflows.json
git commit -m "feat(views): assign split drafts during review"
```
