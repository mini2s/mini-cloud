# 创建任务「立即运行」修复与统一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让创建任务弹窗的「立即运行」真正生效——任务直接创建为 `in_progress` 并立刻派发；agent/workflow/squad 复用 `WorkflowRuntimeStrategyDialog` 选运行时（三档策略全生效）；移除无效的 StatusPicker 与 backlog 提示。

**Architecture:** 服务端让 `CreateIssue` 尊重显式 `status:"in_progress"`（仅当有处理人），`AfterIssueAssigned` 见到 `in_progress` 即走既有派发；把工作流的运行时策略解析（`chooseRuntimeByPolicy`）提炼为共享函数，agent/squad 派发复用它，解析出的 runtime 作为 override 传入 enqueue。前端把 `useRuntimeStartDialogs` 里 agent/squad 也统一弹 `WorkflowRuntimeStrategyDialog`，并移除 StatusPicker 与 backlog 提示（含 shell 与 legacy wrapper 的 lifted state）。

**Tech Stack:** Go（Chi handler + sqlc + service 层）、TypeScript/React（packages/views，Vitest + @testing-library/react）。

**Spec:** `docs/superpowers/specs/2026-08-03-create-issue-run-now-design.md`

---

## File Structure

**后端（Go）**
- Modify `server/internal/handler/issue.go` — `CreateIssue` 用新 `resolveCreateStatus`；新增 `resolveCreateStatus`（紧邻 `issueCreateStatusForAssignee`）。
- Modify `server/internal/service/workflow_runtime_selection.go` — 从 `chooseWorkflowRuntime` 提炼出 `chooseRuntimeByPolicy`。
- Modify `server/internal/service/issue_assignment.go` — 新增 `resolveIssueRuntime`；改 agent/squad 分支。
- Modify `server/internal/service/task.go` — `EnqueueTaskForSquadLeader` 加 override 变参；`enqueueMentionTask` 用 override。
- Test `server/internal/handler/handler_test.go`（追加）与 `server/internal/service/workflow_runtime_selection_test.go`（新建）。

**前端（TS）**
- Modify `packages/views/issues/hooks/use-runtime-start-dialogs.tsx` — agent/squad 统一弹 `WorkflowRuntimeStrategyDialog`。
- Modify `packages/views/modals/create-issue.tsx` — 移除 StatusPicker、`status` 状态、backlog 提示渲染、`manualDialogContentClass` 入参。
- Modify `packages/views/modals/create-issue-dialog.tsx` — 移除 lifted `backlogHintIssueId` state 与传参。
- Test `packages/views/modals/create-issue.test.tsx`（调整 mock）与 `packages/views/issues/hooks/use-runtime-start-dialogs.test.tsx`（新建）。

> 不动：`RuntimeSelectDialog`（详情页 assignee-picker 仍用）、`BacklogAgentHintContent` 组件文件（详情页仍用）、issue 表（无 runtime 列，确认无需迁移）、`EnqueueTaskForIssue`（已支持 override 变参）。

---

## Task 1: 后端 — `CreateIssue` 尊重显式 `in_progress`

**Files:**
- Modify: `server/internal/handler/issue.go`（约 1834 行调用处；新增 helper 紧邻 `issueCreateStatusForAssignee` 约 2531 行）
- Test: `server/internal/handler/handler_test.go`（追加两个测试）

- [ ] **Step 1: 写失败测试** — 追加到 `server/internal/handler/handler_test.go`

```go
func TestCreateIssueInProgressHonoredWithAssignee(t *testing.T) {
	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/issues?workspace_id="+testWorkspaceID, map[string]any{
		"title":         "Run now",
		"status":        "in_progress",
		"assignee_type": "member",
		"assignee_id":   testUserID,
	})
	testHandler.CreateIssue(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var created IssueResponse
	if err := json.NewDecoder(w.Body).Decode(&created); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if created.Status != "in_progress" {
		t.Fatalf("expected status in_progress, got %s", created.Status)
	}
	cleanupReq := newRequest("DELETE", "/api/issues/"+created.ID, nil)
	cleanupReq = withURLParam(cleanupReq, "id", created.ID)
	testHandler.DeleteIssue(httptest.NewRecorder(), cleanupReq)
}

func TestCreateIssueInProgressWithoutAssigneeRejected(t *testing.T) {
	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/issues?workspace_id="+testWorkspaceID, map[string]any{
		"title":  "No assignee",
		"status": "in_progress",
	})
	testHandler.CreateIssue(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}
```

- [ ] **Step 2: 跑测试确认失败** — 数据库测试用 `make test`（或 CLAUDE.md 的 PowerShell 段）。先确认两个新测试 FAIL（现状：前者 status 落 todo；后者 201 而非 400）。

Run: `make test`（或 `cd server && go test ./internal/handler -run 'TestCreateIssueInProgress'`，注意需 DB，见 CLAUDE.md「Database-backed Go tests」）
Expected: FAIL

- [ ] **Step 3: 实现** — 在 `server/internal/handler/issue.go`，紧邻 `issueCreateStatusForAssignee` 新增：

```go
// resolveCreateStatus keeps the assignee-derived default for normal creates and
// additionally honors an explicit in_progress ("run now") when an assignee is
// present. Any other requested status falls back to the assignee-derived
// default so normal create behavior is unchanged.
func resolveCreateStatus(reqStatus string, assigneeType pgtype.Text, assigneeID pgtype.UUID) (string, error) {
	if reqStatus == "in_progress" {
		if !issueHasAssignee(assigneeType, assigneeID) {
			return "", fmt.Errorf("cannot start an issue without an assignee")
		}
		return "in_progress", nil
	}
	return issueCreateStatusForAssignee(assigneeType, assigneeID), nil
}
```

然后把约 1834 行的调用从：
```go
	status := issueCreateStatusForAssignee(assigneeType, assigneeID)
```
改为：
```go
	status, err := resolveCreateStatus(req.Status, assigneeType, assigneeID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
```

> 若同作用域已有 `err`，`:=` 至少引入新变量 `status`，仍合法；如编译器报重复声明，把 `err` 改为赋值已存在变量即可。

- [ ] **Step 4: 跑测试确认通过**

Run: `make test`（或 PowerShell 段 `-run 'TestCreateIssueInProgress'`）
Expected: PASS。同时确认 `TestCreateIssueDefaultStatusIsBacklog`、`TestCreateIssueAssignedDefaultsToTodo` 仍通过（普通创建不变）。

- [ ] **Step 5: 提交**

```bash
git add server/internal/handler/issue.go server/internal/handler/handler_test.go
git commit -m "feat(issue): honor explicit in_progress on create (run-now)"
```

---

## Task 2: 后端 — 提炼 `chooseRuntimeByPolicy`（纯函数）

**Files:**
- Modify: `server/internal/service/workflow_runtime_selection.go`（`chooseWorkflowRuntime` 112-188）
- Test: `server/internal/service/workflow_runtime_selection_test.go`（新建）

- [ ] **Step 1: 写失败测试** — 新建 `server/internal/service/workflow_runtime_selection_test.go`

```go
package service

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestChooseRuntimeByPolicy(t *testing.T) {
	creator := util.MustParseUUID("11111111-1111-1111-1111-111111111111")
	other := util.MustParseUUID("22222222-2222-2222-2222-222222222222")
	spec := util.MustParseUUID("33333333-3333-3333-3333-333333333333")
	candidates := []db.ListWorkflowRuntimeCandidatesRow{
		{ID: other, OwnerID: pgtype.UUID{}, ActiveTaskCount: 0},
		{ID: creator, OwnerID: creator, ActiveTaskCount: 2},
		{ID: spec, OwnerID: pgtype.UUID{}, ActiveTaskCount: 1},
	}

	got, err := chooseRuntimeByPolicy(RuntimeSelectionPolicySpecifiedRuntimeFirst, spec, pgtype.UUID{}, candidates)
	if err != nil || got.RuntimeID != spec {
		t.Fatalf("specified: got=%v err=%v", got.RuntimeID, err)
	}

	got, err = chooseRuntimeByPolicy(RuntimeSelectionPolicyIdleFirst, pgtype.UUID{}, pgtype.UUID{}, candidates)
	if err != nil || got.RuntimeID != other {
		t.Fatalf("idle: got=%v err=%v", got.RuntimeID, err)
	}

	got, err = chooseRuntimeByPolicy(RuntimeSelectionPolicyIssueCreatorFirst, pgtype.UUID{}, creator, candidates)
	if err != nil || got.RuntimeID != creator {
		t.Fatalf("creator: got=%v err=%v", got.RuntimeID, err)
	}

	if _, err := chooseRuntimeByPolicy(RuntimeSelectionPolicyIdleFirst, pgtype.UUID{}, pgtype.UUID{}, nil); !errors.Is(err, ErrWorkflowRuntimeUnavailable) {
		t.Fatalf("expected ErrWorkflowRuntimeUnavailable, got %v", err)
	}
}
```

- [ ] **Step 2: 跑测试确认失败** — 纯函数测试，无需 DB。

Run: `cd server && go test ./internal/service -run TestChooseRuntimeByPolicy`
Expected: FAIL（`chooseRuntimeByPolicy` 未定义）

- [ ] **Step 3: 实现** — 把 `chooseWorkflowRuntime`（workflow_runtime_selection.go:112）体里的策略逻辑抽到新函数，`chooseWorkflowRuntime` 改为委托：

```go
func chooseWorkflowRuntime(
	run db.MulticaWorkflowRun,
	candidates []db.ListWorkflowRuntimeCandidatesRow,
) (workflowRuntimeSelection, error) {
	policy := run.RuntimeSelectionPolicy
	if policy == "" {
		if run.RuntimeID.Valid {
			policy = RuntimeSelectionPolicySpecifiedRuntimeFirst
		} else {
			policy = RuntimeSelectionPolicyIdleFirst
		}
	}
	return chooseRuntimeByPolicy(policy, run.RuntimeID, run.ResponsibleUserID, candidates)
}

// chooseRuntimeByPolicy resolves a concrete runtime from candidates given a
// selection policy. Extracted from chooseWorkflowRuntime so non-workflow
// dispatch paths (issue run-now for built-in agents / squad leaders) reuse the
// exact same semantics. specifiedRuntimeID is honored for
// specified_runtime_first; responsibleUserID drives issue_creator_first.
func chooseRuntimeByPolicy(
	policy string,
	specifiedRuntimeID pgtype.UUID,
	responsibleUserID pgtype.UUID,
	candidates []db.ListWorkflowRuntimeCandidatesRow,
) (workflowRuntimeSelection, error) {
	if policy == RuntimeSelectionPolicySpecifiedRuntimeFirst && specifiedRuntimeID.Valid {
		for _, candidate := range candidates {
			if candidate.ID == specifiedRuntimeID {
				return workflowRuntimeSelection{
					RuntimeID:       candidate.ID,
					Reason:          RuntimeSelectionManual,
					ActiveTaskCount: candidate.ActiveTaskCount,
				}, nil
			}
		}
	}

	chooseIdle := func() (workflowRuntimeSelection, bool) {
		for _, candidate := range candidates {
			if candidate.ActiveTaskCount == 0 {
				return workflowRuntimeSelection{
					RuntimeID: candidate.ID,
					Reason:    RuntimeSelectionIdle,
				}, true
			}
		}
		return workflowRuntimeSelection{}, false
	}
	chooseIssueCreator := func() (workflowRuntimeSelection, bool) {
		if !responsibleUserID.Valid {
			return workflowRuntimeSelection{}, false
		}
		var selected *db.ListWorkflowRuntimeCandidatesRow
		for i := range candidates {
			candidate := &candidates[i]
			if !candidate.OwnerID.Valid || candidate.OwnerID != responsibleUserID {
				continue
			}
			if selected == nil || candidate.ActiveTaskCount < selected.ActiveTaskCount {
				selected = candidate
			}
		}
		if selected != nil {
			return workflowRuntimeSelection{
				RuntimeID:       selected.ID,
				Reason:          RuntimeSelectionIssueCreator,
				ActiveTaskCount: selected.ActiveTaskCount,
			}, true
		}
		return workflowRuntimeSelection{}, false
	}

	if policy == RuntimeSelectionPolicyIssueCreatorFirst {
		if selection, ok := chooseIssueCreator(); ok {
			return selection, nil
		}
		if selection, ok := chooseIdle(); ok {
			return selection, nil
		}
	} else {
		if selection, ok := chooseIdle(); ok {
			return selection, nil
		}
		if selection, ok := chooseIssueCreator(); ok {
			return selection, nil
		}
	}

	return workflowRuntimeSelection{}, ErrWorkflowRuntimeUnavailable
}
```

- [ ] **Step 4: 跑测试确认通过** — 新测试 + 工作流回归（确保重构没改语义）

Run: `cd server && go test ./internal/service -run TestChooseRuntimeByPolicy` 然后 `make test`
Expected: PASS（含既有工作流运行时测试）

- [ ] **Step 5: 提交**

```bash
git add server/internal/service/workflow_runtime_selection.go server/internal/service/workflow_runtime_selection_test.go
git commit -m "refactor(service): extract chooseRuntimeByPolicy from chooseWorkflowRuntime"
```

---

## Task 3: 后端 — agent 派发接入运行时策略解析

**Files:**
- Modify: `server/internal/service/issue_assignment.go`（新增 `resolveIssueRuntime`；改 agent 分支 140-147）
- Test: `server/internal/handler/builtin_agent_test.go`（追加，镜像既有 `TestCreateIssueAssignedToBuiltinAgentWaitsUntilInProgress` 的 fixture）

- [ ] **Step 1: 写失败测试** — 追加到 `server/internal/handler/builtin_agent_test.go`。**镜像同文件 `TestCreateIssueAssignedToBuiltinAgentWaitsUntilInProgress`（约 17 行）的 builtin-agent fixture 构造方式**（用同一个 helper 建 builtin agent + runtime）。核心断言：run-now 后任务被派发、且 runtime_id 为指定值。

```go
// 镜像 TestCreateIssueAssignedToBuiltinAgentWaitsUntilInProgress 的 builtin agent
// + runtime fixture 构造（变量名沿用该测试），然后：
func TestCreateIssueRunNowBuiltinAgentEnqueuesWithSpecifiedRuntime(t *testing.T) {
	// 用同文件既有的 builtin agent + runtime fixture（参考 TestCreateIssueAssignedToBuiltinAgentWaitsUntilInProgress）
	builtinAgentID, runtimeID := setupBuiltinAgentFixture(t) // 复用既有 helper/写法

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/issues?workspace_id="+testWorkspaceID, map[string]any{
		"title":                     "Run now builtin",
		"status":                    "in_progress",
		"assignee_type":             "agent",
		"assignee_id":               builtinAgentID,
		"runtime_selection_policy":  "specified_runtime_first",
		"runtime_id":                runtimeID,
	})
	testHandler.CreateIssue(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var created IssueResponse
	json.NewDecoder(w.Body).Decode(&created)

	var taskRuntimeID string
	if err := testPool.QueryRow(context.Background(), `
		SELECT runtime_id::text FROM multica_agent_task_queue
		WHERE issue_id = $1 AND agent_id = $2 AND status = 'queued'
		ORDER BY created_at DESC LIMIT 1
	`, created.ID, builtinAgentID).Scan(&taskRuntimeID); err != nil {
		t.Fatalf("no queued task enqueued: %v", err)
	}
	if taskRuntimeID != runtimeID {
		t.Fatalf("expected task runtime %s, got %s", runtimeID, taskRuntimeID)
	}
	// cleanup
	cleanupReq := newRequest("DELETE", "/api/issues/"+created.ID, nil)
	cleanupReq = withURLParam(cleanupReq, "id", created.ID)
	testHandler.DeleteIssue(httptest.NewRecorder(), cleanupReq)
}
```

> 若 builtin fixture helper 的真实签名不同（返回值/参数），按 `builtin_agent_test.go` 既有写法对齐 `setupBuiltinAgentFixture`；不要新造与既有不一致的 helper。需要 `context` import。

- [ ] **Step 2: 跑测试确认失败**

Run: `make test`（或 PowerShell 段 `-run TestCreateIssueRunNowBuiltinAgent`）
Expected: FAIL（现状：任务未派发——status 落 todo，或 runtime 不符）

- [ ] **Step 3: 实现** — 在 `server/internal/service/issue_assignment.go` 新增（`workflowRuntimeStaleSeconds`、`IsWorkflowRuntimeSelectionPolicy`、`chooseRuntimeByPolicy` 同包可用）：

```go
// resolveIssueRuntime resolves a concrete runtime for an issue's run-now
// dispatch using the same policy semantics as workflow runtime selection. Used
// for built-in agent and squad-leader dispatch when the caller supplied a
// runtime selection policy. Returns an invalid UUID on any failure so callers
// fall back to the task service's default runtime resolution.
func (s *IssueAssignmentService) resolveIssueRuntime(
	ctx context.Context,
	issue db.MulticaIssue,
	actor AssignmentActor,
	policy string,
	specifiedRuntimeID pgtype.UUID,
) pgtype.UUID {
	if !IsWorkflowRuntimeSelectionPolicy(policy) {
		return pgtype.UUID{}
	}
	candidates, err := s.Queries.ListWorkflowRuntimeCandidates(ctx, db.ListWorkflowRuntimeCandidatesParams{
		WorkspaceID:       issue.WorkspaceID,
		StaleSeconds:      workflowRuntimeStaleSeconds,
		AuthorizerUserID:  actor.ID,
		ResponsibleUserID: issue.ResponsibleUserID,
	})
	if err != nil {
		return pgtype.UUID{}
	}
	selection, err := chooseRuntimeByPolicy(policy, specifiedRuntimeID, issue.ResponsibleUserID, candidates)
	if err != nil {
		return pgtype.UUID{}
	}
	return selection.RuntimeID
}
```

然后改 agent 分支（issue_assignment.go 约 140-147）从：
```go
	case "agent":
		agent, err := s.Queries.GetAgent(ctx, issue.AssigneeID)
		if err != nil || agent.ArchivedAt.Valid || (!agent.RuntimeID.Valid && !agent.IsBuiltin) {
			return nil
		}
		_, err = s.Tasks.EnqueueTaskForIssue(ctx, issue, pgtype.UUID{}, runtimeSelection.RuntimeID)
		return err
```
改为：
```go
	case "agent":
		agent, err := s.Queries.GetAgent(ctx, issue.AssigneeID)
		if err != nil || agent.ArchivedAt.Valid || (!agent.RuntimeID.Valid && !agent.IsBuiltin) {
			return nil
		}
		runtimeID := runtimeSelection.RuntimeID
		if agent.IsBuiltin {
			if resolved := s.resolveIssueRuntime(ctx, issue, actor, runtimeSelection.Policy, runtimeID); resolved.Valid {
				runtimeID = resolved
			}
		}
		_, err = s.Tasks.EnqueueTaskForIssue(ctx, issue, pgtype.UUID{}, runtimeID)
		return err
```

- [ ] **Step 4: 跑测试确认通过**

Run: `make test`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/internal/service/issue_assignment.go server/internal/handler/builtin_agent_test.go
git commit -m "feat(issue): resolve runtime by policy for built-in agent run-now"
```

---

## Task 4: 后端 — squad 派发接入运行时策略解析

**Files:**
- Modify: `server/internal/service/task.go`（`EnqueueTaskForSquadLeader` 731、`enqueueMentionTask` 735 加 override）
- Modify: `server/internal/service/issue_assignment.go`（squad 分支 148-166）
- Test: `server/internal/handler/squad_comment_trigger_test.go`（追加，镜像既有 squad fixture）

- [ ] **Step 1: 写失败测试** — 追加到 `server/internal/handler/squad_comment_trigger_test.go`，**镜像同文件既有 squad fixture**（参考约 304 行的 task 计数断言）。断言：run-now + 指定 runtime 后，小队 leader 任务被派发且 runtime_id 为指定值。

```go
func TestCreateIssueRunNowSquadEnqueuesWithSpecifiedRuntime(t *testing.T) {
	// 镜像 squad_comment_trigger_test.go 既有 squad + leader agent + runtime fixture
	squadID, leaderID, runtimeID := setupSquadFixture(t) // 复用既有写法

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/issues?workspace_id="+testWorkspaceID, map[string]any{
		"title":                    "Run now squad",
		"status":                   "in_progress",
		"assignee_type":            "squad",
		"assignee_id":              squadID,
		"runtime_selection_policy": "specified_runtime_first",
		"runtime_id":               runtimeID,
	})
	testHandler.CreateIssue(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var created IssueResponse
	json.NewDecoder(w.Body).Decode(&created)

	var taskRuntimeID string
	if err := testPool.QueryRow(context.Background(), `
		SELECT runtime_id::text FROM multica_agent_task_queue
		WHERE issue_id = $1 AND agent_id = $2 AND status = 'queued'
		ORDER BY created_at DESC LIMIT 1
	`, created.ID, leaderID).Scan(&taskRuntimeID); err != nil {
		t.Fatalf("no queued squad-leader task: %v", err)
	}
	if taskRuntimeID != runtimeID {
		t.Fatalf("expected task runtime %s, got %s", runtimeID, taskRuntimeID)
	}
	cleanupReq := newRequest("DELETE", "/api/issues/"+created.ID, nil)
	cleanupReq = withURLParam(cleanupReq, "id", created.ID)
	testHandler.DeleteIssue(httptest.NewRecorder(), cleanupReq)
}
```

> 按既有 squad fixture 的真实签名对齐 `setupSquadFixture`；`context` import 按需。

- [ ] **Step 2: 跑测试确认失败**

Run: `make test`（或 `-run TestCreateIssueRunNowSquad`）
Expected: FAIL（现状：squad leader 任务 runtime 仍由 `resolveRuntimeForAgent` 自动选，非指定值）

- [ ] **Step 3: 实现** — `server/internal/service/task.go`：

`EnqueueTaskForSquadLeader`（731）加 trailing 变参（4 个既有调用方 autopilot/squad/comment/assignment 不传第 5 参，零改动）：
```go
func (s *TaskService) EnqueueTaskForSquadLeader(ctx context.Context, issue db.MulticaIssue, leaderID pgtype.UUID, triggerCommentID pgtype.UUID, overrideRuntimeID ...pgtype.UUID) (db.MulticaAgentTaskQueue, error) {
	var override pgtype.UUID
	if len(overrideRuntimeID) > 0 {
		override = overrideRuntimeID[0]
	}
	return s.enqueueMentionTask(ctx, issue, leaderID, triggerCommentID, true, false, pgtype.UUID{}, nil, override)
}
```

`enqueueMentionTask`（735）加 `overrideRuntimeID pgtype.UUID` 参数，并在解析 runtime 时优先用 override（与 `enqueueIssueTask` 651 行一致的语义）：
```go
func (s *TaskService) enqueueMentionTask(ctx context.Context, issue db.MulticaIssue, agentID pgtype.UUID, triggerCommentID pgtype.UUID, isLeader bool, forceFreshSession bool, workflowNodeRunID pgtype.UUID, contextJSON []byte, overrideRuntimeID pgtype.UUID) (db.MulticaAgentTaskQueue, error) {
	agent, err := s.Queries.GetAgent(ctx, agentID)
	if err != nil {
		slog.Error("mention task enqueue failed: agent not found", "issue_id", util.UUIDToString(issue.ID), "agent_id", util.UUIDToString(agentID), "error", err)
		return db.MulticaAgentTaskQueue{}, fmt.Errorf("load agent: %w", err)
	}
	if agent.ArchivedAt.Valid {
		slog.Debug("mention task enqueue skipped: agent is archived", "issue_id", util.UUIDToString(issue.ID), "agent_id", util.UUIDToString(agentID))
		return db.MulticaAgentTaskQueue{}, fmt.Errorf("agent is archived")
	}
	runtimeID, err := s.resolveRuntimeForAgent(ctx, agent, issue.WorkspaceID)
	if err != nil {
		if overrideRuntimeID.Valid {
			runtimeID = overrideRuntimeID
		} else {
			slog.Error("mention task enqueue failed", "issue_id", util.UUIDToString(issue.ID), "agent_id", util.UUIDToString(agentID), "error", err)
			return db.MulticaAgentTaskQueue{}, fmt.Errorf("resolve runtime: %w", err)
		}
	}
	if overrideRuntimeID.Valid {
		runtimeID = overrideRuntimeID // caller override takes priority
	}
	// …其余 CreateAgentTask / link / broadcast 体保持不变（runtimeID 已确定）
```
> 把 751 行起的 `runtimeID, err := s.resolveRuntimeForAgent(...)` 段替换为上面两段；函数体其余（CreateAgentTask 用 runtimeID、link、broadcast）原样保留。

然后改 squad 分支（issue_assignment.go 约 148-166）的 leader 解析与调用。在 `leader, err := s.Queries.GetAgent(ctx, squad.LeaderID)` 与 readiness 检查之后、`EnqueueTaskForSquadLeader` 之前插入解析，并传 override：
```go
		leader, err := s.Queries.GetAgent(ctx, squad.LeaderID)
		if err != nil {
			return nil
		}
		ready, _, err := AgentReadiness(ctx, s.Queries, leader)
		if err != nil || !ready {
			return nil
		}
		hasPending, err := s.Queries.HasPendingTaskForIssueAndAgent(ctx, db.HasPendingTaskForIssueAndAgentParams{IssueID: issue.ID, AgentID: squad.LeaderID})
		if err != nil || hasPending {
			return err
		}
		runtimeID := runtimeSelection.RuntimeID
		if leader.IsBuiltin {
			if resolved := s.resolveIssueRuntime(ctx, issue, actor, runtimeSelection.Policy, runtimeID); resolved.Valid {
				runtimeID = resolved
			}
		}
		_, err = s.Tasks.EnqueueTaskForSquadLeader(ctx, issue, squad.LeaderID, pgtype.UUID{}, runtimeID)
		return err
```

- [ ] **Step 4: 跑测试确认通过** — squad 新测试 + 4 个既有调用方回归（autopilot/squad/comment trigger）

Run: `make test`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/internal/service/task.go server/internal/service/issue_assignment.go server/internal/handler/squad_comment_trigger_test.go
git commit -m "feat(issue): resolve runtime by policy for squad-leader run-now"
```

---

## Task 5: 前端 — `useRuntimeStartDialogs` 统一弹 `WorkflowRuntimeStrategyDialog`

**Files:**
- Modify: `packages/views/issues/hooks/use-runtime-start-dialogs.tsx`
- Test: `packages/views/issues/hooks/use-runtime-start-dialogs.test.tsx`（新建）

- [ ] **Step 1: 写失败测试** — 新建 `packages/views/issues/hooks/use-runtime-start-dialogs.test.tsx`，参考 `use-issue-timeline.test.tsx` 的 `renderHook` + `vi.hoisted`/`vi.mock` 模式。

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

// --- hoisted mocks ---
const { agents, workflows, runtimes } = vi.hoisted(() => ({
	agents: [{ id: "ag1", is_builtin: true, name: "Agent One" }],
	workflows: [{ id: "wf1", title: "Workflow One" }],
	runtimes: [{ id: "rt1", status: "online" }, { id: "rt2", status: "online" }],
}));

vi.mock("@multica/core/runtimes/queries", () => ({
	runtimeListOptions: () => ({ queryKey: ["runtimes"], queryFn: () => runtimes }),
}));
vi.mock("@multica/core/workspace/queries", () => ({
	agentListOptions: () => ({ queryKey: ["agents"], queryFn: () => agents }),
}));
vi.mock("@multica/core/workflows/queries", () => ({
	workflowActiveListOptions: () => ({ queryKey: ["workflows"], queryFn: () => workflows }),
}));
vi.mock("@multica/core/types", async () => {
	const actual = await vi.importActual("@multica/core/types");
	return { ...actual };
});
vi.mock("../../workflows/components/use-usable-workflow-runtimes", () => ({
	useUsableWorkflowRuntimes: () => ({ runtimes, isLoading: false }),
}));

import { useRuntimeStartDialogs } from "./use-runtime-start-dialogs";

describe("useRuntimeStartDialogs", () => {
	it("defers (opens dialog) for workflow / agent / squad, commits directly for member", () => {
		const { result } = renderHook(() => useRuntimeStartDialogs("ws-1"));
		const committed = vi.fn();
		const payload = { status: "in_progress" };

		// member -> commits directly, returns true
		expect(result.current.maybeSelectRuntimeThen("member", "m1", payload, committed)).toBe(true);
		expect(committed).toHaveBeenCalledTimes(1);

		// workflow -> defers
		expect(result.current.maybeSelectRuntimeThen("workflow", "wf1", payload, committed)).toBe(false);
		// agent (builtin) -> defers
		expect(result.current.maybeSelectRuntimeThen("agent", "ag1", payload, committed)).toBe(false);
		// squad -> defers
		expect(result.current.maybeSelectRuntimeThen("squad", "sq1", payload, committed)).toBe(false);

		// member still the only commit
		expect(committed).toHaveBeenCalledTimes(1);
	});
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @multica/views exec vitest run issues/hooks/use-runtime-start-dialogs.test.tsx`
Expected: FAIL（现状：agent builtin >1 runtime 会弹（false），但 squad 直接 commit（true）；单 runtime 时 agent 也直接 commit）

- [ ] **Step 3: 实现** — 改 `packages/views/issues/hooks/use-runtime-start-dialogs.tsx`。把 agent/squad 都改为弹 `WorkflowRuntimeStrategyDialog`，去掉 agent 的在线数分支。

`maybeSelectRuntimeThen` 内（替换 agent 分支 + 新增 squad 分支）：
```tsx
    if (assigneeType === "workflow" && assigneeId) {
      const workflow = workflows.find((w) => w.id === assigneeId);
      setPending({
        basePayload: loosePayload,
        commit: looseCommit,
        kind: "workflow",
        workflowTitle: workflow?.title ?? "",
        initialValue: {
          policy: workflow?.default_runtime_selection_policy ?? "idle_first",
          runtimeId: workflow?.default_runtime_id ?? null,
        },
      });
      return false;
    }
    if (assigneeType === "agent" && assigneeId) {
      const agent = agents.find((a) => a.id === assigneeId);
      if (agent?.is_builtin) {
        setPending({
          basePayload: loosePayload,
          commit: looseCommit,
          kind: "agent",
          workflowTitle: agent.name,
          initialValue: { policy: "idle_first", runtimeId: null },
        });
        return false;
      }
    }
    if (assigneeType === "squad" && assigneeId) {
      setPending({
        basePayload: loosePayload,
        commit: looseCommit,
        kind: "squad",
        workflowTitle: "",
        initialValue: { policy: "idle_first", runtimeId: null },
      });
      return false;
    }
    commit(basePayload);
    return true;
```

把 `dialogs` 里的 `pending?.kind === "agent"` 分支从 `RuntimeSelectDialog` 换成 `WorkflowRuntimeStrategyDialog`（与 workflow 分支同结构），并合并 agent/squad/workflow 三种 kind 都渲染 `WorkflowRuntimeStrategyDialog`：
```tsx
  const dialogs: ReactNode = (
    <>
      {(pending?.kind === "workflow" || pending?.kind === "agent" || pending?.kind === "squad") && (
        <WorkflowRuntimeStrategyDialog
          mode="run"
          workflowTitle={pending.workflowTitle ?? ""}
          initialValue={pending.initialValue ?? { policy: "idle_first", runtimeId: null }}
          runtimes={usableWorkflowRuntimes.runtimes}
          loading={runtimesLoading || usableWorkflowRuntimes.isLoading}
          directRun
          onClose={() => setPending(null)}
          onConfirm={(value: WorkflowRuntimeStrategyValue) => {
            pending.commit({
              ...pending.basePayload,
              runtime_id: value.runtimeId ?? undefined,
              runtime_selection_policy: value.policy,
            });
            setPending(null);
          }}
        />
      )}
    </>
  );
```

> 删除文件顶部 `RuntimeSelectDialog` 的 import（不再使用）。`PendingStart` 的 `kind` 联合改为 `"agent" | "workflow" | "squad"`（已是，无需改）。注意：复用工作流弹窗的标题文案「启动工作流」对 agent/squad 略不符——属已知小瑕疵，行为正确，文案泛化留作后续。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @multica/views exec vitest run issues/hooks/use-runtime-start-dialogs.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/views/issues/hooks/use-runtime-start-dialogs.tsx packages/views/issues/hooks/use-runtime-start-dialogs.test.tsx
git commit -m "feat(views): unify run-now runtime dialog for agent/workflow/squad"
```

---

## Task 6: 前端 — 移除 StatusPicker 与 backlog 提示

**Files:**
- Modify: `packages/views/modals/create-issue.tsx`（移除 picker、`status` 状态、hint 渲染、`manualDialogContentClass` 入参、legacy `CreateIssueModal` 的 hint state）
- Modify: `packages/views/modals/create-issue-dialog.tsx`（移除 lifted `backlogHintIssueId` 与传参）
- Modify: `packages/views/modals/create-issue.test.tsx`（清理相关 mock）

- [ ] **Step 1: 调整测试** — 在 `packages/views/modals/create-issue.test.tsx`：移除 `StatusPicker` 的 stub（约 144-321 的 UI stub 列表中），移除任何针对 backlog 提示的断言/用例。保留「立即运行 / 创建任务」主流程用例。先让测试在「预期 picker 已不存在」下编译失败，驱动后续删除。

Run: `pnpm --filter @multica/views exec vitest run modals/create-issue.test.tsx`
Expected: FAIL（引用了已删除/将删除的 StatusPicker stub 或 hint）

- [ ] **Step 2: 移除代码** — `packages/views/modals/create-issue.tsx`：

1. 删 import 中的 `StatusPicker`（42 行，保留 `StatusIcon`）与 `BacklogAgentHintContent` import（44 行）。
2. 删 `status` 状态（110 行）、`updateStatus`（167 行）、resetForNextIssue 里的 `setStatus("backlog")`（187 行）。
3. 删 StatusPicker 渲染（539-545 的 `{/* Status */}` 块）。
4. 删 `shouldShowBacklogHint` 与 `setBacklogHintIssueId(issue.id)`（270-275）；`performCreate` 末尾改为直接 `keepOpen ? resetForNextIssue() : onClose()`（去掉 backlog 分支），toast 始终展示。
5. 删 backlog 提示渲染：把 394-421 的 `{backlogHintIssueId ? <BacklogAgentHintContent/> : (<>…主体…</>)}` 三元 unwrap，直接返回主体（`<>…runtimeDialogs + DialogTitle + 主体…</>`）。
6. 移除 `ManualCreatePanel` props 中的 `backlogHintIssueId` / `setBacklogHintIssueId`（78-79、88-89、`{…}` 类型）。
7. `manualDialogContentClass`（761-777）简化为单参：
```tsx
export function manualDialogContentClass(isExpanded: boolean) {
  return cn(
    "p-0 gap-0 flex flex-col overflow-hidden",
    "!top-1/2 !left-1/2 !-translate-x-1/2",
    "!transition-all !duration-300 !ease-out",
    isExpanded
      ? "!max-w-4xl !w-full !h-5/6 !-translate-y-1/2"
      : "!max-w-2xl !w-full !h-96 !-translate-y-1/2",
  );
}
```
8. legacy `CreateIssueModal`（784-807）：删 `backlogHintIssueId` state（789）、传参（801-802），className 改 `manualDialogContentClass(isExpanded)`。

- [ ] **Step 3: 移除 shell lifted state** — `packages/views/modals/create-issue-dialog.tsx`：删 `backlogHintIssueId` state（47）、传给 `ManualCreatePanel` 的两 prop（95-96），className 调用改 `manualDialogContentClass(isExpanded)`（72）。

- [ ] **Step 4: typecheck + 测试**

Run: `pnpm typecheck` 然后 `pnpm --filter @multica/views exec vitest run modals/create-issue.test.tsx`
Expected: PASS（无类型错误；create-issue 主流程用例通过；无 StatusPicker / backlog hint 残留引用）

- [ ] **Step 5: 提交**

```bash
git add packages/views/modals/create-issue.tsx packages/views/modals/create-issue-dialog.tsx packages/views/modals/create-issue.test.tsx
git commit -m "refactor(views): remove dead StatusPicker and backlog-agent hint from create-issue"
```

---

## Final Verification

- [ ] **全量检查** — `make check`（typecheck + TS 单测 + Go 测试 + E2E）。Go 数据库测试走 `make test`（不是裸 `go test`）。
- [ ] **手测路径**（可选）：起 `make dev`，创建任务 → 选数智人 → 点「立即运行」→ 任务应为「进行中」且数智人开跑；选工作流/小队时弹运行时策略弹窗；member 直接进行中；无 StatusPicker、无 backlog 提示。

## Self-Review（计划对照 spec）

- **Spec 覆盖**：B1→Task 1；B2(agent)→Task 2+3；B2(squad)→Task 4；F3→Task 5；F1+F2→Task 6。member run-now 走 Task 1 后既有 `AfterIssueAssigned` member 分支（无需新代码，已覆盖）。
- **占位符**：无 TBD；fixture helper（builtin/squad）显式指向既有测试镜像，非新造占位。
- **类型一致**：`resolveCreateStatus`、`chooseRuntimeByPolicy`、`resolveIssueRuntime`、`EnqueueTaskForSquadLeader` 变参在各 Task 中签名一致；前端 `manualDialogContentClass` 单参在 create-issue.tsx 与 create-issue-dialog.tsx 一致。
- **已知小瑕疵**：复用工作流弹窗对 agent/squad 的标题文案「启动工作流」略不符（行为正确，文案泛化后续）。
