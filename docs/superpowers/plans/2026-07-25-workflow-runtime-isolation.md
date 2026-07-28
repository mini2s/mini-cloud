# Workflow 运行时隔离 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让每个 workflow run 在启动事务中获得不可变、可恢复、可回放的完整运行快照，使后续 definition 编辑或删除不再改变已经创建的运行。

**Architecture:** 编辑域仍由现有 workflow definition 表承载，并通过 workflow 行锁、workspace 角色 advisory lock 与 `config_revision` 形成一致写边界。启动域统一由 `PrepareWorkflowRunSnapshot` 在一个事务中物化强类型 JSON snapshot、node run、run edge、运行态交付物与持久化派发 job；运行期只能经过集中式 runtime repository 读取这些数据。API 保留旧字段兼容，前端以 run snapshot 回放画布，并移除编辑器完整预检。

**Tech Stack:** PostgreSQL migrations, Go 1.24（Chi、pgx v5、sqlc）, TypeScript（React、TanStack Query、Zod）, Vitest + Testing Library, Go `testing`

## Global Constraints

- 运行创建后不得通过 `workflow_id`、`workflow_node_id` 或 definition deliverable ID 回查任何可编辑执行配置。
- `config_revision` 仅用于并发控制与诊断，不提供用户可见版本、发布、回滚或比较能力。
- 锁顺序固定为：workspace 角色 advisory lock -> workflow 行锁 -> 角色行锁；共享角色写使用排他 advisory lock，启动使用共享 advisory lock。
- 所有创建新 run 的入口必须调用 `PrepareWorkflowRunSnapshot`；重试、接管、交还、评论恢复和同一 run 内重派发只复用既有 node run snapshot。
- 自动触发配置错误必须留下 `failed` run 和通知；手动启动配置错误返回 `422 workflow_config_invalid`、`run_id` 和结构化 `issues`。
- API 在兼容期内继续输出必填 `workflow_node_id`，其值等于 `source_workflow_node_id`；新客户端映射键为 `source_workflow_node_id ?? workflow_node_id`。
- 迁移只能在维护窗口、旧服务停止写入且所有旧 run 已终态时执行；恢复流量后只允许前滚修复。
- `server/pkg/db/generated/` 只由 `make sqlc` 生成，不手工编辑；Go 代码执行 `gofmt`，代码注释使用英文。
- `packages/core/` 不得访问 `react-dom`、`localStorage` 或 `process.env`；`packages/views/` 不得导入 `next/*` 或 `react-router-dom`。
- TypeScript 线上的 `snake_case` 响应必须经过 Zod schema 与 `parseWithFallback`，包内类型保持现有 API 边界约定。
- 每个任务先运行精确的红灯测试，再写最小实现；最终执行 `make check`。

## File Structure

| 文件 | 职责 |
| --- | --- |
| `server/migrations/144_workflow_runtime_isolation.{up,down}.sql` | 新运行模型、legacy 回填、约束与受保护回滚 |
| `server/migrations/145_workflow_runtime_isolation_contract.{up,down}.sql` | 所有调用方切换后删除临时兼容列/default/trigger，收紧最终约束 |
| `server/pkg/db/queries/workflow_snapshot.sql` | definition 一致读取、run/node/deliverable snapshot 写入与 runtime 查询 |
| `server/pkg/db/queries/workflow_dispatch.sql` | dispatch job 创建、租约领取、重排、完成与幂等 task 查询 |
| `server/internal/service/workflow_definition.go` | definition 写事务、锁顺序与 revision 递增 |
| `server/internal/service/workflow_snapshot.go` | 强类型 snapshot DTO、构建与序列化 |
| `server/internal/service/workflow_preflight.go` | 服务端结构化启动校验 |
| `server/internal/service/workflow_run_prepare.go` | 唯一的新 run 准备事务 |
| `server/internal/service/workflow_runtime_repository.go` | 运行期节点、边、交付物与 snapshot 的集中读取接口 |
| `server/internal/service/workflow_dispatch.go` | 可恢复且幂等的 node-run dispatch worker |
| `server/internal/service/workflow.go` | 既有生命周期迁移到 prepare/runtime repository/dispatch job |
| `server/internal/service/workflow_split.go` | Split 只读写 node-run runtime config，子 run 独立快照 |
| `server/internal/handler/workflow*.go`、`issue.go` | 统一启动、兼容响应和结构化错误 |
| `server/internal/handler/workspace.go` | workspace 显式有序删除 |
| `packages/core/types/workflow.ts`、`packages/core/api/schemas.ts` | snapshot、兼容 node ID、启动错误的客户端契约 |
| `packages/views/workflows/components/workflow-run-page.tsx` | 从 run snapshot 回放画布和 actor 名称 |
| `packages/views/workflows/components/overview/*` | 删除编辑器 preflight bar 与启用阻断 |

---

### Task 1: 建立运行隔离数据库模型并完成 legacy 回填

**Files:**
- Create: `server/migrations/144_workflow_runtime_isolation.up.sql`
- Create: `server/migrations/144_workflow_runtime_isolation.down.sql`
- Create: `server/pkg/db/queries/workflow_snapshot.sql`
- Create: `server/pkg/db/queries/workflow_dispatch.sql`
- Modify: `server/pkg/db/queries/workflow.sql:1-260`
- Modify: `server/pkg/db/queries/workflow_node_run.sql:1-390`
- Modify: `server/pkg/db/queries/workflow_deliverable.sql:1-80`
- Generated: `server/pkg/db/generated/*.go`
- Test: `server/internal/service/workflow_migration_integration_test.go`
- Test: `server/internal/migrations/workflow_runtime_isolation_test.go`

**Interfaces:**
- Produces: `multica_workflow.config_revision bigint NOT NULL DEFAULT 0`
- Produces: immutable run fields `source_config_revision`, `definition_schema_version`, `definition_snapshot`, `max_retries`, `failure_reason`, `validation_errors`
- Produces: `multica_workflow_run_edge`, `multica_workflow_node_run_deliverable`, `multica_workflow_node_run_dispatch_job`
- Produces: `GetWorkflowForSnapshot`, `ListWorkflowDefinitionForSnapshot`, `CreateWorkflowRunSnapshot`, `CreateRunEdge`, `CreateNodeRunDeliverableRequirement`
- Produces: `GetWorkflowWorkspaceID`（只读取锁 key，不读取 definition 配置）
- Produces: `CreateWorkflowDispatchJob`, `ClaimWorkflowDispatchJob`, `RequeueExpiredWorkflowDispatchJobs`, `GetAgentTaskByWorkflowDispatchJob`

- [ ] **Step 1: 写 migration contract 集成测试并确认红灯**

创建 `workflow_migration_integration_test.go`，使用现有测试数据库连接方式检查 schema 与约束：

```go
func TestWorkflowRuntimeIsolationSchema(t *testing.T) {
	f := newRoleResolutionFixture(t, []roleSlotSpec{{slotType: "worker", roleName: "developer"}})
	defer f.cleanup()
	pool := f.pool
	ctx := context.Background()
	var sourceColumn string
	err := pool.QueryRow(ctx, `
		SELECT column_name
		FROM information_schema.columns
		WHERE table_name = 'multica_workflow_node_run'
		  AND column_name = 'source_workflow_node_id'`).Scan(&sourceColumn)
	if err != nil {
		t.Fatalf("source_workflow_node_id missing: %v", err)
	}

	var deleteRule string
	err = pool.QueryRow(ctx, `
		SELECT rc.delete_rule
		FROM information_schema.referential_constraints rc
		JOIN information_schema.table_constraints tc
		  ON tc.constraint_name = rc.constraint_name
		WHERE tc.table_name = 'multica_workflow_run'
		  AND tc.constraint_type = 'FOREIGN KEY'
		  AND rc.unique_constraint_name IS NOT NULL`).Scan(&deleteRule)
	if err != nil || deleteRule != "RESTRICT" {
		t.Fatalf("workflow run delete rule = %q, err=%v", deleteRule, err)
	}
}
```

Run: `cd server && go test ./internal/service -run TestWorkflowRuntimeIsolationSchema -v`

Expected: FAIL，提示 `source_workflow_node_id missing`。

同一红灯步骤创建 migration harness 测试；测试文件中的 `newMigrationDatabaseAt` 创建独立临时数据库、按 `migrations.Files("up")` 应用到指定 version，并在 `t.Cleanup` 删除该数据库：

```go
func TestWorkflowRuntimeIsolationMigrationRejectsNonTerminalLegacyRun(t *testing.T) {
	database := newMigrationDatabaseAt(t, "143_workflow_runtime_selection_policy")
	database.seedLegacyWorkflowRun(t, "running")
	err := database.apply(t, "144_workflow_runtime_isolation.up.sql")
	if err == nil || !strings.Contains(err.Error(), "requires all legacy runs to be terminal") {
		t.Fatalf("migration error=%v", err)
	}
	database.assertVersionAbsent(t, "144_workflow_runtime_isolation")
}

func TestWorkflowRuntimeIsolationMigrationBackfillsTerminalRun(t *testing.T) {
	database := newMigrationDatabaseAt(t, "143_workflow_runtime_selection_policy")
	run := database.seedLegacyWorkflowRun(t, "completed")
	database.seedLegacyDeliverableSubmission(t, run)
	if err := database.apply(t, "144_workflow_runtime_isolation.up.sql"); err != nil { t.Fatal(err) }
	database.assertLegacySnapshot(t, run, 0, "legacy_backfill")
	database.assertRuntimeEdgesAndDeliverablesMapped(t, run)
}
```

- [ ] **Step 2: 写 up migration 的停止条件、列与表**

`144_workflow_runtime_isolation.up.sql` 必须先拒绝非终态旧 run，再做 DDL；核心约束使用以下内容，且所有新表增加索引与 `created_at` 默认值：

```sql
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM multica_workflow_run
        WHERE status IN ('running', 'resolving_roles', 'waiting_role_assignment')
    ) THEN
        RAISE EXCEPTION 'workflow runtime isolation requires all legacy runs to be terminal';
    END IF;
END $$;

ALTER TABLE multica_workflow ADD COLUMN config_revision BIGINT NOT NULL DEFAULT 0;
ALTER TABLE multica_workflow_run
    ADD COLUMN source_config_revision BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN definition_schema_version INT NOT NULL DEFAULT 0,
    ADD COLUMN definition_snapshot JSONB NOT NULL DEFAULT '{"schema_version":0,"snapshot_origin":"legacy_backfill"}'::jsonb,
    ADD COLUMN max_retries INT NOT NULL DEFAULT 0,
    ADD COLUMN failure_reason TEXT,
    ADD COLUMN validation_errors JSONB;

ALTER TABLE multica_workflow_node_run
    ADD COLUMN source_workflow_node_id UUID,
    ADD COLUMN node_description TEXT NOT NULL DEFAULT '',
    ADD COLUMN format_schema JSONB,
    ADD COLUMN critic_api_url TEXT,
    ADD COLUMN stage_snapshot JSONB,
    ADD COLUMN worker_role_snapshot JSONB,
    ADD COLUMN critic_role_snapshot JSONB,
    ADD COLUMN runtime_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN worker_name_snapshot TEXT NOT NULL DEFAULT '',
    ADD COLUMN critic_name_snapshot TEXT NOT NULL DEFAULT '';

CREATE TABLE multica_workflow_run_edge (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_run_id UUID NOT NULL REFERENCES multica_workflow_run(id) ON DELETE CASCADE,
    source_node_run_id UUID NOT NULL,
    target_node_run_id UUID NOT NULL,
    condition JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workflow_run_id, source_node_run_id, target_node_run_id),
    FOREIGN KEY (workflow_run_id, source_node_run_id)
        REFERENCES multica_workflow_node_run(workflow_run_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workflow_run_id, target_node_run_id)
        REFERENCES multica_workflow_node_run(workflow_run_id, id) ON DELETE CASCADE
);

CREATE TABLE multica_workflow_node_run_deliverable (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_node_run_id UUID NOT NULL REFERENCES multica_workflow_node_run(id) ON DELETE CASCADE,
    source_deliverable_id UUID NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('document', 'pull_request')),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    required BOOLEAN NOT NULL,
    sort_order INT NOT NULL,
    UNIQUE (workflow_node_run_id, source_deliverable_id)
);

CREATE TABLE multica_workflow_node_run_dispatch_job (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_run_id UUID NOT NULL REFERENCES multica_workflow_run(id) ON DELETE CASCADE,
    workflow_node_run_id UUID NOT NULL REFERENCES multica_workflow_node_run(id) ON DELETE CASCADE,
    phase TEXT NOT NULL,
    generation INT NOT NULL CHECK (generation > 0),
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
    attempt_count INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 5,
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_by TEXT,
    lease_expires_at TIMESTAMPTZ,
    last_error TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workflow_node_run_id, phase, generation)
);
```

在添加 run-edge 组合外键前，为 `multica_workflow_node_run(workflow_run_id, id)` 创建唯一约束。为 agent task 添加 nullable `workflow_dispatch_job_id`、`ON DELETE SET NULL` 外键与 partial unique index。

- [ ] **Step 3: 在同一 up migration 完整物化 legacy 运行数据**

按 `workflow_run -> node_run -> run_edge -> run_deliverable -> submission` 顺序执行。snapshot 顶层固定为以下形状，legacy 值必须使用 `schema_version: 0` 和 `snapshot_origin: legacy_backfill`：

```sql
UPDATE multica_workflow_run wr
SET source_config_revision = w.config_revision,
    definition_schema_version = 0,
    max_retries = w.max_retries,
    definition_snapshot = jsonb_build_object(
        'schema_version', 0,
        'snapshot_origin', 'legacy_backfill',
        'workflow', jsonb_build_object(
            'id', w.id, 'title', w.title, 'description', w.description,
            'max_retries', w.max_retries,
            'runtime_selection_policy', wr.runtime_selection_policy,
            'runtime_id', wr.runtime_id
        ),
        'nodes', COALESCE((
            SELECT jsonb_agg(to_jsonb(n) ORDER BY n.sort_order, n.id)
            FROM multica_workflow_node n WHERE n.workflow_id = w.id
        ), '[]'::jsonb),
        'edges', COALESCE((
            SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at, e.id)
            FROM multica_workflow_edge e WHERE e.workflow_id = w.id
        ), '[]'::jsonb),
        'stages', COALESCE((
            SELECT jsonb_agg(to_jsonb(s) ORDER BY s.sort_order, s.id)
            FROM multica_workflow_stage s WHERE s.workflow_id = w.id
        ), '[]'::jsonb)
    )
FROM multica_workflow w
WHERE w.id = wr.workflow_id;
```

snapshot 的 `roles` 与 `deliverables` 使用确定顺序写入，actor 已删除时名称写空字符串：

```sql
UPDATE multica_workflow_run wr
SET definition_snapshot = wr.definition_snapshot || jsonb_build_object(
    'roles', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', r.id, 'name', r.name, 'description', r.description
        ) ORDER BY r.id)
        FROM multica_workflow_role r
        WHERE EXISTS (
            SELECT 1 FROM multica_workflow_node n
            WHERE n.workflow_id = wr.workflow_id
              AND (n.worker_role_id = r.id OR n.critic_role_id = r.id)
        )
    ), '[]'::jsonb),
    'deliverables', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', d.id, 'workflow_node_id', d.workflow_node_id,
            'kind', d.kind, 'title', d.title, 'description', d.description,
            'required', d.required, 'sort_order', d.sort_order
        ) ORDER BY d.sort_order, d.id)
        FROM multica_workflow_node_deliverable d
        JOIN multica_workflow_node n ON n.id = d.workflow_node_id
        WHERE n.workflow_id = wr.workflow_id
    ), '[]'::jsonb)
);

UPDATE multica_workflow_node_run nr
SET source_workflow_node_id = nr.workflow_node_id,
    node_description = n.description,
    format_schema = n.format_schema,
    critic_api_url = n.critic_api_url,
    runtime_config = COALESCE(n.format_schema, '{}'::jsonb)
FROM multica_workflow_node n
WHERE n.id = nr.workflow_node_id;
```

通过源 edge 两端的 `source_workflow_node_id` 映射 run edge；通过 `(workflow_node_run_id, source_deliverable_id)` 建运行态 requirement，并把 submission 外键重映射到 requirement ID。任何 node、edge、deliverable 或 submission 无法一一映射时用保护块使整个 migration 回滚。

- [ ] **Step 4: 收紧 NOT NULL、移除编辑域外键并改 workflow 删除约束**

回填检查通过后执行：

```sql
ALTER TABLE multica_workflow_run
    ALTER COLUMN source_config_revision SET NOT NULL,
    ALTER COLUMN definition_schema_version SET NOT NULL,
    ALTER COLUMN definition_snapshot SET NOT NULL,
    ALTER COLUMN max_retries SET NOT NULL;

ALTER TABLE multica_workflow_node_run
    ALTER COLUMN source_workflow_node_id SET NOT NULL,
    ALTER COLUMN node_description SET NOT NULL,
    ALTER COLUMN runtime_config SET NOT NULL,
    ALTER COLUMN worker_name_snapshot SET NOT NULL,
    ALTER COLUMN critic_name_snapshot SET NOT NULL;

ALTER TABLE multica_workflow_node_run DROP CONSTRAINT workflow_node_run_workflow_node_id_fkey;

CREATE FUNCTION multica_fill_source_workflow_node_id() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.source_workflow_node_id IS NULL THEN
        NEW.source_workflow_node_id := NEW.workflow_node_id;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER fill_source_workflow_node_id
BEFORE INSERT ON multica_workflow_node_run
FOR EACH ROW EXECUTE FUNCTION multica_fill_source_workflow_node_id();

ALTER TABLE multica_workflow_node_run ALTER COLUMN source_workflow_node_id SET NOT NULL;

ALTER TABLE multica_workflow_run DROP CONSTRAINT workflow_run_workflow_id_fkey;
ALTER TABLE multica_workflow_run
    ADD CONSTRAINT workflow_run_workflow_id_fkey
    FOREIGN KEY (workflow_id) REFERENCES multica_workflow(id) ON DELETE RESTRICT;
```

144 保留无外键的 `workflow_node_id` 作为分步实施期间的编译兼容列；所有生产读取仍必须转向 source ID。Task 12 的 145 contract migration 在调用方完成切换后删除 trigger、函数与该列。submission 的 definition deliverable 外键在 144 中替换成指向 `multica_workflow_node_run_deliverable(id)` 的运行态外键。

- [ ] **Step 5: 写受保护 down migration**

`down.sql` 的第一条语句必须是保护块；只有不存在 native run、所有 source node/deliverable 仍存在、所有 submission 可逆映射时才恢复旧列和外键：

```sql
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM multica_workflow_run WHERE definition_schema_version > 0) THEN
        RAISE EXCEPTION 'cannot roll back after native snapshot runs exist';
    END IF;
    IF EXISTS (
        SELECT 1 FROM multica_workflow_node_run nr
        LEFT JOIN multica_workflow_node n ON n.id = nr.source_workflow_node_id
        WHERE n.id IS NULL
    ) THEN
        RAISE EXCEPTION 'cannot restore workflow_node_id: source node is missing';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM multica_workflow_node_deliverable_submission s
        JOIN multica_workflow_node_run_deliverable rd ON rd.id = s.deliverable_id
        LEFT JOIN multica_workflow_node_deliverable d ON d.id = rd.source_deliverable_id
        WHERE d.id IS NULL
    ) THEN
        RAISE EXCEPTION 'cannot restore deliverable_id: source deliverable is missing';
    END IF;
END $$;
```

保护块之后先恢复旧列/引用并验证数量，再删除新表和新列；不得使用 `CASCADE` 隐式丢弃运行数据。

- [ ] **Step 6: 添加 snapshot/runtime/dispatch sqlc 查询**

`workflow_dispatch.sql` 的领取语句使用单条 CTE 和 `SKIP LOCKED`：

```sql
-- name: ClaimWorkflowDispatchJob :one
WITH candidate AS (
    SELECT id
    FROM multica_workflow_node_run_dispatch_job
    WHERE status = 'pending' AND scheduled_at <= now()
    ORDER BY scheduled_at, created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
UPDATE multica_workflow_node_run_dispatch_job job
SET status = 'running',
    attempt_count = attempt_count + 1,
    locked_by = sqlc.arg(locked_by),
    lease_expires_at = now() + sqlc.arg(lease_duration)::interval,
    updated_at = now()
FROM candidate
WHERE job.id = candidate.id
RETURNING job.*;
```

同时提供按 run/node run 读取运行态节点、边、交付物与 snapshot 的查询，所有函数名使用本任务 `Interfaces` 中固定名称。

- [ ] **Step 7: 生成代码并运行 migration/schema 测试**

Run: `make sqlc`

Expected: sqlc 成功生成新 model 和 query 方法。

Run: `make db-reset`

Expected: migration 144 成功执行，空测试库处于新 schema。

Run: `cd server && go test ./internal/service -run 'TestWorkflowRuntimeIsolationSchema' -v`

Run: `cd server && go test ./internal/migrations -run 'TestWorkflowRuntimeIsolationMigration' -v`

Expected: PASS；非终态 case 原子拒绝，终态 case 完整回填 snapshot、run edge、runtime deliverable 与 submission 引用。

- [ ] **Step 8: 提交**

```bash
git add server/migrations/144_workflow_runtime_isolation.*.sql server/pkg/db/queries server/pkg/db/generated server/internal/service/workflow_migration_integration_test.go server/internal/migrations/workflow_runtime_isolation_test.go
git commit -m "feat(workflow): add isolated workflow runtime schema"
```

---

### Task 2: 定义强类型 snapshot 与服务端结构化 preflight

**Files:**
- Create: `server/internal/service/workflow_snapshot.go`
- Create: `server/internal/service/workflow_snapshot_test.go`
- Create: `server/internal/service/workflow_preflight.go`
- Create: `server/internal/service/workflow_preflight_test.go`
- Modify: `server/internal/service/workflow_topo.go:1-120`

**Interfaces:**
- Consumes: Task 1 的 definition snapshot 查询结果
- Produces: `const WorkflowDefinitionSchemaVersion = 1`
- Produces: `WorkflowDefinitionSnapshot`, `WorkflowSnapshotNode`, `WorkflowSnapshotEdge`, `WorkflowSnapshotStage`, `WorkflowSnapshotRole`, `WorkflowSnapshotDeliverable`
- Produces: `BuildWorkflowDefinitionSnapshot(rows WorkflowDefinitionRows) (WorkflowDefinitionSnapshot, error)`
- Produces: `ValidateWorkflowDefinition(snapshot WorkflowDefinitionSnapshot) []WorkflowConfigIssue`

- [ ] **Step 1: 写 snapshot 稳定序列化失败测试**

```go
func TestBuildWorkflowDefinitionSnapshotProducesStableTypedJSON(t *testing.T) {
	rows := workflowDefinitionRowsFixture()
	first, err := BuildWorkflowDefinitionSnapshot(rows)
	if err != nil { t.Fatal(err) }
	second, err := BuildWorkflowDefinitionSnapshot(rows)
	if err != nil { t.Fatal(err) }
	a, _ := json.Marshal(first)
	b, _ := json.Marshal(second)
	if !bytes.Equal(a, b) { t.Fatalf("snapshot is not stable:\n%s\n%s", a, b) }
	if first.SchemaVersion != 1 || first.SnapshotOrigin != "native" {
		t.Fatalf("unexpected header: %#v", first)
	}
}
```

Run: `cd server && go test ./internal/service -run TestBuildWorkflowDefinitionSnapshotProducesStableTypedJSON -v`

Expected: FAIL，`BuildWorkflowDefinitionSnapshot` 未定义。

- [ ] **Step 2: 定义不含 `map[string]any` 的 snapshot 类型**

```go
const WorkflowDefinitionSchemaVersion = 1

type WorkflowDefinitionSnapshot struct {
	SchemaVersion  int                           `json:"schema_version"`
	SnapshotOrigin string                        `json:"snapshot_origin"`
	Workflow       WorkflowSnapshotWorkflow      `json:"workflow"`
	Nodes          []WorkflowSnapshotNode         `json:"nodes"`
	Edges          []WorkflowSnapshotEdge         `json:"edges"`
	Stages         []WorkflowSnapshotStage        `json:"stages"`
	Roles          []WorkflowSnapshotRole         `json:"roles"`
	Deliverables   []WorkflowSnapshotDeliverable  `json:"deliverables"`
}

type WorkflowConfigIssue struct {
	Code      string `json:"code"`
	NodeID    string `json:"node_id,omitempty"`
	NodeTitle string `json:"node_title,omitempty"`
	Detail    string `json:"detail"`
}
```

节点结构必须显式列出 description、position、format schema、stage、worker/critic actor、role snapshot、Split runtime 配置；workflow 结构显式列出 title、description、max retries 和 runtime selection 配置。构建时按 stage `sort_order,id`、node `sort_order,id`、edge `created_at,id`、deliverable `sort_order,id` 排序。

- [ ] **Step 3: 写完整 preflight 表驱动失败测试**

```go
func TestValidateWorkflowDefinitionReturnsStructuredIssues(t *testing.T) {
	tests := []struct {
		name string
		mutate func(*WorkflowDefinitionSnapshot)
		code string
	}{
		{"cycle", addCycle, "dag_cycle"},
		{"missing worker", clearWorker, "worker_missing"},
		{"missing stage", pointAtMissingStage, "stage_missing"},
		{"invalid split", invalidateSplitConfig, "split_config_invalid"},
		{"invalid deliverable", invalidateDeliverable, "deliverable_invalid"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			snapshot := validWorkflowDefinitionSnapshot()
			tt.mutate(&snapshot)
			issues := ValidateWorkflowDefinition(snapshot)
			if !slices.ContainsFunc(issues, func(issue WorkflowConfigIssue) bool { return issue.Code == tt.code }) {
				t.Fatalf("issues %#v do not contain %q", issues, tt.code)
			}
		})
	}
}
```

Run: `cd server && go test ./internal/service -run TestValidateWorkflowDefinitionReturnsStructuredIssues -v`

Expected: FAIL，`ValidateWorkflowDefinition` 未定义。

- [ ] **Step 4: 实现完整启动校验并复用纯拓扑函数**

`workflow_preflight.go` 必须返回稳定 code，覆盖：空图、DAG cycle、孤立/不可达节点、边界与 gateway 方向、actor/role 缺失、stage 引用、Split planner/critic/default issue workflow/max concurrency、交付物字段。校验函数只消费 snapshot，不访问数据库：

```go
func ValidateWorkflowDefinition(snapshot WorkflowDefinitionSnapshot) []WorkflowConfigIssue {
	issues := make([]WorkflowConfigIssue, 0)
	issues = append(issues, validateSnapshotTopology(snapshot.Nodes, snapshot.Edges)...)
	issues = append(issues, validateSnapshotActors(snapshot.Nodes)...)
	issues = append(issues, validateSnapshotStages(snapshot.Nodes, snapshot.Stages)...)
	issues = append(issues, validateSnapshotSplit(snapshot.Nodes)...)
	issues = append(issues, validateSnapshotDeliverables(snapshot.Nodes, snapshot.Deliverables)...)
	slices.SortFunc(issues, compareWorkflowConfigIssue)
	return issues
}
```

- [ ] **Step 5: 运行单元测试并提交**

Run: `cd server && go test ./internal/service -run 'Test(BuildWorkflowDefinitionSnapshot|ValidateWorkflowDefinition)' -v`

Expected: PASS。

```bash
git add server/internal/service/workflow_snapshot* server/internal/service/workflow_preflight* server/internal/service/workflow_topo.go
git commit -m "feat(workflow): add typed run snapshots and start preflight"
```

---

### Task 3: 串行化 definition 写入并维护 config revision

**Files:**
- Create: `server/internal/service/workflow_definition.go`
- Create: `server/internal/service/workflow_definition_integration_test.go`
- Modify: `server/pkg/db/queries/workflow.sql`
- Modify: `server/pkg/db/queries/workflow_role.sql`
- Modify: `server/internal/handler/workflow.go:360-1545`
- Modify: `server/internal/handler/workflow_role.go:1-210`
- Modify: `server/internal/service/workflow.go:180-310,2260-2365`
- Modify: `server/internal/service/workflow_split.go`（definition 写入路径）
- Generated: `server/pkg/db/generated/*.go`

**Interfaces:**
- Consumes: `multica_workflow.config_revision`
- Produces: `WorkflowDefinitionLockMode`, `RunDefinitionWrite`, `RunWorkspaceRoleWrite`
- Produces: SQL queries `LockWorkflowDefinitionForUpdate`, `LockWorkflowDefinitionForShare`, `IncrementWorkflowConfigRevision`, `LockWorkflowRoleDefinitionsShared`, `LockWorkflowRoleDefinitionsExclusive`

- [ ] **Step 1: 写成功/失败 revision 与角色并发测试**

```go
func TestRunDefinitionWriteIncrementsRevisionOnlyAfterSuccessfulMutation(t *testing.T) {
	fixture := newWorkflowDefinitionFixture(t)
	err := fixture.service.RunDefinitionWrite(fixture.ctx, fixture.workspaceID, fixture.workflowID, DefinitionLockWorkflowOnly, func(q *db.Queries) error {
		return q.UpdateWorkflowDescription(fixture.ctx, db.UpdateWorkflowDescriptionParams{ID: fixture.workflowID, Description: "saved"})
	})
	if err != nil { t.Fatal(err) }
	if got := fixture.configRevision(); got != 1 { t.Fatalf("revision=%d", got) }

	err = fixture.service.RunDefinitionWrite(fixture.ctx, fixture.workspaceID, fixture.workflowID, DefinitionLockWorkflowOnly, func(*db.Queries) error {
		return errors.New("reject mutation")
	})
	if err == nil { t.Fatal("expected mutation failure") }
	if got := fixture.configRevision(); got != 1 { t.Fatalf("failed write incremented revision to %d", got) }
}
```

另写 `TestRoleUpdateAndSnapshotUseOneWorkspaceLockBoundary`，用两个 pgx 连接和 channel 证明排他角色更新与共享 snapshot 读取互斥。

Run: `cd server && go test ./internal/service -run 'TestRunDefinitionWrite|TestRoleUpdateAndSnapshot' -v`

Expected: FAIL，事务包装器未定义。

- [ ] **Step 2: 添加固定锁顺序查询与事务包装器**

```go
type WorkflowDefinitionLockMode int

const (
	DefinitionLockWorkflowOnly WorkflowDefinitionLockMode = iota
	DefinitionLockRoleSensitive
)

func (s *WorkflowService) RunDefinitionWrite(
	ctx context.Context,
	workspaceID pgtype.UUID,
	workflowID pgtype.UUID,
	mode WorkflowDefinitionLockMode,
	mutate func(*db.Queries) error,
) error {
	return s.runInTx(ctx, func(qtx *db.Queries) error {
		if mode == DefinitionLockRoleSensitive {
			if err := qtx.LockWorkflowRoleDefinitionsExclusive(ctx, workspaceID); err != nil { return err }
		}
		if _, err := qtx.LockWorkflowDefinitionForUpdate(ctx, workflowID); err != nil { return err }
		if err := mutate(qtx); err != nil { return err }
		return qtx.IncrementWorkflowConfigRevision(ctx, workflowID)
	})
}
```

advisory lock 查询以 workspace UUID 的两个 32-bit 分量作为稳定 key，shared/exclusive 两条查询必须采用相同 key。

- [ ] **Step 3: 把所有 definition 写入口放入包装器**

逐一迁移 workflow title/description/retries/default runtime、node create/update/move/delete、edge create/delete、stage create/update/reorder/delete、角色槽与 actor 配置、Split definition 配置、deliverable create/update/delete。handler 不得先读后用裸 `h.Queries` 写；在事务回调中重新校验归属并写入。

共享角色更新必须：取得 exclusive advisory lock -> 查询所有引用 workflow -> 按 UUID 排序锁定每个 workflow -> 更新角色 -> 递增所有引用 workflow。角色创建不递增 revision，仍被引用的角色删除保持拒绝。

- [ ] **Step 4: 将启用改成纯运营状态更新**

从 `WorkflowService.UpdateWorkflow` 和相应 handler 删除完整 actor/DAG preflight；启用只在 definition 写事务中把 `draft` 更新为 `active` 并递增 revision。请求字段和现有状态枚举保持不变。

- [ ] **Step 5: 生成 sqlc、运行 definition 测试并提交**

Run: `make sqlc`

Run: `cd server && go test ./internal/service ./internal/handler -run 'Test(RunDefinitionWrite|RoleUpdateAndSnapshot|CreateWorkflow|UpdateWorkflow|DeleteWorkflowNode|WorkflowStage|WorkflowRole)' -v`

Expected: PASS，失败写不递增 revision，所有成功写恰好递增一次。

```bash
git add server/pkg/db/queries server/pkg/db/generated server/internal/service/workflow_definition* server/internal/service/workflow.go server/internal/service/workflow_split.go server/internal/handler/workflow.go server/internal/handler/workflow_role.go
git commit -m "feat(workflow): serialize definition writes by revision"
```

---

### Task 4: 实现唯一运行准备事务并统一新 run 创建入口

**Files:**
- Create: `server/internal/service/workflow_run_prepare.go`
- Create: `server/internal/service/workflow_run_prepare_integration_test.go`
- Modify: `server/internal/service/workflow.go:316-780`
- Modify: `server/internal/handler/workflow_run.go:280-365`
- Modify: `server/internal/handler/issue.go:2070-2150,2480-2560,2680-2730`
- Modify: `server/internal/service/workflow_split.go:2160-2230`
- Modify: `server/pkg/db/queries/workflow_snapshot.sql`
- Modify: `server/pkg/db/queries/workflow_role_resolution.sql`
- Generated: `server/pkg/db/generated/*.go`

**Interfaces:**
- Consumes: Task 2 snapshot/preflight，Task 3 shared role lock 和 workflow `FOR SHARE` lock
- Produces: `PrepareWorkflowRunParams`
- Produces: `PrepareWorkflowRunSnapshot(ctx, workflowID, params) (*PreparedWorkflowRun, error)`
- Produces: `WorkflowConfigInvalidError` with `RunID` and `Issues`

- [ ] **Step 1: 写成功快照与失败原子性测试**

```go
func TestPrepareWorkflowRunSnapshotMaterializesOneRevision(t *testing.T) {
	f := newWorkflowPrepareFixture(t)
	prepared, err := f.service.PrepareWorkflowRunSnapshot(f.ctx, f.workflowID, PrepareWorkflowRunParams{TriggeredByType: "member"})
	if err != nil { t.Fatal(err) }
	if prepared.Run.SourceConfigRevision != f.revision { t.Fatalf("revision=%d", prepared.Run.SourceConfigRevision) }
	assertSnapshotContainsWorkflowGraph(t, prepared.Run.DefinitionSnapshot, f.nodeIDs, f.edgeIDs, f.stageIDs, f.roleIDs, f.deliverableIDs)
	assertRunEntityCounts(t, f.db, prepared.Run.ID, 2, 1, 2, 1)
}

func TestPrepareWorkflowRunSnapshotInvalidConfigCreatesOnlyFailedRun(t *testing.T) {
	f := newInvalidWorkflowPrepareFixture(t)
	_, err := f.service.PrepareWorkflowRunSnapshot(f.ctx, f.workflowID, PrepareWorkflowRunParams{TriggeredByType: "member"})
	var invalid *WorkflowConfigInvalidError
	if !errors.As(err, &invalid) { t.Fatalf("error=%v", err) }
	assertRunStatusAndFailure(t, f.db, invalid.RunID, RunStatusFailed, "config_invalid")
	assertRunEntityCounts(t, f.db, invalid.RunID, 0, 0, 0, 0)
}
```

Run: `cd server && go test ./internal/service -run TestPrepareWorkflowRunSnapshot -v`

Expected: FAIL，准备服务未定义。

- [ ] **Step 2: 固定准备服务参数与返回类型**

```go
type PrepareWorkflowRunParams struct {
	TriggeredByType        string
	TriggeredByID          pgtype.UUID
	Input                  json.RawMessage
	RuntimeSelectionPolicy string
	RuntimeID              pgtype.UUID
	DispatchKey            string
	SourceIssueID          pgtype.UUID
	ResponsibleUserID      pgtype.UUID
	RuntimeAuthorizerID    pgtype.UUID
}

type PreparedWorkflowRun struct {
	Run      db.MulticaWorkflowRun
	NodeRuns []db.MulticaWorkflowNodeRun
}

type WorkflowConfigInvalidError struct {
	RunID  pgtype.UUID
	Issues []WorkflowConfigIssue
}
```

- [ ] **Step 3: 实现单事务 prepare 流程**

事务严格执行：查 workspace ID -> shared advisory lock -> workflow `FOR SHARE` -> status 校验 -> 读取并锁定按 ID 排序的角色 -> 构建 snapshot -> preflight -> 建 run。校验失败只建 failed run；成功时创建可执行 node run、run edge、运行态 deliverable、role resolution，并为无需角色解析的根节点创建 generation 1 `worker` dispatch job。

```go
func (s *WorkflowService) PrepareWorkflowRunSnapshot(ctx context.Context, workflowID pgtype.UUID, params PrepareWorkflowRunParams) (*PreparedWorkflowRun, error) {
	var prepared PreparedWorkflowRun
	err := s.runInTx(ctx, func(qtx *db.Queries) error {
		workspaceID, err := qtx.GetWorkflowWorkspaceID(ctx, workflowID)
		if err != nil { return err }
		if err := qtx.LockWorkflowRoleDefinitionsShared(ctx, workspaceID); err != nil { return err }
		workflow, err := qtx.LockWorkflowDefinitionForShare(ctx, workflowID)
		if err != nil { return err }
		rows, err := loadWorkflowDefinitionRows(ctx, qtx, workflow)
		if err != nil { return err }
		snapshot, err := BuildWorkflowDefinitionSnapshot(rows)
		if err != nil { return err }
		issues := ValidateWorkflowDefinition(snapshot)
		return s.persistPreparedWorkflowRun(ctx, qtx, workflow, snapshot, issues, params, &prepared)
	})
	if err != nil { return nil, err }
	return &prepared, nil
}
```

幂等 `DispatchKey` 冲突时返回同一 run 及其 node runs，不重复物化运行实体或 job。

- [ ] **Step 4: 统一所有创建新 run 的 service 入口**

保留 `StartRun*` 作为短期内部兼容 wrapper，但它们只能组装 `PrepareWorkflowRunParams` 并调用 `PrepareWorkflowRunSnapshot`。手动、Issue assignment、默认 workflow、自动化/API 和 Split child run 全部通过该方法；删除 handler 中事务提交后的 `DispatchRootNodeRuns` 调用。

- [ ] **Step 5: 添加并发编辑边界测试**

测试用两个事务：snapshot 事务持 shared role/workflow lock 时启动 definition 写；断言一次 run 的 revision、role name/description、node、edge 和 deliverable 全部来自同一提交前或提交后状态，不能混合。

Run: `cd server && go test ./internal/service -run 'TestPrepareWorkflowRunSnapshot|TestSnapshotAndDefinitionWriteAreRevisionConsistent' -v`

Expected: PASS。

- [ ] **Step 6: 生成 sqlc、运行启动入口回归并提交**

Run: `make sqlc`

Run: `cd server && go test ./internal/service ./internal/handler -run 'Test(StartWorkflow|StartDefaultRunForIssue|StartRunForIssue|PrepareWorkflowRunSnapshot)' -v`

Expected: PASS，成功 run 提交时已经存在 dispatch job，配置失败 run 没有任何执行实体。

```bash
git add server/internal/service/workflow_run_prepare* server/internal/service/workflow.go server/internal/service/workflow_split.go server/internal/handler/workflow_run.go server/internal/handler/issue.go server/pkg/db/queries server/pkg/db/generated
git commit -m "feat(workflow): prepare immutable runs in one transaction"
```

---

### Task 5: 用持久化 worker 取代 best-effort 直接派发

**Files:**
- Create: `server/internal/service/workflow_dispatch.go`
- Create: `server/internal/service/workflow_dispatch_test.go`
- Create: `server/internal/service/workflow_dispatch_integration_test.go`
- Modify: `server/pkg/db/queries/workflow_dispatch.sql`
- Modify: `server/pkg/db/queries/workflow_node_run.sql:300-345`
- Modify: `server/internal/service/workflow.go:509-543,1530-1690`
- Modify: `server/cmd/server/main.go:540-610`
- Generated: `server/pkg/db/generated/*.go`

**Interfaces:**
- Consumes: Task 1 的 dispatch job 表/查询，Task 4 在 run 事务内创建的 pending job
- Produces: `WorkflowDispatchWorker.Run(ctx)`、`WorkflowDispatchWorker.runOnce(ctx)`
- Produces: `EnqueueWorkflowDispatch(ctx, q, nodeRunID, phase, generation) error`
- Produces: agent task 的唯一 `workflow_dispatch_job_id`

- [ ] **Step 1: 写租约恢复和 task 幂等失败测试**

```go
func TestWorkflowDispatchWorkerRecoversAfterTaskInsertBeforeJobSuccess(t *testing.T) {
	f := newWorkflowDispatchFixture(t)
	job := f.pendingJob("worker", 1)
	f.insertAgentTaskForJob(job.ID)

	worker := f.worker("worker-b")
	if err := worker.runOnce(f.ctx); err != nil { t.Fatal(err) }
	if got := f.countAgentTasksForJob(job.ID); got != 1 { t.Fatalf("tasks=%d", got) }
	if got := f.dispatchJobStatus(job.ID); got != "succeeded" { t.Fatalf("status=%q", got) }
}

func TestWorkflowDispatchWorkerReclaimsExpiredLease(t *testing.T) {
	f := newWorkflowDispatchFixture(t)
	job := f.runningExpiredJob("worker", 1)
	if _, err := f.queries.RequeueExpiredWorkflowDispatchJobs(f.ctx); err != nil { t.Fatal(err) }
	if err := f.worker("worker-b").runOnce(f.ctx); err != nil { t.Fatal(err) }
	if got := f.dispatchJobStatus(job.ID); got != "succeeded" { t.Fatalf("status=%q", got) }
}
```

Run: `cd server && go test ./internal/service -run TestWorkflowDispatchWorker -v`

Expected: FAIL，worker 未定义。

- [ ] **Step 2: 实现 worker 的 claim/lease/process 循环**

```go
type WorkflowDispatchWorker struct {
	Queries       *db.Queries
	TxStarter     TxStarter
	Workflow      *WorkflowService
	WorkerID      string
	PollInterval  time.Duration
	LeaseDuration time.Duration
}

func (w *WorkflowDispatchWorker) Run(ctx context.Context) {
	if w.PollInterval <= 0 { w.PollInterval = time.Second }
	if w.LeaseDuration <= 0 { w.LeaseDuration = 30 * time.Second }
	_, _ = w.Queries.RequeueExpiredWorkflowDispatchJobs(ctx)
	ticker := time.NewTicker(w.PollInterval)
	defer ticker.Stop()
	for {
		if err := w.runOnce(ctx); err != nil && !errors.Is(err, pgx.ErrNoRows) && !errors.Is(err, context.Canceled) {
			slog.Warn("workflow dispatch worker", "worker_id", w.WorkerID, "error", err)
		}
		select { case <-ctx.Done(): return; case <-ticker.C: }
	}
}
```

`runOnce` 领取一个 job，按 `phase` 调用 snapshot-based dispatch，续租直到完成，并用 `(id,generation,status='running')` 条件更新防止 stale worker 覆盖。

- [ ] **Step 3: 将 agent task 创建绑定到 dispatch job**

在现有 task insert query 中新增 `workflow_dispatch_job_id`；worker 遇到 unique violation 时调用 `GetAgentTaskByWorkflowDispatchJob` 并把 job 标记成功。该冲突只表示幂等重放，不吞掉其他约束错误。

```go
task, err := qtx.CreateWorkflowAgentTask(ctx, paramsWithDispatchJob(job, nodeRun))
if err != nil {
	if !isUniqueViolation(err, "idx_agent_task_workflow_dispatch_job") { return err }
	task, err = qtx.GetAgentTaskByWorkflowDispatchJob(ctx, job.ID)
	if err != nil { return err }
}
return qtx.CompleteWorkflowDispatchJob(ctx, db.CompleteWorkflowDispatchJobParams{ID: job.ID, Generation: job.Generation})
```

- [ ] **Step 4: 实现重试耗尽失败语义**

瞬时错误把 job 恢复为 pending，清空 lease，使用有上限的 backoff 更新 `scheduled_at`。`attempt_count >= max_attempts` 时在一个事务中把 job 标记 `failed`、node run 标记 `failed`、run 标记 `failed` 且 `failure_reason='dispatch_failed'`，不得更新 workflow definition。

- [ ] **Step 5: 在 server main 启动 worker 并移除直接 root dispatch**

按 `WorkflowRoleResolutionWorker` 生命周期创建 worker；复用 server shutdown context。worker ID 使用 `hostname + "-workflow-dispatch-" + strconv.Itoa(i+1)`，并从明确常量读取并发数、poll interval、lease duration。

- [ ] **Step 6: 生成 sqlc、运行 crash-window 测试并提交**

Run: `make sqlc`

Run: `cd server && go test ./internal/service -run 'TestWorkflowDispatchWorker|TestEnqueueWorkflowDispatch' -v`

Expected: PASS；事务提交后模拟退出、租约过期、task 插入后退出三种路径最终都只有一条 task。

```bash
git add server/internal/service/workflow_dispatch* server/internal/service/workflow.go server/pkg/db/queries server/pkg/db/generated server/cmd/server/main.go
git commit -m "feat(workflow): dispatch node runs through durable jobs"
```

---

### Task 6: 将角色提升、下游激活、重试与恢复改为事务内入队

**Files:**
- Modify: `server/internal/service/workflow_role_assignment.go:1-175`
- Modify: `server/internal/service/workflow_role_resolution_worker.go:20-280`
- Modify: `server/internal/service/workflow_role_resolution_worker_integration_test.go`
- Modify: `server/internal/service/workflow.go:840-1240,1380-1700,1800-2180`
- Modify: `server/internal/service/task.go:450-620`
- Modify: `server/cmd/server/main.go:560-580`
- Modify: `server/pkg/db/queries/workflow_role_resolution.sql`
- Modify: `server/pkg/db/queries/workflow_dispatch.sql`
- Generated: `server/pkg/db/generated/*.go`

**Interfaces:**
- Consumes: `EnqueueWorkflowDispatch` 与唯一 `(node_run_id,phase,generation)`
- Produces: `PromoteWorkflowRunAndEnqueueRoots(ctx, q, runID) error`
- Produces: `ActivateDownstreamAndEnqueue(ctx, q, completedNodeRunID) error`
- Produces: `NextWorkflowDispatchGeneration(ctx, q, nodeRunID, phase) (int32, error)`

- [ ] **Step 1: 写状态转换与 job 同事务测试**

```go
func TestAssignWorkflowRolePromotesRunAndEnqueuesRootsAtomically(t *testing.T) {
	f := newRoleAssignmentFixture(t)
	if err := f.service.AssignWorkflowRole(f.ctx, f.assignment()); err != nil { t.Fatal(err) }
	if got := f.runStatus(); got != RunStatusRunning { t.Fatalf("status=%q", got) }
	if got := f.pendingDispatchJobs(); got != f.rootCount { t.Fatalf("jobs=%d roots=%d", got, f.rootCount) }
}

func TestRetryNodeRunCreatesNextGenerationWithoutDefinitionRead(t *testing.T) {
	f := newRuntimeIsolationFixture(t)
	f.deleteSourceDefinitionNode()
	if err := f.service.RetryNodeRun(f.ctx, f.nodeRunID); err != nil { t.Fatal(err) }
	if got := f.dispatchGenerations(f.nodeRunID, "worker"); !reflect.DeepEqual(got, []int32{1, 2}) {
		t.Fatalf("generations=%v", got)
	}
}
```

Run: `cd server && go test ./internal/service -run 'TestAssignWorkflowRolePromotes|TestRetryNodeRunCreatesNext' -v`

Expected: FAIL，仍由 callback/direct dispatch 执行。

- [ ] **Step 2: 角色解析完成与人工分配在提升事务内建 job**

删除 `WorkflowRoleResolutionWorker.OnRunPromoted` 和 `main.go` 注册的 `DispatchRootNodeRuns` callback。角色解析/人工分配更新具体 actor 时，同事务写 `worker_name_snapshot` / `critic_name_snapshot`；所有 slot resolved 后将 run 提升为 running 并为解除阻塞的 root 创建 job。

- [ ] **Step 3: 下游激活在状态事务内建 job**

上游完成检查只能读取 run edge；符合 gateway 条件的下游 node run 状态更新与 generation 1 job insert 在同一事务。unique key 使并发上游完成不会重复创建 job。

- [ ] **Step 4: 重试、接管、交还与评论恢复建立下一 generation**

所有同 run 重派发读取 node run 的 snapshot actor/runtime config，使用 `max(generation)+1`，在状态提交前创建对应 `worker`、`critic`、`split` 或 recovery phase job。删除 service、handler 与 callback 中的 goroutine/best-effort `dispatchWorker` 调用。

- [ ] **Step 5: 运行角色/状态机集成测试并提交**

Run: `make sqlc`

Run: `cd server && go test ./internal/service -run 'Test(WorkflowRoleResolutionWorkerIntegration|AssignWorkflowRole|RetryNodeRun|GatewayRunForkAndJoin)' -v`

Expected: PASS，任何可执行状态提交都伴随 durable job，角色回调不再负责派发。

```bash
git add server/internal/service/workflow_role_assignment.go server/internal/service/workflow_role_resolution_worker* server/internal/service/workflow.go server/internal/service/task.go server/pkg/db/queries server/pkg/db/generated server/cmd/server/main.go
git commit -m "refactor(workflow): enqueue every runtime dispatch transactionally"
```

---

### Task 7: 集中运行态 repository 并切换拓扑、节点配置与任务上下文

**Files:**
- Create: `server/internal/service/workflow_runtime_repository.go`
- Create: `server/internal/service/workflow_runtime_repository_test.go`
- Modify: `server/pkg/db/queries/workflow_snapshot.sql`
- Modify: `server/pkg/db/queries/workflow_node_run.sql:1-390`
- Modify: `server/internal/service/workflow.go:840-1240,1530-2180`
- Modify: `server/internal/service/workflow_topo.go`
- Modify: `server/internal/service/workflow_runtime_selection.go:200-430`
- Modify: `server/internal/service/task.go:450-620,2240-2280`
- Modify: `server/internal/service/task_cscloud_push.go:350-410`
- Modify: `server/internal/handler/daemon.go:1660-1870`
- Modify: `server/internal/handler/issue.go:3300-3460`
- Generated: `server/pkg/db/generated/*.go`

**Interfaces:**
- Consumes: node-run snapshot 列和 `multica_workflow_run_edge`
- Produces: `WorkflowRuntimeRepository`
- Produces: `GetRunNodeConfig(ctx, nodeRunID) (RunNodeConfig, error)`
- Produces: `ListRunEdgesBySource(ctx, nodeRunID) ([]db.MulticaWorkflowRunEdge, error)`
- Produces: `ListRunEdgesByTarget(ctx, nodeRunID) ([]db.MulticaWorkflowRunEdge, error)`
- Produces: `GetRunDefinitionSnapshot(ctx, runID) (WorkflowDefinitionSnapshot, error)`

- [ ] **Step 1: 写删除/编辑 definition 后继续运行的失败测试**

```go
func TestRuntimeRepositorySurvivesDefinitionMutation(t *testing.T) {
	f := newRunningWorkflowFixture(t)
	f.updateSourceNodeActorAndDeleteSourceEdges()

	config, err := f.runtime.GetRunNodeConfig(f.ctx, f.rootNodeRunID)
	if err != nil { t.Fatal(err) }
	if config.WorkerID != f.originalWorkerID { t.Fatalf("worker changed to %s", config.WorkerID) }
	edges, err := f.runtime.ListRunEdgesBySource(f.ctx, f.rootNodeRunID)
	if err != nil { t.Fatal(err) }
	if len(edges) != 1 || edges[0].TargetNodeRunID != f.childNodeRunID { t.Fatalf("edges=%#v", edges) }
}
```

另写测试删除 definition node 后，gateway、stage context、worker/critic dispatch、runtime selection 和评论恢复仍成功。

Run: `cd server && go test ./internal/service -run TestRuntimeRepositorySurvivesDefinitionMutation -v`

Expected: FAIL，运行路径仍查询 definition 表。

- [ ] **Step 2: 实现语义明确的 runtime repository**

```go
type RunNodeConfig struct {
	NodeRunID          pgtype.UUID
	WorkflowRunID      pgtype.UUID
	SourceNodeID       pgtype.UUID
	Title              string
	Description        string
	FormatSchema       json.RawMessage
	CriticAPIURL       pgtype.Text
	StageSnapshot      json.RawMessage
	WorkerRoleSnapshot json.RawMessage
	CriticRoleSnapshot json.RawMessage
	RuntimeConfig      json.RawMessage
	WorkerType         string
	WorkerID           pgtype.UUID
	CriticType         string
	CriticID           pgtype.UUID
}

type WorkflowRuntimeRepository struct { Queries *db.Queries }
```

repository 接口只接收 run ID 或 node run ID，不接受 workflow ID/source node ID 作为运行查询入口。

- [ ] **Step 3: 替换运行期 definition 查询**

逐个替换 `workflow.go`、`workflow_runtime_selection.go`、`task.go`、`task_cscloud_push.go` 和 handler runtime 路径中的 `GetWorkflowNode`、`ListWorkflowEdges*`。stage context 必须以 run edge 连接同 run 的 node run；gateway/边界/Split 类型从 `RunNodeConfig.FormatSchema` 解析；actor 显示/任务上下文优先用 node-run 名称与 role snapshot。

- [ ] **Step 4: 增加禁止回归的静态测试**

测试读取指定运行文件源码，禁止出现下列调用；只允许 definition 编辑、模板克隆和 prepare 文件调用它们：

```go
func TestRuntimeFilesDoNotReadWorkflowDefinitionTables(t *testing.T) {
	files := []string{"workflow.go", "workflow_runtime_selection.go", "task.go", "task_cscloud_push.go"}
	for _, name := range files {
		body, err := os.ReadFile(name)
		if err != nil { t.Fatal(err) }
		for _, forbidden := range []string{"GetWorkflowNode(ctx", "ListWorkflowEdgesBySource(ctx", "ListWorkflowEdgesByTarget(ctx"} {
			if bytes.Contains(body, []byte(forbidden)) { t.Errorf("%s contains %s", name, forbidden) }
		}
	}
}
```

- [ ] **Step 5: 生成 sqlc、运行运行态回归并提交**

Run: `make sqlc`

Run: `cd server && go test ./internal/service ./internal/handler -run 'Test(RuntimeRepository|RuntimeFilesDoNotRead|Gateway|WorkflowBoundary|WorkflowRuntime)' -v`

Expected: PASS，definition node/edge 修改或删除不改变已有 run。

```bash
git add server/internal/service/workflow_runtime_repository* server/internal/service/workflow.go server/internal/service/workflow_topo.go server/internal/service/workflow_runtime_selection.go server/internal/service/task*.go server/internal/handler/daemon.go server/internal/handler/issue.go server/pkg/db/queries server/pkg/db/generated
git commit -m "refactor(workflow): read runtime topology from run snapshots"
```

---

### Task 8: 将交付物创建、提交、审核与仓库路径切换到运行态 requirement

**Files:**
- Modify: `server/pkg/db/queries/workflow_deliverable.sql`
- Modify: `server/internal/service/workflow_deliverable_repo.go:1-1100`
- Modify: `server/internal/service/workflow_deliverable_repo_test.go`
- Modify: `server/internal/service/task_cscloud_push.go:350-410`
- Modify: `server/internal/handler/workflow_run.go:960-1060`
- Modify: `server/internal/handler/issue_gitea_deliverables.go`
- Modify: `server/internal/handler/issue_workflow_tree.go`
- Modify: `server/internal/handler/report_pr.go`
- Generated: `server/pkg/db/generated/*.go`

**Interfaces:**
- Consumes: `multica_workflow_node_run_deliverable`
- Produces: `ListNodeRunDeliverableRequirements(ctx, nodeRunID)`
- Produces: submission 的 `deliverable_id` 永远指向运行态 requirement

- [ ] **Step 1: 写 definition deliverable 变化不影响 run 的失败测试**

```go
func TestRunDeliverablesRemainStableAfterDefinitionEditAndDelete(t *testing.T) {
	f := newWorkflowDeliverableFixture(t)
	run := f.prepareRun()
	f.renameDefinitionDeliverable("new title")
	f.deleteDefinitionDeliverable()

	requirements, err := f.queries.ListNodeRunDeliverableRequirements(f.ctx, run.NodeRunID)
	if err != nil { t.Fatal(err) }
	if len(requirements) != 1 || requirements[0].Title != "original title" {
		t.Fatalf("requirements=%#v", requirements)
	}
	if err := f.submit(requirements[0].ID); err != nil { t.Fatal(err) }
}
```

Run: `cd server && go test ./internal/service -run TestRunDeliverablesRemainStableAfterDefinitionEditAndDelete -v`

Expected: FAIL，读取或 submission 外键仍依赖 definition deliverable。

- [ ] **Step 2: 将 service 和 handler 全部改为 node-run requirement 查询**

仓库初始化、目录/文件名、required 计数、提交、critic 审核、PR report 与 issue workflow tree 必须从 `ListNodeRunDeliverableRequirements(nodeRunID)` 读取。definition deliverable query 只保留在编辑 handler 和 prepare snapshot 中。

- [ ] **Step 3: 增加 submission 归属验证**

创建/更新 submission 时同时校验 requirement 的 `workflow_node_run_id` 等于 URL/任务上下文的 node run ID；不允许把另一 run 的 requirement ID 绑定进来。错误返回现有 400/404 语义，不暴露数据库约束细节。

- [ ] **Step 4: 扫描运行路径并运行测试**

Run: `rg -n "ListWorkflowNodeDeliverables|GetWorkflowNode\(" server/internal/service/workflow_deliverable_repo.go server/internal/service/task_cscloud_push.go server/internal/handler/workflow_run.go server/internal/handler/issue_gitea_deliverables.go server/internal/handler/issue_workflow_tree.go server/internal/handler/report_pr.go`

Expected: 无匹配。

Run: `make sqlc`

Run: `cd server && go test ./internal/service ./internal/handler -run 'Test(WorkflowDeliverable|RunDeliverables|ReportPR|IssueWorkflowTree)' -v`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/pkg/db/queries server/pkg/db/generated server/internal/service/workflow_deliverable_repo* server/internal/service/task_cscloud_push.go server/internal/handler/workflow_run.go server/internal/handler/issue_gitea_deliverables.go server/internal/handler/issue_workflow_tree.go server/internal/handler/report_pr.go
git commit -m "refactor(workflow): isolate run deliverable requirements"
```

---

### Task 9: 隔离 Split runtime config 与子 workflow 启动

**Files:**
- Modify: `server/internal/service/workflow_split.go:580-830,900-1400,2160-2230,2320-2480,3040-3090`
- Modify: `server/internal/service/workflow_split_test.go`
- Modify: `server/internal/handler/workflow_split_test.go:2400-2920`
- Modify: `server/pkg/db/queries/workflow_node_run.sql`
- Modify: `server/pkg/db/queries/workflow_split_task.sql`
- Generated: `server/pkg/db/generated/*.go`

**Interfaces:**
- Consumes: `RunNodeConfig.RuntimeConfig`、`PrepareWorkflowRunSnapshot`、dispatch generations
- Produces: `UpdateNodeRunRuntimeConfig(ctx, id, expectedSplitConfigVersion, runtimeConfig)` 乐观锁更新
- Produces: Split child run 只保留 parent split task/run 的稳定业务 ID，不共享 definition 配置

- [ ] **Step 1: 写 Split 不回写 definition 的失败测试**

```go
func TestPatchSplitConfigOnlyUpdatesNodeRunSnapshot(t *testing.T) {
	f := newSplitRuntimeFixture(t)
	before := f.definitionFormatSchema()
	resp := f.patchMaxConcurrency(4, 1)
	if resp.Code != http.StatusOK { t.Fatalf("status=%d body=%s", resp.Code, resp.Body.String()) }
	if got := f.definitionFormatSchema(); !bytes.Equal(got, before) { t.Fatalf("definition changed: %s", got) }
	config := f.nodeRunRuntimeConfig()
	if config.MaxConcurrency != 4 || f.splitConfigVersion() != 2 { t.Fatalf("config=%#v", config) }
}

func TestSplitChildRunUsesChildWorkflowCurrentSnapshotOnly(t *testing.T) {
	f := newSplitChildRunFixture(t)
	f.startParentRun()
	f.editChildWorkflowDefinition()
	child := f.startChildRun()
	if child.Run.SourceConfigRevision != f.childRevision { t.Fatalf("revision=%d", child.Run.SourceConfigRevision) }
	assertSnapshotDoesNotContain(t, child.Run.DefinitionSnapshot, f.parentNodeID)
}
```

Run: `cd server && go test ./internal/handler ./internal/service -run 'TestPatchSplitConfigOnly|TestSplitChildRunUses' -v`

Expected: FAIL，当前路径更新 `workflow_node.format_schema` 或直接派发 child run。

- [ ] **Step 2: 将 Split 运行参数写入 `node_run.runtime_config`**

解析 snapshot 中的初始 Split 配置后，每次运行时 `max_concurrency` 修改只执行：

```sql
-- name: UpdateNodeRunRuntimeConfig :one
UPDATE multica_workflow_node_run
SET runtime_config = $2,
    split_config_version = split_config_version + 1,
    updated_at = now()
WHERE id = $1 AND split_config_version = $3
RETURNING *;
```

零行返回映射为现有 version conflict。删除 Split runtime handler/service 对 `UpdateWorkflowNode`、`format_schema` definition update 的调用。

- [ ] **Step 3: 将 Split phase 和恢复路径切换到 node-run snapshot/job**

planner、critic、repair、chat、retry 和恢复读取 `GetRunNodeConfig`；重派发创建对应下一 generation job。已有 split task dispatch key 保持业务幂等，但不替代 workflow dispatch job 的 task 幂等键。

- [ ] **Step 4: 子 workflow 通过统一 prepare 服务独立启动**

`scheduleReadyTasks` 组装 child issue 和 `PrepareWorkflowRunParams{DispatchKey: splitTaskDispatchKey(task), SourceIssueID: ...}`，调用 `PrepareWorkflowRunSnapshot(childWorkflowID, params)`；删除提交后 `DispatchRootNodeRuns`。父子只通过 split task `run_id` 等稳定字段关联。

- [ ] **Step 5: 运行 Split 回归并提交**

Run: `make sqlc`

Run: `cd server && go test ./internal/service ./internal/handler -run 'Test(Split|PatchSplitConfig|ScheduleReadyTasks|RetrySplitTask)' -v`

Expected: PASS，definition `format_schema` 在整个测试中不变，child run 有自己的 snapshot 与 dispatch job。

```bash
git add server/internal/service/workflow_split* server/internal/handler/workflow_split_test.go server/pkg/db/queries server/pkg/db/generated
git commit -m "refactor(workflow): isolate split runtime configuration"
```

---

### Task 10: 暴露兼容 API contract 与结构化启动错误

**Files:**
- Modify: `server/internal/handler/workflow_run.go:280-365,430-1060`
- Modify: `server/internal/handler/workflow.go:430-520`
- Create: `server/internal/handler/workflow_runtime_isolation_test.go`
- Modify: `packages/core/types/workflow.ts:215-380`
- Modify: `packages/core/api/schemas.ts:920-1108`
- Modify: `packages/core/api/schemas.test.ts`
- Modify: `packages/core/api/schema.test.ts`
- Modify: `packages/core/api/client.ts`（start/run detail methods）

**Interfaces:**
- Consumes: `WorkflowConfigInvalidError`、run snapshot、node-run source ID/name snapshots
- Produces: `workflow_config_invalid` 422 wire response
- Produces: `WorkflowDefinitionSnapshotSchema`（known schema parse + unknown/malformed fallback）
- Produces: `WorkflowNodeRun.sourceWorkflowNodeId?: string` 且保留必填 `workflowNodeId: string`

- [ ] **Step 1: 写 handler 422 和 node ID alias 失败测试**

```go
func TestStartWorkflowRunReturnsStructuredConfigError(t *testing.T) {
	h := newWorkflowRuntimeIsolationHandlerFixture(t)
	w := httptest.NewRecorder()
	h.Handler.StartWorkflowRun(w, h.invalidStartRequest())
	if w.Code != http.StatusUnprocessableEntity { t.Fatalf("status=%d body=%s", w.Code, w.Body.String()) }
	var body struct { Code, RunID string; Issues []service.WorkflowConfigIssue }
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil { t.Fatal(err) }
	if body.Code != "workflow_config_invalid" || body.RunID == "" || len(body.Issues) == 0 { t.Fatalf("body=%#v", body) }
}

func TestWorkflowNodeRunResponseKeepsWorkflowNodeIDAlias(t *testing.T) {
	h := newWorkflowRuntimeIsolationHandlerFixture(t)
	body := h.getNodeRunResponse()
	if body.WorkflowNodeID == "" || body.WorkflowNodeID != body.SourceWorkflowNodeID {
		t.Fatalf("response=%#v", body)
	}
}
```

Run: `cd server && go test ./internal/handler -run 'TestStartWorkflowRunReturnsStructured|TestWorkflowNodeRunResponseKeeps' -v`

Expected: FAIL，响应 contract 尚未增加。

- [ ] **Step 2: 显式构建 handler response DTO**

不得直接 JSON encode sqlc row。node run DTO 同时写两个 ID；run DTO 把新增字段设为可选兼容字段：

```go
type workflowNodeRunResponse struct {
	ID                   string `json:"id"`
	WorkflowRunID        string `json:"workflow_run_id"`
	WorkflowNodeID       string `json:"workflow_node_id"`
	SourceWorkflowNodeID string `json:"source_workflow_node_id,omitempty"`
	NodeTitle            string `json:"node_title"`
	WorkerNameSnapshot   string `json:"worker_name_snapshot"`
	CriticNameSnapshot   string `json:"critic_name_snapshot"`
}

func newWorkflowNodeRunResponse(row db.MulticaWorkflowNodeRun) workflowNodeRunResponse {
	sourceID := util.UUIDToString(row.SourceWorkflowNodeID)
	return workflowNodeRunResponse{
		ID: util.UUIDToString(row.ID), WorkflowRunID: util.UUIDToString(row.WorkflowRunID),
		WorkflowNodeID: sourceID, SourceWorkflowNodeID: sourceID,
		NodeTitle: row.NodeTitle, WorkerNameSnapshot: row.WorkerNameSnapshot,
		CriticNameSnapshot: row.CriticNameSnapshot,
	}
}
```

DTO 要包含现有所有 node run 字段，不能因示例省略而造成 API 回归。

- [ ] **Step 3: 映射结构化启动错误与自动通知**

手动 handler 使用 `errors.As` 返回精确 422 body。自动/Issue/Split 入口收到该错误时不再次创建 run，而是使用错误内 `RunID` 调用现有 notification enqueue，责任人取 `ResponsibleUserID`；缺少责任人时写现有系统可见事件。

- [ ] **Step 4: 写 Zod 新旧响应与错误类型测试**

```typescript
it("keeps the legacy node id and accepts a new source id", () => {
  const parsed = WorkflowNodeRunSchema.parse({
    id: "nr", workflow_run_id: "run", workflow_node_id: "node-old",
    source_workflow_node_id: "node-new",
  });
  expect(parsed.workflow_node_id).toBe("node-old");
  expect(parsed.source_workflow_node_id).toBe("node-new");
});

it("accepts an old response without snapshot fields", () => {
  expect(WorkflowRunSchema.safeParse(oldWorkflowRunFixture).success).toBe(true);
});

it("falls back for an unknown snapshot schema without rejecting the run", () => {
  const parsed = WorkflowRunSchema.parse({
    ...oldWorkflowRunFixture,
    definition_schema_version: 99,
    definition_snapshot: { schema_version: 99, snapshot_origin: "native", nodes: "invalid" },
  });
  expect(parsed.definition_snapshot).toBeNull();
});

it("rejects a non-string workflow_node_id", () => {
  expect(WorkflowNodeRunSchema.safeParse({
    id: "nr", workflow_run_id: "run", workflow_node_id: 7,
  }).success).toBe(false);
});
```

Run: `pnpm --filter @multica/core exec vitest run api/schemas.test.ts api/schema.test.ts`

Expected: FAIL，新字段/schema 未定义。

- [ ] **Step 5: 实现客户端类型、schema 与通用错误 fallback**

`WorkflowRunSchema` 新字段使用 `.optional()`/`.nullable()` 并为 snapshot 使用 `z.preprocess`：只接受 schema version 1 的完整形状，unknown/malformed 转为 `null`，不能让整个 run parse 失败。`workflow_node_id` 保持 `z.string()` 必填，`source_workflow_node_id` 为 optional string。启动 client 解析新错误字段；字段缺失时返回现有通用“无法启动工作流，请检查配置。”消息。

- [ ] **Step 6: 运行后端/核心测试并提交**

Run: `cd server && go test ./internal/handler -run 'Test(StartWorkflowRunReturnsStructured|WorkflowNodeRunResponseKeeps)' -v`

Run: `pnpm --filter @multica/core exec vitest run api/schemas.test.ts api/schema.test.ts`

Expected: 全部 PASS。

```bash
git add server/internal/handler/workflow*.go server/internal/handler/workflow_runtime_isolation_test.go packages/core/types/workflow.ts packages/core/api/schemas.ts packages/core/api/schemas.test.ts packages/core/api/schema.test.ts packages/core/api/client.ts
git commit -m "feat(workflow): expose snapshot-compatible run APIs"
```

---

### Task 11: 从 snapshot 回放运行详情并删除编辑器 preflight UX

**Files:**
- Modify: `packages/core/workflows/queries.ts:90-135`
- Modify: `packages/views/workflows/components/workflow-run-page.tsx`
- Modify: `packages/views/workflows/components/workflow-run-page.test.tsx`
- Modify: `packages/views/workflows/components/overview/workflow-panorama-page.tsx:70-100,250-370,460-490`
- Modify: `packages/views/workflows/components/overview/workflow-panorama-page.test.tsx`
- Modify: `packages/views/workflows/components/overview/workflow-editor-toolbar.tsx:45-145`
- Modify: `packages/views/workflows/components/overview/workflow-editor-toolbar.test.tsx`
- Delete: `packages/views/workflows/components/overview/preflight-bar.tsx`
- Delete: `packages/views/workflows/components/overview/preflight-bar.test.tsx`
- Modify: `packages/views/locales/en/workflows.ts`（删除已无引用的 editor preflight copy）
- Modify: `packages/views/locales/zh-CN/workflows.ts`（删除已无引用的 editor preflight copy）
- Keep: `packages/core/workflows/preflight-checks.ts`、`packages/core/workflows/preflight-checks.test.ts`（保留纯工具，但编辑器不得导入）

**Interfaces:**
- Consumes: `WorkflowRun.definitionSnapshot`、`sourceWorkflowNodeId ?? workflowNodeId`、actor name snapshots
- Produces: `workflowRunOptions` 是运行详情画布 definition 的唯一 server-state 请求
- Produces: editor toolbar 启用禁用条件仅为 mutation pending/unsaved edits，不再接收 blocking preflight count

- [ ] **Step 1: 写运行详情只用 snapshot 的失败测试**

```typescript
it("renders snapshot nodes without requesting current definition", async () => {
  apiMocks.getWorkflowRun.mockResolvedValue(runWithNativeSnapshot);
  apiMocks.listWorkflowNodes.mockRejectedValue(new Error("must not be called"));
  apiMocks.listWorkflowEdges.mockRejectedValue(new Error("must not be called"));
  render(<WorkflowRunPage workflowId="wf" runId="run" />);
  expect(await screen.findByText("Snapshot node")).toBeInTheDocument();
  expect(apiMocks.listWorkflowNodes).not.toHaveBeenCalled();
  expect(apiMocks.listWorkflowEdges).not.toHaveBeenCalled();
});

it("maps status with source id and falls back for a legacy node run", async () => {
  renderRun({ nodeRuns: [newNodeRun, legacyNodeRun] });
  expect(await screen.findByTestId("node-source-new")).toHaveAttribute("data-status", "working");
  expect(screen.getByTestId("node-source-legacy")).toHaveAttribute("data-status", "completed");
});

it("renders generic nodes for an unsupported snapshot", async () => {
  renderRun({ run: runWithUnsupportedSnapshot });
  expect(await screen.findByText("Workflow node")).toBeInTheDocument();
  expect(screen.queryByTestId("workflow-run-error-boundary")).not.toBeInTheDocument();
});
```

Run: `pnpm --filter @multica/views exec vitest run workflows/components/workflow-run-page.test.tsx`

Expected: FAIL，页面仍请求当前 definition。

- [ ] **Step 2: 从 run snapshot 构造只读画布 model**

运行详情不再调用 workflow nodes/edges/stages query。对 known snapshot 映射 nodes、edges、stages；node status map 的 key 统一：

```typescript
const sourceNodeId = (nodeRun: WorkflowNodeRun) =>
  nodeRun.source_workflow_node_id ?? nodeRun.workflow_node_id;

const nodeRunBySourceId = new Map(
  nodeRuns.map((nodeRun) => [sourceNodeId(nodeRun), nodeRun]),
);
```

actor label 先使用 `worker_name_snapshot`/`critic_name_snapshot`；空字符串的 legacy actor 显示通用 member/agent/squad 类型，不请求或猜测当前其他 actor 名称。

- [ ] **Step 3: 写编辑器不渲染 preflight 且可启用的失败测试**

```typescript
it("does not render editor preflight and allows activation after save", async () => {
  render(<WorkflowPanoramaPage {...draftWorkflowProps} />);
  expect(screen.queryByTestId("preflight-bar")).not.toBeInTheDocument();
  const activate = screen.getByRole("button", { name: /activate/i });
  expect(activate).toBeEnabled();
});
```

Run: `pnpm --filter @multica/views exec vitest run workflows/components/overview/workflow-panorama-page.test.tsx workflows/components/overview/workflow-editor-toolbar.test.tsx`

Expected: FAIL，preflight bar/阻断仍存在。

- [ ] **Step 4: 删除编辑器 preflight 依赖与 UI**

删除 panorama 的 `runAllPreflightChecks` import、state、memo、toolbar prop 和 `PreflightBar` 渲染；toolbar 删除 `blockingPreflightIssueCount` 和 `hasBlockingPreflightIssues`。保留保存状态、首阶段引导和请求级结构校验。删除 preflight bar 组件/测试与仅由它使用的 locale key；保留 core preflight 工具文件，避免把无关工具删除混入本变更。

- [ ] **Step 5: 运行前端测试、类型检查并提交**

Run: `pnpm --filter @multica/views exec vitest run workflows/components/workflow-run-page.test.tsx workflows/components/overview/workflow-panorama-page.test.tsx workflows/components/overview/workflow-editor-toolbar.test.tsx`

Run: `pnpm typecheck`

Expected: PASS；运行详情不访问 definition endpoint，编辑器不展示/计算 preflight，启用不被配置问题阻断。

```bash
git add packages/core/workflows/queries.ts packages/views/workflows/components/workflow-run-page* packages/views/workflows/components/overview/workflow-panorama-page* packages/views/workflows/components/overview/workflow-editor-toolbar* packages/views/locales
git rm packages/views/workflows/components/overview/preflight-bar.tsx packages/views/workflows/components/overview/preflight-bar.test.tsx
git commit -m "feat(workflow): replay runs from snapshots and simplify activation"
```

---

### Task 12: 实现 workflow/workspace 删除语义并完成端到端隔离验证

**Files:**
- Create: `server/migrations/145_workflow_runtime_isolation_contract.up.sql`
- Create: `server/migrations/145_workflow_runtime_isolation_contract.down.sql`
- Modify: `server/internal/service/workflow.go:2360-2405`
- Create: `server/internal/service/workflow_delete_integration_test.go`
- Modify: `server/internal/handler/workflow.go:650-690`
- Modify: `server/internal/handler/workflow_delete_test.go`
- Create: `server/internal/service/workspace_delete.go`
- Create: `server/internal/service/workspace_delete_integration_test.go`
- Modify: `server/internal/handler/workspace.go:732-775`
- Modify: `server/internal/handler/workspace_test.go`
- Modify: `server/pkg/db/queries/workflow.sql`
- Modify: `server/pkg/db/queries/workspace.sql`
- Modify: `server/cmd/server/main.go` 或 router wiring（注入 workspace delete service）
- Generated: `server/pkg/db/generated/*.go`

**Interfaces:**
- Consumes: Task 3 的 exclusive workspace role advisory lock、workflow run `ON DELETE RESTRICT`
- Produces: `ErrWorkflowHasRuns` -> HTTP `409 {"code":"workflow_has_runs"}`
- Produces: `DeleteWorkflowDefinition(ctx, workflowID) error`
- Produces: `WorkspaceDeletionService.Delete(ctx, workspaceID) error`

- [ ] **Step 1: 写 workflow 删除竞态与历史保留失败测试**

```go
func TestDeleteWorkflowWithAnyRunReturnsConflictAndPreservesHistory(t *testing.T) {
	f := newWorkflowDeleteFixture(t)
	runID := f.createTerminalRun("completed")
	err := f.service.DeleteWorkflowDefinition(f.ctx, f.workflowID)
	if !errors.Is(err, ErrWorkflowHasRuns) { t.Fatalf("error=%v", err) }
	if !f.workflowExists() || !f.runExists(runID) { t.Fatal("workflow or history was deleted") }
}

func TestDeleteWorkflowAndPrepareRunSerializeOnWorkflowLock(t *testing.T) {
	f := newWorkflowDeleteFixture(t)
	deleteTx := f.beginDeleteAndHoldWorkflowLock()
	startDone := f.startRunAsync()
	f.commitDelete(deleteTx)
	result := <-startDone
	if !errors.Is(result.Err, pgx.ErrNoRows) { t.Fatalf("start result=%#v", result) }
}
```

Run: `cd server && go test ./internal/service ./internal/handler -run 'TestDeleteWorkflowWithAnyRun|TestDeleteWorkflowAndPrepareRun' -v`

Expected: FAIL，handler 当前裸 `DeleteWorkflow` 且数据库曾依赖级联。

- [ ] **Step 2: 实现锁内 workflow 删除服务与 409 映射**

```go
var ErrWorkflowHasRuns = errors.New("workflow has runs")

func (s *WorkflowService) DeleteWorkflowDefinition(ctx context.Context, workflowID pgtype.UUID) error {
	return s.runInTx(ctx, func(qtx *db.Queries) error {
		workflow, err := qtx.LockWorkflowDefinitionForUpdate(ctx, workflowID)
		if err != nil { return err }
		hasRuns, err := qtx.WorkflowHasRuns(ctx, workflow.ID)
		if err != nil { return err }
		if hasRuns { return ErrWorkflowHasRuns }
		return qtx.DeleteWorkflow(ctx, workflow.ID)
	})
}
```

保留现有 template-derived workflow 检查；两种冲突使用不同 error code。归档 workflow 不删除 run，历史详情仍可读取。

- [ ] **Step 3: 写 workspace 显式删除与 task `SET NULL` 测试**

```go
func TestDeleteWorkspaceRemovesRunsInOrderAndDetachesHistoricalTasks(t *testing.T) {
	f := newWorkspaceDeleteFixture(t)
	taskIDs := f.createRunsAndTasks([]string{"succeeded", "failed", "cancelled"})
	if err := f.service.Delete(f.ctx, f.workspaceID); err != nil { t.Fatal(err) }
	if f.workspaceExists() || f.workflowRunCount() != 0 { t.Fatal("workspace runtime data remains") }
	for _, taskID := range taskIDs {
		if got := f.workflowDispatchJobID(taskID); got.Valid { t.Fatalf("task %s still references job", taskID) }
	}
}

func TestDeleteWorkspaceUsesSameLockOrderAsRoleUpdateAndRunStart(t *testing.T) {
	f := newWorkspaceDeleteFixture(t)
	deleteDone := f.deleteAsyncAfterExclusiveRoleLock()
	roleDone := f.updateRoleAsync()
	startDone := f.startRunAsync()
	f.releaseExclusiveRoleLock()
	assertCompletesWithoutDeadlock(t, deleteDone, roleDone, startDone)
}
```

Run: `cd server && go test ./internal/service -run TestDeleteWorkspaceRemovesRunsInOrder -v`

Expected: FAIL，现有 workspace handler 依赖多路径 cascade。

- [ ] **Step 4: 实现 workspace 固定锁与显式删除顺序**

删除事务执行：exclusive role advisory lock -> workspace `FOR UPDATE` -> 取消 active task/session/split/role/dispatch work -> 将 agent task 的 dispatch job FK 置空（也由 FK 兜底）-> 删除 run submissions/deliverables/jobs/edges/node runs/role resolutions/runs -> 删除 workflow definition entities -> 删除共享 roles -> 删除 workspace。每一步使用 workspace-scoped SQL，禁止逐 workflow 调用 `DeleteWorkflowDefinition`。

- [ ] **Step 5: 验证 down migration 的三个拒绝条件**

在三个独立临时测试数据库中分别建立 native run、删除 legacy source node、删除 legacy source deliverable（使 submission 无法反向映射），然后运行 `make migrate-down`；断言命令非零退出，144 仍在 `schema_migrations` 中，且 schema/data 未变化。每个 case 恢复 migration 145 后再继续下一个 case：

Run: `make migrate-down`

Expected: FAIL with `cannot roll back after native snapshot runs exist`（native run case）。

Run: `make migrate-up`

Expected: migration 144 恢复成功。

- [ ] **Step 6: 添加最终 contract migration**

所有 Go/SQL 调用方已只使用 `source_workflow_node_id` 后，145 up 删除 Task 1 的临时 trigger、函数和无外键 alias，并移除只为分步实施保留的 run/node snapshot defaults：

```sql
DROP TRIGGER fill_source_workflow_node_id ON multica_workflow_node_run;
DROP FUNCTION multica_fill_source_workflow_node_id();
ALTER TABLE multica_workflow_node_run DROP COLUMN workflow_node_id;

ALTER TABLE multica_workflow_run
    ALTER COLUMN source_config_revision DROP DEFAULT,
    ALTER COLUMN definition_schema_version DROP DEFAULT,
    ALTER COLUMN definition_snapshot DROP DEFAULT,
    ALTER COLUMN max_retries DROP DEFAULT;
ALTER TABLE multica_workflow_node_run
    ALTER COLUMN node_description DROP DEFAULT,
    ALTER COLUMN runtime_config DROP DEFAULT,
    ALTER COLUMN worker_name_snapshot DROP DEFAULT,
    ALTER COLUMN critic_name_snapshot DROP DEFAULT;
```

145 down 仅恢复分步实施兼容结构，不恢复 definition 外键：重新添加 `workflow_node_id UUID`，从 source ID 回填、设为 NOT NULL，重建相同 copy trigger/function，并恢复上述 defaults。144 down 仍负责受保护地回到旧运行模型。

- [ ] **Step 7: 运行全链路静态扫描**

Run: `rg -n "DispatchRootNodeRuns\(|ListWorkflowEdgesBy(Source|Target)\(|ListWorkflowNodeDeliverables\(|GetWorkflowNode\(" server/internal/service server/internal/handler`

Expected: `DispatchRootNodeRuns` 无生产调用；definition 查询只出现在编辑、模板克隆和 `workflow_run_prepare.go`，不出现在运行、task、daemon、deliverable、Split 恢复路径。

Run: `rg -n "runAllPreflightChecks|PreflightBar|blockingPreflightIssueCount" packages/views/workflows`

Expected: 无匹配。

- [ ] **Step 8: 运行完整验证**

Run: `gofmt -w server/internal/service/workflow_definition.go server/internal/service/workflow_snapshot.go server/internal/service/workflow_preflight.go server/internal/service/workflow_run_prepare.go server/internal/service/workflow_runtime_repository.go server/internal/service/workflow_dispatch.go server/internal/service/workspace_delete.go`

Run: `make sqlc`

Run: `make check`

Expected: migration、sqlc diff、Go build/vet/tests、TypeScript typecheck/tests 与 E2E 全部 PASS。

- [ ] **Step 9: 提交**

```bash
git add server/migrations/145_workflow_runtime_isolation_contract.*.sql server/internal/service/workflow.go server/internal/service/workflow_delete_integration_test.go server/internal/service/workspace_delete* server/internal/handler/workflow.go server/internal/handler/workflow_delete_test.go server/internal/handler/workspace.go server/internal/handler/workspace_test.go server/pkg/db/queries server/pkg/db/generated server/cmd/server/main.go
git commit -m "feat(workflow): protect runtime history during deletion"
```

---

## Requirement Coverage

| 设计要求 | 实施任务 |
| --- | --- |
| definition revision、workflow/role 锁顺序、启用不做完整校验 | Task 3 |
| 强类型 native/legacy snapshot、结构化 preflight | Task 1、Task 2 |
| 单事务创建 run/node/edge/deliverable/role resolution/job | Task 4 |
| 手动、Issue、默认、自动化、API、Split child 统一启动 | Task 4、Task 9 |
| 租约领取、崩溃恢复、agent task 唯一幂等键 | Task 5、Task 6 |
| gateway、边界、下游、stage context、actor/runtime 只读运行数据 | Task 7 |
| 交付物创建、提交、审核、repo/report 只读运行 requirement | Task 8 |
| Split runtime config 不回写 definition，child run 独立 snapshot | Task 9 |
| 422 错误、旧 `workflow_node_id` alias、新旧 schema fallback | Task 10 |
| 运行详情 snapshot 回放、actor 名称降级、编辑器移除 preflight | Task 11 |
| workflow 409 删除保护、workspace 有序删除与统一锁顺序 | Task 12 |
| 终态 legacy 限制、完整回填、受保护 down、最终 contract | Task 1、Task 12 |

---

## Completion Checklist

- [ ] 任意 definition node、edge、stage、role、Split 或 deliverable 修改后，既有 run 的调度、提交、审核与详情均保持启动时行为。
- [ ] 手动与自动入口都由同一 prepare 事务创建 run；配置失败只有一个可追踪 failed run，没有 node run、edge、deliverable、job 或 task。
- [ ] 所有可执行状态提交都原子创建 dispatch job；worker crash window 不产生重复 agent task。
- [ ] legacy 回填只接受终态 run，标记 schema 0/origin legacy；down 的三个保护条件均会中止且保持原数据。
- [ ] workflow 有任意 run 时返回 `409 workflow_has_runs`；workspace 删除显式清理运行数据并解除历史 task 到 job 的引用。
- [ ] 新服务继续输出必填 `workflow_node_id`；新客户端兼容旧响应、未知 snapshot schema 和 malformed snapshot。
- [ ] 编辑器不展示或运行完整 preflight，运行详情不请求当前 definition。
- [ ] `make check` 最终通过。
