# Dynamic Task Splitting — 后端 /split/chat + approve 简化 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 `/split/chat` NL审核对话端点、简化 `/split/approve`（拒绝旧 modifications）、修复 phase 常量与 draft_source 语义。

**Architecture:** 在现有 `SplitOrchestrator` 和 handler 基础上扩展：新增 `SplitChat` 方法在 `awaiting_split_review` 状态下派发 `phase: "split_chat"` 的 agent task，通过现有 draft API 修改草案；`/split/approve` 简化为只接受 `approved_task_ids`，拒绝非空 `modifications`。

**Tech Stack:** Go 1.26.1, Chi router, pgx/v5, sqlc, gorilla/websocket

## 全局约束

- Go 代码遵循标准 Go 规范(gofmt, go vet)
- 所有 DB 列和 TS 类型命名遵循 `apps/docs/content/docs/developers/conventions.mdx`
- 拆分节点嵌套限制为两层（父→子）
- Critic 必填（拆分节点默认 human）
- Split chat 同一 node run 同时只允许一个 active task
- `/split/approve` 拒绝非空 `modifications`（返回 400）
- draft API phase 严格校验：`split_generate`/`split_repair` → `splitting` 状态，`split_chat` → `awaiting_split_review` 状态
- 注释用英文

---

### Task 1: 重构 split task phase 常量与访问控制

**Files:**
- Modify: `server/internal/service/workflow_split.go`

**Interfaces:**
- Consumes: 现有 `isSplitTaskPhase`, `isSplitRepairTask`, `validateSplitDraftTaskAccess`
- Produces: 
  - `splitPhaseGenerate = "split_generate"` (替代旧的 `"split"`)
  - `splitPhaseRepair = "split_repair"`
  - `splitPhaseChat = "split_chat"`
  - `isSplitGeneratePhase(contextJSON []byte) bool`
  - `isSplitRepairPhase(contextJSON []byte) bool` (重命名自 `isSplitRepairTask`)
  - `isSplitChatPhase(contextJSON []byte) bool` (新增)
  - `isAnySplitPhase(contextJSON []byte) bool` (替代旧 `isSplitTaskPhase`)
  - 更新 `validateSplitDraftTaskAccess` 校验 phase 与 node_run 状态匹配

- [ ] **Step 1: 定义新的 phase 常量与判断函数**

在 `server/internal/service/workflow_split.go` 中，在现有常量区域后添加：

```go
const (
    // Split task context phases.
    splitPhaseGenerate = "split_generate"
    splitPhaseRepair   = "split_repair"
    splitPhaseChat     = "split_chat"
)
```

替换旧的 `isSplitTaskPhase` 和 `isSplitRepairTask`：

```go
func isSplitGeneratePhase(contextJSON []byte) bool {
    if len(contextJSON) == 0 {
        return false
    }
    var payload struct {
        Phase string `json:"phase"`
    }
    if err := json.Unmarshal(contextJSON, &payload); err != nil {
        return false
    }
    return payload.Phase == splitPhaseGenerate
}

func isSplitRepairPhase(contextJSON []byte) bool {
    if len(contextJSON) == 0 {
        return false
    }
    var payload struct {
        Type   string `json:"type"`
        Phase  string `json:"phase"`
        Repair bool   `json:"repair"`
    }
    if err := json.Unmarshal(contextJSON, &payload); err != nil {
        return false
    }
    return payload.Type == "workflow" && payload.Phase == splitPhaseRepair && payload.Repair
}

func isSplitChatPhase(contextJSON []byte) bool {
    if len(contextJSON) == 0 {
        return false
    }
    var payload struct {
        Phase string `json:"phase"`
    }
    if err := json.Unmarshal(contextJSON, &payload); err != nil {
        return false
    }
    return payload.Phase == splitPhaseChat
}

func isAnySplitPhase(contextJSON []byte) bool {
    return isSplitGeneratePhase(contextJSON) || isSplitRepairPhase(contextJSON) || isSplitChatPhase(contextJSON)
}
```

- [ ] **Step 2: 全局替换旧函数引用**

将所有 `isSplitTaskPhase(` 替换为 `isAnySplitPhase(`，`isSplitRepairTask(` 替换为 `isSplitRepairPhase(`。

涉及位置（在 `workflow_split.go` 中）：
- `GenerateSplitTasks` — `isSplitTaskPhase(task.Context)` → `isAnySplitPhase(task.Context)`
- `loadSplitRecoveryTask` — 两处 `isSplitTaskPhase(task.Context)` → `isAnySplitPhase(task.Context)`
- `dispatchSplitRepairTask` — `isSplitTaskPhase(activeTask.Context)` → `isAnySplitPhase(activeTask.Context)`；`isSplitRepairTask(activeTask.Context)` → `isSplitRepairPhase(activeTask.Context)`
- `HandleTaskCompletion` — `isSplitTaskPhase(task.Context)` → `isAnySplitPhase(task.Context)`
- `handleTaskCompletion` — `isSplitRepairTask(task.Context)` → `isSplitRepairPhase(task.Context)`
- `validateSplitDraftTaskAccess` — `isSplitTaskPhase(task.Context)` → `isAnySplitPhase(task.Context)`

- [ ] **Step 3: 更新 `validateSplitDraftTaskAccess` 加入 phase 与状态匹配校验**

在现有 `validateSplitDraftTaskAccess` 末尾（task 验证通过后，return 之前）加入：

```go
// Validate phase matches node run status.
if isSplitChatPhase(task.Context) {
    if nodeRun.Status != NodeRunStatusAwaitingSplitReview {
        return db.MulticaAgentTaskQueue{}, fmt.Errorf("split chat draft API is only allowed in awaiting_split_review state")
    }
} else if isSplitGeneratePhase(task.Context) || isSplitRepairPhase(task.Context) {
    if nodeRun.Status != NodeRunStatusSplitting {
        return db.MulticaAgentTaskQueue{}, fmt.Errorf("split generate/repair draft API is only allowed in splitting state")
    }
}
```

- [ ] **Step 4: 更新 dispatch 调用中的 phase 覆盖**

当前 `GenerateSplitTasks` 调用 `s.WfService.DispatchAgentTask(ctx, currentNodeRun, "split")`，它在 task context 中设置 `"phase": "split"`。需要改为 `"split_generate"`。

关键代码路径：`DispatchAgentTask` → `DispatchAgentTaskWithContextExtras`（`server/internal/service/workflow.go:1201-1214`）构建 context payload，其中 `"phase": phase` 在 extras 合并之前设置。因此可以通过 contextExtras 覆盖 phase。

在 `GenerateSplitTasks`（约第 601 行）中，将：
```go
task, err := s.WfService.DispatchAgentTask(ctx, currentNodeRun, "split")
```
改为：
```go
task, err := s.WfService.DispatchAgentTaskWithContextExtras(ctx, currentNodeRun, "split", map[string]any{
    "phase": splitPhaseGenerate,
})
```

在 `dispatchSplitRepairTask`（约第 1117 行）中，现有代码已调用 `DispatchAgentTaskWithContextExtras`。在 `splitRepairContextExtras` 返回的 map 中已有 `"repair": true` 等字段，需添加：
```go
func splitRepairContextExtras(sourceTask db.MulticaAgentTaskQueue, recoveryErr error) map[string]any {
    // ... existing fields ...
    return map[string]any{
        "phase":                  splitPhaseRepair,  // ← 新增：覆盖 context phase
        "repair":                 true,
        // ... rest unchanged
    }
}
```

同样，`SplitChat` 的 `contextExtras` 已包含 `"phase": splitPhaseChat`（在 Task 3 Step 2 中定义）。

- [ ] **Step 5: 运行已有测试确保无回归**

```bash
cd server && go test ./internal/service/ -run TestSplit -v -count=1
cd server && go test ./internal/handler/ -run TestSplit -v -count=1
```

期望：所有已有 split 测试通过。

- [ ] **Step 6: Commit**

```bash
git add server/internal/service/workflow_split.go server/internal/service/task.go
git commit -m "refactor(workflow): split task phases into generate/repair/chat with state validation"
```

---

### Task 2: 修复 draft_source 语义

**Files:**
- Modify: `server/internal/service/workflow_split.go`

**Interfaces:**
- Consumes: `SplitTaskStatusDraft`, `CreateSplitTask`, `UpsertSplitDraftTaskByKey`
- Produces: 所有创建 split task 的位置正确设置 `draft_source`

- [ ] **Step 1: 添加 draft_source 常量**

在 `workflow_split.go` 的常量区域添加：

```go
const (
    DraftSourceAgent    = "agent"
    DraftSourceChat     = "chat"
    DraftSourceRecovered = "recovered"
)
```

- [ ] **Step 2: 确保 `CreateSplitTask` 和 `UpsertSplitDraftTaskByKey` 使用正确的 `draft_source`**

检查 `GenerateSplitTasks` → `replaceSplitDraftTasksFromPayload` 中的 `CreateSplitTask` 调用。这些是从 agent 生成的 payload 创建的，应设置 `DraftSource: DraftSourceAgent`（当前 sql 中 `draft_source` 有 `DEFAULT 'agent'`，所以可能已经正确）。确认即可。

在 `replaceSplitDraftTasksFromPayload`（recovery 路径）中：
```go
// 在 CreateSplitTask 调用中明确设置
DraftSource: pgtype.Text{String: DraftSourceRecovered, Valid: true},
```

在 `UpsertSplitDraftTaskByKey` 调用中（Agent draft API），参数中当前没有传递 `draft_source`。需要根据 phase 判断：
- `split_chat` phase → `DraftSourceChat`
- `split_generate` / `split_repair` phase → `DraftSourceAgent`

修改 `AddSplitDraftTask` 中的 `UpsertSplitDraftTaskByKey` 调用，添加 `DraftSource` 参数。但首先需要知道当前 task 的 phase。当前 `AddSplitDraftTask` 接收 `taskID` 和 `agentID` 但未传递 phase 信息。

更新 `UpsertSplitDraftTaskByKey` sqlc 查询以接受 `draft_source` 参数，或在 upsert 后通过 `UpdateSplitTaskFields` 单独设置。检查 sql 定义：

查看 `server/pkg/db/queries/workflow_split_task.sql`，当前 `UpsertSplitDraftTaskByKey` 接受 `draft_source` 作为 `sqlc.narg('draft_source')`。确认 call site 传递了正确值。

- [ ] **Step 3: 在 `AddSplitDraftTask` 中根据 phase 设置 draft_source**

```go
func (s *SplitOrchestrator) AddSplitDraftTask(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun, taskID, agentID pgtype.UUID, req SplitDraftTaskRequest) error {
    task, err := s.validateSplitDraftTaskAccess(ctx, nodeRun, taskID, agentID)
    if err != nil {
        return err
    }
    // Determine draft source from task phase.
    draftSource := DraftSourceAgent
    if isSplitChatPhase(task.Context) {
        draftSource = DraftSourceChat
    }
    // ... 在 UpsertSplitDraftTaskByKey 调用中使用 draftSource
```

- [ ] **Step 4: 运行测试**

```bash
cd server && go test ./internal/service/ -run TestSplit -v -count=1
```

期望：通过。

- [ ] **Step 5: Commit**

```bash
git add server/internal/service/workflow_split.go
git commit -m "feat(workflow): set correct draft_source based on agent task phase"
```

---

### Task 3: 实现 SplitChat 在 SplitOrchestrator

**Files:**
- Modify: `server/internal/service/workflow_split.go`

**Interfaces:**
- Consumes: `Queries`, `WfService`, `NodeRunStatusAwaitingSplitReview`, `isSplitChatPhase`, `isAnySplitPhase`
- Produces: `SplitChat(ctx, nodeRun, userID, message, attachmentIDs) (*SplitChatResult, error)`
- 产出类型:
  ```go
  type SplitChatRequest struct {
      Message       string   `json:"message"`
      AttachmentIDs []string `json:"attachment_ids"`
  }
  
  type SplitChatResult struct {
      ChatSessionID string              `json:"chat_session_id"`
      TaskID        string              `json:"task_id"`
      Tasks         []SplitTaskResponse `json:"tasks"`
      Progress      SplitProgressResponse `json:"progress"`
  }
  ```

- [ ] **Step 1: 编写失败测试（TDD）**

在 `server/internal/service/workflow_split_test.go` 添加测试：

```go
func TestSplitChatRejectsWhenNotAwaitingReview(t *testing.T) {
    // 构造一个状态不是 awaiting_split_review 的 nodeRun
    // 调用 SplitChat，期望返回错误
}

func TestSplitChatDispatchesAgentTaskAndReturnsChatSessionID(t *testing.T) {
    // 完整的 happy path 测试
}
```

由于 `SplitChat` 依赖 DB 和外部的 agent dispatch，service 层单元测试可能需要 mock。查看已有测试模式（如 `TestGenerateSplitTasksDispatchesAndPersistsDraftTasks`）采用集成测试模式。

- [ ] **Step 2: 实现 `SplitChat` 方法**

在 `server/internal/service/workflow_split.go` 末尾添加：

```go
// SplitChatRequest is the payload for the /split/chat endpoint.
type SplitChatRequest struct {
    Message       string   `json:"message"`
    AttachmentIDs []string `json:"attachment_ids"`
}

// SplitChatResult is returned by the /split/chat endpoint.
type SplitChatResult struct {
    ChatSessionID string                `json:"chat_session_id"`
    TaskID        string                `json:"task_id"`
    Tasks         []db.MulticaWorkflowSplitTask `json:"-"`
}

func (s *SplitOrchestrator) SplitChat(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun, userID pgtype.UUID, req SplitChatRequest) (*SplitChatResult, error) {
    if nodeRun.Status != NodeRunStatusAwaitingSplitReview {
        return nil, fmt.Errorf("split chat is only available when the node is awaiting review")
    }
    if strings.TrimSpace(req.Message) == "" {
        return nil, fmt.Errorf("chat message is required")
    }

    // Check for existing active split chat task.
    if nodeRun.SplitReviewChatSessionID.Valid {
        pendingTask, err := s.Queries.GetPendingChatTask(ctx, nodeRun.SplitReviewChatSessionID)
        if err == nil && pendingTask.ID.Valid {
            return nil, fmt.Errorf("another split chat task is already in progress")
        }
    }

    node, err := s.Queries.GetWorkflowNode(ctx, nodeRun.WorkflowNodeID)
    if err != nil {
        return nil, fmt.Errorf("get split node: %w", err)
    }
    cfg, err := parseSplitConfig(node.FormatSchema)
    if err != nil {
        return nil, err
    }

    run, err := s.Queries.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
    if err != nil {
        return nil, fmt.Errorf("get workflow run: %w", err)
    }

    // Get or create chat session.
    var chatSessionID pgtype.UUID
    if nodeRun.SplitReviewChatSessionID.Valid {
        chatSessionID = nodeRun.SplitReviewChatSessionID
    } else {
        // Get the split agent to bind the session to.
        splitIssue, err := s.Queries.GetIssueByOrigin(ctx, db.GetIssueByOriginParams{
            WorkspaceID: run.WorkspaceID,
            OriginType:  pgtype.Text{String: "workflow", Valid: true},
            OriginID:    nodeRun.ID,
        })
        if err != nil {
            return nil, fmt.Errorf("get split sub-issue: %w", err)
        }
        activeTasks, err := s.Queries.ListActiveTasksByIssue(ctx, splitIssue.ID)
        if err != nil {
            return nil, fmt.Errorf("list active split tasks: %w", err)
        }
        var agentID pgtype.UUID
        for _, t := range activeTasks {
            if t.WorkflowNodeRunID == nodeRun.ID && isAnySplitPhase(t.Context) {
                agentID = t.AgentID
                break
            }
        }
        if !agentID.Valid {
            // Fall back to the node's worker agent.
            agentID = nodeRun.WorkerID
        }

        title := fmt.Sprintf("Split review: %s", nodeRun.NodeTitle)
        session, err := s.Queries.CreateChatSession(ctx, db.CreateChatSessionParams{
            WorkspaceID: run.WorkspaceID,
            AgentID:     agentID,
            CreatorID:   userID,
            Title:       title,
        })
        if err != nil {
            return nil, fmt.Errorf("create split review chat session: %w", err)
        }
        chatSessionID = session.ID

        // Bind session to node run.
        if _, err := s.Queries.SetNodeRunSplitReviewChatSession(ctx, db.SetNodeRunSplitReviewChatSessionParams{
            ID:                        nodeRun.ID,
            SplitReviewChatSessionID: chatSessionID,
        }); err != nil {
            return nil, fmt.Errorf("bind split review chat session: %w", err)
        }
    }

    // Write user message to chat.
    if _, err := s.Queries.CreateChatMessage(ctx, db.CreateChatMessageParams{
        ChatSessionID: chatSessionID,
        Role:          "user",
        Content:       req.Message,
    }); err != nil {
        return nil, fmt.Errorf("create split chat user message: %w", err)
    }

    // Build context with current drafts, parent issue, and user message.
    existingTasks, err := s.Queries.ListSplitTasksByNodeRun(ctx, nodeRun.ID)
    if err != nil {
        return nil, fmt.Errorf("list current split tasks: %w", err)
    }

    // Load parent issue for context injection.
    parentIssue, err := s.findParentIssue(ctx, nodeRun)
    if err != nil {
        return nil, fmt.Errorf("find parent issue: %w", err)
    }

    contextExtras := map[string]any{
        "phase":            splitPhaseChat,
        "chat_session_id":  util.UUIDToString(chatSessionID),
        "parent_issue_id":  util.UUIDToString(parentIssue.ID),
        "parent_issue_title":       parentIssue.Title,
        "parent_issue_description": textToString(parentIssue.Description),
        "current_drafts":   splitTasksToSummary(existingTasks),
        "split_config":     cfg,
    }

    // Dispatch agent task.
    task, err := s.WfService.DispatchAgentTaskWithContextExtras(ctx, nodeRun, "split", contextExtras)
    if err != nil {
        return nil, fmt.Errorf("dispatch split chat task: %w", err)
    }

    // Link task to chat session.
    if err := s.Queries.LinkTaskToChatSession(ctx, db.LinkTaskToChatSessionParams{
        ID:            task.ID,
        ChatSessionID: chatSessionID,
    }); err != nil {
        slog.Warn("split chat: failed to link task to chat session", "task_id", util.UUIDToString(task.ID), "error", err)
    }

    // Link task to node run.
    if _, err := s.Queries.LinkNodeRunAgentTask(ctx, db.LinkNodeRunAgentTaskParams{
        ID:          nodeRun.ID,
        AgentTaskID: task.ID,
    }); err != nil {
        slog.Warn("split chat: failed to link task to node run", "error", err)
    }

    return &SplitChatResult{
        ChatSessionID: util.UUIDToString(chatSessionID),
        TaskID:        util.UUIDToString(task.ID),
        Tasks:         existingTasks,
    }, nil
}

func splitTasksToSummary(tasks []db.MulticaWorkflowSplitTask) []map[string]any {
    summary := make([]map[string]any, 0, len(tasks))
    for _, t := range tasks {
        if t.Status == SplitTaskStatusDiscarded {
            continue
        }
        var dependsOn []string
        if len(t.DependsOn) > 0 {
            json.Unmarshal(t.DependsOn, &dependsOn)
        }
        item := map[string]any{
            "id":                     util.UUIDToString(t.ID),
            "title":                  t.Title,
            "description":            t.Description,
            "status":                 t.Status,
            "suggested_assignee_type": textToString(t.SuggestedAssigneeType),
            "suggested_assignee_id":   func() string { if t.SuggestedAssigneeID.Valid { return util.UUIDToString(t.SuggestedAssigneeID) }; return "" }(),
            "depends_on":             dependsOn,
            "sort_order":             t.SortOrder,
            "draft_key":              textToString(t.DraftKey),
            "draft_source":           t.DraftSource,
        }
        summary = append(summary, item)
    }
    return summary
}

func textToString(t pgtype.Text) string {
    if t.Valid {
        return t.String
    }
    return ""
}
```

- [ ] **Step 3: 运行测试验证**

```bash
cd server && go build ./...
```

期望：编译通过。

- [ ] **Step 4: Commit**

```bash
git add server/internal/service/workflow_split.go server/internal/service/workflow_split_test.go
git commit -m "feat(workflow): add SplitChat method to SplitOrchestrator"
```

---

### Task 4: 实现 HandleSplitChat HTTP Handler

**Files:**
- Modify: `server/internal/handler/workflow_split.go`

**Interfaces:**
- Consumes: `SplitOrchestrator.SplitChat`, `loadNodeRunForWorkspace`, `requireUserID`
- Produces: `HandleSplitChat(w, r)` — POST `/api/node-runs/{nodeRunId}/split/chat`

- [ ] **Step 1: 添加 handler**

在 `server/internal/handler/workflow_split.go` 的 `CancelSplitNode` 函数之后添加：

```go
func (h *Handler) HandleSplitChat(w http.ResponseWriter, r *http.Request) {
    userID, ok := requireUserID(w, r)
    if !ok {
        return
    }
    nodeRun, _, _, ok := h.loadNodeRunForWorkspace(w, r)
    if !ok {
        return
    }
    var req service.SplitChatRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        writeError(w, http.StatusBadRequest, "invalid split chat payload")
        return
    }
    if h.SplitOrchestrator == nil {
        writeError(w, http.StatusInternalServerError, "split orchestrator is not configured")
        return
    }
    result, err := h.SplitOrchestrator.SplitChat(r.Context(), nodeRun, parseUUID(userID), req)
    if err != nil {
        code := http.StatusBadRequest
        msg := err.Error()
        if strings.Contains(msg, "already in progress") {
            code = http.StatusConflict
        }
        writeError(w, code, msg)
        return
    }
    tasks, err := h.Queries.ListSplitTasksByNodeRun(r.Context(), nodeRun.ID)
    if err != nil {
        writeError(w, http.StatusInternalServerError, "failed to list split tasks")
        return
    }
    writeJSON(w, http.StatusOK, map[string]any{
        "chat_session_id": result.ChatSessionID,
        "task_id":         result.TaskID,
        "tasks":           splitTasksResponse(tasks),
    })
}
```

- [ ] **Step 2: 编译验证**

```bash
cd server && go build ./internal/handler/
```

期望：编译通过。

- [ ] **Step 3: Commit**

```bash
git add server/internal/handler/workflow_split.go
git commit -m "feat(handler): add HandleSplitChat for split review NL adjustments"
```

---

### Task 5: 注册 /split/chat 路由

**Files:**
- Modify: `server/cmd/server/router.go`

**Interfaces:**
- Consumes: `h.HandleSplitChat`
- Produces: 新路由 `POST /api/node-runs/{nodeRunId}/split/chat`

- [ ] **Step 1: 添加路由**

在 `server/cmd/server/router.go` 中，找到已有的 split 路由注册（约第 567-574 行），在 `split/approve` 之后添加：

```go
r.Post("/api/node-runs/{nodeRunId}/split/chat", h.HandleSplitChat)
```

完整上下文：
```go
r.Post("/api/node-runs/{nodeRunId}/split/generate", h.GenerateSplitTasks)
r.Post("/api/node-runs/{nodeRunId}/split/recover", h.RecoverSplitDraftTasks)
r.Post("/api/node-runs/{nodeRunId}/split/draft-tasks", h.AddSplitDraftTask)
r.Delete("/api/node-runs/{nodeRunId}/split/draft-tasks/{taskId}", h.DeleteSplitDraftTask)
r.Post("/api/node-runs/{nodeRunId}/split/draft-submit", h.SubmitSplitDraftTasks)
r.Post("/api/node-runs/{nodeRunId}/split/chat", h.HandleSplitChat)       // ← 新增
r.Post("/api/node-runs/{nodeRunId}/split/approve", h.ApproveSplitTasks)
r.Get("/api/node-runs/{nodeRunId}/split/tasks", h.ListSplitTasks)
r.Post("/api/node-runs/{nodeRunId}/split/cancel", h.CancelSplitNode)
```

- [ ] **Step 2: 编译验证**

```bash
cd server && go build ./cmd/server/
```

期望：编译通过。

- [ ] **Step 3: Commit**

```bash
git add server/cmd/server/router.go
git commit -m "feat(router): register /api/node-runs/{nodeRunId}/split/chat route"
```

---

### Task 6: 简化 /split/approve — 拒绝非空 modifications

**Files:**
- Modify: `server/internal/service/workflow_split.go` — `ApproveSplit` 方法
- Modify: `server/internal/handler/workflow_split.go` — `ApproveSplitTasks` 无需改动（透传）
- Modify: `server/internal/handler/workflow_split_test.go` — 更新测试

**Interfaces:**
- Consumes: `SplitApproveRequest` (保留 `Modifications` 字段用于检测，但拒绝非空)
- Produces: `ApproveSplit` 在 `len(req.Modifications) > 0` 时返回明确错误

- [ ] **Step 1: 在 `ApproveSplit` 开头添加 modifications 拒绝逻辑**

在 `server/internal/service/workflow_split.go` 的 `ApproveSplit` 方法中，在现有 `approvedIDs` 解析之后、`node, err := s.Queries.GetWorkflowNode(...)` 之前添加：

```go
func (s *SplitOrchestrator) ApproveSplit(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun, req SplitApproveRequest) error {
    // Reject legacy modifications — all edits must go through /split/chat.
    if len(req.Modifications) > 0 {
        return fmt.Errorf("split modifications must be submitted through /split/chat")
    }
    
    // ... 其余代码不变
```

- [ ] **Step 2: 移除 `ApproveSplit` 中的 modifications 处理逻辑**

删除 `ApproveSplit` 方法中处理 `req.Modifications` 的整个 `for _, mod := range req.Modifications` 循环体及其相关逻辑（add/delete/update 操作）。这些现在由 `/split/chat` 处理。

保留：
- `approvedIDs` 和 `approvedUUIDs` 构建
- `cfg` 解析
- `findParentIssue`
- 事务内的 lock、状态检查、`MarkSplitTasksApproved`、`MarkSplitTasksDiscardedExcept`
- 子 issue 创建逻辑（`topologicalSplitTaskIDs` + `CreateIssueWithOrigin`）
- `ScheduleReadyTasks` + `reconcileParentNode`

删除的代码块：
```go
// 删除从 for _, mod := range req.Modifications { 开始的整个循环
// 以及相关的 deletedIDs map 使用
```

注意：还需要删除 `deletedIDs` 变量的声明（`deletedIDs := make(map[string]struct{})`），以及后续使用 `deletedIDs` 的逻辑。

实际上 `deletedIDs` 只在 modifications 删除操作中用到。在简化后，`approvedIDs` 已经足够驱动逻辑——未在 `approved_task_ids` 中的 draft task 会被 `MarkSplitTasksDiscardedExcept` 标记为 discarded。

简化后的事务内代码应为：

```go
if err := s.WfService.runInTx(ctx, func(qtx *db.Queries) error {
    lockedNodeRun, err := qtx.GetWorkflowNodeRunForUpdate(ctx, nodeRun.ID)
    if err != nil {
        return fmt.Errorf("lock split node run: %w", err)
    }
    if lockedNodeRun.Status != NodeRunStatusAwaitingSplitReview {
        return fmt.Errorf("split node cannot be approved from current status")
    }

    current, err := qtx.ListSplitTasksByNodeRun(ctx, nodeRun.ID)
    if err != nil {
        return fmt.Errorf("reload split tasks: %w", err)
    }
    allowed := make([]db.MulticaWorkflowSplitTask, 0, len(current))
    for _, task := range current {
        id := util.UUIDToString(task.ID)
        if _, approved := approvedIDs[id]; approved {
            allowed = append(allowed, task)
        }
    }
    if len(allowed) == 0 {
        return fmt.Errorf("split approval requires at least one task")
    }
    plans, err := splitTaskPlansFromRows(allowed)
    if err != nil {
        return err
    }
    if err := validateSplitTaskGraph(plans); err != nil {
        return err
    }

    if err := qtx.MarkSplitTasksApproved(ctx, db.MarkSplitTasksApprovedParams{
        NodeRunID: nodeRun.ID,
        Column2:   approvedUUIDs,
    }); err != nil {
        return fmt.Errorf("mark approved split tasks: %w", err)
    }
    if err := qtx.MarkSplitTasksDiscardedExcept(ctx, db.MarkSplitTasksDiscardedExceptParams{
        NodeRunID: nodeRun.ID,
        Column2:   approvedUUIDs,
    }); err != nil {
        return fmt.Errorf("mark discarded split tasks: %w", err)
    }

    // ... 子 issue 创建逻辑保持不变
```

- [ ] **Step 3: 更新测试**

在 `server/internal/handler/workflow_split_test.go` 中：

1. 更新 `TestApproveSplitTasksDeleteModificationWinsOverApprovedIDs` — 这个测试验证 old modifications 逻辑。应改为验证：发送非空 `modifications` → 期望 400。

```go
func TestApproveSplitTasksRejectsNonEmptyModifications(t *testing.T) {
    if testHandler == nil {
        t.Skip("database not available")
    }
    f := createSplitApproveFixture(t, "barrier")
    // ... 创建 draft tasks ...
    
    req := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/approve", map[string]any{
        "approved_task_ids": []string{f.taskAID},
        "modifications": []map[string]any{
            {"action": "add", "title": "extra"},
        },
    })
    withMemberContext(req, testUserID, testMemberID, testWorkspaceID)
    w := httptest.NewRecorder()
    testHandler.ApproveSplitTasks(w, req)
    
    if w.Code != http.StatusBadRequest {
        t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
    }
    if !strings.Contains(w.Body.String(), "split modifications must be submitted through /split/chat") {
        t.Fatalf("expected modifications rejection message, got: %s", w.Body.String())
    }
}
```

2. 确保已有 `TestApproveSplitTasksPipelineMaterializesTasksAndCompletesNode` 和 `TestApproveSplitTasksBarrierStartsOnlyReadyTasks` 测试仍然通过（它们不传 modifications）。

- [ ] **Step 4: 运行测试**

```bash
cd server && go test ./internal/handler/ -run TestApprove -v -count=1
cd server && go test ./internal/service/ -run TestSplit -v -count=1
```

期望：所有测试通过。

- [ ] **Step 5: Commit**

```bash
git add server/internal/service/workflow_split.go server/internal/handler/workflow_split_test.go
git commit -m "feat(workflow): reject non-empty modifications in /split/approve, remove legacy edit logic"
```

---

### Task 7: 端到端集成测试 — /split/chat + approve 流程

**Files:**
- Modify: `server/internal/handler/workflow_split_test.go`

**Interfaces:**
- Consumes: `createSplitApproveFixture`, `newRequest`, `withMemberContext`
- Produces: 新的集成测试覆盖 split/chat → split/approve 完整流程

- [ ] **Step 1: 编写 split/chat happy path 测试**

```go
func TestSplitChatCreatesSessionAndDispatchesTask(t *testing.T) {
    if testHandler == nil {
        t.Skip("database not available")
    }
    f := createSplitGenerateFixture(t)
    ctx := context.Background()
    
    // First generate drafts.
    generateReq := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/generate", nil)
    withMemberContext(generateReq, testUserID, testMemberID, testWorkspaceID)
    generateResp := httptest.NewRecorder()
    testHandler.GenerateSplitTasks(generateResp, generateReq)
    if generateResp.Code != http.StatusOK {
        t.Fatalf("GenerateSplitTasks: expected 200, got %d: %s", generateResp.Code, generateResp.Body.String())
    }
    
    // Transition to awaiting_split_review by submitting drafts.
    submitReq := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/draft-submit", nil)
    // ... set headers for agent task access ...
    
    // Send chat message.
    chatReq := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/chat", map[string]any{
        "message": "请把任务2拆成两个独立任务",
    })
    withMemberContext(chatReq, testUserID, testMemberID, testWorkspaceID)
    chatResp := httptest.NewRecorder()
    testHandler.HandleSplitChat(chatResp, chatReq)
    
    if chatResp.Code != http.StatusOK {
        t.Fatalf("HandleSplitChat: expected 200, got %d: %s", chatResp.Code, chatResp.Body.String())
    }
    
    var body map[string]any
    if err := json.Unmarshal(chatResp.Body.Bytes(), &body); err != nil {
        t.Fatalf("parse chat response: %v", err)
    }
    if body["chat_session_id"] == nil || body["chat_session_id"] == "" {
        t.Fatal("expected chat_session_id in response")
    }
    if body["task_id"] == nil || body["task_id"] == "" {
        t.Fatal("expected task_id in response")
    }
    
    // Verify chat session was bound to node run.
    nodeRun, err := testHandler.Queries.GetWorkflowNodeRun(ctx, parseUUID(f.splitNodeRunID))
    if err != nil {
        t.Fatalf("get node run: %v", err)
    }
    if !nodeRun.SplitReviewChatSessionID.Valid {
        t.Fatal("expected split_review_chat_session_id to be set on node run")
    }
}
```

- [ ] **Step 2: 编写 split/chat 幂等性测试**

```go
func TestSplitChatReusesExistingSession(t *testing.T) {
    if testHandler == nil {
        t.Skip("database not available")
    }
    f := createSplitApproveFixture(t, "barrier")
    ctx := context.Background()

    // Transition node run to awaiting_split_review with drafts.
    // ... setup: create drafts, transition to awaiting_split_review ...

    // First chat call.
    chatReq1 := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/chat", map[string]any{
        "message": "调整任务1的标题",
    })
    withMemberContext(chatReq1, testUserID, testMemberID, testWorkspaceID)
    chatResp1 := httptest.NewRecorder()
    testHandler.HandleSplitChat(chatResp1, chatReq1)
    if chatResp1.Code != http.StatusOK {
        t.Fatalf("first HandleSplitChat: expected 200, got %d: %s", chatResp1.Code, chatResp1.Body.String())
    }

    var body1 map[string]any
    json.Unmarshal(chatResp1.Body.Bytes(), &body1)
    sessionID1 := body1["chat_session_id"].(string)

    // Verify chat session was bound.
    nodeRun, _ := testHandler.Queries.GetWorkflowNodeRun(ctx, parseUUID(f.splitNodeRunID))
    if !nodeRun.SplitReviewChatSessionID.Valid {
        t.Fatal("expected split_review_chat_session_id to be set")
    }

    // Second chat call — should reuse the same session.
    chatReq2 := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/chat", map[string]any{
        "message": "再调整一下任务2",
    })
    withMemberContext(chatReq2, testUserID, testMemberID, testWorkspaceID)
    chatResp2 := httptest.NewRecorder()
    testHandler.HandleSplitChat(chatResp2, chatReq2)
    if chatResp2.Code != http.StatusOK {
        t.Fatalf("second HandleSplitChat: expected 200, got %d: %s", chatResp2.Code, chatResp2.Body.String())
    }

    var body2 map[string]any
    json.Unmarshal(chatResp2.Body.Bytes(), &body2)
    sessionID2 := body2["chat_session_id"].(string)

    if sessionID1 != sessionID2 {
        t.Fatalf("expected same chat_session_id (%s), got %s", sessionID1, sessionID2)
    }

    // Verify two user messages exist in the session.
    chatSessionID, _ := util.ParseUUID(sessionID1)
    messages, err := testHandler.Queries.ListChatMessages(ctx, chatSessionID)
    if err != nil {
        t.Fatalf("list chat messages: %v", err)
    }
    userMsgCount := 0
    for _, msg := range messages {
        if msg.Role == "user" {
            userMsgCount++
        }
    }
    if userMsgCount != 2 {
        t.Fatalf("expected 2 user messages, got %d", userMsgCount)
    }
}
```

- [ ] **Step 3: 编写 split/chat 并发拒绝测试**

```go
func TestSplitChatRejectsConcurrentTask(t *testing.T) {
    if testHandler == nil {
        t.Skip("database not available")
    }
    f := createSplitApproveFixture(t, "barrier")
    // ... setup: transition node run to awaiting_split_review with drafts ...

    // First chat call — dispatches agent task (stays in queued/dispatched/running).
    chatReq1 := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/chat", map[string]any{
        "message": "调整任务1",
    })
    withMemberContext(chatReq1, testUserID, testMemberID, testWorkspaceID)
    chatResp1 := httptest.NewRecorder()
    testHandler.HandleSplitChat(chatResp1, chatReq1)
    if chatResp1.Code != http.StatusOK {
        t.Fatalf("first HandleSplitChat: expected 200, got %d: %s", chatResp1.Code, chatResp1.Body.String())
    }

    // Second chat call while first task is still pending — should return 409.
    chatReq2 := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/chat", map[string]any{
        "message": "这个应该被拒绝",
    })
    withMemberContext(chatReq2, testUserID, testMemberID, testWorkspaceID)
    chatResp2 := httptest.NewRecorder()
    testHandler.HandleSplitChat(chatResp2, chatReq2)

    if chatResp2.Code != http.StatusConflict {
        t.Fatalf("expected 409 Conflict, got %d: %s", chatResp2.Code, chatResp2.Body.String())
    }
    if !strings.Contains(chatResp2.Body.String(), "already in progress") {
        t.Fatalf("expected 'already in progress' error, got: %s", chatResp2.Body.String())
    }
}
```

- [ ] **Step 4: 运行全部测试**

```bash
cd server && go test ./internal/handler/ -run "TestSplit" -v -count=1
```

期望：全部通过。

- [ ] **Step 5: Commit**

```bash
git add server/internal/handler/workflow_split_test.go
git commit -m "test(workflow): add integration tests for split/chat endpoint"
```

---

### Task 8: 更新 Agent CLI — 支持 split_chat phase

**Files:**
- Modify: `server/cmd/cs-workflow/cmd_workflow_split.go`

**Interfaces:**
- Consumes: 现有 draft API 路径
- Produces: 无需改动功能，仅确认 `split_chat` phase 下 draft API 调用不受影响

- [ ] **Step 1: 确认 CLI 无需改动**

`cs-workflow split draft add` 和 `cs-workflow split draft submit` 使用 `X-Task-ID` 和 `X-Agent-ID` header，路径使用 `/api/node-runs/{id}/split/draft-tasks`。这不需要改动——phase 判断由服务端通过 task context 完成。

- [ ] **Step 2: 运行 CLI 单元测试**

```bash
cd server && go test ./cmd/cs-workflow/ -run TestWorkflow -v -count=1
```

期望：通过。

- [ ] **Step 3: Commit（如有改动）**

```bash
# 如果没有改动则跳过
```

---

### Task 9: 最终验证 — 全量 make check

- [ ] **Step 1: 运行全面检查**

```bash
make check
```

期望：全部通过（Go tests, TS typecheck, TS tests, E2E）。

- [ ] **Step 2: 修复所有问题**

如果有任何步骤失败，读取错误输出，修复代码，重新运行直到全部通过。

- [ ] **Step 3: 最终 Commit**

```bash
git add -A
git commit -m "chore: final verification after split/chat implementation"
```
