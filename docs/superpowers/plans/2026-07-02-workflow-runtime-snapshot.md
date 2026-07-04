# Workflow 运行时快照 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让每个 Workflow Run 在触发时持有一份不可变的定义快照（`workflow_snapshot`），执行路径只读快照，从而搭建者发布后继续编辑 active Workflow 不会破坏运行中的 Run；同时新增 `runtime_config_override` 临时配置覆盖机制（仅本次生效）。

**Architecture:** 在 `StartRun` 事务内序列化 workflow 的 nodes/edges/stages 为 JSONB 写入 `multica_workflow_run.workflow_snapshot`。新增 `runtimeDefinitionForRun` / `runtimeNodeForRun` service helper 解析快照（旧数据 `{}` 时 fallback 到 live 定义并记录 warning），并把所有执行路径（root 识别、下游推进、worker/critic 派发、format 校验、agent task 上下文、upstream stage 上下文）从回查 live 表改为从快照派生。`runtime_config_override` 经 `PATCH /api/node-runs/{id}/runtime-config` 写入，在 `runtimeNodeForRun` 内 shallow-merge 到 snapshot node 上，经现有 handback/rework 重新派发路径生效。

**Tech Stack:** Go (Chi, sqlc, pgx/v5)、PostgreSQL JSONB、TypeScript (Zod, TanStack Query, React)、Vitest、Go `go test`。

## Global Constraints

- 遵循 `apps/docs/content/docs/developers/conventions.mdx`：代码注释仅英文；UI 字符串中 `workflow`/`node`/`stage`/`run` 保持小写英文。
- API Response Compatibility（CLAUDE.md）：跨网络 JSON 必须经 Zod schema + `parseWithFallback`，禁止 bare `as`；optional-chain + `=== true`；enum drift 走 `default` 分支。
- 后端 UUID 约定：URL/body 输入走 `parseUUIDOrBadRequest`；sqlc 往返 UUID 用 `parseUUID`；写查询必须用 loader 解析后的 `entity.ID`。
- 迁移当前最高编号为 **128**；本计划使用 **129** 与 **130**。
- 不做 `bun test` 全量测试，只做相关模块测试；后端用 `go test`。
- 不新增兼容层/双写/legacy shim 给内部代码；`runtime_config_override` 的 merge 是执行真相计算，不是 shim。
- 「重试 failed/format_failed 节点」的完整 UX（前端按钮 + 可能的新后端 re-dispatch 动作）属于 Plan G，不在本计划范围。本计划只保证 override 经现有 handback（blocked→working）/ rework（critic_rework→format_ok）重新派发路径生效。

## File Structure

**新增文件：**
- `server/migrations/129_workflow_run_snapshot.up.sql` / `.down.sql` — `workflow_snapshot` 列。
- `server/migrations/130_workflow_node_run_runtime_config.up.sql` / `.down.sql` — `runtime_config_override` + `taken_over_by` 列。
- `server/internal/service/workflow_snapshot.go` — 快照序列化、`runtimeDefinitionForRun` / `runtimeNodeForRun`、override merge。
- `server/internal/service/workflow_snapshot_test.go` — 上述 helper 的单元测试。
- `packages/core/types/workflow-snapshot.ts` — `WorkflowSnapshot` TS 类型。

**修改文件：**
- `server/pkg/db/queries/workflow.sql` — `CreateWorkflowRun` 增加 `workflow_snapshot` 列。
- `server/pkg/db/queries/workflow_node_run.sql` — 新增 `SetWorkflowNodeRunRuntimeConfig`；扩展 `TakeoverWorkflowNodeRun` / `HandbackWorkflowNodeRun` 写 `taken_over_by`。
- `server/pkg/db/generated/*` — 由 `make sqlc` 重新生成（不手改）。
- `server/internal/service/workflow.go` — `StartRun` 写快照；`OnNodeRunCompleted` / `dispatchWorker` / `dispatchCritic` / `executeFormatChecker` / `DispatchAgentTask` 改用快照；新增 snapshot-based upstream helper。
- `server/internal/handler/workflow_run.go` — 响应 DTO 扩展；新增 `UpdateNodeRunRuntimeConfig` handler。
- `server/internal/handler/daemon.go` — `buildUpstreamStageContext` 改用 snapshot-based helper。
- `server/cmd/server/router.go` — 注册 `PATCH /api/node-runs/{nodeRunId}/runtime-config`。
- `packages/core/api/schemas.ts` — `WorkflowRunSchema` / `WorkflowNodeRunSchema` 扩展；新增 `WorkflowSnapshotSchema`。
- `packages/core/api/client.ts` — `getWorkflowRun` 修正信封解析；新增 `updateNodeRunRuntimeConfig`。
- `packages/core/types/workflow.ts` — `WorkflowRun` / `WorkflowNodeRun` 扩展。
- `packages/core/workflows/queries.ts` — 新增 `useUpdateNodeRunRuntimeConfig` mutation。
- `packages/views/issues/components/execution/execution-panorama-page.tsx` — 优先从 `workflow_snapshot` 渲染，fallback 到 live + 警告。
- `packages/views/locales/{en,zh-Hans}/issues.json` — 快照缺失警告文案。

---

### Task 1: 数据库迁移 129 + 130 + sqlc 重新生成

**Files:**
- Create: `server/migrations/129_workflow_run_snapshot.up.sql`
- Create: `server/migrations/129_workflow_run_snapshot.down.sql`
- Create: `server/migrations/130_workflow_node_run_runtime_config.up.sql`
- Create: `server/migrations/130_workflow_node_run_runtime_config.down.sql`
- Modify: `server/pkg/db/queries/workflow.sql`（`CreateWorkflowRun` 查询）
- Modify: `server/pkg/db/queries/workflow_node_run.sql`（新增 `SetWorkflowNodeRunRuntimeConfig`，扩展 `TakeoverWorkflowNodeRun` / `HandbackWorkflowNodeRun`）
- Regenerate: `server/pkg/db/generated/*`（由 `make sqlc` 生成）

**Interfaces:**
- Produces: `MulticaWorkflowRun.WorkflowSnapshot []byte`（json tag `workflow_snapshot`）；`MulticaWorkflowNodeRun.RuntimeConfigOverride []byte`（json tag `runtime_config_override`）、`TakenOverBy pgtype.UUID`（json tag `taken_over_by`）；`CreateWorkflowRunParams.WorkflowSnapshot []byte`；`Queries.SetWorkflowNodeRunRuntimeConfig(ctx, params) (MulticaWorkflowNodeRun, error)`；`TakeoverWorkflowNodeRun` / `HandbackWorkflowNodeRun` 签名增加 `taken_over_by` 参数。

- [ ] **Step 1: 写 129 up 迁移**

`server/migrations/129_workflow_run_snapshot.up.sql`:
```sql
-- Runtime snapshot: an immutable copy of the workflow definition captured at
-- StartRun time. Execution reads from this column, not the live definition
-- tables, so editing an active workflow does not break in-flight runs.
ALTER TABLE multica_workflow_run
    ADD COLUMN workflow_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;
```

- [ ] **Step 2: 写 129 down 迁移**

`server/migrations/129_workflow_run_snapshot.down.sql`:
```sql
ALTER TABLE multica_workflow_node_run
    DROP COLUMN IF EXISTS workflow_snapshot;
ALTER TABLE multica_workflow_run
    DROP COLUMN IF EXISTS workflow_snapshot;
```

注意：`multica_workflow_node_run` 没有 `workflow_snapshot` 列，`DROP COLUMN IF EXISTS` 是无害的占位（保持与 down 模板一致）。若觉得冗余可只保留 `multica_workflow_run` 那行。

- [ ] **Step 3: 写 130 up 迁移**

`server/migrations/130_workflow_node_run_runtime_config.up.sql`:
```sql
-- Per-run runtime config override: a partial node config applied on top of the
-- snapshot node when this node run is (re)dispatched. Affects only this run,
-- never the live workflow definition. taken_over_by records the user who took
-- over a blocked node, so the global prompt bar can flag "my" blocked nodes.
ALTER TABLE multica_workflow_node_run
    ADD COLUMN runtime_config_override JSONB,
    ADD COLUMN taken_over_by UUID REFERENCES multica_user(id) ON DELETE SET NULL;
```

- [ ] **Step 4: 写 130 down 迁移**

`server/migrations/130_workflow_node_run_runtime_config.down.sql`:
```sql
ALTER TABLE multica_workflow_node_run
    DROP COLUMN IF EXISTS taken_over_by,
    DROP COLUMN IF EXISTS runtime_config_override;
```

- [ ] **Step 5: 扩展 `CreateWorkflowRun` 查询**

`server/pkg/db/queries/workflow.sql`，找到 `CreateWorkflowRun`（约 150-156 行），改为：
```sql
-- name: CreateWorkflowRun :one
INSERT INTO multica_workflow_run (
    workflow_id, workspace_id, workflow_title, status,
    triggered_by_type, triggered_by_id, input, runtime_id, workflow_snapshot
) VALUES (
    $1, $2, $3, $4, $5, sqlc.narg('triggered_by_id'), sqlc.narg('input'), sqlc.narg('runtime_id'), sqlc.narg('workflow_snapshot')
) RETURNING *;
```

- [ ] **Step 6: 新增 `SetWorkflowNodeRunRuntimeConfig` 查询**

在 `server/pkg/db/queries/workflow_node_run.sql` 末尾追加：
```sql
-- name: SetWorkflowNodeRunRuntimeConfig :one
UPDATE multica_workflow_node_run
SET runtime_config_override = $2,
    updated_at = now()
WHERE id = $1
RETURNING *;
```

- [ ] **Step 7: 扩展 `TakeoverWorkflowNodeRun` / `HandbackWorkflowNodeRun`**

在 `server/pkg/db/queries/workflow_node_run.sql` 找到这两个查询。`TakeoverWorkflowNodeRun` 改为同时写 `taken_over_by`：
```sql
-- name: TakeoverWorkflowNodeRun :one
UPDATE multica_workflow_node_run
SET status = 'blocked',
    taken_over_by = sqlc.narg('taken_over_by'),
    updated_at = now()
WHERE id = $1
RETURNING *;
```
`HandbackWorkflowNodeRun` 改为清空 `taken_over_by`：
```sql
-- name: HandbackWorkflowNodeRun :one
UPDATE multica_workflow_node_run
SET status = 'working',
    taken_over_by = NULL,
    updated_at = now()
WHERE id = $1
RETURNING *;
```

注意：若现有查询的 SET 子句还包含其他列（如 `completed_at`），保留它们，只追加 `taken_over_by` 相关行。实现者须先读现有 SQL 再做最小改动。

- [ ] **Step 8: 运行 sqlc 重新生成**

Run: `make sqlc`
Expected: 无错误；`server/pkg/db/generated/models.go` 中 `MulticaWorkflowRun` 出现 `WorkflowSnapshot []byte`，`MulticaWorkflowNodeRun` 出现 `RuntimeConfigOverride []byte` 与 `TakenOverBy pgtype.UUID`；`workflow.sql.go` 中 `CreateWorkflowRunParams` 出现 `WorkflowSnapshot`；`workflow_node_run.sql.go` 出现 `SetWorkflowNodeRunRuntimeConfig` 及其 Params。

- [ ] **Step 9: 跑迁移并编译**

Run: `make migrate-up && cd server && go build ./...`
Expected: 迁移成功；Go 编译通过（此时新列尚未被使用，但 `CreateWorkflowRunParams` 多了字段，调用处 `StartRun` 仍能编译因为 Go 结构体字面量无需列全字段）。

- [ ] **Step 10: Commit**

```bash
git add server/migrations/129_workflow_run_snapshot.* server/migrations/130_workflow_node_run_runtime_config.* server/pkg/db/queries/workflow.sql server/pkg/db/queries/workflow_node_run.sql server/pkg/db/generated/
git commit -m "feat(workflow): add workflow_snapshot and runtime_config_override migrations"
```

---

### Task 2: Go 快照类型 + 序列化 + StartRun 写入快照

**Files:**
- Create: `server/internal/service/workflow_snapshot.go`
- Modify: `server/internal/service/workflow.go:184-258`（`StartRun`）
- Test: `server/internal/service/workflow_snapshot_test.go`

**Interfaces:**
- Consumes: `db.Queries` 的 `ListWorkflowNodes` / `ListWorkflowEdges` / `ListWorkflowStages`（在 StartRun 事务内已调用）。
- Produces: `buildWorkflowSnapshot(ctx, qtx, workflow) ([]byte, error)` —— 序列化快照为 JSONB；`StartRun` 在 `CreateWorkflowRun` 时传入 `WorkflowSnapshot`。

- [ ] **Step 1: 写快照序列化的失败测试**

`server/internal/service/workflow_snapshot_test.go`:
```go
package service

import (
	"context"
	"encoding/json"
	"testing"

	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestBuildWorkflowSnapshotSerializesNodesEdgesStages(t *testing.T) {
	// buildWorkflowSnapshotFromRows is the pure helper that takes already-loaded
	// rows and serializes them. We test it directly to avoid needing a DB.
	wf := db.MulticaWorkflow{
		ID:          uuidA(),
		Title:       "Bug Fix Flow",
		Description: "fix -> review",
		MaxRetries:  2,
	}
	nodes := []db.MulticaWorkflowNode{
		{ID: uuidA(), WorkflowID: wf.ID, Title: "Analyze", WorkerType: "agent", WorkerID: uuidB(), CriticType: "human"},
		{ID: uuidB(), WorkflowID: wf.ID, Title: "Fix", WorkerType: "agent", WorkerID: uuidB(), CriticType: "agent", CriticID: uuidC()},
	}
	edges := []db.MulticaWorkflowEdge{
		{ID: uuidD(), WorkflowID: wf.ID, SourceNodeID: uuidA(), TargetNodeID: uuidB()},
	}
	stages := []db.MulticaWorkflowStage{
		{ID: uuidE(), WorkflowID: wf.ID, Name: "Stage 1", SortOrder: 0},
	}

	raw, err := buildWorkflowSnapshotFromRows(wf, nodes, edges, stages)
	if err != nil {
		t.Fatalf("buildWorkflowSnapshotFromRows: %v", err)
	}

	var snap workflowSnapshot
	if err := json.Unmarshal(raw, &snap); err != nil {
		t.Fatalf("unmarshal snapshot: %v", err)
	}
	if snap.SnapshotVersion != 1 {
		t.Errorf("snapshot_version = %d, want 1", snap.SnapshotVersion)
	}
	if snap.Title != "Bug Fix Flow" || snap.MaxRetries != 2 {
		t.Errorf("title/max_retries mismatch: %+v", snap)
	}
	if len(snap.Nodes) != 2 || len(snap.Edges) != 1 || len(snap.Stages) != 1 {
		t.Errorf("counts mismatch: nodes=%d edges=%d stages=%d", len(snap.Nodes), len(snap.Edges), len(snap.Stages))
	}
	if snap.Nodes[0].WorkerID == nil || *snap.Nodes[0].WorkerID == "" {
		t.Errorf("worker_id not serialized for agent node")
	}
}
```

说明：`uuidA()` 等是测试辅助，下一步给出。若仓库已有测试 UUID helper（搜 `internal/service` 下 `*_test.go` 的 UUID 构造），复用之；否则在测试文件顶部加：
```go
func mustUUID(s string) pgtype.UUID {
	u, err := util.ParseUUID(s)
	if err != nil {
		panic(err)
	}
	return u
}
func uuidA() pgtype.UUID { return mustUUID("00000000-0000-0000-0000-000000000001") }
func uuidB() pgtype.UUID { return mustUUID("00000000-0000-0000-0000-000000000002") }
func uuidC() pgtype.UUID { return mustUUID("00000000-0000-0000-0000-000000000003") }
func uuidD() pgtype.UUID { return mustUUID("00000000-0000-0000-0000-000000000004") }
func uuidE() pgtype.UUID { return mustUUID("00000000-0000-0000-0000-000000000005") }
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd server && go test ./internal/service/ -run TestBuildWorkflowSnapshotSerializesNodesEdgesStages -v`
Expected: FAIL —— `buildWorkflowSnapshotFromRows` 未定义 / `workflowSnapshot` 类型未定义。

- [ ] **Step 3: 写快照类型与序列化实现**

`server/internal/service/workflow_snapshot.go`:
```go
package service

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/util"
)

// workflowSnapshot is the JSONB shape stored on multica_workflow_run.workflow_snapshot.
// It mirrors the TypeScript WorkflowSnapshot interface. Field names use snake_case
// json tags so the frontend Zod schema can parse it directly.
type workflowSnapshot struct {
	SnapshotVersion int             `json:"snapshot_version"`
	WorkflowID      string          `json:"workflow_id"`
	Title           string          `json:"title"`
	Description     string          `json:"description"`
	MaxRetries      int32           `json:"max_retries"`
	Nodes           []snapshotNode  `json:"nodes"`
	Edges           []snapshotEdge  `json:"edges"`
	Stages          []snapshotStage `json:"stages"`
}

type snapshotNode struct {
	ID           string          `json:"id"`
	Title        string          `json:"title"`
	Description  string          `json:"description"`
	PositionX    float64         `json:"position_x"`
	PositionY    float64         `json:"position_y"`
	FormatSchema json.RawMessage `json:"format_schema"`
	WorkerType   string          `json:"worker_type"`
	WorkerID     *string         `json:"worker_id"`
	CriticType   string          `json:"critic_type"`
	CriticID     *string         `json:"critic_id"`
	CriticApiUrl *string         `json:"critic_api_url"`
	SortOrder    int32           `json:"sort_order"`
	StageID      *string         `json:"stage_id"`
}

type snapshotEdge struct {
	ID           string          `json:"id"`
	SourceNodeID string          `json:"source_node_id"`
	TargetNodeID string          `json:"target_node_id"`
	Condition    json.RawMessage `json:"condition"`
}

type snapshotStage struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	SortOrder   int32  `json:"sort_order"`
}

// buildWorkflowSnapshotFromRows serializes already-loaded workflow rows into the
// JSONB snapshot. Pure function (no DB) so it is unit-testable.
func buildWorkflowSnapshotFromRows(wf db.MulticaWorkflow, nodes []db.MulticaWorkflowNode, edges []db.MulticaWorkflowEdge, stages []db.MulticaWorkflowStage) ([]byte, error) {
	snap := workflowSnapshot{
		SnapshotVersion: 1,
		WorkflowID:      util.UUIDToString(wf.ID),
		Title:           wf.Title,
		Description:     wf.Description,
		MaxRetries:      wf.MaxRetries,
		Nodes:           make([]snapshotNode, 0, len(nodes)),
		Edges:           make([]snapshotEdge, 0, len(edges)),
		Stages:          make([]snapshotStage, 0, len(stages)),
	}
	for _, n := range nodes {
		snap.Nodes = append(snap.Nodes, snapshotNode{
			ID:           util.UUIDToString(n.ID),
			Title:        n.Title,
			Description:  n.Description,
			PositionX:    n.PositionX,
			PositionY:    n.PositionY,
			FormatSchema: json.RawMessage(n.FormatSchema),
			WorkerType:   n.WorkerType,
			WorkerID:     pgUUIDToPtr(n.WorkerID),
			CriticType:   n.CriticType,
			CriticID:     pgUUIDToPtr(n.CriticID),
			CriticApiUrl: pgTextToPtr(n.CriticApiUrl),
			SortOrder:    n.SortOrder,
			StageID:      pgUUIDToPtr(n.StageID),
		})
	}
	for _, e := range edges {
		snap.Edges = append(snap.Edges, snapshotEdge{
			ID:           util.UUIDToString(e.ID),
			SourceNodeID: util.UUIDToString(e.SourceNodeID),
			TargetNodeID: util.UUIDToString(e.TargetNodeID),
			Condition:    json.RawMessage(e.Condition),
		})
	}
	for _, s := range stages {
		snap.Stages = append(snap.Stages, snapshotStage{
			ID:          util.UUIDToString(s.ID),
			Name:        s.Name,
			Description: s.Description,
			SortOrder:   s.SortOrder,
		})
	}
	return json.Marshal(snap)
}

// buildWorkflowSnapshot loads live rows inside the StartRun transaction and
// serializes them. Called once per run; the result is the immutable snapshot.
func buildWorkflowSnapshot(ctx context.Context, q *db.Queries, wf db.MulticaWorkflow) ([]byte, error) {
	nodes, err := q.ListWorkflowNodes(ctx, wf.ID)
	if err != nil {
		return nil, err
	}
	edges, err := q.ListWorkflowEdges(ctx, wf.ID)
	if err != nil {
		return nil, err
	}
	stages, err := q.ListWorkflowStages(ctx, wf.ID)
	if err != nil {
		return nil, err
	}
	return buildWorkflowSnapshotFromRows(wf, nodes, edges, stages)
}

func pgUUIDToPtr(u pgtype.UUID) *string {
	if !u.Valid {
		return nil
	}
	s := util.UUIDToString(u)
	return &s
}

func pgTextToPtr(t pgtype.Text) *string {
	if !t.Valid {
		return nil
	}
	return &t.String
}
```

注意：`db.MulticaWorkflow.MaxRetries` 字段类型确认（见 generated models.go）；若为 `int32` 则直接用，若为 `pgtype.Int4` 则改为 `wf.MaxRetries.Int32`。实现者须以实际生成类型为准。`util.UUIDToString` 已在仓库使用（见 `workflow.go` 现有代码）。

- [ ] **Step 4: 运行测试验证通过**

Run: `cd server && go test ./internal/service/ -run TestBuildWorkflowSnapshotSerializesNodesEdgesStages -v`
Expected: PASS。

- [ ] **Step 5: 在 `StartRun` 中写入快照**

修改 `server/internal/service/workflow.go` 的 `StartRun`（184-258 行）。在 `runInTx` 内、调用 `CreateWorkflowRun` 之前，构建快照并传入参数。把 `CreateWorkflowRun` 调用改为：

```go
		snapshot, err := buildWorkflowSnapshot(ctx, qtx, workflow)
		if err != nil {
			return fmt.Errorf("build workflow snapshot: %w", err)
		}

		r, err := qtx.CreateWorkflowRun(ctx, db.CreateWorkflowRunParams{
			WorkflowID:      workflow.ID,
			WorkspaceID:     workflow.WorkspaceID,
			WorkflowTitle:   workflow.Title,
			Status:          "running",
			TriggeredByType: triggeredByType,
			TriggeredByID:   triggeredByUUID,
			Input:           input,
			RuntimeID:       runtimeID,
			WorkflowSnapshot: snapshot,
		})
```

注意：事务内随后已 `ListWorkflowNodes` / `ListWorkflowEdges`，可复用其结果避免二次查询。实现者可选择：保留 `buildWorkflowSnapshot` 内部查询（简单，多一次 SELECT，可接受），或重构为先 List 一次再传给 `buildWorkflowSnapshotFromRows`（DRY）。推荐后者：把 nodes/edges 提前 List，传给 `buildWorkflowSnapshotFromRows`，后续 root 检测复用同一 `nodes`/`edges` 变量。

- [ ] **Step 6: 验证 StartRun 集成（需要测试 DB）**

写一个 `StartRun` 集成测试，断言返回的 `run.WorkflowSnapshot` 非空且能反序列化。若仓库 `internal/service` 已有 DB 测试 fixture（搜 `setupTestService` 或类似），复用之；否则跳过集成测试，依赖 Task 3 的 helper 测试 + 后续 E2E。实现者按仓库实际测试基础设施决定。

- [ ] **Step 7: 编译并跑相关测试**

Run: `cd server && go build ./... && go test ./internal/service/ -run TestBuildWorkflowSnapshot -v`
Expected: 编译通过；测试 PASS。

- [ ] **Step 8: Commit**

```bash
git add server/internal/service/workflow_snapshot.go server/internal/service/workflow_snapshot_test.go server/internal/service/workflow.go
git commit -m "feat(workflow): serialize and persist workflow_snapshot on StartRun"
```

---

### Task 3: `runtimeDefinitionForRun` + `runtimeNodeForRun`（含 override merge 与 legacy fallback）

**Files:**
- Modify: `server/internal/service/workflow_snapshot.go`
- Test: `server/internal/service/workflow_snapshot_test.go`

**Interfaces:**
- Consumes: `db.Queries` 的 `GetWorkflowRun` / `ListWorkflowNodes` / `ListWorkflowEdges` / `ListWorkflowStages` / `GetWorkflowNode`；`nodeRun.RuntimeConfigOverride`。
- Produces:
  - `type RuntimeNode struct{...}` / `RuntimeEdge` / `RuntimeStage` / `RuntimeWorkflowDefinition`
  - `runtimeDefinitionForRun(ctx, q, run) (RuntimeWorkflowDefinition, error)`
  - `runtimeNodeForRun(ctx, q, nodeRun) (RuntimeNode, error)` —— 返回 snapshot node + override merge 后的结果。

merge 规则（shallow）：override JSONB 中 `worker_type`/`worker_id`/`critic_type`/`critic_id`/`critic_api_url`/`format_schema` 顶层字段覆盖 snapshot node；`id`/`workflow_id`/`stage_id` 不允许覆盖（忽略）。

- [ ] **Step 1: 写 runtimeNodeForRun override merge 的失败测试**

追加到 `server/internal/service/workflow_snapshot_test.go`：
```go
func TestMergeRuntimeConfigOverrideAppliesTopLevelFields(t *testing.T) {
	base := RuntimeNode{
		ID:         uuidA(),
		Title:      "Analyze",
		WorkerType: "human",
		CriticType: "agent",
		CriticID:   uuidC(),
	}
	// override: switch worker to a specific agent, change critic_type to api.
	override := []byte(`{"worker_type":"agent","worker_id":"00000000-0000-0000-0000-000000000002","critic_type":"api","critic_api_url":"https://example.com/review"}`)

	merged := mergeOverride(base, override)
	if merged.WorkerType != "agent" {
		t.Errorf("worker_type not overridden: %s", merged.WorkerType)
	}
	if util.UUIDToString(merged.WorkerID) != "00000000-0000-0000-0000-000000000002" {
		t.Errorf("worker_id not overridden: %s", util.UUIDToString(merged.WorkerID))
	}
	if merged.CriticType != "api" {
		t.Errorf("critic_type not overridden: %s", merged.CriticType)
	}
	if !merged.CriticApiUrl.Valid || merged.CriticApiUrl.String != "https://example.com/review" {
		t.Errorf("critic_api_url not overridden: %+v", merged.CriticApiUrl)
	}
	// id / stage_id must NOT be overridable.
	if util.UUIDToString(merged.ID) != util.UUIDToString(base.ID) {
		t.Errorf("id was overridden")
	}
}

func TestMergeRuntimeConfigOverrideMalformedJSONIsIgnored(t *testing.T) {
	base := RuntimeNode{ID: uuidA(), WorkerType: "human"}
	merged := mergeOverride(base, []byte(`{not valid json`))
	if merged.WorkerType != "human" {
		t.Errorf("malformed override mutated base: %+v", merged)
	}
}
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd server && go test ./internal/service/ -run TestMergeRuntimeConfigOverride -v`
Expected: FAIL —— `RuntimeNode` / `mergeOverride` 未定义。

- [ ] **Step 3: 写 Runtime 类型与 merge 实现**

追加到 `server/internal/service/workflow_snapshot.go`：
```go
// RuntimeNode / RuntimeEdge / RuntimeStage mirror the DB row shapes but are
// derived from the snapshot (not live). Dispatch code consumes them exactly as
// it previously consumed db.MulticaWorkflowNode etc.
type RuntimeNode struct {
	ID           pgtype.UUID
	WorkflowID   pgtype.UUID
	Title        string
	Description  string
	PositionX    float64
	PositionY    float64
	FormatSchema []byte
	WorkerType   string
	WorkerID     pgtype.UUID
	CriticType   string
	CriticID     pgtype.UUID
	CriticApiUrl pgtype.Text
	SortOrder    int32
	StageID      pgtype.UUID
}

type RuntimeEdge struct {
	ID           pgtype.UUID
	SourceNodeID pgtype.UUID
	TargetNodeID pgtype.UUID
	Condition    []byte
}

type RuntimeStage struct {
	ID          pgtype.UUID
	WorkflowID  pgtype.UUID
	Name        string
	Description string
	SortOrder   int32
}

type RuntimeWorkflowDefinition struct {
	WorkflowID pgtype.UUID
	Title      string
	MaxRetries int32
	NodesByID  map[string]RuntimeNode
	Edges      []RuntimeEdge
	Stages     []RuntimeStage
}

// runtimeDefinitionForRun parses the run's workflow_snapshot. For legacy runs
// with an empty {} snapshot, it falls back to the live definition and logs a
// warning. New runs always carry a non-empty snapshot (see StartRun).
func runtimeDefinitionForRun(ctx context.Context, q *db.Queries, run db.MulticaWorkflowRun) (RuntimeWorkflowDefinition, error) {
	if len(run.WorkflowSnapshot) > 0 && string(run.WorkflowSnapshot) != "{}" {
		def, err := parseSnapshotDefinition(run.WorkflowSnapshot)
		if err == nil {
			return def, nil
		}
		slog.Warn("workflow snapshot parse failed, falling back to live definition",
			"run_id", util.UUIDToString(run.ID), "error", err)
	}
	return loadLiveDefinition(ctx, q, run)
}

func parseSnapshotDefinition(raw []byte) (RuntimeWorkflowDefinition, error) {
	var snap workflowSnapshot
	if err := json.Unmarshal(raw, &snap); err != nil {
		return RuntimeWorkflowDefinition{}, err
	}
	def := RuntimeWorkflowDefinition{
		WorkflowID: util.UUIDFromStringOrZero(snap.WorkflowID),
		Title:      snap.Title,
		MaxRetries: snap.MaxRetries,
		NodesByID:  make(map[string]RuntimeNode, len(snap.Nodes)),
		Edges:      make([]RuntimeEdge, 0, len(snap.Edges)),
		Stages:     make([]RuntimeStage, 0, len(snap.Stages)),
	}
	for _, n := range snap.Nodes {
		rn := snapshotNodeToRuntime(n)
		def.NodesByID[n.ID] = rn
	}
	for _, e := range snap.Edges {
		def.Edges = append(def.Edges, snapshotEdgeToRuntime(e))
	}
	for _, s := range snap.Stages {
		def.Stages = append(def.Stages, snapshotStageToRuntime(s))
	}
	return def, nil
}

func loadLiveDefinition(ctx context.Context, q *db.Queries, run db.MulticaWorkflowRun) (RuntimeWorkflowDefinition, error) {
	wf, err := q.GetWorkflow(ctx, run.WorkflowID)
	if err != nil {
		return RuntimeWorkflowDefinition{}, err
	}
	nodes, err := q.ListWorkflowNodes(ctx, run.WorkflowID)
	if err != nil {
		return RuntimeWorkflowDefinition{}, err
	}
	edges, err := q.ListWorkflowEdges(ctx, run.WorkflowID)
	if err != nil {
		return RuntimeWorkflowDefinition{}, err
	}
	stages, err := q.ListWorkflowStages(ctx, run.WorkflowID)
	if err != nil {
		return RuntimeWorkflowDefinition{}, err
	}
	def := RuntimeWorkflowDefinition{
		WorkflowID: wf.ID,
		Title:      wf.Title,
		MaxRetries: wf.MaxRetries,
		NodesByID:  make(map[string]RuntimeNode, len(nodes)),
		Edges:      make([]RuntimeEdge, 0, len(edges)),
		Stages:     make([]RuntimeStage, 0, len(stages)),
	}
	for _, n := range nodes {
		def.NodesByID[util.UUIDToString(n.ID)] = dbNodeToRuntime(n)
	}
	for _, e := range edges {
		def.Edges = append(def.Edges, dbEdgeToRuntime(e))
	}
	for _, s := range stages {
		def.Stages = append(def.Stages, dbStageToRuntime(s))
	}
	return def, nil
}

// runtimeNodeForRun returns the effective RuntimeNode for a node run: the
// snapshot node with runtime_config_override shallow-merged on top. This is
// the single source of truth for what config a (re)dispatch uses.
func runtimeNodeForRun(ctx context.Context, q *db.Queries, nodeRun db.MulticaWorkflowNodeRun) (RuntimeNode, error) {
	run, err := q.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
	if err != nil {
		return RuntimeNode{}, err
	}
	def, err := runtimeDefinitionForRun(ctx, q, run)
	if err != nil {
		return RuntimeNode{}, err
	}
	node, ok := def.NodesByID[util.UUIDToString(nodeRun.WorkflowNodeID)]
	if !ok {
		// Fallback for legacy runs whose snapshot lacks this node.
		slog.Warn("node missing from snapshot, falling back to live node",
			"node_run_id", util.UUIDToString(nodeRun.ID),
			"workflow_node_id", util.UUIDToString(nodeRun.WorkflowNodeID))
		live, err := q.GetWorkflowNode(ctx, nodeRun.WorkflowNodeID)
		if err != nil {
			return RuntimeNode{}, err
		}
		node = dbNodeToRuntime(live)
	}
	return mergeOverride(node, nodeRun.RuntimeConfigOverride), nil
}

// mergeOverride shallow-merges a runtime_config_override JSONB onto a RuntimeNode.
// Only top-level runtime-safe fields are honored; id/workflow_id/stage_id are
// ignored. Malformed JSON is ignored (node unchanged) — a bad override must not
// crash dispatch.
func mergeOverride(node RuntimeNode, override []byte) RuntimeNode {
	if len(override) == 0 {
		return node
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(override, &raw); err != nil {
		return node
	}
	if v, ok := raw["worker_type"]; ok {
		_ = json.Unmarshal(v, &node.WorkerType)
	}
	if v, ok := raw["worker_id"]; ok {
		var s *string
		if json.Unmarshal(v, &s) == nil && s != nil {
			node.WorkerID = util.UUIDFromStringOrZero(*s)
		}
	}
	if v, ok := raw["critic_type"]; ok {
		_ = json.Unmarshal(v, &node.CriticType)
	}
	if v, ok := raw["critic_id"]; ok {
		var s *string
		if json.Unmarshal(v, &s) == nil && s != nil {
			node.CriticID = util.UUIDFromStringOrZero(*s)
		}
	}
	if v, ok := raw["critic_api_url"]; ok {
		var s *string
		if json.Unmarshal(v, &s) == nil && s != nil {
			node.CriticApiUrl = pgtype.Text{String: *s, Valid: true}
		} else {
			node.CriticApiUrl = pgtype.Text{}
		}
	}
	if v, ok := raw["format_schema"]; ok {
		node.FormatSchema = v
	}
	return node
}

func snapshotNodeToRuntime(n snapshotNode) RuntimeNode {
	return RuntimeNode{
		ID:           util.UUIDFromStringOrZero(n.ID),
		Title:        n.Title,
		Description:  n.Description,
		PositionX:    n.PositionX,
		PositionY:    n.PositionY,
		FormatSchema: []byte(n.FormatSchema),
		WorkerType:   n.WorkerType,
		WorkerID:     ptrToUUID(n.WorkerID),
		CriticType:   n.CriticType,
		CriticID:     ptrToUUID(n.CriticID),
		CriticApiUrl: ptrToText(n.CriticApiUrl),
		SortOrder:    n.SortOrder,
		StageID:      ptrToUUID(n.StageID),
	}
}
func snapshotEdgeToRuntime(e snapshotEdge) RuntimeEdge {
	return RuntimeEdge{
		ID:           util.UUIDFromStringOrZero(e.ID),
		SourceNodeID: util.UUIDFromStringOrZero(e.SourceNodeID),
		TargetNodeID: util.UUIDFromStringOrZero(e.TargetNodeID),
		Condition:    []byte(e.Condition),
	}
}
func snapshotStageToRuntime(s snapshotStage) RuntimeStage {
	return RuntimeStage{ID: util.UUIDFromStringOrZero(s.ID), Name: s.Name, Description: s.Description, SortOrder: s.SortOrder}
}
func dbNodeToRuntime(n db.MulticaWorkflowNode) RuntimeNode {
	return RuntimeNode{
		ID: n.ID, WorkflowID: n.WorkflowID, Title: n.Title, Description: n.Description,
		PositionX: n.PositionX, PositionY: n.PositionY, FormatSchema: n.FormatSchema,
		WorkerType: n.WorkerType, WorkerID: n.WorkerID, CriticType: n.CriticType,
		CriticID: n.CriticID, CriticApiUrl: n.CriticApiUrl, SortOrder: n.SortOrder, StageID: n.StageID,
	}
}
func dbEdgeToRuntime(e db.MulticaWorkflowEdge) RuntimeEdge {
	return RuntimeEdge{ID: e.ID, SourceNodeID: e.SourceNodeID, TargetNodeID: e.TargetNodeID, Condition: e.Condition}
}
func dbStageToRuntime(s db.MulticaWorkflowStage) RuntimeStage {
	return RuntimeStage{ID: s.ID, WorkflowID: s.WorkflowID, Name: s.Name, Description: s.Description, SortOrder: s.SortOrder}
}

func ptrToUUID(s *string) pgtype.UUID {
	if s == nil || *s == "" {
		return pgtype.UUID{}
	}
	return util.UUIDFromStringOrZero(*s)
}
func ptrToText(s *string) pgtype.Text {
	if s == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: *s, Valid: true}
}
```

注意：`util.UUIDFromStringOrZero` 若仓库不存在则需新增（在 `server/pkg/util/uuid.go`，返回零 UUID on error）。实现者先搜 `pkg/util` 确认；若已有 `util.ParseUUID` 返回 `(pgtype.UUID, error)`，则 `UUIDFromStringOrZero` 封装为忽略 error 返回零值。

- [ ] **Step 4: 运行测试验证通过**

Run: `cd server && go test ./internal/service/ -run TestMergeRuntimeConfigOverride -v`
Expected: PASS。

- [ ] **Step 5: 写 runtimeDefinitionForRun fallback 测试（纯函数 parseSnapshotDefinition）**

追加：
```go
func TestParseSnapshotDefinitionBuildsNodesByID(t *testing.T) {
	raw, err := buildWorkflowSnapshotFromRows(
		db.MulticaWorkflow{ID: uuidA(), Title: "T", MaxRetries: 1},
		[]db.MulticaWorkflowNode{{ID: uuidA(), Title: "N1", WorkerType: "human"}},
		[]db.MulticaWorkflowEdge{{ID: uuidD(), SourceNodeID: uuidA(), TargetNodeID: uuidB()}},
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	def, err := parseSnapshotDefinition(raw)
	if err != nil {
		t.Fatal(err)
	}
	if def.Title != "T" || def.MaxRetries != 1 {
		t.Errorf("meta mismatch: %+v", def)
	}
	if _, ok := def.NodesByID[util.UUIDToString(uuidA())]; !ok {
		t.Errorf("node N1 not in NodesByID")
	}
	if len(def.Edges) != 1 {
		t.Errorf("edges count = %d", len(def.Edges))
	}
}
```

- [ ] **Step 6: 运行全部快照测试**

Run: `cd server && go test ./internal/service/ -run "Snapshot|MergeRuntimeConfig|ParseSnapshot" -v`
Expected: 全部 PASS。

- [ ] **Step 7: Commit**

```bash
git add server/internal/service/workflow_snapshot.go server/internal/service/workflow_snapshot_test.go server/pkg/util/  # 若新增了 UUIDFromStringOrZero
git commit -m "feat(workflow): add runtimeDefinitionForRun and runtimeNodeForRun with override merge"
```

---

### Task 4: `OnNodeRunCompleted` 改用 snapshot edges

**Files:**
- Modify: `server/internal/service/workflow.go:549-632`（`OnNodeRunCompleted`）
- Test: `server/internal/service/workflow_snapshot_test.go` 或新建 `workflow_test.go`

**Interfaces:**
- Consumes: `runtimeDefinitionForRun`、`db.Queries.ListWorkflowNodeRunsByRunAndNode`、`UpdateWorkflowNodeRunStatus`。

目标：把 `ListWorkflowEdgesBySource(nodeRun.WorkflowNodeID)` / `ListWorkflowEdgesByTarget(edge.TargetNodeID)`（查 live edges）改为从 `runtimeDefinitionForRun(run)` 取 `def.Edges` 过滤。

- [ ] **Step 1: 写下游推进的失败测试**

若 `internal/service` 有 DB 测试 fixture，写集成测试：构造一个 workflow（A→B），StartRun，complete A 的 node run，断言 B 推进到 `format_checking`；然后修改 live edge（删除 A→B），complete 另一个上游，断言 B 仍按 snapshot 推进。若无可用的 DB fixture，写一个针对纯辅助函数 `downstreamEdges(def, nodeID)` 与 `allUpstreamTerminal(def, nodeID, nodeRunStatusLookup)` 的单元测试。

纯函数测试追加到 `workflow_snapshot_test.go`：
```go
func TestDownstreamEdgesFromSnapshot(t *testing.T) {
	def := RuntimeWorkflowDefinition{
		Edges: []RuntimeEdge{
			{ID: uuidD(), SourceNodeID: uuidA(), TargetNodeID: uuidB()},
			{ID: uuidE(), SourceNodeID: uuidB(), TargetNodeID: uuidC()},
		},
	}
	got := downstreamEdges(def, uuidA())
	if len(got) != 1 || util.UUIDToString(got[0].TargetNodeID) != util.UUIDToString(uuidB()) {
		t.Errorf("downstreamEdges(A) = %+v", got)
	}
}

func TestUpstreamNodeIDsFromSnapshot(t *testing.T) {
	def := RuntimeWorkflowDefinition{
		Edges: []RuntimeEdge{
			{SourceNodeID: uuidA(), TargetNodeID: uuidC()},
			{SourceNodeID: uuidB(), TargetNodeID: uuidC()},
		},
	}
	got := upstreamNodeIDs(def, uuidC())
	if len(got) != 2 {
		t.Errorf("expected 2 upstreams, got %d", len(got))
	}
}
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd server && go test ./internal/service/ -run "DownstreamEdges|UpstreamNodeIDs" -v`
Expected: FAIL —— 函数未定义。

- [ ] **Step 3: 写 helper 函数**

追加到 `server/internal/service/workflow_snapshot.go`：
```go
// downstreamEdges returns snapshot edges whose source is the given node.
func downstreamEdges(def RuntimeWorkflowDefinition, nodeID pgtype.UUID) []RuntimeEdge {
	out := []RuntimeEdge{}
	for _, e := range def.Edges {
		if uuidsEqual(e.SourceNodeID, nodeID) {
			out = append(out, e)
		}
	}
	return out
}

// upstreamNodeIDs returns snapshot source node IDs that point at the given node.
func upstreamNodeIDs(def RuntimeWorkflowDefinition, targetNodeID pgtype.UUID) []pgtype.UUID {
	out := []pgtype.UUID{}
	for _, e := range def.Edges {
		if uuidsEqual(e.TargetNodeID, targetNodeID) {
			out = append(out, e.SourceNodeID)
		}
	}
	return out
}

func uuidsEqual(a, b pgtype.UUID) bool {
	return a.Valid && b.Valid && a.Bytes == b.Bytes
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd server && go test ./internal/service/ -run "DownstreamEdges|UpstreamNodeIDs" -v`
Expected: PASS。

- [ ] **Step 5: 改造 `OnNodeRunCompleted` 使用 snapshot edges**

修改 `server/internal/service/workflow.go` 的 `OnNodeRunCompleted`（549-632 行）。把开头的 live edge 查询替换为 snapshot definition：

```go
	// Snapshot edges are the source of truth for downstream/upstream topology.
	def, err := runtimeDefinitionForRun(ctx, s.Queries, run)
	if err != nil {
		return fmt.Errorf("load runtime definition: %w", err)
	}

	edges := downstreamEdges(def, nodeRun.WorkflowNodeID)

	if err := s.runInTx(ctx, func(qtx *db.Queries) error {
		for _, edge := range edges {
			upstreamIDs := upstreamNodeIDs(def, edge.TargetNodeID)
			allUpstreamDone := true
			for _, upID := range upstreamIDs {
				upstreamNr, err := qtx.ListWorkflowNodeRunsByRunAndNode(ctx, db.ListWorkflowNodeRunsByRunAndNodeParams{
					WorkflowRunID:  run.ID,
					WorkflowNodeID: upID,
				})
				if err != nil || !isTerminalNodeRunStatus(upstreamNr.Status) {
					allUpstreamDone = false
					break
				}
			}
			if allUpstreamDone {
				dnr, err := qtx.ListWorkflowNodeRunsByRunAndNode(ctx, db.ListWorkflowNodeRunsByRunAndNodeParams{
					WorkflowRunID:  run.ID,
					WorkflowNodeID: edge.TargetNodeID,
				})
				if err != nil {
					continue
				}
				if dnr.Status == NodeRunStatusPending {
					if _, err := qtx.UpdateWorkflowNodeRunStatus(ctx, db.UpdateWorkflowNodeRunStatusParams{
						ID:     dnr.ID,
						Status: NodeRunStatusFormatChecking,
					}); err != nil {
						return fmt.Errorf("advance downstream node: %w", err)
					}
				}
			}
		}
		return nil
	}); err != nil {
		return err
	}
```

保留函数末尾的 `executeFormatChecker` 触发与 `checkRunCompletion` 调用不变。

- [ ] **Step 6: 编译并跑测试**

Run: `cd server && go build ./... && go test ./internal/service/ -run "DownstreamEdges|UpstreamNodeIDs|Snapshot|MergeRuntimeConfig" -v`
Expected: 编译通过；测试 PASS。

- [ ] **Step 7: Commit**

```bash
git add server/internal/service/workflow.go server/internal/service/workflow_snapshot.go server/internal/service/workflow_snapshot_test.go
git commit -m "refactor(workflow): OnNodeRunCompleted uses snapshot edges for downstream propagation"
```

---

### Task 5: `dispatchWorker` / `dispatchCritic` / `executeFormatChecker` / `DispatchAgentTask` 改用 `runtimeNodeForRun`

**Files:**
- Modify: `server/internal/service/workflow.go:827-870`（`dispatchWorker`）
- Modify: `server/internal/service/workflow.go:872-915`（`dispatchCritic`）
- Modify: `server/internal/service/workflow.go:1039-1088`（`executeFormatChecker`）
- Modify: `server/internal/service/workflow.go:919-1035`（`DispatchAgentTask`）
- Modify: `server/internal/service/workflow.go:494-530`（`dispatchHandbackResume`，若它读 live node）
- Modify: `server/internal/service/workflow.go:1462-1504`（`dispatchWorkerResume`，若它读 live node）

**Interfaces:**
- Consumes: `runtimeNodeForRun`、`runtimeDefinitionForRun`、`RuntimeNode`（形状同 `db.MulticaWorkflowNode`，dispatch 代码字段名一致）。

目标：每处 `node, err := s.Queries.GetWorkflowNode(ctx, nodeRun.WorkflowNodeID)` 改为 `node, err := s.runtimeNodeForRun(ctx, nodeRun)`，返回的 `RuntimeNode` 字段与 `db.MulticaWorkflowNode` 同名（`Title`/`WorkerType`/`WorkerID`/`CriticType`/`CriticID`/`CriticApiUrl`/`FormatSchema`/`StageID`/`SortOrder`/`ID`/`WorkflowID`）。`DispatchAgentTask` 中 `workflow, err := s.Queries.GetWorkflow(...)` 用于取 `Title` 的部分改为 `def, err := runtimeDefinitionForRun(ctx, s.Queries, run)` 取 `def.Title`，但解析 agent/squad/runtime 仍走 live 查询。

- [ ] **Step 1: 写 dispatchWorker 使用 override 的集成测试（若有 DB fixture）**

测试场景：构造 agent worker 节点的 node run，写入 `runtime_config_override` 切换 worker_id 到另一个 agent，调用 `dispatchWorker`，断言创建的 agent task 的 AgentID 是 override 指定的 agent。若无 DB fixture，跳过集成测试，依赖 Task 3 的 `mergeOverride` 单元测试 + Task 7 的 PATCH 端到端测试。

实现者按仓库 `internal/service` 实际 DB 测试能力决定。若跳过，在此步骤注明「依赖 Task 3 mergeOverride 单元测试覆盖 merge 正确性」。

- [ ] **Step 2: 改造 `dispatchWorker`**

`server/internal/service/workflow.go`，`dispatchWorker`（827-870 行），把第一行：
```go
	node, err := s.Queries.GetWorkflowNode(ctx, nodeRun.WorkflowNodeID)
	if err != nil {
		return fmt.Errorf("get node: %w", err)
	}
```
改为：
```go
	node, err := s.runtimeNodeForRun(ctx, nodeRun)
	if err != nil {
		return fmt.Errorf("load runtime node: %w", err)
	}
```
后续 `node.WorkerType` / `node.WorkerID` 等访问不变（`RuntimeNode` 同字段名）。`GetSquad(ctx, node.WorkerID)` 等 live actor 查询保留。

- [ ] **Step 3: 改造 `dispatchCritic`**

同 Step 2，把 `dispatchCritic`（872-915 行）开头的 `GetWorkflowNode` 改为 `s.runtimeNodeForRun(ctx, nodeRun)`。

- [ ] **Step 4: 改造 `executeFormatChecker`**

`executeFormatChecker`（1039-1088 行）开头：
```go
	node, err := qtx.GetWorkflowNode(ctx, nodeRun.WorkflowNodeID)
```
改为：
```go
	node, err := s.runtimeNodeForRun(ctx, nodeRun)
```
注意：`executeFormatChecker` 签名含 `qtx *db.Queries` 参数但内部 `runtimeNodeForRun` 用 `s.Queries`。可保留 `qtx` 用于 `GetWorkflowRun`（取 run.Input），或把 `run` 也从 `runtimeNodeForRun` 内部已取的 run 复用。最小改动：保留 `qtx.GetWorkflowRun` 取 run.Input 不变，仅替换 node 来源。`runtimeNodeForRun` 内部会再 GetWorkflowRun 一次（多一次查询，可接受）；若想避免，重构 `executeFormatChecker` 先取 run，再调 `runtimeDefinitionForRun` + `mergeOverride`。推荐最小改动版本。

- [ ] **Step 5: 改造 `DispatchAgentTask`**

`DispatchAgentTask`（919-1035 行）：
- 把 `node, err := s.Queries.GetWorkflowNode(...)` 改为 `node, err := s.runtimeNodeForRun(ctx, nodeRun)`。
- 把 `workflow, err := s.Queries.GetWorkflow(ctx, run.WorkflowID)` 改为：`def, err := runtimeDefinitionForRun(ctx, s.Queries, run)`，随后用 `def.Title` 替代 `workflow.Title`、`def.WorkflowID` 替代 `workflow.ID`。`contextPayload` 里 `workflow_id`/`workflow_title` 改用 `def`。其余 agent/squad/runtime 解析不变。

- [ ] **Step 6: 改造 `dispatchHandbackResume` / `dispatchWorkerResume`**

检查这两个函数（494-530、1462-1504 行）。若它们调用 `DispatchAgentTask`（已改），则它们自动获得 merged config，无需额外改动。若它们直接 `GetWorkflowNode`，同样替换为 `s.runtimeNodeForRun(ctx, nodeRun)`。实现者读代码确认。

- [ ] **Step 7: 编译并跑相关测试**

Run: `cd server && go build ./... && go test ./internal/service/ -run "Snapshot|MergeRuntimeConfig|Downstream|Upstream" -v`
Expected: 编译通过；测试 PASS。

- [ ] **Step 8: Commit**

```bash
git add server/internal/service/workflow.go
git commit -m "refactor(workflow): dispatch/format-check reads snapshot node with override merge"
```

---

### Task 6: 快照驱动的 upstream stage 上下文（替换 live join）

**Files:**
- Modify: `server/internal/service/workflow_snapshot.go`（新增 `listCompletedUpstreamFromSnapshot` helper）
- Modify: `server/internal/handler/daemon.go:1603-1678`（`buildUpstreamStageContext`）
- Test: `server/internal/service/workflow_snapshot_test.go`

**Interfaces:**
- Consumes: `runtimeDefinitionForRun`、`db.Queries.ListWorkflowNodeRunsByRun`。
- Produces: `(s *WorkflowService) ListCompletedUpstreamForNodeRun(ctx, nodeRun) ([]UpstreamNodeSummary, error)` —— 返回按 snapshot stage sort_order 排序的已完成上游 node run 摘要。

目标：现有 `ListCompletedUpstreamNodeRuns` SQL JOIN live `multica_workflow_node` / `multica_workflow_stage` 决定 stage 排序。改为基于 snapshot：从 `runtimeDefinitionForRun` 拿 node→stage 与 stage sort_order，在 Go 内过滤已完成的同 run 上游 node run。

- [ ] **Step 1: 写纯函数排序测试**

追加到 `workflow_snapshot_test.go`：
```go
func TestSortUpstreamBySnapshotStageOrder(t *testing.T) {
	def := RuntimeWorkflowDefinition{
		Stages: []RuntimeStage{
			{ID: uuidE(), Name: "S1", SortOrder: 0},
			{ID: uuidA(), Name: "S2", SortOrder: 1}, // reuse uuidA as a stage id is fine here
		},
		NodesByID: map[string]RuntimeNode{
			util.UUIDToString(uuidA()): {ID: uuidA(), Title: "N1", StageID: uuidE(), SortOrder: 0},
			util.UUIDToString(uuidB()): {ID: uuidB(), Title: "N2", StageID: uuidA(), SortOrder: 0},
		},
	}
	completed := []db.MulticaWorkflowNodeRun{
		{ID: uuidB(), WorkflowNodeID: uuidB(), Status: "completed", NodeTitle: "N2"},
		{ID: uuidA(), WorkflowNodeID: uuidA(), Status: "completed", NodeTitle: "N1"},
	}
	got := sortUpstreamBySnapshot(def, completed, uuidC()) // current node uuidC, not in list
	if len(got) != 2 {
		t.Fatalf("expected 2, got %d", len(got))
	}
	if got[0].NodeTitle != "N1" {
		t.Errorf("expected N1 first (stage S1 sort_order 0), got %s", got[0].NodeTitle)
	}
}
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd server && go test ./internal/service/ -run TestSortUpstreamBySnapshotStageOrder -v`
Expected: FAIL —— `sortUpstreamBySnapshot` 未定义。

- [ ] **Step 3: 写 helper**

追加到 `server/internal/service/workflow_snapshot.go`：
```go
// UpstreamNodeSummary is a compact view of a completed upstream node run,
// ordered by the snapshot's stage sort_order then node sort_order.
type UpstreamNodeSummary struct {
	ID             pgtype.UUID
	WorkflowNodeID pgtype.UUID
	NodeTitle      string
	Status         string
	WorkerOutput   []byte
}

// sortUpstreamBySnapshot filters completed node runs to those in earlier snapshot
// stages than the current node, then sorts by stage sort_order, node sort_order,
// created_at. Pure function for testability.
func sortUpstreamBySnapshot(def RuntimeWorkflowDefinition, candidates []db.MulticaWorkflowNodeRun, currentNodeID pgtype.UUID) []UpstreamNodeSummary {
	curNode, curOk := def.NodesByID[util.UUIDToString(currentNodeID)]
	var curStageOrder int32 = -1
	if curOk && curNode.StageID.Valid {
		for _, s := range def.Stages {
			if uuidsEqual(s.ID, curNode.StageID) {
				curStageOrder = s.SortOrder
				break
			}
		}
	}
	out := []UpstreamNodeSummary{}
	for _, nr := range candidates {
		if uuidsEqual(nr.WorkflowNodeID, currentNodeID) {
			continue
		}
		if nr.Status != NodeRunStatusCompleted {
			continue
		}
		n, ok := def.NodesByID[util.UUIDToString(nr.WorkflowNodeID)]
		if !ok {
			continue
		}
		stageOrder := int32(-1)
		if n.StageID.Valid {
			for _, s := range def.Stages {
				if uuidsEqual(s.ID, n.StageID) {
					stageOrder = s.SortOrder
					break
				}
			}
		}
		if stageOrder >= curStageOrder {
			continue
		}
		out = append(out, UpstreamNodeSummary{
			ID: nr.ID, WorkflowNodeID: nr.WorkflowNodeID, NodeTitle: nr.NodeTitle,
			Status: nr.Status, WorkerOutput: nr.WorkerOutput,
		})
	}
	// stable sort by stageOrder then node.SortOrder then created_at
	sort.SliceStable(out, func(i, j int) bool {
		oi, oj := stageOrderOf(def, out[i].WorkflowNodeID), stageOrderOf(def, out[j].WorkflowNodeID)
		if oi != oj {
			return oi < oj
		}
		ni, nj := def.NodesByID[util.UUIDToString(out[i].WorkflowNodeID)], def.NodesByID[util.UUIDToString(out[j].WorkflowNodeID)]
		if ni.SortOrder != nj.SortOrder {
			return ni.SortOrder < nj.SortOrder
		}
		return false
	})
	return out
}

func stageOrderOf(def RuntimeWorkflowDefinition, nodeID pgtype.UUID) int32 {
	n, ok := def.NodesByID[util.UUIDToString(nodeID)]
	if !ok || !n.StageID.Valid {
		return -1
	}
	for _, s := range def.Stages {
		if uuidsEqual(s.ID, n.StageID) {
			return s.SortOrder
		}
	}
	return -1
}
```

在文件 import 增加 `sort`。

- [ ] **Step 4: 运行测试验证通过**

Run: `cd server && go test ./internal/service/ -run TestSortUpstreamBySnapshotStageOrder -v`
Expected: PASS。

- [ ] **Step 5: 改造 `buildUpstreamStageContext`**

`server/internal/handler/daemon.go` 的 `buildUpstreamStageContext`（1603-1678 行）。把调用 `h.Queries.ListCompletedUpstreamNodeRuns(...)`（1625 行附近）替换为：

```go
	// Use snapshot-based upstream context so stage ordering follows the run's
	// immutable definition, not the live (possibly edited) tables.
	allRunNodeRuns, err := h.Queries.ListWorkflowNodeRunsByRun(ctx, nodeRun.WorkflowRunID)
	if err != nil {
		return nil
	}
	run, err := h.Queries.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
	if err != nil {
		return nil
	}
	def, err := service.RuntimeDefinitionForRun(ctx, h.Queries, run) // 若未导出则导出为 RuntimeDefinitionForRun
	upstream := service.SortUpstreamBySnapshot(def, allRunNodeRuns, nodeRun.WorkflowNodeID)
```

注意：`runtimeDefinitionForRun` / `sortUpstreamBySnapshot` 当前为包内未导出。`daemon.go` 在 `handler` 包，需导出为 `RuntimeDefinitionForRun` / `SortUpstreamBySnapshot`。实现者把这两个函数首字母大写并更新所有调用处。随后 `upstreamRows` 到 `UpstreamStageNode` 的映射逻辑保留（字段名 `ID`/`WorkflowNodeID`/`NodeTitle`/`Status`/`WorkerOutput` 与 `UpstreamNodeSummary` 一致），把 `ListCompletedUpstreamNodeRunsRow` 替换为 `UpstreamNodeSummary`。

- [ ] **Step 6: 保留旧 SQL 查询但不再调用**

`ListCompletedUpstreamNodeRuns` SQL 查询保留在 `workflow_node_run.sql`（避免迁移回退问题），但 Go 代码不再调用。若 lint 报未使用生成代码，忽略（生成代码本就可能有未用查询）。

- [ ] **Step 7: 编译并跑测试**

Run: `cd server && go build ./... && go test ./internal/service/ -run "Upstream|Snapshot" -v && go test ./internal/handler/ -run Upstream -v 2>/dev/null || true`
Expected: 编译通过；service 测试 PASS。

- [ ] **Step 8: Commit**

```bash
git add server/internal/service/workflow_snapshot.go server/internal/service/workflow_snapshot_test.go server/internal/handler/daemon.go
git commit -m "refactor(workflow): upstream stage context derived from run snapshot"
```

---

### Task 7: `PATCH /api/node-runs/{nodeRunId}/runtime-config` 端点

**Files:**
- Modify: `server/internal/handler/workflow_run.go`（新增 handler + request type + 路由）
- Modify: `server/cmd/server/router.go`（注册路由）
- Test: `server/internal/handler/workflow_run_test.go`（若存在；否则新建）

**Interfaces:**
- Consumes: `db.Queries.SetWorkflowNodeRunRuntimeConfig`、`loadNodeRunForWorkspace`。
- Produces: `PATCH /api/node-runs/{nodeRunId}/runtime-config`，body `{ runtime_config_override: unknown }`，返回更新后的 `WorkflowNodeRunResponse`。

- [ ] **Step 1: 写 handler 失败测试**

若 `internal/handler` 有 HTTP 测试 fixture（搜 `workflow_run_test.go`），写测试：PATCH 一个 node run 的 override，断言 200 且响应含 `runtime_config_override`。若无 fixture，写一个直接调用 `h.UpdateNodeRunRuntimeConfig` 的最小测试，或跳过单元测试依赖 E2E。实现者按仓库实际决定。下面给出 handler 代码，测试可针对性写。

- [ ] **Step 2: 写 request type 与 handler**

在 `server/internal/handler/workflow_run.go` 的 request types 区（16-31 行附近）追加：
```go
type UpdateNodeRunRuntimeConfigRequest struct {
	RuntimeConfigOverride json.RawMessage `json:"runtime_config_override"`
}
```

在文件末尾追加 handler：
```go
// UpdateNodeRunRuntimeConfig writes a per-run runtime config override for a node
// run. The override is shallow-merged onto the snapshot node when the node run
// is next (re)dispatched (e.g. via handback or critic rework). It never touches
// the live workflow definition.
func (h *Handler) UpdateNodeRunRuntimeConfig(w http.ResponseWriter, r *http.Request) {
	nodeRun, run, _, ok := h.loadNodeRunForWorkspace(w, r)
	if !ok {
		return
	}

	var req UpdateNodeRunRuntimeConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Reject override of identity fields up front — they are not runtime-safe.
	if len(req.RuntimeConfigOverride) > 0 {
		var raw map[string]json.RawMessage
		if err := json.Unmarshal(req.RuntimeConfigOverride, &raw); err != nil {
			writeError(w, http.StatusBadRequest, "invalid runtime_config_override JSON")
			return
		}
		for _, forbidden := range []string{"id", "workflow_id", "stage_id"} {
			if _, ok := raw[forbidden]; ok {
				writeError(w, http.StatusBadRequest, "cannot override "+forbidden)
				return
			}
		}
	}

	updated, err := h.Queries.SetWorkflowNodeRunRuntimeConfig(r.Context(), db.SetWorkflowNodeRunRuntimeConfigParams{
		ID:                   nodeRun.ID,
		RuntimeConfigOverride: req.RuntimeConfigOverride,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update runtime config")
		return
	}

	resp := workflowNodeRunToResponse(updated)
	h.publish(protocol.EventWorkflowNodeRunUpdated, uuidToString(run.WorkspaceID), "member", requireUserIDRaw(r), map[string]any{
		"node_run": resp,
		"run_id":   uuidToString(run.ID),
	})
	writeJSON(w, http.StatusOK, resp)
}
```

注意：`SetWorkflowNodeRunRuntimeConfigParams` 字段名以 sqlc 生成为准（预计 `ID` 与 `RuntimeConfigOverride`）。`requireUserIDRaw` 若不存在则用现有 `requireUserID(w, r)` 返回的 userID（已在其他 handler 使用）。`protocol.EventWorkflowNodeRunUpdated` 若不存在，复用已有事件常量或新增（搜 `protocol.Event` 前缀）。`workflowNodeRunToResponse` 见 Task 8 扩展。

- [ ] **Step 3: 注册路由**

`server/cmd/server/router.go`，在 node-run action 路由块（558-565 行附近）追加：
```go
r.Patch("/api/node-runs/{nodeRunId}/runtime-config", h.UpdateNodeRunRuntimeConfig)
```

- [ ] **Step 4: 编译并跑测试**

Run: `cd server && go build ./... && go test ./internal/handler/ -run RuntimeConfig -v 2>/dev/null || cd server && go vet ./internal/handler/`
Expected: 编译通过；`go vet` 无错误。

- [ ] **Step 5: Commit**

```bash
git add server/internal/handler/workflow_run.go server/cmd/server/router.go
git commit -m "feat(workflow): PATCH /api/node-runs/:id/runtime-config writes per-run override"
```

---

### Task 8: 扩展 Go 响应 DTO（`workflow_snapshot` / `runtime_config_override` / `taken_over_by`）

**Files:**
- Modify: `server/internal/handler/workflow_run.go:35-72`（DTO）+ `workflowRunToResponse` / `workflowNodeRunToResponse` converter
- Test: `server/internal/handler/workflow_run_test.go`（可选）

**Interfaces:**
- Produces: `WorkflowRunResponse` 新增 `WorkflowSnapshot json.RawMessage`；`WorkflowNodeRunResponse` 新增 `RuntimeConfigOverride json.RawMessage` 与 `TakenOverBy *string`。

- [ ] **Step 1: 扩展 DTO 结构体**

`server/internal/handler/workflow_run.go`：
- `WorkflowRunResponse`（35-48 行）追加字段：
```go
	WorkflowSnapshot json.RawMessage `json:"workflow_snapshot"`
```
- `WorkflowNodeRunResponse`（50-72 行）追加字段：
```go
	RuntimeConfigOverride json.RawMessage `json:"runtime_config_override"`
	TakenOverBy           *string         `json:"taken_over_by"`
```

- [ ] **Step 2: 扩展 converter**

找到 `workflowRunToResponse` 与 `workflowNodeRunToResponse`（74 行之后）。在 `workflowRunToResponse` 中追加：
```go
	resp.WorkflowSnapshot = json.RawMessage(run.WorkflowSnapshot)
```
在 `workflowNodeRunToResponse` 中追加：
```go
	resp.RuntimeConfigOverride = json.RawMessage(nr.RuntimeConfigOverride)
	if nr.TakenOverBy.Valid {
		s := util.UUIDToString(nr.TakenOverBy)
		resp.TakenOverBy = &s
	}
```
注意 import `util`（若未导入）。`run.WorkflowSnapshot` / `nr.RuntimeConfigOverride` 为 `[]byte`，空时 `json.RawMessage(nil)` 会 marshal 为 `null`（符合 API 兼容性「提供 null fallback」）。

- [ ] **Step 3: 编译并跑 handler 测试**

Run: `cd server && go build ./... && go test ./internal/handler/ -run Workflow -v 2>/dev/null || true`
Expected: 编译通过。

- [ ] **Step 4: Commit**

```bash
git add server/internal/handler/workflow_run.go
git commit -m "feat(workflow): expose workflow_snapshot and runtime_config_override in responses"
```

---

### Task 9: 扩展 TS Zod schema / 类型 / 修正 `getWorkflowRun` 信封

**Files:**
- Create: `packages/core/types/workflow-snapshot.ts`
- Modify: `packages/core/api/schemas.ts:763-776`（`WorkflowRunSchema`）+ `WorkflowNodeRunSchema`
- Modify: `packages/core/api/client.ts:2042-2047`（`getWorkflowRun`）
- Modify: `packages/core/api/client.ts`（新增 `updateNodeRunRuntimeConfig`）
- Modify: `packages/core/types/workflow.ts`（`WorkflowRun` / `WorkflowNodeRun` 接口）
- Test: `packages/core/api/schemas.test.ts`（若存在）或新建

**Interfaces:**
- Produces: `WorkflowSnapshot` TS 类型与 `WorkflowSnapshotSchema`；`WorkflowRun.workflow_snapshot?: WorkflowSnapshot | null`；`WorkflowNodeRun.runtime_config_override?: unknown | null` 与 `taken_over_by?: string | null`；`api.updateNodeRunRuntimeConfig(nodeRunId, override)`。

- [ ] **Step 1: 写 schema 失败测试**

`packages/core/api/schemas.test.ts`（若不存在则新建）：
```ts
import { describe, it, expect } from "vitest";
import { WorkflowRunSchema, WorkflowNodeRunSchema } from "./schemas";

describe("WorkflowRunSchema snapshot compat", () => {
  it("parses run with workflow_snapshot", () => {
    const raw = {
      id: "r1", workflow_id: "w1", workspace_id: "ws", workflow_title: "T",
      status: "running", triggered_by_type: "member", triggered_by_id: null,
      started_at: "", created_at: "",
      workflow_snapshot: {
        snapshot_version: 1, workflow_id: "w1", title: "T", description: "",
        max_retries: 1, nodes: [], edges: [], stages: [],
      },
    };
    const r = WorkflowRunSchema.parse(raw);
    expect(r.workflow_snapshot).toBeDefined();
  });

  it("falls back when workflow_snapshot is null", () => {
    const r = WorkflowRunSchema.parse({ id: "r1", workflow_id: "w1", workspace_id: "ws", workflow_snapshot: null });
    expect(r.workflow_snapshot).toBeNull();
  });
});

describe("WorkflowNodeRunSchema override compat", () => {
  it("parses runtime_config_override and taken_over_by", () => {
    const r = WorkflowNodeRunSchema.parse({
      id: "nr1", workflow_run_id: "r1", workflow_node_id: "n1", node_title: "N",
      status: "blocked", retry_count: 0, worker_type: "human", critic_type: "human",
      critic_comment: "", created_at: "", updated_at: "",
      runtime_config_override: { worker_type: "agent" },
      taken_over_by: "u1",
    });
    expect(r.taken_over_by).toBe("u1");
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm --filter @multica/core exec vitest run api/schemas.test.ts`
Expected: FAIL —— `workflow_snapshot` / `taken_over_by` 字段不存在。

- [ ] **Step 3: 写 `WorkflowSnapshot` 类型与 schema**

`packages/core/types/workflow-snapshot.ts`:
```ts
export interface WorkflowSnapshotNode {
  id: string;
  title: string;
  description: string;
  position_x: number;
  position_y: number;
  format_schema: unknown;
  worker_type: string;
  worker_id: string | null;
  critic_type: string;
  critic_id: string | null;
  critic_api_url: string | null;
  sort_order: number;
  stage_id: string | null;
}

export interface WorkflowSnapshotEdge {
  id: string;
  source_node_id: string;
  target_node_id: string;
  condition: unknown;
}

export interface WorkflowSnapshotStage {
  id: string;
  name: string;
  description: string;
  sort_order: number;
}

export interface WorkflowSnapshot {
  snapshot_version: number;
  workflow_id: string;
  title: string;
  description: string;
  max_retries: number;
  nodes: WorkflowSnapshotNode[];
  edges: WorkflowSnapshotEdge[];
  stages: WorkflowSnapshotStage[];
}
```

- [ ] **Step 4: 扩展 Zod schema**

`packages/core/api/schemas.ts`。新增 `WorkflowSnapshotSchema`（在 `WorkflowRunSchema` 之前）：
```ts
export const WorkflowSnapshotNodeSchema = z.object({
  id: z.string(),
  title: z.string().default(""),
  description: z.string().default(""),
  position_x: z.number().default(0),
  position_y: z.number().default(0),
  format_schema: z.unknown().nullable().optional(),
  worker_type: z.string().default("human"),
  worker_id: z.string().nullable().default(null),
  critic_type: z.string().default("human"),
  critic_id: z.string().nullable().default(null),
  critic_api_url: z.string().nullable().default(null),
  sort_order: z.number().default(0),
  stage_id: z.string().nullable().default(null),
}).loose();

export const WorkflowSnapshotEdgeSchema = z.object({
  id: z.string(),
  source_node_id: z.string(),
  target_node_id: z.string(),
  condition: z.unknown().nullable().optional(),
}).loose();

export const WorkflowSnapshotStageSchema = z.object({
  id: z.string(),
  name: z.string().default(""),
  description: z.string().default(""),
  sort_order: z.number().default(0),
}).loose();

export const WorkflowSnapshotSchema = z.object({
  snapshot_version: z.number().default(1),
  workflow_id: z.string().default(""),
  title: z.string().default(""),
  description: z.string().default(""),
  max_retries: z.number().default(0),
  nodes: z.array(WorkflowSnapshotNodeSchema).default([]),
  edges: z.array(WorkflowSnapshotEdgeSchema).default([]),
  stages: z.array(WorkflowSnapshotStageSchema).default([]),
}).loose();
```

扩展 `WorkflowRunSchema`（763-776 行），在 `created_at` 后追加：
```ts
  workflow_snapshot: WorkflowSnapshotSchema.nullable().default(null),
```

扩展 `WorkflowNodeRunSchema`（802-826 行），追加：
```ts
  runtime_config_override: z.unknown().nullable().optional(),
  taken_over_by: z.string().nullable().default(null),
```

- [ ] **Step 5: 扩展 TS 类型**

`packages/core/types/workflow.ts`，在 `WorkflowRun` 接口追加 `workflow_snapshot?: WorkflowSnapshot | null`；在 `WorkflowNodeRun` 接口追加 `runtime_config_override?: unknown | null` 与 `taken_over_by?: string | null`。import `WorkflowSnapshot` from `./workflow-snapshot`。

- [ ] **Step 6: 修正 `getWorkflowRun` 信封解析 + 新增 `updateNodeRunRuntimeConfig`**

`packages/core/api/client.ts:2042-2047`，替换 `getWorkflowRun`：
```ts
  async getWorkflowRun(workflowId: string, runId: string): Promise<WorkflowRun> {
    const raw = await this.fetch<unknown>(`/api/workflows/${workflowId}/runs/${runId}`);
    // GET endpoint returns { run, node_runs }; POST start returns the bare run.
    const runPayload =
      raw && typeof raw === "object" && "run" in raw
        ? (raw as { run: unknown }).run
        : raw;
    return parseWithFallback(runPayload, WorkflowRunSchema, EMPTY_WORKFLOW_RUN, {
      endpoint: "GET /api/workflows/:id/runs/:runId",
    });
  }
```

在 `finalizeNodeRun` 之后追加：
```ts
  async updateNodeRunRuntimeConfig(nodeRunId: string, override: unknown): Promise<WorkflowNodeRun> {
    const raw = await this.fetch<unknown>(`/api/node-runs/${nodeRunId}/runtime-config`, {
      method: "PATCH",
      body: JSON.stringify({ runtime_config_override: override }),
    });
    return parseWithFallback(raw, WorkflowNodeRunSchema, EMPTY_WORKFLOW_NODE_RUN, {
      endpoint: "PATCH /api/node-runs/:id/runtime-config",
    });
  }
```

注意：`EMPTY_WORKFLOW_NODE_RUN` 常量须存在（搜 `schemas.ts`）；若不存在则补充一个与 `EMPTY_WORKFLOW_RUN` 同风格的空对象常量。

- [ ] **Step 7: 运行测试验证通过**

Run: `pnpm --filter @multica/core exec vitest run api/schemas.test.ts`
Expected: PASS。

- [ ] **Step 8: typecheck**

Run: `pnpm typecheck`
Expected: 无类型错误（`EMPTY_WORKFLOW_NODE_RUN` 等常量补充到位）。

- [ ] **Step 9: Commit**

```bash
git add packages/core/types/workflow-snapshot.ts packages/core/types/workflow.ts packages/core/api/schemas.ts packages/core/api/client.ts packages/core/api/schemas.test.ts
git commit -m "feat(workflow): expose workflow_snapshot and runtime_config_override to frontend"
```

---

### Task 10: 新增 `useUpdateNodeRunRuntimeConfig` mutation hook

**Files:**
- Modify: `packages/core/workflows/queries.ts`

**Interfaces:**
- Produces: `useUpdateNodeRunRuntimeConfig(wsId, workflowId, runId)` mutation hook，成功后失效 `workflowKeys.nodeRuns` 与 `workflowKeys.run`。

- [ ] **Step 1: 写 hook**

在 `packages/core/workflows/queries.ts` 的 `useCreateNode` 等 hook 附近追加：
```ts
export function useUpdateNodeRunRuntimeConfig(wsId: string, workflowId: string, runId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (override: unknown) => api.updateNodeRunRuntimeConfig(/* nodeRunId */ "", override),
  });
}
```

注意：`updateNodeRunRuntimeConfig` 需要 `nodeRunId`，应作为 mutationFn 参数传入。修正为：
```ts
export function useUpdateNodeRunRuntimeConfig(wsId: string, workflowId: string, runId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ nodeRunId, override }: { nodeRunId: string; override: unknown }) =>
      api.updateNodeRunRuntimeConfig(nodeRunId, override),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.nodeRuns(wsId, workflowId, runId) });
      queryClient.invalidateQueries({ queryKey: workflowKeys.run(wsId, workflowId, runId) });
    },
  });
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm typecheck`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add packages/core/workflows/queries.ts
git commit -m "feat(workflow): useUpdateNodeRunRuntimeConfig mutation hook"
```

---

### Task 11: `ExecutionPanoramaPage` 从快照渲染 + live fallback + 警告

**Files:**
- Modify: `packages/views/issues/components/execution/execution-panorama-page.tsx:47-152`
- Modify: `packages/views/locales/{en,zh-Hans}/issues.json`

**Interfaces:**
- Consumes: `workflowRunOptions(wsId, workflowId, runId)`、`WorkflowSnapshot`、`workflowNodeRunsOptions`。
- Produces: 当 `run.workflow_snapshot` 存在时，nodes/edges/stages 从快照派生；否则 fallback 到现有 live 查询并显示警告。

- [ ] **Step 1: 写快照派生 nodes/edges/stages 的单元测试**

`packages/views/issues/components/execution/execution-panorama-page.test.tsx`（若不存在则新建）。测试一个纯辅助函数 `derivePanoramaFromSnapshot(snapshot)`，返回 `{ nodes, edges, stages }`：
```tsx
import { describe, it, expect } from "vitest";
import { derivePanoramaFromSnapshot } from "./execution-panorama-page";
import type { WorkflowSnapshot } from "@multica/core";

describe("derivePanoramaFromSnapshot", () => {
  it("maps snapshot nodes/edges/stages to panorama shape", () => {
    const snap: WorkflowSnapshot = {
      snapshot_version: 1, workflow_id: "w1", title: "T", description: "", max_retries: 1,
      nodes: [
        { id: "n1", title: "N1", description: "", position_x: 0, position_y: 0, format_schema: null,
          worker_type: "human", worker_id: null, critic_type: "human", critic_id: null,
          critic_api_url: null, sort_order: 0, stage_id: "s1" },
      ],
      edges: [],
      stages: [{ id: "s1", name: "S1", description: "", sort_order: 0 }],
    };
    const { nodes, stages } = derivePanoramaFromSnapshot(snap);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].id).toBe("n1");
    expect(stages).toHaveLength(1);
    expect(stages[0].id).toBe("s1");
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm --filter @multica/views exec vitest run issues/components/execution/execution-panorama-page.test.tsx`
Expected: FAIL —— `derivePanoramaFromSnapshot` 未导出。

- [ ] **Step 3: 写 `derivePanoramaFromSnapshot` 并接入页面**

在 `execution-panorama-page.tsx` 顶部导出纯函数：
```tsx
export function derivePanoramaFromSnapshot(snapshot: WorkflowSnapshot) {
  const nodes = snapshot.nodes.map((n) => ({
    id: n.id,
    workflow_id: snapshot.workflow_id,
    title: n.title,
    description: n.description,
    position_x: n.position_x,
    position_y: n.position_y,
    format_schema: n.format_schema,
    worker_type: n.worker_type,
    worker_id: n.worker_id,
    critic_type: n.critic_type,
    critic_id: n.critic_id,
    critic_api_url: n.critic_api_url,
    sort_order: n.sort_order,
    stage_id: n.stage_id,
    created_at: "",
    updated_at: "",
  }));
  const edges = snapshot.edges.map((e) => ({
    id: e.id,
    workflow_id: snapshot.workflow_id,
    source_node_id: e.source_node_id,
    target_node_id: e.target_node_id,
    condition: e.condition,
    created_at: "",
  }));
  const stages = snapshot.stages.map((s) => ({
    id: s.id,
    workflow_id: snapshot.workflow_id,
    name: s.name,
    description: s.description,
    sort_order: s.sort_order,
    node_count: 0,
    created_at: "",
    updated_at: "",
  }));
  return { nodes, edges, stages };
}
```

在组件内（47-68 行的 query 区），新增 run 查询并派生：
```tsx
const { data: run } = useQuery({
  ...workflowRunOptions(wsId, workflowId, runId ?? ""),
  enabled: !!runId,
});
const snapshot = run?.workflow_snapshot ?? null;
const derived = snapshot ? derivePanoramaFromSnapshot(snapshot) : null;

// Snapshot is the source of truth when present; otherwise fall back to live.
const effectiveNodes = derived?.nodes ?? nodes;
const effectiveEdges = derived?.edges ?? edges;
const effectiveStages = derived?.stages ?? stages;
const usingLiveFallback = !snapshot && !!runId;
```

随后把渲染处（144-303 行）引用的 `nodes`/`edges`/`stages` 改为 `effectiveNodes`/`effectiveEdges`/`effectiveStages`。`nodeRunMap` 仍来自 `workflowNodeRunsOptions`（不变）。

- [ ] **Step 4: 显示 fallback 警告**

在画布顶部条件渲染警告条（`usingLiveFallback` 为 true 时）：
```tsx
{usingLiveFallback && (
  <div className="rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-800 dark:border-yellow-700 dark:bg-yellow-950 dark:text-yellow-200">
    {t("execution.panorama.snapshot_missing")}
  </div>
)}
```

- [ ] **Step 5: 加 i18n key**

`packages/views/locales/en/issues.json` 的 `execution.panorama` 下加：
```json
"snapshot_missing": "This run has no snapshot; showing the current workflow definition."
```
`packages/views/locales/zh-Hans/issues.json` 对应：
```json
"snapshot_missing": "此运行缺少快照，正在显示当前 workflow 定义。"
```

- [ ] **Step 6: 运行测试验证通过**

Run: `pnpm --filter @multica/views exec vitest run issues/components/execution/execution-panorama-page.test.tsx`
Expected: PASS。

- [ ] **Step 7: typecheck**

Run: `pnpm typecheck`
Expected: 无错误。

- [ ] **Step 8: Commit**

```bash
git add packages/views/issues/components/execution/execution-panorama-page.tsx packages/views/issues/components/execution/execution-panorama-page.test.tsx packages/views/locales/en/issues.json packages/views/locales/zh-Hans/issues.json
git commit -m "feat(workflow): ExecutionPanoramaPage renders from run snapshot with live fallback"
```

---

### Task 12: 最终验证

**Files:**
- Run: 全量检查命令。

- [ ] **Step 1: 后端编译 + 相关 Go 测试**

Run: `cd server && go build ./... && go test ./internal/service/ -run "Snapshot|MergeRuntimeConfig|Downstream|Upstream|ParseSnapshot|SortUpstream" -v`
Expected: 全部 PASS。

- [ ] **Step 2: 前端相关 TS 测试 + typecheck**

Run: `pnpm --filter @multica/core exec vitest run api/schemas.test.ts && pnpm --filter @multica/views exec vitest run issues/components/execution/execution-panorama-page.test.tsx && pnpm typecheck`
Expected: 全部 PASS，无类型错误。

- [ ] **Step 3: make check（用户显式要求时运行）**

Run: `make check`
Expected: 全绿。若 E2E 因需 backend+frontend 运行而跳过，注明。

- [ ] **Step 4: 验收对照（手动 / E2E）**

对照 spec §1 测试清单：
- `StartRun` 后 Run 的 snapshot 与触发时定义一致（Task 2 集成测试）。
- 触发 Run 后修改 nodes/edges/stages，后续调度仍使用旧 snapshot（Task 4/5 改造 + E2E）。
- 删除 live edge 后，运行中 Run 的下游推进仍按 snapshot edge 生效（Task 4）。
- `runtime_config_override` merge 后重新执行当前 node run（Task 3 mergeOverride + Task 7 PATCH + 经 handback 重新派发）。
- 前端 Issue 全景图在 live 定义被修改后仍按 run snapshot 渲染（Task 11）。

- [ ] **Step 5: 最终 commit（如有遗留）**

```bash
git status
# 若有未提交的修复
git add -A && git commit -m "test(workflow): snapshot verification fixes"
```

---

## 自检

**1. Spec 覆盖（§1）：**
- 数据模型（workflow_snapshot / runtime_config_override / taken_over_by）：Task 1。✅
- 写入时机（StartRun 事务内唯一写入点）：Task 2。✅
- 执行路径改造表（root 识别 / OnNodeRunCompleted / dispatchWorker / dispatchCritic / DispatchAgentTask / executeFormatChecker / upstream context / ExecutionPanoramaPage）：Task 2/4/5/6/11。✅
- NodeRun 冗余字段保留：未改动现有 `worker_type` 等列，仅新增 snapshot 优先。✅
- 失败恢复两种生效范围（仅本次 PATCH override / 更新定义走 UpdateWorkflowNode）：Task 7。✅
- merge 规则（shallow，禁 override id/workflow_id/stage_id）：Task 3 + Task 7 前端拒绝。✅
- API 兼容性（schema loose + null fallback）：Task 8/9。✅
- 测试清单：Task 2/3/4/11 + Task 12 验收。✅

**2. 占位扫描：** 无 TBD/TODO；每步含实际代码或命令。Task 5 Step 1、Task 7 Step 1、Task 2 Step 6 标注「按仓库实际测试基础设施决定」——这是对现有 fixture 的条件依赖，非占位，实现者须按现有模式写。

**3. 类型一致性：** `RuntimeNode` 字段名与 `db.MulticaWorkflowNode` 一致（`Title`/`WorkerType`/`WorkerID`/`CriticType`/`CriticID`/`CriticApiUrl`/`FormatSchema`/`StageID`/`SortOrder`/`ID`/`WorkflowID`），dispatch 代码字段访问无需改。`SetWorkflowNodeRunRuntimeConfigParams.ID` / `.RuntimeConfigOverride` 与 Task 7 handler 一致。TS `workflow_snapshot` / `runtime_config_override` / `taken_over_by` 在 schema、类型、hook、页面四处一致。

## 执行交接

**Plan complete and saved to `docs/superpowers/plans/2026-07-02-workflow-runtime-snapshot.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - 每个 Task 派发新 subagent，任务间评审，迭代快。

**2. Inline Execution** - 在当前 session 用 executing-plans 批量执行，带 checkpoint 评审。

**Which approach?**
