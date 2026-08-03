# Workflow Boundary Nodes Implementation Plan


**Goal:** 为 workflow 增加可持久化、可编辑、手动连线且首期不参与执行的唯一开始节点和结束节点。

**Architecture:** 始末节点继续存入 `multica_workflow_node`，以 `format_schema.type = "start" | "end"` 标识，并复用现有边表。写入层保证唯一性与连线方向，运行层过滤边界节点及其边，前端为编辑器、模板预览和运行详情提供一致的专用渲染。

**Tech Stack:** Go、Chi、PostgreSQL、sqlc、TypeScript、React、React Query、Zustand、`@xyflow/react`、Vitest、Testing Library。

## Global Constraints

- 每个 workflow 最多一个 start 和一个 end；两者均可选。
- 只允许编辑标题、描述、所属阶段和画布位置；类型创建后不可变。
- 只手动添加、手动连线，不自动创建、不自动连接。
- start 只指向执行节点；end 只接收执行节点；禁止 start 直连 end 或连接 annotation。
- 始末节点不创建 node run，不参与角色解析、派发、上下文、输出、事件或完成统计。
- 数据库要求 `worker_type`、`critic_type` 非空；边界节点保存兼容值 `human`，但 actor/role ID 和 URL 必须为空。
- 编辑器、模板预览、运行详情均展示始末节点；后两者只读。
- 只运行计划列出的相关模块测试，不执行全量测试。
- 设计依据：`docs/superpowers/specs/2026-07-22-workflow-boundary-nodes-design.md`。

## File Map

- `packages/core/types/workflow.ts`：TypeScript 节点类型和边界判定入口。
- `server/internal/workflowmeta/node-format.go`：Go 节点类型与边界规则。
- `server/migrations/142_workflow_boundary_nodes.*.sql`：数据库唯一性约束。
- `server/internal/handler/workflow.go`：节点和边的权威写入校验。
- `server/internal/service/workflow.go`：运行图过滤与 node run 创建。
- `packages/core/workflows/preflight-checks.ts`：边界节点预检。
- `packages/views/workflows/components/overview/node-template-*`：添加入口和唯一性禁用。
- `packages/views/workflows/components/overview/reactflow-nodes/boundary-node.tsx`：共享视觉。
- `packages/views/workflows/components/canvas/workflow-canvas-model.ts`：编辑器及模板预览映射。
- `packages/views/workflows/components/dag-canvas.tsx`：运行详情旧画布适配。
- `packages/views/workflows/components/node-config-panel.tsx`：受限配置面板。

---

### Task 1: 建立跨端边界节点类型契约

**Files:**
- Modify: `packages/core/types/workflow.ts`
- Modify: `packages/core/types/workflow.test.ts`
- Create: `server/internal/workflowmeta/node-format.go`
- Create: `server/internal/workflowmeta/node-format_test.go`

**Interfaces:**
- Produces: `WorkflowBoundaryKind`, `isBoundaryNode()`, `isStartNode()`, `isEndNode()`, `isInvalidBoundaryConnection()`。
- Produces: `workflowmeta.KindOf()`, `workflowmeta.IsBoundary()`, `workflowmeta.ValidateBoundaryEdge()`。

- [ ] **Step 1: 写 TypeScript 失败测试**

```ts
it("parses and classifies workflow boundary nodes", () => {
  const start = makeNode({ format_schema: { type: "start", shape: "pill" } });
  const end = makeNode({ format_schema: { type: "end", shape: "pill" } });
  const task = makeNode({ format_schema: { shape: "rectangle" } });
  expect(parseNodeFormat(start.format_schema).kind).toBe("start");
  expect(parseNodeFormat(end.format_schema).kind).toBe("end");
  expect(isStartNode(start)).toBe(true);
  expect(isEndNode(end)).toBe(true);
  expect(isBoundaryNode(task)).toBe(false);
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @multica/core test -- types/workflow.test.ts`

Expected: FAIL，三个判定函数未导出，`start/end` 未进入 format kind。

- [ ] **Step 3: 实现 TypeScript 契约**

```ts
export type WorkflowBoundaryKind = "start" | "end";
export type WorkflowNodeFormatKind =
  | "task" | "annotation" | "gateway" | "split" | WorkflowBoundaryKind;

export function isBoundaryNode(node: Pick<WorkflowNode, "format_schema">): boolean {
  const kind = parseNodeFormat(node.format_schema).kind;
  return kind === "start" || kind === "end";
}
export function isStartNode(node: Pick<WorkflowNode, "format_schema">): boolean {
  return parseNodeFormat(node.format_schema).kind === "start";
}
export function isEndNode(node: Pick<WorkflowNode, "format_schema">): boolean {
  return parseNodeFormat(node.format_schema).kind === "end";
}
export function isInvalidBoundaryConnection(
  source: Pick<WorkflowNode, "format_schema">,
  target: Pick<WorkflowNode, "format_schema">,
): boolean {
  const sourceKind = parseNodeFormat(source.format_schema).kind;
  const targetKind = parseNodeFormat(target.format_schema).kind;
  const sourceBoundary = sourceKind === "start" || sourceKind === "end";
  const targetBoundary = targetKind === "start" || targetKind === "end";
  return targetKind === "start" || sourceKind === "end" ||
    (sourceKind === "start" && targetKind === "end") ||
    (sourceBoundary && targetKind === "annotation") ||
    (sourceKind === "annotation" && targetBoundary);
}
```

在 `parseNodeFormat()` 中识别 `schema.type === "start" || schema.type === "end"`，保留 shape/template 元数据。

- [ ] **Step 4: 写 Go 失败测试**

```go
func TestBoundaryKindsAndEdges(t *testing.T) {
	start := json.RawMessage(`{"type":"start"}`)
	end := json.RawMessage(`{"type":"end"}`)
	task := json.RawMessage(`{"shape":"rectangle"}`)
	annotation := json.RawMessage(`{"type":"annotation"}`)
	if KindOf(start) != KindStart || KindOf(end) != KindEnd || KindOf(task) != KindTask {
		t.Fatal("unexpected node kind classification")
	}
	if ValidateBoundaryEdge(start, task) != nil || ValidateBoundaryEdge(task, end) != nil {
		t.Fatal("valid boundary edge rejected")
	}
	for _, pair := range [][2]json.RawMessage{{task, start}, {end, task}, {start, end}, {start, annotation}} {
		if !errors.Is(ValidateBoundaryEdge(pair[0], pair[1]), ErrInvalidBoundaryEdge) {
			t.Fatalf("invalid edge accepted: %s -> %s", pair[0], pair[1])
		}
	}
}
```

- [ ] **Step 5: 实现 Go 领域模块**

```go
package workflowmeta

import (
	"encoding/json"
	"errors"
)

type NodeKind string
const (
	KindTask NodeKind = "task"
	KindAnnotation NodeKind = "annotation"
	KindGateway NodeKind = "gateway"
	KindSplit NodeKind = "split"
	KindStart NodeKind = "start"
	KindEnd NodeKind = "end"
)
var ErrInvalidBoundaryEdge = errors.New("invalid workflow boundary edge")

func KindOf(raw json.RawMessage) NodeKind {
	var value struct{ Type string `json:"type"` }
	if len(raw) == 0 || json.Unmarshal(raw, &value) != nil { return KindTask }
	switch NodeKind(value.Type) {
	case KindAnnotation, KindGateway, KindSplit, KindStart, KindEnd:
		return NodeKind(value.Type)
	default:
		return KindTask
	}
}
func IsBoundary(raw json.RawMessage) bool {
	kind := KindOf(raw)
	return kind == KindStart || kind == KindEnd
}
func ValidateBoundaryEdge(source, target json.RawMessage) error {
	s, t := KindOf(source), KindOf(target)
	if t == KindStart || s == KindEnd || (s == KindStart && t == KindEnd) ||
		(IsBoundary(source) && t == KindAnnotation) || (s == KindAnnotation && IsBoundary(target)) {
		return ErrInvalidBoundaryEdge
	}
	return nil
}
```

- [ ] **Step 6: 运行并提交**

Run: `pnpm --filter @multica/core test -- types/workflow.test.ts`

Run: `cd server; go test ./internal/workflowmeta`

Expected: 均 PASS。

```bash
git add packages/core/types/workflow.ts packages/core/types/workflow.test.ts server/internal/workflowmeta
git commit -m "feat(workflows): define boundary node semantics"
```

### Task 2: 持久化唯一性与写入校验

**Files:**
- Create: `server/migrations/142_workflow_boundary_nodes.up.sql`
- Create: `server/migrations/142_workflow_boundary_nodes.down.sql`
- Create: `server/internal/handler/workflow_boundary_test.go`
- Modify: `server/internal/handler/workflow.go`
- Modify: `server/internal/handler/workflow_test.go`

**Interfaces:**
- Consumes: Task 1 `workflowmeta`。
- Produces: constraint `multica_workflow_node_boundary_kind_unique`，重复返回 409，非法 payload/type/edge 返回 422。

- [ ] **Step 1: 写迁移**

```sql
CREATE UNIQUE INDEX multica_workflow_node_boundary_kind_unique
ON multica_workflow_node (workflow_id, (format_schema ->> 'type'))
WHERE format_schema ->> 'type' IN ('start', 'end');
```

down 文件：

```sql
DROP INDEX IF EXISTS multica_workflow_node_boundary_kind_unique;
```

- [ ] **Step 2: 写 handler 失败测试**

```go
func TestCreateWorkflowBoundaryNodeRejectsDuplicateKind(t *testing.T) {
	workflowID := createTestWorkflow(t)
	createBoundaryNode(t, workflowID, "Start", "start", http.StatusCreated)
	createBoundaryNode(t, workflowID, "Start again", "start", http.StatusConflict)
}
func TestUpdateWorkflowBoundaryNodeRejectsTypeMutation(t *testing.T) {
	workflowID := createTestWorkflow(t)
	nodeID := createBoundaryNode(t, workflowID, "Start", "start", http.StatusCreated)
	updateWorkflowNode(t, workflowID, nodeID, map[string]any{
		"format_schema": map[string]any{"type": "end"},
	}, http.StatusUnprocessableEntity)
}
func TestCreateWorkflowEdgeValidatesBoundaryDirection(t *testing.T) {
	workflowID := createTestWorkflow(t)
	startID := createBoundaryNode(t, workflowID, "Start", "start", http.StatusCreated)
	endID := createBoundaryNode(t, workflowID, "End", "end", http.StatusCreated)
	taskID := createTaskNode(t, workflowID, "Task")
	createWorkflowEdge(t, workflowID, startID, taskID, http.StatusCreated)
	createWorkflowEdge(t, workflowID, taskID, endID, http.StatusCreated)
	createWorkflowEdge(t, workflowID, taskID, startID, http.StatusUnprocessableEntity)
	createWorkflowEdge(t, workflowID, endID, taskID, http.StatusUnprocessableEntity)
	createWorkflowEdge(t, workflowID, startID, endID, http.StatusUnprocessableEntity)
}
```

helper 使用现有 `createTestWorkflow/newRequest/withURLParams/testHandler`，请求固定发送 `worker_type: "human"`、`critic_type: "human"`，并 cleanup workflow。

在测试文件内定义并复用以下 helper 形状；每个 helper 都调用对应 handler，并验证实际 HTTP status：

```go
func createBoundaryNode(t *testing.T, workflowID, title, kind string, wantStatus int) string {
	t.Helper()
	w := httptest.NewRecorder()
	req := newRequest("POST", fmt.Sprintf("/api/workflows/%s/nodes", workflowID), map[string]any{
		"title": title, "worker_type": "human", "critic_type": "human",
		"format_schema": map[string]any{"type": kind, "shape": "pill"},
	})
	testHandler.CreateWorkflowNode(w, withURLParams(req, "id", workflowID))
	if w.Code != wantStatus { t.Fatalf("create %s: got %d: %s", kind, w.Code, w.Body.String()) }
	if wantStatus != http.StatusCreated { return "" }
	var response struct{ ID string `json:"id"` }
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil { t.Fatal(err) }
	return response.ID
}
func createTaskNode(t *testing.T, workflowID, title string) string {
	t.Helper()
	w := httptest.NewRecorder()
	req := newRequest("POST", fmt.Sprintf("/api/workflows/%s/nodes", workflowID), map[string]any{
		"title": title, "worker_type": "human", "critic_type": "human",
		"format_schema": map[string]any{"shape": "rectangle"},
	})
	testHandler.CreateWorkflowNode(w, withURLParams(req, "id", workflowID))
	if w.Code != http.StatusCreated { t.Fatalf("create task: got %d: %s", w.Code, w.Body.String()) }
	var response struct{ ID string `json:"id"` }
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil { t.Fatal(err) }
	return response.ID
}
func updateWorkflowNode(t *testing.T, workflowID, nodeID string, body map[string]any, wantStatus int) {
	t.Helper()
	w := httptest.NewRecorder()
	req := newRequest("PUT", fmt.Sprintf("/api/workflows/%s/nodes/%s", workflowID, nodeID), body)
	testHandler.UpdateWorkflowNode(w, withURLParams(req, "id", workflowID, "nodeId", nodeID))
	if w.Code != wantStatus { t.Fatalf("update node: got %d: %s", w.Code, w.Body.String()) }
}
func createWorkflowEdge(t *testing.T, workflowID, sourceID, targetID string, wantStatus int) {
	t.Helper()
	w := httptest.NewRecorder()
	req := newRequest("POST", fmt.Sprintf("/api/workflows/%s/edges", workflowID), map[string]any{
		"source_node_id": sourceID, "target_node_id": targetID,
	})
	testHandler.CreateWorkflowEdge(w, withURLParams(req, "id", workflowID))
	if w.Code != wantStatus { t.Fatalf("create edge: got %d: %s", w.Code, w.Body.String()) }
}
```

每个测试使用 `t.Cleanup` 删除创建的 workflow；父级 cascade 清理节点和边。

- [ ] **Step 3: 运行并确认失败**

Run: `cd server; go test ./internal/handler -run 'Test(Create|Update)WorkflowBoundary|TestCreateWorkflowEdgeValidatesBoundary'`

Expected: FAIL；重复节点为 500，类型更新和非法边未被拒绝。

- [ ] **Step 4: 实现节点写入校验**

```go
kind := workflowmeta.KindOf(req.FormatSchema)
if kind == workflowmeta.KindStart || kind == workflowmeta.KindEnd {
	if req.WorkerID != nil || req.WorkerRoleID != nil || req.CriticID != nil ||
		req.CriticRoleID != nil || req.CriticApiURL != nil {
		writeError(w, http.StatusUnprocessableEntity, "boundary nodes cannot configure workers or critics")
		return
	}
	req.WorkerType, req.CriticType = "human", "human"
}
```

更新时比较 `workflowmeta.KindOf(currentNode.FormatSchema)` 与新 format kind；变化返回 422。边界节点更新包含任何 actor/role 字段也返回 422。捕获 PostgreSQL `23505` 且 constraint name 匹配时返回 409。

- [ ] **Step 5: 实现边校验**

```go
if sourceNode.WorkflowID != wf.ID || targetNode.WorkflowID != wf.ID {
	writeError(w, http.StatusUnprocessableEntity, "edge nodes must belong to this workflow")
	return
}
if err := workflowmeta.ValidateBoundaryEdge(sourceNode.FormatSchema, targetNode.FormatSchema); err != nil {
	writeError(w, http.StatusUnprocessableEntity, err.Error())
	return
}
```

将 `isNonExecutableNode()` 扩展为 annotation、gateway、start、end，split 保持可执行。

- [ ] **Step 6: 运行并提交**

Run: `cd server; go test ./internal/handler -run 'TestIsNonExecutableNode|Test(Create|Update)WorkflowBoundary|TestCreateWorkflowEdgeValidatesBoundary'`

Expected: PASS；数据库不可用时集成用例按现有约定 SKIP。

```bash
git add server/migrations/142_workflow_boundary_nodes.*.sql server/internal/handler/workflow.go server/internal/handler/workflow_test.go server/internal/handler/workflow_boundary_test.go
git commit -m "feat(workflows): validate boundary node writes"
```

### Task 3: 运行图过滤与无副作用执行

**Files:**
- Create: `server/internal/service/workflow_boundary_run_test.go`
- Modify: `server/internal/service/workflow.go`

**Interfaces:**
- Produces: `buildExecutableWorkflowGraph(nodes, edges)`。
- Guarantees: 无 boundary node run，边界边不影响根、依赖和完成。

- [ ] **Step 1: 写纯函数和数据库失败测试**

```go
func TestBuildExecutableWorkflowGraphFiltersBoundaryNodesAndEdges(t *testing.T) {
	id := func(last byte) pgtype.UUID {
		var bytes [16]byte
		bytes[15] = last
		return pgtype.UUID{Bytes: bytes, Valid: true}
	}
	node := func(last byte, format string) db.MulticaWorkflowNode {
		return db.MulticaWorkflowNode{ID: id(last), FormatSchema: []byte(format)}
	}
	start := node(1, `{"type":"start"}`)
	a := node(2, `{}`)
	b := node(3, `{}`)
	end := node(4, `{"type":"end"}`)
	nodes, edges := buildExecutableWorkflowGraph(
		[]db.MulticaWorkflowNode{start, a, b, end},
		[]db.MulticaWorkflowEdge{
			{SourceNodeID: start.ID, TargetNodeID: a.ID},
			{SourceNodeID: a.ID, TargetNodeID: b.ID},
			{SourceNodeID: b.ID, TargetNodeID: end.ID},
		},
	)
	if len(nodes) != 2 || nodes[0].ID != a.ID || nodes[1].ID != b.ID {
		t.Fatalf("unexpected executable nodes: %#v", nodes)
	}
	if len(edges) != 1 || edges[0].SourceNodeID != a.ID || edges[0].TargetNodeID != b.ID {
		t.Fatalf("unexpected executable edges: %#v", edges)
	}
}
```

数据库用例建立 `start -> root -> dependent -> end`，并额外保留 `start -> dependent`，用于证明 start 边不会成为 dependent 的真实依赖。`StartRun` 后断言只有两个 node run，root 为 `format_checking`，dependent 为 `pending`；root 完成后 dependent 能推进，真实节点终态后 run 可 completed。

- [ ] **Step 2: 运行并确认失败**

Run: `cd server; go test ./internal/service -run 'TestBuildExecutableWorkflowGraph|TestWorkflowBoundaryNodesDoNotCreateRuns'`

Expected: FAIL；当前创建四个 node run，root 被 start 入边阻塞。

- [ ] **Step 3: 实现执行图过滤**

```go
func buildExecutableWorkflowGraph(
	nodes []db.MulticaWorkflowNode,
	edges []db.MulticaWorkflowEdge,
) ([]db.MulticaWorkflowNode, []db.MulticaWorkflowEdge) {
	ids := make(map[string]struct{}, len(nodes))
	keptNodes := make([]db.MulticaWorkflowNode, 0, len(nodes))
	for _, node := range nodes {
		if workflowmeta.IsBoundary(node.FormatSchema) { continue }
		ids[util.UUIDToString(node.ID)] = struct{}{}
		keptNodes = append(keptNodes, node)
	}
	keptEdges := make([]db.MulticaWorkflowEdge, 0, len(edges))
	for _, edge := range edges {
		_, sourceOK := ids[util.UUIDToString(edge.SourceNodeID)]
		_, targetOK := ids[util.UUIDToString(edge.TargetNodeID)]
		if sourceOK && targetOK { keptEdges = append(keptEdges, edge) }
	}
	return keptNodes, keptEdges
}
```

- [ ] **Step 4: 在 StartRun 使用过滤结果**

加载完整 nodes/edges 后调用该函数。`hasRoleSlots`、`hasIncoming` 和创建 node run 的循环全部使用过滤结果。空执行图创建 run 后必须触发现有完成检查，不能永久停留 running。

`OnNodeRunCompleted` 也必须应用相同语义：遍历 downstream 时若 target 是 boundary 直接跳过；检查真实 target 的 upstream edges 时，加载 source node 并跳过 boundary source。这样 `start -> dependent` 不会因缺少 start node run 永久阻塞真实依赖传播。

- [ ] **Step 5: 运行并提交**

Run: `cd server; go test ./internal/service -run 'TestBuildExecutableWorkflowGraph|TestWorkflowBoundaryNodesDoNotCreateRuns|TestGatewayRunForkAndJoinSemantics'`

Expected: PASS。

```bash
git add server/internal/service/workflow.go server/internal/service/workflow_boundary_run_test.go
git commit -m "feat(workflows): bypass boundary nodes at runtime"
```

### Task 4: 增加边界节点预检

**Files:**
- Modify: `packages/core/workflows/preflight-checks.ts`
- Modify: `packages/core/workflows/preflight-checks.test.ts`
- Modify: `packages/views/workflows/components/overview/preflight-bar.tsx`
- Modify: `packages/views/workflows/components/overview/preflight-bar.test.tsx`
- Modify: `packages/views/locales/en/workflows.json`
- Modify: `packages/views/locales/zh-Hans/workflows.json`

**Interfaces:**
- Consumes: Task 1 边界判定。
- Produces: `boundary-start-outgoing`、`boundary-end-incoming`、`boundary-edge-direction`。

- [ ] **Step 1: 写失败测试**

```ts
it("keeps boundary nodes optional but validates present nodes", () => {
  expect(runAllPreflightChecks(input({ nodes: [task], edges: [] })).issues)
    .not.toEqual(expect.arrayContaining([
      expect.objectContaining({ checkId: expect.stringContaining("boundary") }),
    ]));
  expect(runAllPreflightChecks(input({ nodes: [start, task], edges: [] })).issues)
    .toContainEqual(expect.objectContaining({ checkId: "boundary-start-outgoing", blocking: true }));
  expect(runAllPreflightChecks(input({ nodes: [task, end], edges: [] })).issues)
    .toContainEqual(expect.objectContaining({ checkId: "boundary-end-incoming", blocking: true }));
  expect(checkWorkerMissing([start, end])).toEqual([]);
  expect(checkOrphanNodes([start, task], []))
    .not.toContainEqual(expect.objectContaining({ nodeId: start.id }));
});
```

再覆盖非法方向、start 直连 end、annotation 连接，以及 boundary 未分配阶段仍为 warning。

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @multica/core test -- workflows/preflight-checks.test.ts`

Expected: FAIL；boundary 被报 worker/orphan，且没有专用检查。

- [ ] **Step 3: 实现专用检查**

```ts
function boundaryIssue(
  checkId: "boundary-start-outgoing" | "boundary-end-incoming" | "boundary-edge-direction",
  node: WorkflowNode,
  message: string,
): PreflightIssue {
  return {
    checkId,
    severity: "error",
    blocking: true,
    nodeId: node.id,
    nodeTitle: node.title,
    message,
  };
}

export function checkBoundaryNodes(nodes: WorkflowNode[], edges: WorkflowEdge[]): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const start = nodes.find(isStartNode);
  const end = nodes.find(isEndNode);
  if (start && !edges.some((edge) => edge.source_node_id === start.id)) {
    issues.push(boundaryIssue("boundary-start-outgoing", start, "Start node needs an outgoing connection"));
  }
  if (end && !edges.some((edge) => edge.target_node_id === end.id)) {
    issues.push(boundaryIssue("boundary-end-incoming", end, "End node needs an incoming connection"));
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const edge of edges) {
    const source = byId.get(edge.source_node_id);
    const target = byId.get(edge.target_node_id);
    if (source && target && isInvalidBoundaryConnection(source, target)) {
      issues.push(boundaryIssue(
        "boundary-edge-direction",
        isBoundaryNode(source) ? source : target,
        "Boundary connection direction is invalid",
      ));
    }
  }
  return issues;
}
```

`boundaryIssue` 固定 error/blocking。worker、role、critic、split 检查跳过 boundary；orphan 排除 boundary；stage missing 保留 warning。聚合器加入 `checkBoundaryNodes`。

- [ ] **Step 4: 增加 UI 映射和本地化**

扩展 `PreflightCheckId`、`preflight-bar.tsx` 和中英文 locale，分别提供“开始需要出边”“结束需要入边”“始末连线方向无效”的标题与详情，不复用 orphan 文案。

- [ ] **Step 5: 运行并提交**

Run: `pnpm --filter @multica/core test -- workflows/preflight-checks.test.ts`

Run: `pnpm --filter @multica/views test -- workflows/components/overview/preflight-bar.test.tsx`

Expected: 均 PASS。

```bash
git add packages/core/workflows/preflight-checks.ts packages/core/workflows/preflight-checks.test.ts packages/views/workflows/components/overview/preflight-bar.tsx packages/views/workflows/components/overview/preflight-bar.test.tsx packages/views/locales/en/workflows.json packages/views/locales/zh-Hans/workflows.json
git commit -m "feat(workflows): validate boundary node topology"
```

### Task 5: 节点目录与唯一添加入口

**Files:**
- Modify: `packages/views/workflows/components/overview/node-template-catalog.ts`
- Modify: `packages/views/workflows/components/overview/node-template-catalog.test.ts`
- Modify: `packages/views/workflows/components/overview/node-template-picker.tsx`
- Modify: `packages/views/workflows/components/overview/node-template-picker.test.tsx`
- Modify: `packages/views/workflows/components/overview/workflow-panorama-page.tsx`
- Modify: `packages/views/workflows/components/overview/workflow-panorama-page.test.tsx`
- Modify: `packages/views/locales/en/workflows.json`
- Modify: `packages/views/locales/zh-Hans/workflows.json`

**Interfaces:**
- Produces: `NodeTemplate.boundary_kind?: WorkflowBoundaryKind`。
- Produces: picker props `disabledTemplateIds?: Set<string>`、`excludeBoundary?: boolean`。

- [ ] **Step 1: 写目录 payload 失败测试**

```ts
it("builds boundary payloads without actor assignments", () => {
  const start = NODE_TEMPLATES.find((item) => item.id === "workflow-start")!;
  const end = NODE_TEMPLATES.find((item) => item.id === "workflow-end")!;
  expect(buildCreateNodeRequestFromTemplate(start, { x: 10, y: 20, stageId: "stage-1" }))
    .toMatchObject({
      title: "Start", stage_id: "stage-1", worker_type: "human", worker_id: null,
      critic_type: "human", critic_id: null, critic_api_url: null,
      format_schema: { type: "start", shape: "pill", template_id: "workflow-start" },
    });
  expect((buildCreateNodeRequestFromTemplate(end, { x: 30, y: 20, stageId: null })
    .format_schema as Record<string, unknown>).type).toBe("end");
});
```

- [ ] **Step 2: 写 picker 失败测试**

```tsx
render(<NodeTemplatePicker onSelect={vi.fn()} disabledTemplateIds={new Set(["workflow-start"])} />);
expect(screen.getByRole("button", { name: /Start/ })).toBeDisabled();
expect(screen.getByRole("button", { name: /End/ })).toBeEnabled();

render(<NodeTemplatePicker onSelect={vi.fn()} excludeBoundary />);
expect(screen.queryByRole("button", { name: /Start/ })).not.toBeInTheDocument();
expect(screen.queryByRole("button", { name: /End/ })).not.toBeInTheDocument();
```

- [ ] **Step 3: 运行并确认失败**

Run: `pnpm --filter @multica/views test -- workflows/components/overview/node-template-catalog.test.ts workflows/components/overview/node-template-picker.test.tsx`

Expected: FAIL；模板和 props 不存在。

- [ ] **Step 4: 实现模板与 payload**

```ts
{
  id: "workflow-start", category: "trigger", title: "Start",
  description: "Mark the workflow entry boundary.",
  tags: ["start", "entry", "boundary"], shape: "pill",
  worker_type: "human", critic_type: "human", boundary_kind: "start",
},
{
  id: "workflow-end", category: "trigger", title: "End",
  description: "Mark the workflow exit boundary.",
  tags: ["end", "finish", "boundary"], shape: "pill",
  worker_type: "human", critic_type: "human", boundary_kind: "end",
},
```

`buildCreateNodeRequestFromTemplate` 在其他语义类型之前处理 boundary，生成 `{ type, shape, template_id, template_category }`。picker 根据 props 过滤或禁用，并设置本地化禁用说明。

- [ ] **Step 5: 接入 panorama 两种 picker**

```ts
const disabledBoundaryTemplateIds = useMemo(() => new Set([
  ...(visibleNodes.some(isStartNode) ? ["workflow-start"] : []),
  ...(visibleNodes.some(isEndNode) ? ["workflow-end"] : []),
]), [visibleNodes]);
```

主 picker 传 `disabledTemplateIds`；connected picker 传 `excludeBoundary`。409/422 使用本地化 toast，不追加 undo action 或自动边。

- [ ] **Step 6: 运行并提交**

Run: `pnpm --filter @multica/views test -- workflows/components/overview/node-template-catalog.test.ts workflows/components/overview/node-template-picker.test.tsx workflows/components/overview/workflow-panorama-page.test.tsx`

Expected: PASS。

```bash
git add packages/views/workflows/components/overview/node-template-catalog.ts packages/views/workflows/components/overview/node-template-catalog.test.ts packages/views/workflows/components/overview/node-template-picker.tsx packages/views/workflows/components/overview/node-template-picker.test.tsx packages/views/workflows/components/overview/workflow-panorama-page.tsx packages/views/workflows/components/overview/workflow-panorama-page.test.tsx packages/views/locales/en/workflows.json packages/views/locales/zh-Hans/workflows.json
git commit -m "feat(workflows): add boundary node templates"
```

### Task 6: 共享画布节点与编辑器连线限制

**Files:**
- Create: `packages/views/workflows/components/overview/reactflow-nodes/boundary-node.tsx`
- Create: `packages/views/workflows/components/overview/reactflow-nodes/boundary-node.test.tsx`
- Modify: `packages/views/workflows/components/overview/reactflow-nodes/index.ts`
- Modify: `packages/views/workflows/components/canvas/workflow-canvas-model.ts`
- Modify: `packages/views/workflows/components/canvas/workflow-canvas-model.test.ts`
- Modify: `packages/views/workflows/components/canvas/workflow-canvas-core.tsx`
- Modify: `packages/views/workflows/components/overview/workflow-panorama-page.tsx`
- Modify: `packages/views/workflows/components/overview/workflow-panorama-page.test.tsx`
- Modify: `packages/views/workflows/components/workflow-template-preview-canvas.test.tsx`

**Interfaces:**
- Produces: React Flow type `boundary`、`BoundaryNodeData`、`BOUNDARY_WIDTH/HEIGHT`。
- Produces: `isValidWorkflowConnection(connection, nodesById)`。

- [ ] **Step 1: 写组件、模型和连线失败测试**

```tsx
it("renders directional handles for boundary kinds", () => {
  const { rerender } = renderBoundary({ kind: "start", title: "Start" });
  expect(screen.getByTestId("boundary-node-start")).toHaveStyle({ width: "176px", height: "64px" });
  expect(screen.getByTestId("boundary-handle-source")).toBeInTheDocument();
  expect(screen.queryByTestId("boundary-handle-target")).not.toBeInTheDocument();
  rerender(renderBoundaryElement({ kind: "end", title: "End" }));
  expect(screen.getByTestId("boundary-handle-target")).toBeInTheDocument();
});
```

模型测试断言 start/end 为 `type: "boundary"`、`176x64` 且使用 stage lane Y。连接测试断言 start->task、task->end 为 true；反向、start->end、start->annotation 为 false。

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @multica/views test -- workflows/components/overview/reactflow-nodes/boundary-node.test.tsx workflows/components/canvas/workflow-canvas-model.test.ts workflows/components/overview/workflow-panorama-page.test.tsx`

Expected: FAIL；renderer/type/connection guard 不存在。

- [ ] **Step 3: 实现 BoundaryNode**

```ts
export interface BoundaryNodeData extends Record<string, unknown> {
  node: WorkflowNode;
  kind: WorkflowBoundaryKind;
  stageColorIndex: number;
  onOpen?: (nodeId: string) => void;
}
export const BOUNDARY_WIDTH = 176;
export const BOUNDARY_HEIGHT = 64;
```

使用 `Play`、`Square` 图标；start 仅 right-source，end 仅 left-target；双击及 Enter/Space 打开配置；不渲染 actor slot 或下游快捷按钮。

- [ ] **Step 4: 修改共享 canvas model**

boundary 覆盖为 `type: "boundary"`、固定尺寸、`data.kind`。`normalizedNodeXMap` 使用每个节点实际宽度累计间距，防止 176px boundary 与 296px worker 重叠。`panoramaNodeTypes` 注册 renderer，模板预览自动复用。

- [ ] **Step 5: 接入 React Flow 有效连接校验**

给 `WorkflowCanvasCoreProps` 增加 `isValidConnection?: IsValidConnection` 并透传。panorama 使用：

```ts
export function isValidWorkflowConnection(
  connection: Connection,
  nodesById: Map<string, WorkflowNode>,
): boolean {
  const source = connection.source ? nodesById.get(connection.source) : undefined;
  const target = connection.target ? nodesById.get(connection.target) : undefined;
  return Boolean(source && target && !isInvalidBoundaryConnection(source, target));
}
```

`handleConnect` 再执行相同防御校验，非法时 toast 且不调用 mutation。

- [ ] **Step 6: 运行并提交**

Run: `pnpm --filter @multica/views test -- workflows/components/overview/reactflow-nodes/boundary-node.test.tsx workflows/components/canvas/workflow-canvas-model.test.ts workflows/components/overview/workflow-panorama-page.test.tsx workflows/components/workflow-template-preview-canvas.test.tsx`

Expected: PASS。

```bash
git add packages/views/workflows/components/overview/reactflow-nodes packages/views/workflows/components/canvas/workflow-canvas-model.ts packages/views/workflows/components/canvas/workflow-canvas-model.test.ts packages/views/workflows/components/canvas/workflow-canvas-core.tsx packages/views/workflows/components/overview/workflow-panorama-page.tsx packages/views/workflows/components/overview/workflow-panorama-page.test.tsx packages/views/workflows/components/workflow-template-preview-canvas.test.tsx
git commit -m "feat(workflows): render boundary nodes on shared canvas"
```

### Task 7: 运行详情旧画布适配

**Files:**
- Modify: `packages/views/workflows/components/dag-canvas.tsx`
- Modify: `packages/views/workflows/components/dag-canvas.test.tsx`
- Modify: `packages/views/workflows/components/workflow-run-page.test.tsx`

**Interfaces:**
- Consumes: Task 1 判定与 Task 6 `BoundaryNode`。
- Produces: runtime canvas 无状态只读 boundary。

- [ ] **Step 1: 写失败测试**

```tsx
it("maps persisted boundary nodes without runtime status", () => {
  render(<WorkflowCanvas
    nodes={[startNode, taskNode, endNode]}
    edges={edges}
    nodeStatuses={{ [taskNode.id]: running }}
  />);
  const rfNodes = capturedReactFlowProps.nodes as Node[];
  expect(rfNodes.find((node) => node.id === startNode.id)).toMatchObject({ type: "boundary" });
  expect(rfNodes.find((node) => node.id === endNode.id)).toMatchObject({ type: "boundary" });
  expect(rfNodes.find((node) => node.id === startNode.id)?.data)
    .not.toHaveProperty("statusLabel");
});
```

同时断言 view mode 下不可拖动、不可连线，点击 boundary 不尝试选择不存在的 node run。

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @multica/views test -- workflows/components/dag-canvas.test.tsx workflows/components/workflow-run-page.test.tsx`

Expected: FAIL；boundary 当前映射为普通 workflow node。

- [ ] **Step 3: 注册和映射 renderer**

`nodeTypes` 增加 `boundary: BoundaryNode`。构造 `propNodes` 时 boundary 使用固定尺寸和：

```ts
data: {
  node,
  kind: parseNodeFormat(node.format_schema).kind as WorkflowBoundaryKind,
  stageColorIndex: 0,
}
```

不注入 status、resize、split toggle 或普通 select callbacks。node data 浅比较为 boundary 单独比较 `node.title`、kind，普通节点路径保持原样。

- [ ] **Step 4: 运行并提交**

Run: `pnpm --filter @multica/views test -- workflows/components/dag-canvas.test.tsx workflows/components/workflow-run-page.test.tsx`

Expected: PASS。

```bash
git add packages/views/workflows/components/dag-canvas.tsx packages/views/workflows/components/dag-canvas.test.tsx packages/views/workflows/components/workflow-run-page.test.tsx
git commit -m "feat(workflows): show boundary nodes in run canvas"
```

### Task 8: 始末节点受限配置面板

**Files:**
- Modify: `packages/views/workflows/components/node-config-panel.tsx`
- Modify: `packages/views/workflows/components/node-config-panel.test.tsx`
- Modify: `packages/views/common/workflow-node-detail-panel-shell.tsx`
- Modify: `packages/views/common/workflow-node-detail-panel-shell.test.tsx`
- Modify: `packages/views/locales/en/workflows.json`
- Modify: `packages/views/locales/zh-Hans/workflows.json`

**Interfaces:**
- Consumes: Task 1 `isBoundaryNode()`。
- Produces: 只包含 title、description、stage、save/delete 的 boundary panel。

- [ ] **Step 1: 写失败测试**

```tsx
it("shows only editable boundary fields", () => {
  renderPanel(makeNode({ format_schema: { type: "start" }, title: "Start" }));
  expect(screen.getByLabelText("Node title")).toHaveValue("Start");
  expect(screen.getByLabelText("Node description")).toBeInTheDocument();
  expect(screen.getByLabelText("Stage")).toBeInTheDocument();
  expect(screen.queryByText("Worker & Critic")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Trial run/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Delete node/ })).toBeInTheDocument();
});
```

另测保存 mutation 仅含 title/description，stage 走 `onStageChange`，不缓存 actor 或 format schema 编辑。

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @multica/views test -- workflows/components/node-config-panel.test.tsx common/workflow-node-detail-panel-shell.test.tsx`

Expected: FAIL；boundary 仍显示 worker/critic 区域。

- [ ] **Step 3: 实现布局和保存分支**

定义 `const isBoundary = isBoundaryNode(node)`。保留 primary 字段、stage、删除、保存和关闭确认；split、annotation binding、gateway、worker/critic、runtime、trial run 全部增加 `!isBoundary` 条件。

```ts
const updates: UpdateNodeRequest = {
  title: title.trim(),
  description: description.trim(),
  ...(!isBoundary ? {
    format_schema: saved?.format_schema ?? node.format_schema,
    worker_type: workerType,
    worker_id: workerId,
    worker_role_id: workerRoleId,
    critic_type: criticType,
    critic_id: criticId,
    critic_role_id: criticRoleId,
    critic_api_url: criticApiUrl || null,
  } : {}),
};
```

shell 使用本地化 boundary badge/subtitle，不增加嵌套卡片。

- [ ] **Step 4: 补齐本地化**

中英文增加 start/end 名称、boundary badge、唯一性禁用、非法连接、重复创建和受限面板文案。JSX 不新增裸英文用户文案。

- [ ] **Step 5: 运行并提交**

Run: `pnpm --filter @multica/views test -- workflows/components/node-config-panel.test.tsx common/workflow-node-detail-panel-shell.test.tsx`

Expected: PASS。

```bash
git add packages/views/workflows/components/node-config-panel.tsx packages/views/workflows/components/node-config-panel.test.tsx packages/views/common/workflow-node-detail-panel-shell.tsx packages/views/common/workflow-node-detail-panel-shell.test.tsx packages/views/locales/en/workflows.json packages/views/locales/zh-Hans/workflows.json
git commit -m "feat(workflows): restrict boundary node configuration"
```

### Task 9: 模板克隆与相关模块回归验证

**Files:**
- Modify: `server/internal/service/workflow_template_test.go`
- Modify: `packages/views/workflows/components/workflow-template-preview-canvas.test.tsx`
- Modify: `packages/views/workflows/components/workflow-run-page.test.tsx`

**Interfaces:**
- Consumes: Tasks 1-8。
- Produces: persistence、clone 和三类画布一致性的回归证据。

- [ ] **Step 1: 扩充模板克隆测试**

fixture 增加 start/end 与 `start -> n1`、`n3 -> end`。克隆后断言：

```go
var startCount, endCount int
if err := pool.QueryRow(ctx, `
	SELECT count(*) FILTER (WHERE format_schema->>'type' = 'start'),
	       count(*) FILTER (WHERE format_schema->>'type' = 'end')
	FROM multica_workflow_node WHERE workflow_id = $1
`, cloned.ID).Scan(&startCount, &endCount); err != nil {
	t.Fatal(err)
}
if startCount != 1 || endCount != 1 {
	t.Fatalf("cloned boundary counts = (%d, %d), want (1, 1)", startCount, endCount)
}
```

查询克隆边并断言引用的都是 cloned workflow 节点 ID。

- [ ] **Step 2: 运行模板克隆测试**

Run: `cd server; go test ./internal/service -run TestCloneWorkflowFromTemplate`

Expected: PASS；数据库不可用时按现有约定 SKIP。

- [ ] **Step 3: 运行全部相关 TypeScript 测试**

Run: `pnpm --filter @multica/core test -- types/workflow.test.ts workflows/preflight-checks.test.ts`

Run: `pnpm --filter @multica/views test -- workflows/components/overview/node-template-catalog.test.ts workflows/components/overview/node-template-picker.test.tsx workflows/components/overview/reactflow-nodes/boundary-node.test.tsx workflows/components/canvas/workflow-canvas-model.test.ts workflows/components/overview/workflow-panorama-page.test.tsx workflows/components/workflow-template-preview-canvas.test.tsx workflows/components/dag-canvas.test.tsx workflows/components/workflow-run-page.test.tsx workflows/components/node-config-panel.test.tsx common/workflow-node-detail-panel-shell.test.tsx`

Expected: 所列测试全部 PASS。

- [ ] **Step 4: 运行全部相关 Go 测试**

Run: `cd server; go test ./internal/workflowmeta`

Run: `cd server; go test ./internal/handler -run 'TestIsNonExecutableNode|Test(Create|Update)WorkflowBoundary|TestCreateWorkflowEdgeValidatesBoundary'`

Run: `cd server; go test ./internal/service -run 'TestBuildExecutableWorkflowGraph|TestWorkflowBoundaryNodesDoNotCreateRuns|TestGatewayRunForkAndJoinSemantics|TestCloneWorkflowFromTemplate'`

Expected: 纯函数测试 PASS；数据库用例 PASS，或仅在数据库不可用时 SKIP。

- [ ] **Step 5: 运行相关类型检查和差异检查**

Run: `pnpm --filter @multica/core typecheck`

Run: `pnpm --filter @multica/views typecheck`

Run: `git diff --check`

Expected: 类型检查 exit code 0，`git diff --check` 无输出。

- [ ] **Step 6: 检查工作区并提交回归覆盖**

Run: `git status --short`

Expected: 用户原有未提交改动保持原样，不被覆盖或误暂存。

```bash
git add server/internal/service/workflow_template_test.go packages/views/workflows/components/workflow-template-preview-canvas.test.tsx packages/views/workflows/components/workflow-run-page.test.tsx
git commit -m "test(workflows): cover boundary node workflows"
```
