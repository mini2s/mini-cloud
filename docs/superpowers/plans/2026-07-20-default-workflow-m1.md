# 默认 Workflow M1 实施计划：agent 派单闭环

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `assignee_type=agent` 的 Issue 自动跑一次"默认 workflow"的 run，复用整套 Gitea 交付物归档链路（scaffold → cs-workflow submit → review → merge → UI PR 链接）。

**Architecture:** 每个 workspace get-or-create 一个系统级默认 workflow（`is_default=true`、单节点、1 个 document 交付物、隐藏）。agent 派单时 `StartDefaultRunForIssue` 起一次 run，把 node-run 的 worker 覆写为 Issue assignee、critic 覆写为 Issue 创建者；`DispatchAgentTask`/`DispatchCritic` 改为读 node-run（而非 node）的 assignee——对正常 workflow 零行为变更（node-run 是 node 的拷贝），对默认 workflow 取到 Issue 派单者。dormant：Gitea 未配置时不触发，agent 派单退回今天的 `EnqueueTaskForIssue`。

**Tech Stack:** Go（Chi + sqlc）、PostgreSQL、Gitea HTTP client。member 上传（M2）、squad（M3）本期不含。

**Spec:** `docs/superpowers/specs/2026-07-20-default-workflow-archive-design.md`

---

## 关键事实（已核对）

- 最新 migration = `135`；下一个 = `136`。
- `multica_workflow_node_run` 已有 `worker_type/worker_id/critic_type/critic_id` 列（`StartRun` 从 node 拷贝）。
- `DispatchAgentTask`（`service/workflow.go:1124`）当前读 `node.WorkerID/WorkerType/CriticID`；改读 `nodeRun.*` 对正常 workflow 等价。
- `StartRun`（`service/workflow.go:227`）建 run + 每 node 一条 node-run（root 状态 `format_checking`）。
- `DispatchRootNodeRuns`（`service/workflow.go:304`）把 root node-run 推过 `format_checking → format_ok → dispatchWorker`。
- `ScaffoldRunDeliverables`（`service/workflow_gitea.go:52`）dormant-aware，run 启动后 fire-and-forget。
- CreateIssue agent 分支：`handler/issue.go:2035-2045`（`EnqueueTaskForIssue`）。UpdateIssue 改派 agent 分支：`handler/issue.go:2415-2418`。
- sqlc 查询：`server/pkg/db/queries/workflow.sql`；节点交付物查询在 `workflow_deliverable.sql`。
- DB 测试模式：见 `service/workflow_gitea_test.go`（`seedGiteaFixture` 直插 `multica_*` 表 + `t.Cleanup`；连库方式见 memory `local-db-test-via-golang-container`）。

---

## Task 1: `is_default` 列 migration

**Files:**
- Create: `server/migrations/136_default_workflow.up.sql`
- Create: `server/migrations/136_default_workflow.down.sql`

- [ ] **Step 1: 写 up migration**（注：原 `created_by_type` CHECK 仅 `member/agent` 且 `created_by_id` NOT NULL——`108_workflow.up.sql:14-15`；默认 workflow 由系统创建，需放开）

```sql
-- 136_default_workflow.up.sql
ALTER TABLE multica_workflow
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;

-- 允许系统创建的默认 workflow（created_by_type='system'，无作者）。
-- 原 CHECK 名 = workflow_created_by_type_check（建表于 108，表名 114 改前缀但约束名不变）。
ALTER TABLE multica_workflow DROP CONSTRAINT IF EXISTS workflow_created_by_type_check;
ALTER TABLE multica_workflow
  ADD CONSTRAINT workflow_created_by_type_check CHECK (created_by_type IN ('member', 'agent', 'system'));
ALTER TABLE multica_workflow ALTER COLUMN created_by_id DROP NOT NULL;

-- 每 workspace 至多一个默认 workflow。
CREATE UNIQUE INDEX IF NOT EXISTS uniq_workflow_default_per_workspace
  ON multica_workflow (workspace_id)
  WHERE is_default = TRUE;
```

- [ ] **Step 2: 写 down migration**

```sql
-- 136_default_workflow.down.sql
DELETE FROM multica_workflow WHERE is_default = TRUE;
DROP INDEX IF EXISTS uniq_workflow_default_per_workspace;
ALTER TABLE multica_workflow ALTER COLUMN created_by_id SET NOT NULL;
ALTER TABLE multica_workflow DROP CONSTRAINT IF EXISTS workflow_created_by_type_check;
ALTER TABLE multica_workflow
  ADD CONSTRAINT workflow_created_by_type_check CHECK (created_by_type IN ('member', 'agent'));
ALTER TABLE multica_workflow DROP COLUMN IF EXISTS is_default;
```

- [ ] **Step 3: 跑 migration 验证**

Run: `make migrate-up`
Expected: 136 应用成功，`\d multica_workflow` 含 `is_default` 列与唯一索引。

- [ ] **Step 4: Commit**

```bash
git add server/migrations/136_default_workflow.*
git commit -m "feat(workflow): add is_default column for default archive workflow"
```

---

## Task 2: sqlc 查询（get/create 默认 workflow、覆写 node-run assignees、列表过滤）

**Files:**
- Modify: `server/pkg/db/queries/workflow.sql`
- Modify: `server/pkg/db/queries/workflow_node_run.sql`（加 `UpdateWorkflowNodeRunAssignees`）
- Regenerate: `server/pkg/db/generated/`（`make sqlc`）

- [ ] **Step 1: workflow.sql 加 3 个查询**

在 `ListTemplates` 段附近追加：

```sql
-- name: GetDefaultWorkflow :one
SELECT * FROM multica_workflow
WHERE workspace_id = $1 AND is_default = TRUE;

-- name: CreateDefaultWorkflow :one
INSERT INTO multica_workflow (
    workspace_id, title, description, status, max_retries,
    created_by_type, created_by_id, is_default
) VALUES (
    $1, $2, sqlc.narg('description'), 'active', 3,
    'system', sqlc.narg('created_by_id'), TRUE
) RETURNING *;
```

把用户侧列表查询过滤 `is_default`（执行时确认 handler ListWorkflows 用的具体查询名——候选 `ListWorkflowsExcludingTemplates` / `ListWorkflows`；改用户侧那条，加 `AND is_default = FALSE`）。例：

```sql
-- name: ListWorkflowsExcludingTemplates :many
SELECT * FROM multica_workflow
WHERE workspace_id = $1 AND is_template = FALSE AND is_default = FALSE
  AND (sqlc.narg('status')::text IS NULL OR status = sqlc.narg('status'))
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;
```

- [ ] **Step 2: workflow_node_run.sql 加覆写查询**

```sql
-- name: UpdateWorkflowNodeRunAssignees :one
UPDATE multica_workflow_node_run SET
    worker_type = $2,
    worker_id   = $3,
    critic_type = $4,
    critic_id   = $5,
    updated_at  = now()
WHERE id = $1
RETURNING *;
```

- [ ] **Step 3: 重新生成 sqlc**

Run: `make sqlc`
Expected: 生成 `GetDefaultWorkflow` / `CreateDefaultWorkflow` / `UpdateWorkflowNodeRunAssignees`，`ListWorkflowsExcludingTemplates` 参数不变。

- [ ] **Step 4: 编译**

Run: `cd server && go build ./...`
Expected: 通过（新查询未被引用也不报错）。

- [ ] **Step 5: Commit**

```bash
git add server/pkg/db/queries/workflow.sql server/pkg/db/queries/workflow_node_run.sql server/pkg/db/generated/
git commit -m "feat(workflow): sqlc queries for default workflow + node-run assignee override"
```

---

## Task 3: `EnsureDefaultWorkflow`（get-or-create 默认 workflow + 单节点 + document 交付物）

**Files:**
- Modify: `server/internal/service/workflow.go`（加方法）
- Test: `server/internal/service/workflow_default_test.go`（新建）

- [ ] **Step 1: 写失败测试**（直插表 + `t.Cleanup`，仿 `seedGiteaFixture`；连库见 memory）

```go
func TestEnsureDefaultWorkflow_Idempotent(t *testing.T) {
	s := newWorkflowServiceWithPool(t) // helper：用真实 pool 构 WorkflowService，Gitea=nil
	ws := seedWorkspace(t, s.pool)

	wf1, err := s.EnsureDefaultWorkflow(ctx, ws)
	if err != nil { t.Fatalf("first ensure: %v", err) }
	if !wf1.IsDefault { t.Fatal("wf1 not default") }

	// 单节点 + 1 个 document 交付物
	nodes, _ := s.Queries.ListWorkflowNodes(ctx, wf1.ID)
	if len(nodes) != 1 { t.Fatalf("want 1 node, got %d", len(nodes)) }
	dels, _ := s.Queries.ListWorkflowNodeDeliverables(ctx, nodes[0].ID)
	if len(dels) != 1 || dels[0].Kind != "document" { t.Fatalf("want 1 document deliverable") }

	// 幂等：第二次返回同一行
	wf2, err := s.EnsureDefaultWorkflow(ctx, ws)
	if err != nil { t.Fatalf("second ensure: %v", err) }
	if wf1.ID != wf2.ID { t.Fatal("ensure not idempotent") }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && go test ./internal/service/ -run TestEnsureDefaultWorkflow -v`（在 `golang:1.26-alpine` 容器里连 `multica_default` 的 postgres，见 memory）
Expected: FAIL（`EnsureDefaultWorkflow` 未定义）。

- [ ] **Step 3: 实现**

```go
// EnsureDefaultWorkflow get-or-creates the workspace's system default workflow
// (hidden, single node, one document deliverable) used to archive deliverables
// for issues assigned to agent/member/squad. Idempotent.
func (s *WorkflowService) EnsureDefaultWorkflow(ctx context.Context, workspaceID pgtype.UUID) (db.MulticaWorkflow, error) {
	if wf, err := s.Queries.GetDefaultWorkflow(ctx, workspaceID); err == nil {
		return wf, nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return db.MulticaWorkflow{}, fmt.Errorf("get default workflow: %w", err)
	}
	wf, err := s.Queries.CreateDefaultWorkflow(ctx, db.CreateDefaultWorkflowParams{
		WorkspaceID: workspaceID,
		Title:       "Default Archive Workflow",
	})
	if err != nil {
		return db.MulticaWorkflow{}, fmt.Errorf("create default workflow: %w", err)
	}
	node, err := s.Queries.CreateWorkflowNode(ctx, db.CreateWorkflowNodeParams{
		WorkflowID: wf.ID, Title: "Deliverable", WorkerType: "agent", CriticType: "human", PositionX: 0, PositionY: 0, SortOrder: 0,
	})
	if err != nil {
		return db.MulticaWorkflow{}, fmt.Errorf("create default node: %w", err)
	}
	if _, err := s.Queries.CreateWorkflowNodeDeliverable(ctx, db.CreateWorkflowNodeDeliverableParams{
		WorkflowNodeID: node.ID, Kind: "document", Title: "Deliverable", Required: true, SortOrder: 0,
	}); err != nil {
		return db.MulticaWorkflow{}, fmt.Errorf("create default deliverable: %w", err)
	}
	return wf, nil
}
```
（执行时核对 `CreateWorkflowNodeDeliverable` 的确切参数名/必填项——见 `workflow_deliverable.sql`。）

- [ ] **Step 4: 跑测试确认通过**

Run: 同 Step 2
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/internal/service/workflow.go server/internal/service/workflow_default_test.go
git commit -m "feat(workflow): EnsureDefaultWorkflow get-or-create per workspace"
```

---

## Task 4: `DispatchAgentTask`/`DispatchCritic` 读 node-run assignee（向后兼容）

**Files:**
- Modify: `server/internal/service/workflow.go:1142-1155`（worker/critic 从 `node.*` 改 `nodeRun.*`）
- Modify: `service/workflow.go` 派发 critic 处（`dispatchCritic`，~line 1080-1117，同理改读 node-run）
- Test: 既有 `workflow_transitions_test.go` / 新增针对 node-run 覆写后派发的测试

- [ ] **Step 1: 写失败测试**——node-run worker 被覆写为 A，node 原 worker 为 B，派发应给 A

```go
func TestDispatchAgentTask_ReadsNodeRunWorker(t *testing.T) {
	s := newWorkflowServiceWithPool(t)
	ws, agentA, agentB := seedTwoAgents(t, s.pool)
	wf, node, run, nr := seedRunWithNodeWorker(t, s.pool, ws, agentB) // node.worker = B
	// 覆写 node-run worker = A
	s.Queries.UpdateWorkflowNodeRunAssignees(ctx, db.UpdateWorkflowNodeRunAssigneesParams{
		ID: nr.ID, WorkerType: "agent", WorkerID: agentA, CriticType: "human",
	})
	task, err := s.DispatchAgentTask(ctx, nr, "worker")
	if err != nil { t.Fatalf("dispatch: %v", err) }
	if task.AgentID != agentA { t.Fatalf("want agent A, got %v", task.AgentID) }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `go test ./internal/service/ -run TestDispatchAgentTask_ReadsNodeRunWorker -v`
Expected: FAIL（派发给 B）。

- [ ] **Step 3: 改实现**——`DispatchAgentTask` 把 `node.WorkerID/WorkerType` → `nodeRun.WorkerID/WorkerType`，`node.CriticID/CriticType` → `nodeRun.CriticID/CriticType`（worker/critic 两个 phase 分支）。`dispatchCritic` 同理。保留 squad→leader 解析（读 node-run 的 type/id）。

- [ ] **Step 4: 跑全量 workflow service 测试确认无回归**

Run: `go test ./internal/service/ -run "Workflow|Dispatch|NodeRun" -v`
Expected: PASS（正常 workflow 的 node-run worker==node worker，行为不变）。

- [ ] **Step 5: Commit**

```bash
git add server/internal/service/workflow.go server/internal/service/workflow_*_test.go
git commit -m "refactor(workflow): dispatch reads node-run assignees (enables default-workflow override)"
```

---

## Task 5: `StartDefaultRunForIssue`（默认 run + 覆写 assignees + 派发 + scaffold）

**Files:**
- Modify: `server/internal/service/workflow.go`（加方法）
- Test: `server/internal/service/workflow_default_test.go`

- [ ] **Step 1: 写失败测试**

```go
func TestStartDefaultRunForIssue_Agent(t *testing.T) {
	s := newWorkflowServiceWithPool(t) // Gitea=nil → scaffold no-op，但仍建 run+node-run+派发
	ws, agent, creator := seedAgentAndCreator(t, s.pool)
	issue := seedIssue(t, s.pool, ws, "agent", agent, creator) // assignee=agent, created_by=creator(member)

	run, nr, err := s.StartDefaultRunForIssue(ctx, issue)
	if err != nil { t.Fatalf("start: %v", err) }

	// node-run worker=agent, critic=creator
	got, _ := s.Queries.GetWorkflowNodeRun(ctx, nr.ID)
	if got.WorkerID != agent { t.Fatal("worker not overridden to assignee") }
	if got.CriticID != creator { t.Fatal("critic not overridden to creator") }

	// agent 任务已派发且带 node-run id
	tasks, _ := s.Queries.ListAgentTasksByIssue(ctx, issue.ID)
	found := false
	for _, tk := range tasks {
		if tk.WorkflowNodeRunID == nr.ID { found = true }
	}
	if !found { t.Fatal("no agent task linked to node-run") }
}
```

- [ ] **Step 2: 跑测试确认失败**（`StartDefaultRunForIssue` 未定义）。

- [ ] **Step 3: 实现**

```go
// StartDefaultRunForIssue starts a run of the workspace's default workflow for
// an agent/member/squad-assigned issue, overriding the single node-run's worker
// to the issue assignee and critic to the issue creator, then dispatches the
// worker (agent/squad) and scaffolds Gitea. Member assignee skips worker
// dispatch (the member uploads via the UI — M2). Dormant: caller gates on Gitea
// configured; this method itself does not check (it must still build the run +
// node-run so the issue has a deliverable home even before Gitea is wired).
func (s *WorkflowService) StartDefaultRunForIssue(ctx context.Context, issue db.MulticaIssue) (*db.MulticaWorkflowRun, db.MulticaWorkflowNodeRun, error) {
	wf, err := s.EnsureDefaultWorkflow(ctx, issue.WorkspaceID)
	if err != nil {
		return nil, db.MulticaWorkflowNodeRun{}, err
	}
	input, _ := json.Marshal(map[string]any{"title": issue.Title, "description": textToString(issue.Description)})
	run, err := s.StartRun(ctx, wf, issue.CreatorType, util.UUIDToString(issue.CreatorID), input, pgtype.UUID{})
	if err != nil {
		return nil, db.MulticaWorkflowNodeRun{}, err
	}
	nodeRuns, err := s.Queries.ListWorkflowNodeRunsByRun(ctx, run.ID)
	if err != nil {
		return nil, db.MulticaWorkflowNodeRun{}, err
	}
	nr := nodeRuns[0]
	// Override worker=assignee, critic=creator (issue.CreatorType may be member/agent).
	nr, err = s.Queries.UpdateWorkflowNodeRunAssignees(ctx, db.UpdateWorkflowNodeRunAssigneesParams{
		ID: nr.ID, WorkerType: issue.AssigneeType.String, WorkerID: issue.AssigneeID,
		CriticType: issue.CreatorType, CriticID: issue.CreatorID,
	})
	if err != nil {
		return nil, db.MulticaWorkflowNodeRun{}, fmt.Errorf("override assignees: %w", err)
	}
	// Dispatch root (format_checking → format_ok → dispatchWorker). dispatchWorker
	// reads node-run worker (Task 4) → agent/squad assignee. Member has no agent
	// task; dispatchWorker logs+skips when worker is a non-agent (accept for M1).
	s.DispatchRootNodeRuns(ctx, run.ID)
	// Scaffold Gitea (dormant no-op when unconfigured).
	go s.ScaffoldRunDeliverables(context.Background(), *run)
	return run, nr, nil
}
```
（执行时核对 `StartRun` 入参 `triggeredByType` 接受 "member"/"agent" 字符串、`issue.CreatorID` 类型；member 派单时 `DispatchRootNodeRuns→dispatchWorker` 对非 agent worker 的处理——若报错则在该路径加 `worker_type=="agent"||"squad"` 守卫。）

- [ ] **Step 4: 跑测试确认通过。**

- [ ] **Step 5: Commit**

```bash
git add server/internal/service/workflow.go server/internal/service/workflow_default_test.go
git commit -m "feat(workflow): StartDefaultRunForIssue for agent-assigned issues"
```

---

## Task 6: CreateIssue / UpdateIssue 接默认 workflow 路径（dormant-aware）

**Files:**
- Modify: `server/internal/handler/issue.go:2035-2045`（CreateIssue agent 分支）
- Modify: `server/internal/handler/issue.go:2415-2418`（UpdateIssue 改派 agent 分支）

- [ ] **Step 1: 写失败测试**（handler 层，可用现有 handler test 夹具；mock Gitea configured=true）

创建 agent 派单 Issue → 断言：产生 workflow_run（`issue.workflow_run_id` 非空）+ node-run worker=该 agent + agent 任务带 node-run id。Gitea 未配置时 → 退回 `EnqueueTaskForIssue`（无 workflow_run）。

- [ ] **Step 2: 跑确认失败。**

- [ ] **Step 3: 改 CreateIssue agent 分支**

把 `if h.shouldEnqueueAgentTask(...) { h.TaskService.EnqueueTaskForIssue(...) }` 改为：

```go
if h.shouldEnqueueAgentTask(r.Context(), issue) {
	if isGiteaConfigured() {
		run, _, err := h.WorkflowService.StartDefaultRunForIssue(ctx, issue)
		if err != nil {
			slog.Warn("default workflow run failed; fallback to bare task", "issue_id", uuidToString(issue.ID), "error", err)
			h.TaskService.EnqueueTaskForIssue(r.Context(), issue)
		} else {
			_, _ = h.Queries.UpdateIssue(ctx, db.UpdateIssueParams{
				ID: issue.ID, AssigneeType: issue.AssigneeType, AssigneeID: issue.AssigneeID,
				StartDate: issue.StartDate, DueDate: issue.DueDate, ParentIssueID: issue.ParentIssueID,
				ProjectID: issue.ProjectID, WorkflowID: run.WorkflowID, WorkflowRunID: run.ID,
			})
		}
	} else {
		h.TaskService.EnqueueTaskForIssue(r.Context(), issue)
	}
}
```

UpdateIssue 改派分支（`issue.go:2415`）同构改造：Gitea 配置 → `StartDefaultRunForIssue` + 回写 `WorkflowRunID`；否则原 `EnqueueTaskForIssue`。改派离开 agent（如 → workflow）时 `CancelRun` 既有逻辑保留。

- [ ] **Step 4: 跑测试确认通过**（含 dormant fallback 分支）。

- [ ] **Step 5: Commit**

```bash
git add server/internal/handler/issue.go server/internal/handler/*_test.go
git commit -m "feat(issue): route agent-assigned issues to default workflow (Gitea-gated)"
```

---

## Task 7: 默认 workflow 隐藏 + 不可绑为 assignee

**Files:**
- Modify: `server/internal/handler/workflow.go`（`ListWorkflows` 已在 Task 2 过滤；此处确认调用点用的是过滤后的查询）
- Modify: `server/internal/handler/issue.go:2582`（`validateAssigneePair` workflow 分支：拒绝 `is_default=true` 的 workflow 被绑）
- Test: `server/internal/handler/issue_test.go`（绑默认 workflow → 400）

- [ ] **Step 1: 写失败测试**——把默认 workflow id 作为 `assignee_id`+`assignee_type=workflow` 建 Issue → 期望 400。

- [ ] **Step 2: 跑确认失败。**

- [ ] **Step 3: 实现**——`validateAssigneePair` workflow 分支加：`if workflow.IsDefault { return errors.New("default workflow cannot be assigned") }`。确认 `ListWorkflows` handler 用 `ListWorkflowsExcludingTemplates`（已过滤 `is_default`）。

- [ ] **Step 4: 跑测试确认通过。**

- [ ] **Step 5: Commit**

```bash
git add server/internal/handler/workflow.go server/internal/handler/issue.go server/internal/handler/*_test.go
git commit -m "feat(workflow): hide default workflow + reject binding as issue assignee"
```

---

## Task 8: 全量校验

- [ ] **Step 1: Go 全量**

Run: `cd server && go vet ./... && go test ./...`
Expected: 全绿（DB 测试在 `golang:1.26-alpine` 容器内连 postgres 跑，见 memory）。

- [ ] **Step 2: dormant 行为复核**——Gitea 未配置（`GITEA_BASE_URL` 空）启动，建 agent Issue：行为与今天一致（裸 `EnqueueTaskForIssue`，无 workflow_run）。

- [ ] **Step 3: （可选，需本地 Gitea）端到端**——配 Gitea，建 agent 派单 Issue → 默认 run 自动 scaffold → 用 cs-workflow `gitea submit` 推文档 → 开 PR → 创建者 review approve → merge → Issue 执行面板出 PR 链接。

- [ ] **Step 4: 更新 spec/plan 状态 + memory**（`deliverable-git-storage-design` 追加 M4-默认 workflow M1 完成）。

---

## Self-Review（写完后自查）

- **Spec 覆盖**：M1 范围（agent 派单闭环、默认 workflow get-or-create、隐藏、dormant）→ Task 1-7 全覆盖。member 上传（M2）、squad（M3）、改派跨类型复用 run（M3）显式不在 M1。
- **类型一致**：`EnsureDefaultWorkflow` / `StartDefaultRunForIssue` / `UpdateWorkflowNodeRunAssignees` 在各 Task 名称一致。`StartRun` 入参以执行时核对为准（已标注）。
- **待执行时核对项**（非占位符，是精确动作）：`CreateWorkflowNodeDeliverable` 参数名；handler `ListWorkflows` 实际调用的查询名；`dispatchCritic` 读 node-run 改造；member worker 在 `dispatchWorker` 的守卫；`issue.CreatorType/CreaID` 字段名与类型。
