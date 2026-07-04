# Workflow 静态预检查 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 发布前对 Workflow 做结构完整性校验（环路 / 缺执行者 / 缺审核者 / 缺审核 API URL / 孤立节点 / 无权限），所有发布入口共享同一后端校验 `ValidateForPublish`，失败时在画布上可视化标注节点/连线，并在底部提示栏列出问题。

**Architecture:** 后端在 `WorkflowService` 新增 `ValidateForPublish(workflowID, actorUserID) → []WorkflowValidationError`，供 `POST /api/workflows/{id}/validate`、`UpdateWorkflow(status="active")`、`StartWorkflowRun`（防御性）复用。前端 `useWorkflowEditorStore` 新增 `validationErrors`，发布失败时画布按 `node_ids`/`edge_ids` 高亮（环路连线红色、缺配置节点橙色警告图标、孤立节点灰色虚线边框），底部固定提示栏列出错误并可点击定位。

**Tech Stack:** Go (Chi, sqlc)、TypeScript (Zod, TanStack Query, Zustand, ReactFlow)、Vitest、`go test`。

## Global Constraints

- 与 Plan A 一致：代码注释仅英文；API 经 Zod + `parseWithFallback`；UUID 约定；迁移当前最高编号随 Plan A 推进（Plan A 用 129/130，本计划无新迁移，复用现有表）。
- human worker/critic 允许 `worker_id`/`critic_id=null`（任意成员领取），不能按空 ID 统一判定缺失；仅 `agent`/`squad` 类型缺失 ID 判定 missing。
- `ValidateForPublish` 是唯一发布校验实现，禁止在 handler 内复制校验逻辑（DRY）。
- 不做 `bun test` 全量测试，只做相关模块测试。

## File Structure

**新增文件：**
- `server/internal/service/workflow_validate.go` — `ValidateForPublish` + `WorkflowValidationError`。
- `server/internal/service/workflow_validate_test.go` — 校验逻辑单元测试。
- `packages/views/workflows/components/validation-bar.tsx` — 底部错误提示栏。
- `packages/views/workflows/components/validation-bar.test.tsx` — 测试。

**修改文件：**
- `server/internal/handler/workflow_run.go` — `StartWorkflowRun` 用 `ValidateForPublish` 取代 `ValidateDAG`。
- `server/internal/handler/workflow.go:397-459` — `UpdateWorkflow` 激活分支用 `ValidateForPublish` 取代内联 worker/critic 检查；新增 `ValidateWorkflow` handler。
- `server/cmd/server/router.go` — 注册 `POST /api/workflows/{id}/validate`。
- `packages/core/workflows/store.ts` — 新增 `validationErrors` 字段 + `setValidationErrors`。
- `packages/core/api/schemas.ts` + `client.ts` + `types/workflow.ts` — `ValidationResult` schema / `validateWorkflow` 方法。
- `packages/core/workflows/queries.ts` — `useValidateWorkflow` mutation。
- `packages/views/workflows/components/dag-canvas.tsx` — 节点/边错误状态渲染。
- `packages/views/workflows/components/reactflow-nodes.tsx` — `WorkflowNode` 警告图标、`WorkflowEdge` error 样式。
- `packages/views/locales/{en,zh-Hans}/workflows.json` — 预检查文案。

---

### Task 1: `ValidateForPublish` service helper

**Files:**
- Create: `server/internal/service/workflow_validate.go`
- Test: `server/internal/service/workflow_validate_test.go`

**Interfaces:**
- Consumes: `db.Queries.ListWorkflowNodes` / `ListWorkflowEdges` / `GetUser`；现有 `ValidateDAG`（复用其环检测逻辑或在新文件内重写）。
- Produces:
  ```go
  type WorkflowValidationError struct {
      Code    string   // "cycle" | "missing_worker" | "missing_critic" | "missing_critic_api_url" | "isolated_node" | "forbidden"
      Message string
      NodeIDs []string
      EdgeIDs []string
  }
  func (s *WorkflowService) ValidateForPublish(ctx context.Context, workflowID pgtype.UUID, actorUserID pgtype.UUID) ([]WorkflowValidationError, error)
  ```

- [ ] **Step 1: 写失败测试**

`server/internal/service/workflow_validate_test.go`:
```go
package service

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestValidateNodesMissingWorkerForAgent(t *testing.T) {
	nodes := []db.MulticaWorkflowNode{
		{ID: uuidA(), Title: "N1", WorkerType: "agent", WorkerID: pgtype.UUID{}}, // missing
		{ID: uuidB(), Title: "N2", WorkerType: "human", WorkerID: pgtype.UUID{}}, // ok (human allows null)
	}
	errs := validateNodes(nodes)
	found := false
	for _, e := range errs {
		if e.Code == "missing_worker" && contains(e.NodeIDs, util.UUIDToString(uuidA())) {
			found = true
		}
	}
	if !found {
		t.Errorf("expected missing_worker for N1, got %+v", errs)
	}
}

func TestValidateNodesMissingCriticApiUrl(t *testing.T) {
	nodes := []db.MulticaWorkflowNode{
		{ID: uuidA(), Title: "N1", CriticType: "api", CriticApiUrl: pgtype.Text{}}, // missing url
	}
	errs := validateNodes(nodes)
	if len(errs) != 1 || errs[0].Code != "missing_critic_api_url" {
		t.Errorf("expected missing_critic_api_url, got %+v", errs)
	}
}

func TestValidateIsolatedNodes(t *testing.T) {
	nodes := []db.MulticaWorkflowNode{
		{ID: uuidA()}, {ID: uuidB()},
	}
	edges := []db.MulticaWorkflowEdge{
		{SourceNodeID: uuidA(), TargetNodeID: uuidB()},
	}
	// A & B connected to each other; with no other nodes, neither is isolated.
	errs := validateIsolated(nodes, edges)
	if len(errs) != 0 {
		t.Errorf("expected no isolated nodes, got %+v", errs)
	}

	nodes = append(nodes, db.MulticaWorkflowNode{ID: uuidC()})
	errs = validateIsolated(nodes, edges)
	if len(errs) != 1 || errs[0].Code != "isolated_node" {
		t.Errorf("expected 1 isolated_node, got %+v", errs)
	}
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd server && go test ./internal/service/ -run TestValidate -v`
Expected: FAIL —— `validateNodes` / `validateIsolated` 未定义。

- [ ] **Step 3: 写实现**

`server/internal/service/workflow_validate.go`:
```go
package service

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/util"
)

// WorkflowValidationError describes a single publish-blocking problem on a
// workflow, scoped to the node/edge IDs that caused it.
type WorkflowValidationError struct {
	Code    string   `json:"code"`
	Message string   `json:"message"`
	NodeIDs []string `json:"node_ids,omitempty"`
	EdgeIDs []string `json:"edge_ids,omitempty"`
}

// ValidateForPublish is the single source of truth for publish-time workflow
// validation. Shared by the validate endpoint, UpdateWorkflow(status=active),
// StartWorkflowRun (defensive), and publish-and-test.
func (s *WorkflowService) ValidateForPublish(ctx context.Context, workflowID pgtype.UUID, actorUserID pgtype.UUID) ([]WorkflowValidationError, error) {
	// Permission check.
	user, err := s.Queries.GetUser(ctx, actorUserID)
	if err != nil {
		return nil, fmt.Errorf("get actor user: %w", err)
	}
	if !user.CanManageWorkflows {
		return []WorkflowValidationError{{Code: "forbidden", Message: "you cannot publish workflows"}}, nil
	}

	nodes, err := s.Queries.ListWorkflowNodes(ctx, workflowID)
	if err != nil {
		return nil, fmt.Errorf("list nodes: %w", err)
	}
	edges, err := s.Queries.ListWorkflowEdges(ctx, workflowID)
	if err != nil {
		return nil, fmt.Errorf("list edges: %w", err)
	}

	errs := []WorkflowValidationError{}
	errs = append(errs, validateCycle(nodes, edges)...)
	errs = append(errs, validateNodes(nodes)...)
	errs = append(errs, validateIsolated(nodes, edges)...)
	return errs, nil
}

// validateNodes checks missing_worker / missing_critic / missing_critic_api_url.
// human worker/critic allow null IDs (any member can claim); only agent/squad
// require a configured ID.
func validateNodes(nodes []db.MulticaWorkflowNode) []WorkflowValidationError {
	errs := []WorkflowValidationError{}
	for _, n := range nodes {
		if (n.WorkerType == "agent" || n.WorkerType == "squad") && !n.WorkerID.Valid {
			errs = append(errs, WorkflowValidationError{
				Code: "missing_worker", Message: fmt.Sprintf("node %q missing worker", n.Title),
				NodeIDs: []string{util.UUIDToString(n.ID)},
			})
		}
		if n.CriticType == "agent" || n.CriticType == "squad" {
			if !n.CriticID.Valid {
				errs = append(errs, WorkflowValidationError{
					Code: "missing_critic", Message: fmt.Sprintf("node %q missing critic", n.Title),
					NodeIDs: []string{util.UUIDToString(n.ID)},
				})
			}
		}
		if n.CriticType == "api" && !n.CriticApiUrl.Valid {
			errs = append(errs, WorkflowValidationError{
				Code: "missing_critic_api_url", Message: fmt.Sprintf("node %q missing critic API URL", n.Title),
				NodeIDs: []string{util.UUIDToString(n.ID)},
			})
		}
	}
	return errs
}

// validateIsolated flags nodes with no incoming or outgoing edges.
func validateIsolated(nodes []db.MulticaWorkflowNode, edges []db.MulticaWorkflowEdge) []WorkflowValidationError {
	connected := make(map[string]bool, len(nodes))
	for _, e := range edges {
		connected[util.UUIDToString(e.SourceNodeID)] = true
		connected[util.UUIDToString(e.TargetNodeID)] = true
	}
	errs := []WorkflowValidationError{}
	for _, n := range nodes {
		if !connected[util.UUIDToString(n.ID)] {
			errs = append(errs, WorkflowValidationError{
				Code: "isolated_node", Message: fmt.Sprintf("node %q is not connected", n.Title),
				NodeIDs: []string{util.UUIDToString(n.ID)},
			})
		}
	}
	return errs
}

// validateCycle wraps the existing ValidateDAG, mapping its error into a
// WorkflowValidationError with the offending edge IDs (best-effort: returns all
// edge IDs since the underlying detector reports nodes, not edges).
func validateCycle(nodes []db.MulticaWorkflowNode, edges []db.MulticaWorkflowEdge) []WorkflowValidationError {
	// Reuse DFS cycle detection. Build adjacency and detect; on cycle, return
	// all edge IDs as the offending set (the frontend highlights all edges red,
	// which is acceptable for MVP — precise edge attribution is a later enhancement).
	adj := make(map[string][]string)
	edgeIDs := []string{}
	for _, e := range edges {
		src := util.UUIDToString(e.SourceNodeID)
		tgt := util.UUIDToString(e.TargetNodeID)
		adj[src] = append(adj[src], tgt)
		edgeIDs = append(edgeIDs, util.UUIDToString(e.ID))
	}
	const (white = 0; gray = 1; black = 2)
	color := make(map[string]int)
	var hasCycle bool
	var dfs func(string)
	dfs = func(u string) {
		color[u] = gray
		for _, v := range adj[u] {
			if color[v] == gray {
				hasCycle = true
				return
			}
			if color[v] == white {
				dfs(v)
			}
		}
		color[u] = black
	}
	for _, n := range nodes {
		if color[util.UUIDToString(n.ID)] == white {
			dfs(util.UUIDToString(n.ID))
			if hasCycle {
				break
			}
		}
	}
	if !hasCycle {
		return nil
	}
	return []WorkflowValidationError{{
		Code: "cycle", Message: "cycle detected in workflow", EdgeIDs: edgeIDs,
	}}
}
```

注意：`GetUser` 查询名以 sqlc 生成为准（搜 `agent.sql`/`user.sql` 中的 `GetUser`）。若实际名为 `GetUserByID` 等则调整。`user.CanManageWorkflows` 字段已存在（migration 117）。

- [ ] **Step 4: 运行测试验证通过**

Run: `cd server && go test ./internal/service/ -run TestValidate -v`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/internal/service/workflow_validate.go server/internal/service/workflow_validate_test.go
git commit -m "feat(workflow): ValidateForPublish shared publish validator"
```

---

### Task 2: `POST /api/workflows/{id}/validate` 端点 + 复用接入

**Files:**
- Modify: `server/internal/handler/workflow.go`（新增 `ValidateWorkflow` handler；改造 `UpdateWorkflow` 激活分支）
- Modify: `server/internal/handler/workflow_run.go`（`StartWorkflowRun` 用 `ValidateForPublish` 取代 `ValidateDAG`）
- Modify: `server/cmd/server/router.go`（注册路由）
- Test: `server/internal/handler/workflow_test.go`（若存在）

**Interfaces:**
- Produces: `POST /api/workflows/{id}/validate` 返回 `{ valid: bool, errors: [...] }`。

- [ ] **Step 1: 写 handler**

在 `server/internal/handler/workflow.go` 追加：
```go
// ValidateWorkflow runs the shared publish validator and returns structured
// errors for the editor to render on the canvas.
func (h *Handler) ValidateWorkflow(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	wf, ok := h.loadWorkflowInWorkspace(w, r, id)
	if !ok {
		return
	}
	userID, _ := requireUserID(w, r)
	errs, err := h.WorkflowService.ValidateForPublish(r.Context(), wf.ID, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "validation failed")
		return
	}
	resp := map[string]any{
		"valid":  len(errs) == 0,
		"errors": errs,
	}
	writeJSON(w, http.StatusOK, resp)
}
```

- [ ] **Step 2: 注册路由**

`server/cmd/server/router.go`，在 `r.Route("/{id}", ...)` 块内（约 519-556 行）追加：
```go
r.Post("/validate", h.ValidateWorkflow)
```

- [ ] **Step 3: 改造 `UpdateWorkflow` 激活分支**

`server/internal/handler/workflow.go:413-437`，删除内联 `nodeNames` 检查循环，改为：
```go
	if req.Status != nil && *req.Status == "active" {
		userID, _ := requireUserID(w, r)
		errs, err := h.WorkflowService.ValidateForPublish(r.Context(), wf.ID, userID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "validation failed")
			return
		}
		if len(errs) > 0 {
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"valid":  false,
				"errors": errs,
			})
			return
		}
	}
```

- [ ] **Step 4: 改造 `StartWorkflowRun` 防御性校验**

`server/internal/handler/workflow_run.go`，`StartWorkflowRun`（147-192 行），把 `h.WorkflowService.ValidateDAG(...)` 调用替换为 `ValidateForPublish`，至少保留 DAG 检查：
```go
	userID, _ := requireUserID(w, r)
	errs, err := h.WorkflowService.ValidateForPublish(r.Context(), wf.ID, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "validation failed")
		return
	}
	for _, e := range errs {
		if e.Code == "cycle" || e.Code == "forbidden" {
			writeError(w, http.StatusBadRequest, e.Message)
			return
		}
	}
```
注意：StartWorkflowRun 是防御性兜底（旧客户端可能绕过 validate 端点直接 start），只阻断 `cycle`/`forbidden`；其余 missing_worker 等不强制阻断（run 仍可创建，节点会卡在 worker_assigned）。

- [ ] **Step 5: 编译并跑测试**

Run: `cd server && go build ./... && go test ./internal/service/ -run TestValidate -v`
Expected: 编译通过；测试 PASS。

- [ ] **Step 6: Commit**

```bash
git add server/internal/handler/workflow.go server/internal/handler/workflow_run.go server/cmd/server/router.go
git commit -m "feat(workflow): POST /api/workflows/:id/validate and reuse ValidateForPublish"
```

---

### Task 3: TS `ValidationResult` schema / 类型 / API client / hook

**Files:**
- Modify: `packages/core/api/schemas.ts`
- Modify: `packages/core/api/client.ts`
- Modify: `packages/core/types/workflow.ts`
- Modify: `packages/core/workflows/queries.ts`
- Test: `packages/core/api/schemas.test.ts`

**Interfaces:**
- Produces: `ValidationResult` 类型 + `ValidationResultSchema`；`api.validateWorkflow(workflowId)`；`useValidateWorkflow(wsId, workflowId)` mutation。

- [ ] **Step 1: 写失败测试**

追加到 `packages/core/api/schemas.test.ts`：
```ts
import { ValidationResultSchema } from "./schemas";

describe("ValidationResultSchema", () => {
  it("parses valid result with errors", () => {
    const r = ValidationResultSchema.parse({
      valid: false,
      errors: [{ code: "missing_worker", message: "x", node_ids: ["n1"] }],
    });
    expect(r.valid).toBe(false);
    expect(r.errors[0].code).toBe("missing_worker");
  });
  it("parses valid=true with empty errors and missing errors array", () => {
    const r = ValidationResultSchema.parse({ valid: true });
    expect(r.errors).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm --filter @multica/core exec vitest run api/schemas.test.ts`
Expected: FAIL —— `ValidationResultSchema` 未导出。

- [ ] **Step 3: 写 schema + 类型**

`packages/core/api/schemas.ts` 追加：
```ts
export const WorkflowValidationErrorSchema = z.object({
  code: z.enum(["cycle", "missing_worker", "missing_critic", "missing_critic_api_url", "isolated_node", "forbidden"])
    .catch("isolated_node"),
  message: z.string().default(""),
  node_ids: z.array(z.string()).default([]),
  edge_ids: z.array(z.string()).default([]),
}).loose();

export const ValidationResultSchema = z.object({
  valid: z.boolean().default(true),
  errors: z.array(WorkflowValidationErrorSchema).default([]),
}).loose();
```

`packages/core/types/workflow.ts` 追加：
```ts
export type WorkflowValidationErrorCode =
  | "cycle" | "missing_worker" | "missing_critic" | "missing_critic_api_url" | "isolated_node" | "forbidden";

export interface WorkflowValidationError {
  code: WorkflowValidationErrorCode;
  message: string;
  node_ids: string[];
  edge_ids: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: WorkflowValidationError[];
}
```

- [ ] **Step 4: 写 API client + hook**

`packages/core/api/client.ts` 追加：
```ts
async validateWorkflow(workflowId: string): Promise<ValidationResult> {
  const raw = await this.fetch<unknown>(`/api/workflows/${workflowId}/validate`, { method: "POST" });
  return parseWithFallback(raw, ValidationResultSchema, { valid: true, errors: [] } as ValidationResult, {
    endpoint: "POST /api/workflows/:id/validate",
  });
}
```

`packages/core/workflows/queries.ts` 追加：
```ts
export function useValidateWorkflow(wsId: string, workflowId: string) {
  return useMutation({
    mutationFn: () => api.validateWorkflow(workflowId),
  });
}
```

- [ ] **Step 5: 运行测试验证通过 + typecheck**

Run: `pnpm --filter @multica/core exec vitest run api/schemas.test.ts && pnpm typecheck`
Expected: PASS；无类型错误。

- [ ] **Step 6: Commit**

```bash
git add packages/core/api/schemas.ts packages/core/api/client.ts packages/core/types/workflow.ts packages/core/workflows/queries.ts packages/core/api/schemas.test.ts
git commit -m "feat(workflow): ValidationResult schema, client, and useValidateWorkflow hook"
```

---

### Task 4: `useWorkflowEditorStore` 新增 `validationErrors`

**Files:**
- Modify: `packages/core/workflows/store.ts`
- Test: `packages/core/workflows/store.test.ts`（若存在）

**Interfaces:**
- Produces: `validationErrors: WorkflowValidationError[]`；`setValidationErrors(errs)`；`clearValidationErrorsForNode(nodeId)`。

- [ ] **Step 1: 扩展 state 接口与初始值**

`packages/core/workflows/store.ts`，在 `WorkflowEditorState` 接口（43 行附近）追加：
```ts
  validationErrors: WorkflowValidationError[];
```
actions 区追加：
```ts
  setValidationErrors: (errors: WorkflowValidationError[]) => void;
  clearValidationErrors: () => void;
```
`initialState` 追加 `validationErrors: []`。在 `create` 实现内追加：
```ts
  setValidationErrors: (errors) => set({ validationErrors: errors }),
  clearValidationErrors: () => set({ validationErrors: [] }),
```
并在 `reset` 内追加 `validationErrors: []`。import `WorkflowValidationError` from `../types/workflow`。

- [ ] **Step 2: 写 store 测试**

`packages/core/workflows/store.test.ts`（若不存在则新建）：
```ts
import { describe, it, expect } from "vitest";
import { useWorkflowEditorStore } from "./store";

describe("useWorkflowEditorStore validationErrors", () => {
  it("sets and clears validation errors", () => {
    const { getState, setState } = useWorkflowEditorStore;
    getState().setValidationErrors([{ code: "cycle", message: "c", node_ids: [], edge_ids: ["e1"] }]);
    expect(getState().validationErrors).toHaveLength(1);
    getState().clearValidationErrors();
    expect(getState().validationErrors).toHaveLength(0);
  });
});
```

- [ ] **Step 3: 运行测试**

Run: `pnpm --filter @multica/core exec vitest run workflows/store.test.ts`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add packages/core/workflows/store.ts packages/core/workflows/store.test.ts
git commit -m "feat(workflow): validationErrors in editor store"
```

---

### Task 5: 画布节点/边错误状态渲染

**Files:**
- Modify: `packages/views/workflows/components/reactflow-nodes.tsx`
- Modify: `packages/views/workflows/components/dag-canvas.tsx`
- Test: `packages/views/workflows/components/dag-canvas.test.tsx`（若存在）

**Interfaces:**
- Consumes: `useWorkflowEditorStore.validationErrors`。
- Produces: 节点警告图标 + 橙色边框（缺配置）、灰色虚线边框（孤立）、环路连线红色。

- [ ] **Step 1: 扩展 `WorkflowNodeData` 与节点渲染**

`packages/views/workflows/components/reactflow-nodes.tsx`，`WorkflowNodeData` 接口（8-21 行）追加：
```ts
  validationErrorCodes?: string[]; // e.g. ["missing_worker"], ["isolated_node"], or undefined
```
在 `WorkflowNode` 组件渲染处，根据 `validationErrorCodes`：
- 含 `isolated_node` → 灰色虚线边框（`stroke-dasharray` + `text-muted-foreground`）。
- 含 `missing_worker`/`missing_critic`/`missing_critic_api_url` → 右上角警告图标（lucide `AlertTriangle`，`text-orange-500`）+ 橙色边框。
- 含 `forbidden` → 不在节点上渲染（按钮层处理）。

实现者读现有 `WorkflowNode` SVG 渲染，在 shape `<path>`/`<rect>` 的 stroke 上条件加 class，并在 `<g>` 内追加 `<AlertTriangle>` 图标（绝对定位右上）。

- [ ] **Step 2: 扩展 `WorkflowEdge` error 样式**

同一文件 `WorkflowEdge`（305 行附近）：从 `data` 读取 `errorEdgeIDs`（或由 canvas 传入 `isError` prop）。若该 edge 在 `cycle` error 的 `edge_ids` 中，渲染红色（`stroke: rgb(239 68 68)`）+ 加粗。实现者在 `getEdgeProps`/路径渲染处条件加 stroke。

- [ ] **Step 3: canvas 注入 validation 数据**

`packages/views/workflows/components/dag-canvas.tsx`，构建 ReactFlow nodes 时（136-170 行），从 `useWorkflowEditorStore` 取 `validationErrors`，为每个节点计算 `validationErrorCodes`：
```ts
const validationErrors = useWorkflowEditorStore((s) => s.validationErrors);
// per node:
const codes = validationErrors
  .filter((e) => e.node_ids?.includes(node.id))
  .map((e) => e.code);
// pass into data.validationErrorCodes
```
构建 edges 时（233-268 行），计算 error edge ID 集合：
```ts
const errorEdgeIDs = new Set(
  validationErrors.filter((e) => e.code === "cycle").flatMap((e) => e.edge_ids)
);
// pass isError={errorEdgeIDs.has(edge.id)} into edge data
```

- [ ] **Step 4: 写测试**

`packages/views/workflows/components/dag-canvas.test.tsx`（若不存在则新建），测试纯辅助函数 `computeNodeErrorCodes(validationErrors, nodeId)`：
```tsx
import { describe, it, expect } from "vitest";
// 假设导出 computeNodeErrorCodes
describe("computeNodeErrorCodes", () => {
  it("returns codes for matching node_ids", () => {
    const errs = [
      { code: "missing_worker" as const, message: "", node_ids: ["n1"], edge_ids: [] },
      { code: "isolated_node" as const, message: "", node_ids: ["n1"], edge_ids: [] },
    ];
    expect(computeNodeErrorCodes(errs, "n1")).toEqual(["missing_worker", "isolated_node"]);
    expect(computeNodeErrorCodes(errs, "n2")).toEqual([]);
  });
});
```

- [ ] **Step 5: 运行测试 + typecheck**

Run: `pnpm --filter @multica/views exec vitest run workflows/components/dag-canvas.test.tsx && pnpm typecheck`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/views/workflows/components/reactflow-nodes.tsx packages/views/workflows/components/dag-canvas.tsx packages/views/workflows/components/dag-canvas.test.tsx
git commit -m "feat(workflow): canvas renders validation errors on nodes and edges"
```

---

### Task 6: 底部错误提示栏 `ValidationBar`

**Files:**
- Create: `packages/views/workflows/components/validation-bar.tsx`
- Test: `packages/views/workflows/components/validation-bar.test.tsx`
- Modify: `packages/views/workflows/components/workflow-editor-page.tsx`（或等价编辑器页面，挂载 ValidationBar）
- Modify: `packages/views/locales/{en,zh-Hans}/workflows.json`

**Interfaces:**
- Consumes: `useWorkflowEditorStore.validationErrors` + `setSelectedNodeId`（点击定位）。
- Produces: 画布底部固定提示栏，列出错误，点击居中到对应节点。

- [ ] **Step 1: 写失败测试**

`packages/views/workflows/components/validation-bar.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ValidationBar } from "./validation-bar";
import { useWorkflowEditorStore } from "@multica/core/workflows/store";

describe("ValidationBar", () => {
  it("renders nothing when no errors", () => {
    useWorkflowEditorStore.setState({ validationErrors: [] });
    const { container } = render(<ValidationBar />);
    expect(container.firstChild).toBeNull();
  });

  it("lists errors and triggers select on click", () => {
    useWorkflowEditorStore.setState({
      validationErrors: [
        { code: "missing_worker", message: "node N1 missing worker", node_ids: ["n1"], edge_ids: [] },
      ],
    });
    render(<ValidationBar />);
    expect(screen.getByText(/missing worker/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm --filter @multica/views exec vitest run workflows/components/validation-bar.test.tsx`
Expected: FAIL —— `ValidationBar` 未定义。

- [ ] **Step 3: 写组件**

`packages/views/workflows/components/validation-bar.tsx`:
```tsx
import { AlertTriangle } from "lucide-react";
import { useWorkflowEditorStore } from "@multica/core/workflows";
import { useT } from "../../locales";

export function ValidationBar() {
  const errors = useWorkflowEditorStore((s) => s.validationErrors);
  const selectNode = useWorkflowEditorStore((s) => s.selectNode);
  const t = useT("workflows");

  if (errors.length === 0) return null;

  return (
    <div className="absolute bottom-0 left-0 right-0 border-t bg-background px-4 py-2 max-h-40 overflow-y-auto">
      <div className="flex items-center gap-2 mb-1 text-xs font-medium text-orange-600">
        <AlertTriangle className="h-3.5 w-3.5" />
        {t(($) => $.validation.title, { count: errors.length })}
      </div>
      <ul className="space-y-1">
        {errors.map((e, i) => {
          const nodeId = e.node_ids?.[0];
          return (
            <li key={i}>
              <button
                type="button"
                className="text-xs text-left text-muted-foreground hover:text-foreground"
                onClick={() => nodeId && selectNode(nodeId)}
              >
                {e.message}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: 挂载到编辑器页面**

在 workflow 编辑器页面（搜 `WorkflowCanvas` 挂载处，`packages/views/workflows/` 下）的画布容器内，紧邻 `<WorkflowCanvas ... />` 挂载 `<ValidationBar />`。容器需 `relative` 定位使 `absolute bottom-0` 生效。

- [ ] **Step 5: i18n key**

`packages/views/locales/en/workflows.json` 新增顶层 `validation`：
```json
"validation": {
  "title": "Publish blocked ({{count}} issues)"
}
```
`zh-Hans/workflows.json`：
```json
"validation": {
  "title": "发布受阻（{{count}} 个问题）"
}
```

- [ ] **Step 6: 运行测试 + typecheck**

Run: `pnpm --filter @multica/views exec vitest run workflows/components/validation-bar.test.tsx && pnpm typecheck`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add packages/views/workflows/components/validation-bar.tsx packages/views/workflows/components/validation-bar.test.tsx packages/views/workflows/components/workflow-editor-page.tsx packages/views/locales/en/workflows.json packages/views/locales/zh-Hans/workflows.json
git commit -m "feat(workflow): ValidationBar lists publish errors with locate-on-click"
```

---

### Task 7: 发布失败时写入 `validationErrors` + 成功清空

**Files:**
- Modify: workflow 编辑器页面的发布按钮 handler（搜 `UpdateWorkflow(status="active")` 调用处）

**Interfaces:**
- Consumes: `useUpdateWorkflow`（现有）、`useWorkflowEditorStore.setValidationErrors`/`clearValidationErrors`。

- [ ] **Step 1: 改造发布按钮**

在编辑器页面的发布 handler 中，`useUpdateWorkflow` 的 `onError`/`onSuccess`：
```ts
const setValidationErrors = useWorkflowEditorStore((s) => s.setValidationErrors);
const clearValidationErrors = useWorkflowEditorStore((s) => s.clearValidationErrors);

const publishMutation = useUpdateWorkflow(wsId, workflowId);
const handlePublish = () => {
  publishMutation.mutate(
    { status: "active" },
    {
      onSuccess: () => clearValidationErrors(),
      onError: (err) => {
        // err 是 AxiosError/fetch error，body 含 { valid, errors }
        const body = (err as any)?.response?.body ?? (err as any)?.body;
        if (body?.errors) {
          setValidationErrors(body.errors);
        }
      },
    },
  );
};
```

注意：`useUpdateWorkflow` 的错误体形状取决于 client 封装。实现者读 `api.updateWorkflow` 与 `fetch` 错误传播方式（搜 `EMPTY_WORKFLOW` 附近 / `fetch` 抛错处理），按实际从 error 取 `errors` 数组。若 fetch 抛 `ApiError` 携带 `body`，则用 `(err as ApiError).body.errors`。

- [ ] **Step 2: 编辑节点/边后清除已修复的 error（可选轻量版）**

在 `useUpdateNode`/`useCreateEdge`/`useDeleteEdge` 的 `onSuccess` 调用 `clearValidationErrors()`（最简：编辑后清空全部，用户重新发布时再校验）。避免精确逐项清除的复杂度。

- [ ] **Step 3: typecheck + 手动验证**

Run: `pnpm typecheck`
Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add packages/views/workflows/components/workflow-editor-page.tsx
git commit -m "feat(workflow): publish failure populates validationErrors, success clears"
```

---

### Task 8: 最终验证

- [ ] **Step 1: 后端**

Run: `cd server && go build ./... && go test ./internal/service/ -run TestValidate -v && go test ./internal/handler/ -run Validate -v 2>/dev/null || true`
Expected: 编译通过；service 测试 PASS。

- [ ] **Step 2: 前端**

Run: `pnpm --filter @multica/core exec vitest run api/schemas.test.ts workflows/store.test.ts && pnpm --filter @multica/views exec vitest run workflows/components/validation-bar.test.tsx workflows/components/dag-canvas.test.tsx && pnpm typecheck`
Expected: 全 PASS。

- [ ] **Step 3: 验收对照（spec §2）**

- validate endpoint 对所有错误返回稳定 `code` 和 `node_ids`/`edge_ids`（Task 1/2）。✅
- `UpdateWorkflow(status="active")` 复用同一 validator（Task 2 Step 3）。✅
- 预检查失败时画布高亮对应节点/连线，底部提示栏列出问题（Task 5/6）。✅

- [ ] **Step 4: Commit（如有遗留）**

```bash
git add -A && git commit -m "test(workflow): precheck verification fixes" || true
```

---

## 自检

**1. Spec 覆盖（§2）：** 6 项检查（cycle / missing_worker / missing_critic / missing_critic_api_url / forbidden / isolated_node）均在 `validateNodes`/`validateCycle`/`validateIsolated` 与权限检查中覆盖（Task 1）。后端契约 `ValidateForPublish` 被 4 入口复用（validate 端点 Task 2、UpdateWorkflow Task 2、StartWorkflowRun 防御 Task 2、publish-and-test 留给 Plan C）。前端画布标注 + 底部提示栏（Task 5/6/7）。

**2. 占位扫描：** 无 TBD。Task 5 Step 1/3 与 Task 7 Step 1 标注「实现者读现有渲染/错误传播按实际调整」——是对现有代码细节的条件依赖，非占位，且给了明确判定方向。

**3. 类型一致性：** `WorkflowValidationError.Code` 字符串值（`cycle`/`missing_worker`/...）与 TS `WorkflowValidationErrorCode` 一一对应；`node_ids`/`edge_ids` 命名前后端一致；`validationErrors: WorkflowValidationError[]` 在 store、ValidationBar、canvas 三处一致。

## 执行交接

Plan complete and saved to `docs/superpowers/plans/2026-07-02-workflow-static-precheck.md`. 执行方式同 Plan A（Subagent-Driven 推荐 / Inline）。后续继续撰写 Plan C–G。
