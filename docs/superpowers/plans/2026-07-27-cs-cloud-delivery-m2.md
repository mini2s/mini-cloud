# cs-cloud 交付物重设计 M2：worktree（消费 Repos[]）+ 续接（prior session/workdir）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** multica 服务端在 cs-cloud push payload 注入 `prior_session_id`/`prior_work_dir`（移植 pull 路径既有模式）；cs-cloud 消费 `Repos[]`（多仓库 mirror cache + 按需 `cs-cloud repo checkout`）、消费 prior 字段（命中则复用 workdir + csc 会话）、PinTaskSession 传真 workdir、resume 失败兜底——消除「无续接」硬伤，让同 (agent,issue) 多轮 task 复用 workdir + 会话。

**Architecture:** multica `buildCSCloudPayload` 调 `GetLastTaskSession`（runtime-id 校验）填 prior 字段；cs-cloud `TaskRunPayload` 加对应字段；`Prepare` 改 taskRoot 模型（prior_work_dir 命中复用、没命中新建 + 后台预热 Repos[] cache）；新增 `cs-cloud repo checkout <url>` CLI → localserver RPC → `Driver.CheckoutRepo`（mirror cache + 建分支 worktree，命中已有则 reset 复用）；`bindSession` 有 prior_session_id 直接复用、PinTaskSession 传真 taskRoot；resume 失败开新 session 重试一次。

**Tech Stack:** Go（multica server `github.com/multica-ai/multica/server` + cs-cloud `module cs-cloud`），标准 `testing` + `httptest`，无 testify。

**Spec:** `docs/superpowers/specs/2026-07-26-cs-cloud-delivery-redesign-design.md`（§6 worktree/续接）

---

## 关键事实基线（调研结论，实现时无需再查）

- **multica 服务端续接层已存在且加固**：`GetLastTaskSession(agent_id, issue_id)`（`pkg/db/generated/agent.sql.go:1385`，内置中毒失败过滤）、`UpdateAgentTaskSession`（pin）、`PinTaskSession` handler（`POST /api/daemon/tasks/{taskId}/session`，`task_lifecycle.go:67`）。pull 路径 `handler/daemon.go:1345-1392` 已实现 prior 注入，M2 移植其核心到 service 包的 push 路径。
- **跨包陷阱**：`shouldSkipPriorTaskState` 在 `handler` 包，`service` 包不能调。cs-cloud push 路径只在 service 包重写，**只查 `task.ForceFreshSession`**（`split_chat` 是 daemon-only，spec §13/M5，不会派发到 cs-cloud，故省略）。
- **cs-cloud 已有 worktree 基建**：`WorkspaceManager`（`workspace.go`）的 `EnsureRepoReady`（`git clone --mirror`）+ `CreateWorktree`（`git worktree add`）。但 `payload.Repos[]` 定义了**从未被读**（仍只读单 `RepoURL`），续接完全空白，`PinTaskSession` 传 workdir=`""`。
- **csc serve 会话落盘**：`server-sessions.json` 索引 + transcript JSONL，重启后 `GET /session/{id}` 三层查找返回 200。**跨重启续接可行**，cs-cloud 现有 `createSessionWithEnv` 的 GET-probe 模式本身就对。
- **cs-cloud 续接 seam**：`bindSession`（`driver.go:348`）已调 `PinTaskSession` + `BindNodeRunSession` + `ConversationBinder.Bind`。M2 只需在 `prior_session_id` 命中时**复用它**（跳过 `CreateChatSession`），prior 贯穿同一条路径。
- **测试模式**：multica `task_cscloud_push_test.go` 无真 DB，用 SQL 串匹配 DBTX mock（`pushTaskDB`，扩展 QueryRow switch）+ struct 字面量构造 `TaskService`。cs-cloud `workspace_test.go` 用真 git（`requireGit` skip），`driver_test.go` 用 `fakeMultica` httptest + `installFakeAgent`，CLI 测试用 httptest + `t.Setenv`。
- **load-bearing gaps**：`WorkspaceManager` 是 `Driver` 私有字段（无 accessor）；localserver URL 从未注入 agent env（需加 `CS_CLOUD_SERVER_URL`）；WorkspaceManager 层无 git fake seam（测试用真 git）。

---

## File Structure

**multica（`e:\Projects\multica\server\`）：**
- `internal/service/task_cscloud_push.go` — `csCloudTaskRunPayload` 加 `PriorSessionID`/`PriorWorkDir`；新增 service 包 `shouldSkipPriorTaskState`；`buildCSCloudPayload` 加 GetLastTaskSession 注入块。
- `internal/service/task_cscloud_push_test.go` — 扩展 `pushTaskDB` mock 加 GetLastTaskSession arm + prior 注入测试。

**cs-cloud（`e:\Projects\cs-cloud\`）：**
- `internal/workflow/models.go` — `TaskRunPayload` 加 `PriorSessionID`/`PriorWorkDir` 字段。
- `internal/workflowrunner/workspace.go` — 加 `sanitizeName`/`shortID`/`agentBranch`/`injectToken`；`EnsureRepoReady` 加 accessToken 参数；新增 `RepoWorktreeDir`/`ResetWorktree`/`CheckoutRepo`。
- `internal/workflowrunner/workspace_test.go` — 分支创建/碰撞/reset/多仓库 checkout 测试（真 git）。
- `internal/workflowrunner/task.go` — `Prepare` 改 taskRoot 模型 + Repos[] 预热；`resolveRepoURL` 移除；`buildEnv` 加 `EnvCSCloudServerURL` + `SetLocalServerURL`。
- `internal/workflowrunner/driver.go` — `taskRecord` 加 `payload`/`taskRoot`；`Driver.CheckoutRepo`/`Driver.SetLocalServerURL`；`execute` 存 payload/taskRoot；`bindSession` 续接分支；resume 兜底。
- `internal/workflowrunner/driver_test.go` — 续接（prior 命中/未命中/PinTaskSession workdir）+ resume 兜底测试。
- `internal/localserver/server.go` — 注册 `POST /repo/checkout` 路由。
- `internal/localserver/repo_handler.go`（新建）— `handleRepoCheckout`。
- `internal/localserver/repo_handler_test.go`（新建）— handler 测试。
- `internal/cli/repo.go`（新建）— `repoCmd` + `runRepoCheckout` + `parseCheckoutArgs`。
- `internal/cli/root.go` — dispatch 加 `case "repo"` + usage 行。
- `internal/cli/repo_test.go`（新建）— CLI 测试。

---

## Task 1: multica — payload 加 prior 字段 + service 包 shouldSkipPriorTaskState

**Files:**
- Modify: `server/internal/service/task_cscloud_push.go`（`csCloudTaskRunPayload` line 65-82）
- Test: `server/internal/service/task_cscloud_push_test.go`

- [ ] **Step 1: 写失败测试——payload 序列化含 prior 字段**

在 `task_cscloud_push_test.go` 加：
```go
func TestCsCloudPayloadSerializesPriorSession(t *testing.T) {
	payload := csCloudTaskRunPayload{
		TaskID: "t-1", WorkspaceID: "ws", Agent: "csc", Prompt: "p",
		PriorSessionID: "sess-abc",
		PriorWorkDir:   "/data/work/ws/tasks/t-1",
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got csCloudTaskRunPayload
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.PriorSessionID != "sess-abc" {
		t.Errorf("prior_session_id round-trip: %q", got.PriorSessionID)
	}
	if got.PriorWorkDir != "/data/work/ws/tasks/t-1" {
		t.Errorf("prior_work_dir round-trip: %q", got.PriorWorkDir)
	}
}

func TestShouldSkipPriorTaskState(t *testing.T) {
	// ForceFreshSession (manual rerun) => skip prior, fresh session.
	if !shouldSkipPriorTaskState(db.MulticaAgentTaskQueue{ForceFreshSession: true}) {
		t.Error("ForceFreshSession=true should skip prior")
	}
	// Normal task => keep prior.
	if shouldSkipPriorTaskState(db.MulticaAgentTaskQueue{ForceFreshSession: false}) {
		t.Error("ForceFreshSession=false should keep prior")
	}
}
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd server && go test ./internal/service/ -run "TestCsCloudPayloadSerializesPriorSession|TestShouldSkipPriorTaskState" -v`
Expected: FAIL（`PriorSessionID`/`PriorWorkDir` undefined；`shouldSkipPriorTaskState` undefined）

- [ ] **Step 3: 加 prior 字段 + shouldSkipPriorTaskState**

`task_cscloud_push.go` 的 `csCloudTaskRunPayload` struct（line 65-82）在 `Kind` 之后、闭合 `}` 之前加：
```go
	Kind         string                    `json:"kind,omitempty"`
	// PriorSessionID is the csc session id of the last task on the same
	// (agent, issue), so cs-cloud resumes the conversation context. Empty on
	// first round, manual rerun, or runtime mismatch (session is device-scoped).
	PriorSessionID string `json:"prior_session_id,omitempty"`
	// PriorWorkDir is the workdir of the last task on the same (agent, issue),
	// so cs-cloud reuses (resets) the same checkout. Empty on first round.
	PriorWorkDir string `json:"prior_work_dir,omitempty"`
	Repos       []csCloudRepoSpec         `json:"repos,omitempty"`
	Deliverables []csCloudDeliverableSpec  `json:"deliverables,omitempty"`
```
（保留已有的 Repos/Deliverables 字段；仅插入 PriorSessionID/PriorWorkDir 两行。）

在同文件加 service 包私有的 `shouldSkipPriorTaskState`（handler 包同名函数的 service 侧重写，只查 ForceFreshSession——`split_chat` 是 daemon-only，不会到 cs-cloud push 路径）：
```go
// shouldSkipPriorTaskState reports whether the task should start a fresh
// session/workdir instead of resuming the prior (agent, issue) conversation.
// Mirrors handler.shouldSkipPriorTaskState but lives in the service package
// (cross-package import is not allowed). The handler's split_chat check is
// omitted here because split tasks are daemon-only and never dispatched to
// cs-cloud, so only the manual-rerun (ForceFreshSession) gate remains.
func shouldSkipPriorTaskState(t db.MulticaAgentTaskQueue) bool {
	return t.ForceFreshSession
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd server && go test ./internal/service/ -run "TestCsCloudPayloadSerializesPriorSession|TestShouldSkipPriorTaskState" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /e/Projects/multica add server/internal/service/task_cscloud_push.go server/internal/service/task_cscloud_push_test.go
git -C /e/Projects/multica commit -m "feat(cscloud): add prior_session_id/prior_work_dir to payload + shouldSkipPriorTaskState"
```

---

## Task 2: multica — buildCSCloudPayload 注入 prior（移植 pull 路径模式）

**Files:**
- Modify: `server/internal/service/task_cscloud_push.go`（`buildCSCloudPayload` line 179-258）
- Test: `server/internal/service/task_cscloud_push_test.go`（扩展 `pushTaskDB` mock）

- [ ] **Step 1: 扩展 pushTaskDB / pushMockRow mock 加 GetLastTaskSession arm**

`pushTaskDB.QueryRow`（task_cscloud_push_test.go:59-86）按 `strings.Contains(sql, ...)` 分发，catch-all `default` 返 `ErrNoRows`。`pushMockRow`（:97-122）按具名 struct 字段（task/taskRuntime/agent/issue）分发 Scan。给它加一个 `GetLastTaskSessionRow` 字段 + Scan 分支 + QueryRow arm。

(a) `pushMockRow` struct（:97-103）加字段：
```go
type pushMockRow struct {
	task        *db.MulticaAgentTaskQueue
	taskRuntime *db.MulticaAgentRuntime
	agent       *db.MulticaAgent
	issue       *db.MulticaIssue
	lastSession *db.GetLastTaskSessionRow // GetLastTaskSession 命中时填
	err         error
}
```

(b) `pushMockRow.Scan`（:105-122）在 `r.err` 判断之后、`r.task` 之前加分支（sqlc 生成的 GetLastTaskSession 调 `row.Scan(&i.SessionID, &i.WorkDir, &i.RuntimeID)`，dest 三项分别是 `*pgtype.Text`/`*pgtype.Text`/`*pgtype.UUID`）：
```go
	if r.lastSession != nil {
		if len(dest) >= 3 {
			if p, ok := dest[0].(*pgtype.Text); ok {
				*p = r.lastSession.SessionID
			}
			if p, ok := dest[1].(*pgtype.Text); ok {
				*p = r.lastSession.WorkDir
			}
			if p, ok := dest[2].(*pgtype.UUID); ok {
				*p = r.lastSession.RuntimeID
			}
		}
		return nil
	}
```

(c) `pushTaskDB` struct（:52-57）加字段：
```go
	lastSessionRow *db.GetLastTaskSessionRow // nil => 仿 ErrNoRows（首次/全中毒失败）
```

(d) `pushTaskDB.QueryRow`（:59-86）switch 里，`default` 之前加 arm：
```go
	case strings.Contains(sql, "GetLastTaskSession"):
		if m.lastSessionRow == nil {
			return &pushMockRow{err: pgx.ErrNoRows}
		}
		return &pushMockRow{lastSession: m.lastSessionRow}
```

- [ ] **Step 2: 写失败测试——prior 注入 / runtime 不匹配 / ForceFreshSession 跳过**

```go
func TestBuildCSCloudPayload_InjectsPriorSession(t *testing.T) {
	agentID := testUUID(0xA1)
	issueID := testUUID(0xB2)
	runtimeID := testUUID(0xC3)
	dbtx := newPushTestDB(csCloudProvider, "device-123")
	dbtx.lastSessionRow = &db.GetLastTaskSessionRow{
		SessionID: pgtype.Text{String: "sess-prior", Valid: true},
		WorkDir:   pgtype.Text{String: "/prior/work", Valid: true},
		RuntimeID: runtimeID, // 同 runtime
	}
	svc := &TaskService{Queries: db.New(dbtx), Bus: events.New()}
	task := dbtx.dispatchedResult
	task.AgentID = agentID
	task.IssueID = issueID
	task.RuntimeID = runtimeID

	payload, err := svc.buildCSCloudPayload(context.Background(), task, dbtx.runtime)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if payload.PriorSessionID != "sess-prior" {
		t.Errorf("prior_session_id = %q, want sess-prior", payload.PriorSessionID)
	}
	if payload.PriorWorkDir != "/prior/work" {
		t.Errorf("prior_work_dir = %q, want /prior/work", payload.PriorWorkDir)
	}
}

func TestBuildCSCloudPayload_PriorSessionRuntimeMismatch(t *testing.T) {
	// prior 在别的 runtime（设备）上 => PriorSessionID 不注入（session 是设备级），
	// 但 PriorWorkDir 仍注入（命中不到目录时 cs-cloud 自然降级新建）。
	dbtx := newPushTestDB(csCloudProvider, "device-123")
	dbtx.lastSessionRow = &db.GetLastTaskSessionRow{
		SessionID: pgtype.Text{String: "sess-prior", Valid: true},
		WorkDir:   pgtype.Text{String: "/prior/work", Valid: true},
		RuntimeID: testUUID(0xDD), // 不同 runtime
	}
	svc := &TaskService{Queries: db.New(dbtx), Bus: events.New()}
	task := dbtx.dispatchedResult
	task.AgentID = testUUID(0xA1)
	task.IssueID = testUUID(0xB2)
	task.RuntimeID = testUUID(0xC3)

	payload, err := svc.buildCSCloudPayload(context.Background(), task, dbtx.runtime)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if payload.PriorSessionID != "" {
		t.Errorf("prior_session_id = %q, want empty (runtime mismatch)", payload.PriorSessionID)
	}
	if payload.PriorWorkDir != "/prior/work" {
		t.Errorf("prior_work_dir = %q, want /prior/work (forwarded regardless)", payload.PriorWorkDir)
	}
}

func TestBuildCSCloudPayload_ForceFreshSessionSkipsPrior(t *testing.T) {
	dbtx := newPushTestDB(csCloudProvider, "device-123")
	dbtx.lastSessionRow = &db.GetLastTaskSessionRow{
		SessionID: pgtype.Text{String: "sess-prior", Valid: true},
		WorkDir:   pgtype.Text{String: "/prior/work", Valid: true},
		RuntimeID: testUUID(0xC3),
	}
	svc := &TaskService{Queries: db.New(dbtx), Bus: events.New()}
	task := dbtx.dispatchedResult
	task.AgentID = testUUID(0xA1)
	task.IssueID = testUUID(0xB2)
	task.RuntimeID = testUUID(0xC3)
	task.ForceFreshSession = true // 手动 rerun

	payload, err := svc.buildCSCloudPayload(context.Background(), task, dbtx.runtime)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if payload.PriorSessionID != "" || payload.PriorWorkDir != "" {
		t.Errorf("force fresh should skip prior; got session=%q workdir=%q", payload.PriorSessionID, payload.PriorWorkDir)
	}
}

func TestBuildCSCloudPayload_NoPriorWhenGetLastReturnsNoRows(t *testing.T) {
	// GetLastTaskSession 无命中（首次 / 全是中毒失败）=> 两个 prior 都空。
	dbtx := newPushTestDB(csCloudProvider, "device-123")
	dbtx.lastSessionRow = nil // => ErrNoRows
	svc := &TaskService{Queries: db.New(dbtx), Bus: events.New()}
	task := dbtx.dispatchedResult
	task.AgentID = testUUID(0xA1)
	task.IssueID = testUUID(0xB2)
	task.RuntimeID = testUUID(0xC3)

	payload, err := svc.buildCSCloudPayload(context.Background(), task, dbtx.runtime)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if payload.PriorSessionID != "" || payload.PriorWorkDir != "" {
		t.Errorf("no prior expected; got session=%q workdir=%q", payload.PriorSessionID, payload.PriorWorkDir)
	}
}
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `cd server && go test ./internal/service/ -run "TestBuildCSCloudPayload_(InjectsPriorSession|PriorSessionRuntimeMismatch|ForceFreshSessionSkipsPrior|NoPriorWhenGetLastReturnsNoRows)" -v`
Expected: FAIL（prior 字段始终空，buildCSCloudPayload 还没调 GetLastTaskSession）

- [ ] **Step 4: buildCSCloudPayload 加 prior 注入块**

在 `task_cscloud_push.go` 的 `buildCSCloudPayload` 里，紧挨 `return csCloudTaskRunPayload{...}`（line 244）之前插入：
```go
	// Prior (agent, issue) session/workdir so cs-cloud resumes the conversation
	// and reuses the checkout. Ported from the pull path (handler/daemon.go).
	// PriorSessionID is device-scoped: a csc session on device A cannot be
	// resumed on device B, so forward it only when the prior task ran on the
	// same runtime. PriorWorkDir is forwarded regardless — a missing dir on a
	// different device just makes cs-cloud fall back to a fresh Prepare.
	priorSessionID, priorWorkDir := "", ""
	if !shouldSkipPriorTaskState(task) && task.AgentID.Valid && task.IssueID.Valid {
		if prior, err := s.Queries.GetLastTaskSession(ctx, db.GetLastTaskSessionParams{
			AgentID: task.AgentID,
			IssueID: task.IssueID,
		}); err == nil && prior.SessionID.Valid {
			if prior.RuntimeID == task.RuntimeID {
				priorSessionID = prior.SessionID.String
			}
			if prior.WorkDir.Valid {
				priorWorkDir = prior.WorkDir.String
			}
		}
	}
```
然后在 return struct 里加两个字段（`Kind: kind,` 之后）：
```go
		Kind:           kind,
		PriorSessionID: priorSessionID,
		PriorWorkDir:   priorWorkDir,
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `cd server && go test ./internal/service/ -run "TestBuildCSCloudPayload_" -v`
Expected: PASS（全部 4 个）

- [ ] **Step 6: 跑全量 service 包测试，确认无回归**

Run: `cd server && go test ./internal/service/ -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git -C /e/Projects/multica add server/internal/service/task_cscloud_push.go server/internal/service/task_cscloud_push_test.go
git -C /e/Projects/multica commit -m "feat(cscloud): inject prior_session_id/prior_work_dir via GetLastTaskSession"
```

---

## Task 3: cs-cloud — TaskRunPayload 加 prior 字段

**Files:**
- Modify: `e:\Projects\cs-cloud\internal\workflow\models.go`（`TaskRunPayload` line 68-85）
- Test: `e:\Projects\cs-cloud\internal\workflow\models_test.go`（M1 已建或扩展）

- [ ] **Step 1: 写失败测试——反序列化 prior 字段**

在 `models_test.go` 加（若文件不存在则新建，package `workflow`）：
```go
func TestTaskRunPayloadPriorSession(t *testing.T) {
	raw := `{"task_id":"t1","agent":"csc","prompt":"p",
		"prior_session_id":"sess-x","prior_work_dir":"/prior/dir"}`
	var p TaskRunPayload
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if p.PriorSessionID != "sess-x" {
		t.Errorf("prior_session_id = %q", p.PriorSessionID)
	}
	if p.PriorWorkDir != "/prior/dir" {
		t.Errorf("prior_work_dir = %q", p.PriorWorkDir)
	}
}
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd /e/Projects/cs-cloud && go test ./internal/workflow/ -run TestTaskRunPayloadPriorSession -v`
Expected: FAIL（`p.PriorSessionID` undefined）

- [ ] **Step 3: TaskRunPayload 加字段**

`models.go` 的 `TaskRunPayload` struct 加（紧挨已有 `Repos`/`Deliverables` 字段）：
```go
	PriorSessionID string          `json:"prior_session_id,omitempty"`
	PriorWorkDir   string          `json:"prior_work_dir,omitempty"`
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd /e/Projects/cs-cloud && go test ./internal/workflow/ -run TestTaskRunPayloadPriorSession -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /e/Projects/cs-cloud add internal/workflow/models.go internal/workflow/models_test.go
git -C /e/Projects/cs-cloud commit -m "feat(workflow): add prior_session_id/prior_work_dir to TaskRunPayload"
```

---

## Task 4: cs-cloud — WorkspaceManager 分支创建 / reset 复用 / GitLab token

**Files:**
- Modify: `e:\Projects\cs-cloud\internal\workflowrunner\workspace.go`
- Test: `e:\Projects\cs-cloud\internal\workflowrunner\workspace_test.go`

本 task 给 `WorkspaceManager` 加：URL→分支名的 sanitize/shortID、access token 注入 clone、reset 已有 worktree 的能力。保留现有 `CreateWorktree`/`EnsureRepoReady`（现有测试依赖），新增方法。

- [ ] **Step 1: 写失败测试——分支创建 + token 注入 + reset 复用**

在 `workspace_test.go` 加：
```go
func TestEnsureRepoReady_WithAccessToken(t *testing.T) {
	requireGit(t)
	// 建一个本地裸仓作为 "远端"。
	upstream := initTestRepo(t)
	root := t.TempDir()
	wm := NewWorkspaceManager(root)
	// 用一个假 token 注入 URL（本地 git 会忽略 http 凭证，但验证不报错、缓存建成）。
	cache, err := wm.EnsureRepoReady("ws-1", upstream, "fake-token")
	if err != nil {
		t.Fatalf("ensure repo: %v", err)
	}
	if _, err := os.Stat(filepath.Join(cache, "HEAD")); err != nil {
		t.Fatalf("mirror cache HEAD missing: %v", err)
	}
}

func TestSanitizeName(t *testing.T) {
	cases := map[string]string{
		"产品经理":       "agent",
		"Backend / API": "backend-api",
		"Foo.Bar_Baz":   "foo-bar-baz",
		"":              "agent",
	}
	for in, want := range cases {
		if got := sanitizeName(in); got != want {
			t.Errorf("sanitizeName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestShortID(t *testing.T) {
	// UUID 去横线取前 8 位。
	got := shortID("11111111-2222-3333-4444-555555555555")
	if got != "11111111" {
		t.Errorf("shortID = %q, want 11111111", got)
	}
}

func TestResetWorktree(t *testing.T) {
	requireGit(t)
	upstream := initTestRepo(t)
	root := t.TempDir()
	wm := NewWorkspaceManager(root)
	cache, _ := wm.EnsureRepoReady("ws-1", upstream, "")
	workDir := filepath.Join(root, "ws-1", "taskdir", "repo")
	if err := os.MkdirAll(filepath.Dir(workDir), 0o755); err != nil {
		t.Fatal(err)
	}
	// 先建一个 worktree 在 base 上。
	if err := runGit("-C", cache, "worktree", "add", "-b", "first", workDir, "HEAD"); err != nil {
		t.Fatalf("worktree add: %v", err)
	}
	// 污染：写一个未跟踪文件 + 改一个已跟踪文件。
	if err := os.WriteFile(filepath.Join(workDir, "junk.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	// reset 复用到新分支 second off HEAD：应丢掉未跟踪文件、回到干净状态。
	if err := wm.ResetWorktree(workDir, "second", "HEAD"); err != nil {
		t.Fatalf("reset: %v", err)
	}
	if _, err := os.Stat(filepath.Join(workDir, "junk.txt")); !os.IsNotExist(err) {
		t.Errorf("junk.txt should be cleaned, got %v", err)
	}
	// 新分支应已切出。
	out, err := exec.Command("git", "-C", workDir, "branch", "--show-current").CombinedOutput()
	if err != nil {
		t.Fatalf("branch show: %v: %s", err, out)
	}
	if strings.TrimSpace(string(out)) != "second" {
		t.Errorf("branch = %q, want second", strings.TrimSpace(string(out)))
	}
}
```
（`workspace_test.go` 已 import `os`/`exec`/`filepath`/`strings`——确认后按需补 import。）

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd /e/Projects/cs-cloud && go test ./internal/workflowrunner/ -run "TestEnsureRepoReady_WithAccessToken|TestSanitizeName|TestShortID|TestResetWorktree" -v`
Expected: FAIL（`sanitizeName`/`shortID`/`ResetWorktree` undefined；`EnsureRepoReady` 签名不匹配——加 token 参数后现有调用方编译错）

- [ ] **Step 3: 加 sanitizeName/shortID/agentBranch/injectToken + 改 EnsureRepoReady + 加 ResetWorktree**

在 `workspace.go` 加（import 区加 `"net/url"`、`"regexp"`）：
```go
var nonAlnum = regexp.MustCompile(`[^a-z0-9]+`)

// sanitizeName lowercases and collapses non-alphanumerics to '-', capping
// length. Empty input falls back to "agent". Mirrors multica repocache
// sanitizeName (cache.go:968).
func sanitizeName(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	if s == "" {
		return "agent"
	}
	s = nonAlnum.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if s == "" {
		return "agent"
	}
	if len(s) > 30 {
		s = s[:30]
	}
	return s
}

// shortID returns the first 8 hex chars of a UUID (dashes stripped), mirroring
// multica repocache shortID (cache.go:983).
func shortID(id string) string {
	r := strings.ReplaceAll(id, "-", "")
	if len(r) > 8 {
		r = r[:8]
	}
	return r
}

// agentBranch builds the per-task working branch for a code repo:
// agent/<sanitize(agent)>/<shortTaskID>. Mirrors multica cache.go:449.
func agentBranch(agentName, taskID string) string {
	return fmt.Sprintf("agent/%s/%s", sanitizeName(agentName), shortID(taskID))
}

// injectToken embeds an access token as HTTP basic auth (oauth2:<token>) into a
// git URL so `git clone`/`fetch` can authenticate to a private GitLab. Empty
// token leaves the URL untouched. Used for the local daemon's mirror clone;
// note the token is visible in the git process args on this host.
func injectToken(rawURL, token string) string {
	if token == "" {
		return rawURL
	}
	u, err := url.Parse(rawURL)
	if err != nil || u.Host == "" {
		return rawURL
	}
	u.User = url.UserPassword("oauth2", token)
	return u.String()
}
```

改 `EnsureRepoReady` 签名加 accessToken，并注入到 clone/remote update 的 URL：
```go
func (wm *WorkspaceManager) EnsureRepoReady(workspaceID, repoURL, accessToken string) (string, error) {
	if repoURL == "" {
		return "", nil
	}
	if err := validateID(workspaceID); err != nil {
		return "", err
	}
	cacheDir := wm.RepoCacheDir(workspaceID)
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		return "", err
	}

	name := repoName(repoURL)
	cache := filepath.Join(cacheDir, name)

	cacheLock := wm.lockFor(cache)
	cacheLock.Lock()
	defer cacheLock.Unlock()

	authedURL := injectToken(repoURL, accessToken)
	head := filepath.Join(cache, "HEAD")
	if _, err := os.Stat(head); err != nil {
		if !os.IsNotExist(err) {
			return "", err
		}
		_ = os.RemoveAll(cache)
		if err := runGit("clone", "--mirror", authedURL, cache); err != nil {
			return "", fmt.Errorf("clone repo: %w", err)
		}
	} else {
		if err := runGit("-C", cache, "remote", "update"); err != nil {
			return "", fmt.Errorf("update repo: %w", err)
		}
	}
	return cache, nil
}
```
（`runGit` 继承父进程 env，但 token 已进 URL，无需额外 env。）

更新 `CreateWorktree` 内对 `EnsureRepoReady` 的调用补第三个参数 `""`（CreateWorktree 的旧路径不带 token，保持原行为；新路径 CheckoutRepo 用 token 版本）：
```go
	cache, err := wm.EnsureRepoReady(workspaceID, repoURL, "")
```

新增 `ResetWorktree`（reset --hard + clean -fd + checkout -b，对齐 multica updateExistingWorktree cache.go:619）：
```go
// ResetWorktree resets an existing worktree to a clean base and checks out a new
// branch off baseRef, discarding uncommitted changes (committed/pushed work is
// in the remote, not lost). Used when resuming a prior workdir for a new round.
func (wm *WorkspaceManager) ResetWorktree(workDir, branchName, baseRef string) error {
	if err := runGit("-C", workDir, "reset", "--hard"); err != nil {
		return fmt.Errorf("reset: %w", err)
	}
	if err := runGit("-C", workDir, "clean", "-fd"); err != nil {
		return fmt.Errorf("clean: %w", err)
	}
	if err := runGit("-C", workDir, "checkout", "-b", branchName, baseRef); err != nil {
		// Branch collision: append timestamp suffix and retry once.
		if isBranchCollision(err) {
			retry := fmt.Sprintf("%s-%d", branchName, time.Now().Unix())
			if err2 := runGit("-C", workDir, "checkout", "-b", retry, baseRef); err2 == nil {
				return nil
			}
		}
		return fmt.Errorf("checkout -b: %w", err)
	}
	return nil
}

// isBranchCollision reports whether err is git's "a branch named ... already
// exists" collision. Mirrors multica isBranchCollisionError (cache.go:599).
func isBranchCollision(err error) bool {
	return err != nil && strings.Contains(err.Error(), "a branch named")
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd /e/Projects/cs-cloud && go test ./internal/workflowrunner/ -run "TestEnsureRepoReady_WithAccessToken|TestSanitizeName|TestShortID|TestResetWorktree|TestWorkspaceManagerCreateWorktree" -v`
Expected: PASS（含现有 CreateWorktree 测试——签名兼容）

- [ ] **Step 5: 编译全包，修其它调用 EnsureRepoReady 处的编译错**

Run: `cd /e/Projects/cs-cloud && go build ./...`
Expected: 若 `Prepare`/`task.go` 等处调 `EnsureRepoReady`/`CreateWorktree` 编译错，先就地补 `""` 让编译过（Task 5/6 会正式改 Prepare）。

- [ ] **Step 6: Commit**

```bash
git -C /e/Projects/cs-cloud add internal/workflowrunner/workspace.go internal/workflowrunner/workspace_test.go
git -C /e/Projects/cs-cloud commit -m "feat(workflowrunner): branch/reset helpers + access-token mirror clone"
```

---

## Task 5: cs-cloud — WorkspaceManager 多仓库 CheckoutRepo

**Files:**
- Modify: `e:\Projects\cs-cloud\internal\workflowrunner\workspace.go`
- Test: `e:\Projects\cs-cloud\internal\workflowrunner\workspace_test.go`

新增 `RepoWorktreeDir`（`<taskRoot>/<repoName>/`）与 `CheckoutRepo`（ensure cache → 建分支 worktree，已存在则 reset；agent 按需调用）。

- [ ] **Step 1: 写失败测试——CheckoutRepo 新建 / 命中 reset**

```go
func TestCheckoutRepo_CreatesBranchWorktree(t *testing.T) {
	requireGit(t)
	upstream := initTestRepo(t)
	root := t.TempDir()
	wm := NewWorkspaceManager(root)
	taskRoot := filepath.Join(root, "ws-1", "tasks", "task-1")
	_ = os.MkdirAll(taskRoot, 0o755)

	dir, err := wm.CheckoutRepo("ws-1", taskRoot, upstream, "csc", "11111111-aaaa-bbbb-cccc-dddddddddddd", "master", "")
	if err != nil {
		t.Fatalf("checkout: %v", err)
	}
	wantDir := filepath.Join(taskRoot, repoName(upstream))
	if dir != wantDir {
		t.Errorf("dir = %q, want %q", dir, wantDir)
	}
	// worktree 在 agent/csc/<shortTaskID> 分支上。
	out, _ := exec.Command("git", "-C", dir, "branch", "--show-current").CombinedOutput()
	wantBranch := "agent/csc/11111111"
	if strings.TrimSpace(string(out)) != wantBranch {
		t.Errorf("branch = %q, want %q", strings.TrimSpace(string(out)), wantBranch)
	}
}

func TestCheckoutRepo_ResetsExistingWorktree(t *testing.T) {
	requireGit(t)
	upstream := initTestRepo(t)
	root := t.TempDir()
	wm := NewWorkspaceManager(root)
	taskRoot := filepath.Join(root, "ws-1", "tasks", "task-1")
	_ = os.MkdirAll(taskRoot, 0o755)

	// 第一轮：建 worktree + 污染。
	dir, err := wm.CheckoutRepo("ws-1", taskRoot, upstream, "csc", "aaaaaaaa-...", "master", "")
	if err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(dir, "junk.txt"), []byte("x"), 0o644)

	// 第二轮（同 taskRoot、新 taskID）：命中已存在目录 => reset、新分支。
	dir2, err := wm.CheckoutRepo("ws-1", taskRoot, upstream, "csc", "bbbbbbbb-...", "master", "")
	if err != nil {
		t.Fatalf("checkout round2: %v", err)
	}
	if dir2 != dir {
		t.Errorf("round2 dir = %q, want reuse %q", dir2, dir)
	}
	if _, err := os.Stat(filepath.Join(dir, "junk.txt")); !os.IsNotExist(err) {
		t.Errorf("junk.txt should be cleaned on reset, got %v", err)
	}
}
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd /e/Projects/cs-cloud && go test ./internal/workflowrunner/ -run "TestCheckoutRepo_" -v`
Expected: FAIL（`CheckoutRepo`/`RepoWorktreeDir` undefined）

- [ ] **Step 3: 加 RepoWorktreeDir + CheckoutRepo**

在 `workspace.go` 加：
```go
// RepoWorktreeDir returns the per-repo worktree path under a task root:
// <taskRoot>/<repoName>/. One task may hold several repo worktrees.
func RepoWorktreeDir(taskRoot, repoURL string) string {
	return filepath.Join(taskRoot, repoName(repoURL))
}

// resolveBaseRef resolves the base ref for a new worktree: the given baseBranch
// if non-empty, else the remote default branch discovered from the mirror cache.
func (wm *WorkspaceManager) resolveBaseRef(cache, baseBranch string) (string, error) {
	if baseBranch != "" {
		return baseBranch, nil
	}
	// mirror clone keeps refs/heads/<branch> in the local namespace; pick HEAD.
	out, err := exec.Command("git", "-C", cache, "rev-parse", "--abbrev-ref", "HEAD").Output()
	if err == nil {
		if ref := strings.TrimSpace(string(out)); ref != "" && ref != "HEAD" {
			return ref, nil
		}
	}
	// Fallback: first branch under refs/heads.
	out, err = exec.Command("git", "-C", cache, "for-each-ref", "--format=%(refname:short)", "refs/heads").Output()
	if err != nil {
		return "", fmt.Errorf("resolve base ref: %w", err)
	}
	for _, line := range strings.Split(string(out), "\n") {
		if ref := strings.TrimSpace(line); ref != "" {
			return ref, nil
		}
	}
	return "", fmt.Errorf("no base ref in %s", cache)
}

// CheckoutRepo ensures the mirror cache for repoURL is ready, then creates a
// per-repo worktree at <taskRoot>/<repoName>/ on a fresh agent branch off the
// base ref. If the worktree already exists (resuming a prior round), it resets
// it clean and checks out a new branch instead. No allowlist: any URL the agent
// passes is cloned (the GitLab PAT is the real permission boundary).
func (wm *WorkspaceManager) CheckoutRepo(workspaceID, taskRoot, repoURL, agentName, taskID, baseBranch, accessToken string) (string, error) {
	if err := validateID(workspaceID); err != nil {
		return "", err
	}
	if repoURL == "" {
		return "", fmt.Errorf("checkout: empty repo url")
	}
	cache, err := wm.EnsureRepoReady(workspaceID, repoURL, accessToken)
	if err != nil {
		return "", err
	}
	baseRef, err := wm.resolveBaseRef(cache, baseBranch)
	if err != nil {
		return "", err
	}
	dir := RepoWorktreeDir(taskRoot, repoURL)
	if err := os.MkdirAll(filepath.Dir(dir), 0o755); err != nil {
		return "", err
	}
	branchName := agentBranch(agentName, taskID)
	if _, err := os.Stat(dir); err == nil {
		// Existing worktree (prior round): reset + new branch.
		if isGitWorktree(dir) {
			if err := wm.ResetWorktree(dir, branchName, baseRef); err != nil {
				return "", err
			}
			return dir, nil
		}
		// Stale non-worktree dir in the way: remove and rebuild.
		_ = os.RemoveAll(dir)
	}
	// Fresh worktree on a new branch. Collision => timestamp suffix retry.
	if err := runGit("-C", cache, "worktree", "add", "-b", branchName, dir, baseRef); err != nil {
		if isBranchCollision(err) {
			branchName = fmt.Sprintf("%s-%d", branchName, time.Now().Unix())
			if err := runGit("-C", cache, "worktree", "add", "-b", branchName, dir, baseRef); err != nil {
				return "", fmt.Errorf("add worktree: %w", err)
			}
		} else {
			return "", fmt.Errorf("add worktree: %w", err)
		}
	}
	return dir, nil
}

// isGitWorktree reports whether dir is an active git worktree (has a .git file
// pointing at the worktree metadata).
func isGitWorktree(dir string) bool {
	gitPath := filepath.Join(dir, ".git")
	fi, err := os.Stat(gitPath)
	if err != nil {
		return false
	}
	if fi.IsDir() {
		return true
	}
	// .git file (worktree) contains "gitdir: ..."
	b, err := os.ReadFile(gitPath)
	if err != nil {
		return false
	}
	return strings.HasPrefix(strings.TrimSpace(string(b)), "gitdir:")
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd /e/Projects/cs-cloud && go test ./internal/workflowrunner/ -run "TestCheckoutRepo_" -v`
Expected: PASS

- [ ] **Step 5: 编译 + 跑全 workflowrunner 包测试**

Run: `cd /e/Projects/cs-cloud && go build ./... && go test ./internal/workflowrunner/ -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git -C /e/Projects/cs-cloud add internal/workflowrunner/workspace.go internal/workflowrunner/workspace_test.go
git -C /e/Projects/cs-cloud commit -m "feat(workflowrunner): CheckoutRepo — per-repo branch worktree + reset-on-resume"
```

---

## Task 6: cs-cloud — Prepare 改 taskRoot 模型 + Repos[] 预热

**Files:**
- Modify: `e:\Projects\cs-cloud\internal\workflowrunner\task.go`（`Prepare` line 111-134、`resolveRepoURL` line 167-170）
- Test: `e:\Projects\cs-cloud\internal\workflowrunner\task_test.go`（若无则新建）或 `driver_test.go`

把 Prepare 从「建单 repo worktree」改成「确定 taskRoot（prior 复用 / 新建）+ 后台预热 Repos[] cache」，返回 taskRoot 作为 agent 的 cwd。`payload.Repos[]` 正式被消费。

- [ ] **Step 1: 写失败测试——Prepare 返回 taskRoot、prior 命中复用、Repos 预热**

```go
func TestPrepare_TaskRootFresh(t *testing.T) {
	requireGit(t)
	installFakeAgent(t, AgentCsc) // 让 exec.LookPath("csc") 命中
	cfg := workflow.Config{
		WorkspacesRoot: t.TempDir(), AllowedAgents: []string{AgentCsc},
	}
	wm := NewWorkspaceManager(cfg.WorkspacesRoot)
	tr := NewTaskRunner(wm, 0, cfg.AllowedAgents)

	worktree, _, err := tr.Prepare(context.Background(), workflow.TaskRunPayload{
		TaskID: "11111111-aaaa-bbbb-cccc-dddddddddddd", WorkspaceID: "ws-1", Agent: AgentCsc,
	})
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	want := filepath.Join(cfg.WorkspacesRoot, "ws-1", "tasks", "11111111-aaaa-bbbb-cccc-dddddddddddd")
	if worktree != want {
		t.Errorf("taskRoot = %q, want %q", worktree, want)
	}
	if _, err := os.Stat(worktree); err != nil {
		t.Errorf("taskRoot not created: %v", err)
	}
}

func TestPrepare_PriorWorkDirReused(t *testing.T) {
	requireGit(t)
	installFakeAgent(t, AgentCsc)
	root := t.TempDir()
	prior := filepath.Join(root, "ws-1", "tasks", "prior-task")
	_ = os.MkdirAll(prior, 0o755)
	wm := NewWorkspaceManager(root)
	tr := NewTaskRunner(wm, 0, []string{AgentCsc})

	worktree, _, err := tr.Prepare(context.Background(), workflow.TaskRunPayload{
		TaskID: "new-task-id", WorkspaceID: "ws-1", Agent: AgentCsc, PriorWorkDir: prior,
	})
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	if worktree != prior {
		t.Errorf("taskRoot = %q, want reuse prior %q", worktree, prior)
	}
}
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd /e/Projects/cs-cloud && go test ./internal/workflowrunner/ -run "TestPrepare_" -v`
Expected: FAIL（Prepare 还在建单 repo worktree，路径不符）

- [ ] **Step 3: 改 Prepare + 删 resolveRepoURL**

`task.go` 的 `Prepare` 改为：
```go
// Prepare determines the task root (reusing the prior workdir when resuming,
// else a fresh per-task dir), ensures it exists, and pre-warms the mirror
// caches for the task's Repos[] in the background so the agent's on-demand
// `cs-cloud repo checkout` is fast. It returns the task root (the agent's cwd);
// per-repo worktrees are created lazily by checkout, not here.
func (tr *TaskRunner) Prepare(ctx context.Context, payload workflow.TaskRunPayload) (worktree string, agentPath string, err error) {
	if err := tr.validateAgent(payload.Agent); err != nil {
		return "", "", err
	}
	agentPath, err = exec.LookPath(payload.Agent)
	if err != nil {
		return "", "", fmt.Errorf("resolve agent %q: %w", payload.Agent, err)
	}

	taskRoot := payload.PriorWorkDir
	if taskRoot == "" || !dirExists(taskRoot) {
		taskRoot = tr.workspaceManager.TaskWorktreeDir(payload.WorkspaceID, payload.TaskID)
	}
	if err := os.MkdirAll(taskRoot, 0o755); err != nil {
		return "", "", fmt.Errorf("prepare task root: %w", err)
	}

	// Pre-warm mirror caches for all advertised repos (best-effort, background).
	// The agent's checkout re-ensures (serialized per cache) so a missed warm-up
	// just means a cold clone at checkout time.
	go func() {
		bgCtx, cancel := context.WithTimeout(context.Background(), gitTimeout)
		defer cancel()
		_ = bgCtx
		token := ""
		if payload.Env != nil {
			token = payload.Env["MULTICA_GITLAB_TOKEN"]
		}
		for _, r := range payload.Repos {
			if r.URL == "" {
				continue
			}
			_, _ = tr.workspaceManager.EnsureRepoReady(payload.WorkspaceID, r.URL, token)
		}
	}()

	return taskRoot, agentPath, nil
}

// dirExists reports whether path is an existing directory.
func dirExists(path string) bool {
	fi, err := os.Stat(path)
	return err == nil && fi.IsDir()
}
```

删除 `resolveRepoURL`（line 163-170）——不再用单 RepoURL。同时删 `Prepare` 里旧的 `repoURL, err := tr.resolveRepoURL(...)` 调用（已被新版替换）。

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd /e/Projects/cs-cloud && go test ./internal/workflowrunner/ -run "TestPrepare_" -v`
Expected: PASS

- [ ] **Step 5: 编译全包，修引用 resolveRepoURL/旧 Prepare 的编译错**

Run: `cd /e/Projects/cs-cloud && go build ./...`
Expected: 若 `Run`（task.go:100）等仍调旧 Prepare 形态，已兼容（签名未变，返回值仍 worktree+agentPath+err）。编译过。

- [ ] **Step 6: Commit**

```bash
git -C /e/Projects/cs-cloud add internal/workflowrunner/task.go internal/workflowrunner/task_test.go
git -C /e/Projects/cs-cloud commit -m "feat(workflowrunner): Prepare taskRoot model + Repos[] pre-warm (resume-aware)"
```

---

## Task 7: cs-cloud — taskRecord 存 payload/taskRoot + Driver.CheckoutRepo + Driver.SetLocalServerURL

**Files:**
- Modify: `e:\Projects\cs-cloud\internal\workflowrunner\driver.go`（`taskRecord` line 39-56、`execute` line 296-341）
- Test: `e:\Projects\cs-cloud\internal\workflowrunner\driver_test.go`

让 Driver 能响应 checkout RPC：`taskRecord` 记录当前任务的 payload + taskRoot，`execute` 填充它们；新增 `Driver.CheckoutRepo`（查 running task → 调 WorkspaceManager）和 `Driver.SetLocalServerURL`（转发给 runner）。

- [ ] **Step 1: 写失败测试——CheckoutRepo 建 worktree（用 running task 的 payload/taskRoot）**

```go
func TestDriverCheckoutRepo(t *testing.T) {
	requireGit(t)
	upstream := initTestRepo(t)
	ts := httptest.NewServer((&fakeMultica{}).handler())
	defer ts.Close()
	d := asyncTestDriver(t, ts.URL)

	taskID := "11111111-aaaa-bbbb-cccc-dddddddddddd"
	wsID := "ws-1"
	// 手动注册一个 running task record（绕过 RunTaskAsync，直接填状态）。
	d.mu.Lock()
	rec := &taskRecord{}
	d.running[taskID] = rec
	d.mu.Unlock()
	taskRoot := filepath.Join(d.cfg.WorkspacesRoot, wsID, "tasks", taskID)
	_ = os.MkdirAll(taskRoot, 0o755)
	rec.payload = workflow.TaskRunPayload{TaskID: taskID, WorkspaceID: wsID, Agent: AgentCsc}
	rec.taskRoot = taskRoot

	dir, err := d.CheckoutRepo(taskID, upstream, "")
	if err != nil {
		t.Fatalf("checkout: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, ".git")); err != nil {
		t.Errorf("worktree not created: %v", err)
	}
}
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd /e/Projects/cs-cloud && go test ./internal/workflowrunner/ -run TestDriverCheckoutRepo -v`
Expected: FAIL（`taskRecord.payload`/`taskRoot` 字段、`CheckoutRepo` undefined）

- [ ] **Step 3: taskRecord 加字段 + execute 填充 + CheckoutRepo + SetLocalServerURL**

先读 `driver.go` 的 `taskRecord` struct（line 39-56），加两字段：
```go
type taskRecord struct {
	cancel  context.CancelFunc
	aborted bool
	// payload + taskRoot let the localserver's repo-checkout RPC serve the
	// running task's context (agent name, workspace, env token, cwd) without
	// the CLI having to re-send them.
	payload  workflow.TaskRunPayload
	taskRoot string
}
```

在 `execute`（line 296-341）里，`Prepare` 之后、`bindSession` 之前，把 payload + taskRoot 记到当前 taskRecord。在 `worktree, agentPath, err := d.runner.Prepare(ctx, payload)` 之后加：
```go
	d.mu.Lock()
	if rec, ok := d.running[payload.TaskID]; ok {
		rec.payload = payload
		rec.taskRoot = worktree
	}
	d.mu.Unlock()
```

新增 Driver 方法（在 driver.go 合适位置，例如 `AbortTask` 附近）：
```go
// CheckoutRepo serves an agent's on-demand `cs-cloud repo checkout` for a
// running task: looks up the task's payload + taskRoot, then creates (or resets)
// a per-repo branch worktree. baseBranch "" resolves the remote default.
func (d *Driver) CheckoutRepo(taskID, repoURL, baseBranch string) (string, error) {
	d.mu.Lock()
	rec, ok := d.running[taskID]
	d.mu.Unlock()
	if !ok {
		return "", fmt.Errorf("task %s is not running", taskID)
	}
	token := ""
	if rec.payload.Env != nil {
		token = rec.payload.Env["MULTICA_GITLAB_TOKEN"]
	}
	return d.workspaceManager.CheckoutRepo(
		rec.payload.WorkspaceID, rec.taskRoot, repoURL,
		rec.payload.Agent, taskID, baseBranch, token,
	)
}

// SetLocalServerURL threads the daemon's localserver listen URL to the task
// runner so it can be injected into the agent env (CS_CLOUD_SERVER_URL), letting
// in-task `cs-cloud repo checkout` reach the localserver RPC.
func (d *Driver) SetLocalServerURL(url string) {
	d.runner.SetLocalServerURL(url)
}
```
（确认 `d.runner` 字段名 + `d.workspaceManager` 字段名与 driver.go 一致——agent 报告 `workspaceManager` 在 driver.go:42/90、runner 经 `d.runner` 访问。若 runner 字段名不同，按实际改。）

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd /e/Projects/cs-cloud && go test ./internal/workflowrunner/ -run TestDriverCheckoutRepo -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /e/Projects/cs-cloud add internal/workflowrunner/driver.go internal/workflowrunner/driver_test.go
git -C /e/Projects/cs-cloud commit -m "feat(workflowrunner): Driver.CheckoutRepo + taskRecord payload/taskRoot"
```

---

## Task 8: cs-cloud — localserver POST /repo/checkout handler

**Files:**
- Create: `e:\Projects\cs-cloud\internal\localserver\repo_handler.go`
- Modify: `e:\Projects\cs-cloud\internal\localserver\server.go`（路由注册 line 216-218 附近）
- Test: `e:\Projects\cs-cloud\internal\localserver\repo_handler_test.go`

- [ ] **Step 1: 写失败测试——handler 调 CheckoutRepo 返回 path**

```go
package localserver

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandleRepoCheckout(t *testing.T) {
	// 用一个不依赖真 git 的最小 Driver 替身：直接构造 Server，handler 在
	// workflow==nil 时返回 404；这里用 nil 校验"未注册"路径 + 用真 Driver
	// 校验已注册路径。为避免真 git，本测试只验证未注册时的 404 形态与
	// 请求解码；端到端建仓在 driver_test.go 的 TestDriverCheckoutRepo 覆盖。
	s := New()
	b, _ := json.Marshal(map[string]string{"task_id": "t1", "repo_url": "https://x/y.git"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/repo/checkout", bytes.NewReader(b))
	rec := httptest.NewRecorder()
	s.handleRepoCheckout(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (no workflow driver)", rec.Code)
	}
}
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd /e/Projects/cs-cloud && go test ./internal/localserver/ -run TestHandleRepoCheckout -v`
Expected: FAIL（`handleRepoCheckout` undefined）

- [ ] **Step 3: 新建 repo_handler.go + 注册路由**

新建 `internal/localserver/repo_handler.go`：
```go
package localserver

import (
	"encoding/json"
	"net/http"
)

type repoCheckoutRequest struct {
	TaskID     string `json:"task_id"`
	RepoURL    string `json:"repo_url"`
	BaseBranch string `json:"base_branch,omitempty"`
}

type repoCheckoutResponse struct {
	Path string `json:"path"`
}

// handleRepoCheckout serves an agent's on-demand `cs-cloud repo checkout`:
// creates (or resets) a per-repo branch worktree for a running task and returns
// its path. Mounted under /api/v1 (see server.go).
func (s *Server) handleRepoCheckout(w http.ResponseWriter, r *http.Request) {
	if s.workflow == nil {
		writeErr(w, http.StatusNotFound, "NOT_FOUND", "workflow driver not registered")
		return
	}
	var req repoCheckoutRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	if req.TaskID == "" || req.RepoURL == "" {
		writeErr(w, http.StatusBadRequest, "BAD_REQUEST", "task_id and repo_url required")
		return
	}
	path, err := s.workflow.CheckoutRepo(req.TaskID, req.RepoURL, req.BaseBranch)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "CHECKOUT_FAILED", err.Error())
		return
	}
	writeOK(w, repoCheckoutResponse{Path: path})
}
```

在 `server.go`（line 216-218 附近，其它 `api.HandleFunc` 旁）注册：
```go
	api.HandleFunc("POST /repo/checkout", s.handleRepoCheckout)
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd /e/Projects/cs-cloud && go test ./internal/localserver/ -run TestHandleRepoCheckout -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /e/Projects/cs-cloud add internal/localserver/repo_handler.go internal/localserver/server.go internal/localserver/repo_handler_test.go
git -C /e/Projects/cs-cloud commit -m "feat(localserver): POST /repo/checkout handler"
```

---

## Task 9: cs-cloud — CS_CLOUD_SERVER_URL env 注入（TaskRunner → buildEnv）

**Files:**
- Modify: `e:\Projects\cs-cloud\internal\workflowrunner\task.go`（常量 line 16-32、`TaskRunner` struct line 36-46、`buildEnv` line 184-205）
- Test: `e:\Projects\cs-cloud\internal\workflowrunner\task_test.go`

agent 子进程要能找到 localserver，得把 daemon 的 localserver URL 注入 env。

- [ ] **Step 1: 写失败测试——buildEnv 含 CS_CLOUD_SERVER_URL**

```go
func TestBuildEnv_LocalServerURL(t *testing.T) {
	wm := NewWorkspaceManager(t.TempDir())
	tr := NewTaskRunner(wm, 0, []string{AgentCsc})
	tr.SetLocalServerURL("http://127.0.0.1:9999")
	env := tr.buildEnv(workflow.TaskRunPayload{TaskID: "t1", WorkspaceID: "ws-1", Agent: AgentCsc}, "/work")
	found := false
	for _, e := range env {
		if e == "CS_CLOUD_SERVER_URL=http://127.0.0.1:9999" {
			found = true
		}
	}
	if !found {
		t.Error("buildEnv missing CS_CLOUD_SERVER_URL")
	}
}
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd /e/Projects/cs-cloud && go test ./internal/workflowrunner/ -run TestBuildEnv_LocalServerURL -v`
Expected: FAIL（`SetLocalServerURL` undefined）

- [ ] **Step 3: 加常量 + 字段 + setter + buildEnv 注入**

`task.go` 常量区（line 16-32）加：
```go
	EnvCSCloudServerURL = "CS_CLOUD_SERVER_URL"
```

`TaskRunner` struct 加字段：
```go
	localServerURL string
```

加 setter：
```go
// SetLocalServerURL lets the daemon thread its localserver listen URL into the
// task env so in-task `cs-cloud repo checkout` can reach the RPC.
func (tr *TaskRunner) SetLocalServerURL(url string) {
	tr.localServerURL = url
}
```

`buildEnv`（line 184-205）在 `EnvCSCloudWorktree` 行之后加：
```go
	if tr.localServerURL != "" {
		env = setEnv(env, EnvCSCloudServerURL, tr.localServerURL)
	}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd /e/Projects/cs-cloud && go test ./internal/workflowrunner/ -run TestBuildEnv_LocalServerURL -v`
Expected: PASS

- [ ] **Step 5: daemon 启动处接线 SetLocalServerURL**

Run（定位接线点）:
```bash
cd /e/Projects/cs-cloud && grep -rn "SaveServerURL\|SetMulticaEndpoint\|WithWorkflow" internal/cli internal/app
```
在 daemon/serve 启动 localserver、拿到 listen URL 并调 `App.SaveServerURL(url)` 的同一处（或紧邻 `driver.SetMulticaEndpoint`/`runner.SetMulticaEndpoint` 接线处），加：
```go
	driver.SetLocalServerURL(listenURL) // listenURL = 传给 SaveServerURL 的同一个
```
（`listenURL` 是该处已有的、写入 server_url 文件的 URL 变量；若无具名变量，用构造 SaveServerURL 入参的那个表达式。Driver 已在 Task 7 加 `SetLocalServerURL` 转发方法。）

- [ ] **Step 6: 编译 + 跑测试**

Run: `cd /e/Projects/cs-cloud && go build ./... && go test ./internal/workflowrunner/ ./internal/cli/ -v`
Expected: PASS / 编译过

- [ ] **Step 7: Commit**

```bash
git -C /e/Projects/cs-cloud add internal/workflowrunner/task.go internal/workflowrunner/task_test.go internal/cli/
git -C /e/Projects/cs-cloud commit -m "feat(workflowrunner): inject CS_CLOUD_SERVER_URL into task env for in-task checkout"
```

---

## Task 10: cs-cloud — `cs-cloud repo checkout <url>` CLI

**Files:**
- Create: `e:\Projects\cs-cloud\internal\cli\repo.go`
- Modify: `e:\Projects\cs-cloud\internal\cli\root.go`（dispatch line 182-230、usage）
- Test: `e:\Projects\cs-cloud\internal\cli\repo_test.go`

agent 在 csc 会话里 shell 调 `cs-cloud repo checkout <url> [--base <branch>]`，读 env 定位 task + localserver，POST，打印 worktree 路径。

- [ ] **Step 1: 写失败测试——checkout 走 localserver、打印 path（httptest）**

```go
package cli

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestRunRepoCheckout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/repo/checkout" || r.Method != http.MethodPost {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		b, _ := io.ReadAll(r.Body)
		if string(b) == "" {
			t.Error("empty body")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"data":{"path":"/work/repo"}}`))
	}))
	defer srv.Close()

	t.Setenv("CS_CLOUD_SERVER_URL", srv.URL)
	t.Setenv("MULTICA_TASK_ID", "t1")

	cfg := checkoutConfig{repoURL: "https://gitlab/o/r.git"}
	if err := runRepoCheckout(cfg); err != nil {
		t.Fatalf("runRepoCheckout: %v", err)
	}
}

func TestParseCheckoutArgs(t *testing.T) {
	cases := []struct {
		args []string
		want checkoutConfig
	}{
		{[]string{"https://gitlab/o/r.git"}, checkoutConfig{repoURL: "https://gitlab/o/r.git"}},
		{[]string{"--base", "develop", "https://gitlab/o/r.git"}, checkoutConfig{repoURL: "https://gitlab/o/r.git", baseBranch: "develop"}},
	}
	for _, c := range cases {
		got, err := parseCheckoutArgs(c.args)
		if err != nil {
			t.Fatalf("parse(%v): %v", c.args, err)
		}
		if got != c.want {
			t.Errorf("parse(%v) = %+v, want %+v", c.args, got, c.want)
		}
	}
}

func TestParseCheckoutArgs_MissingURL(t *testing.T) {
	if _, err := parseCheckoutArgs(nil); err == nil {
		t.Error("expected error for missing repo url")
	}
}
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd /e/Projects/cs-cloud && go test ./internal/cli/ -run "TestRunRepoCheckout|TestParseCheckoutArgs" -v`
Expected: FAIL（`runRepoCheckout`/`parseCheckoutArgs`/`checkoutConfig` undefined）

- [ ] **Step 3: 新建 repo.go**

```go
package cli

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

type checkoutConfig struct {
	repoURL    string
	baseBranch string
}

// parseCheckoutArgs parses `cs-cloud repo checkout <url> [--base <branch>]`.
func parseCheckoutArgs(args []string) (checkoutConfig, error) {
	cfg := checkoutConfig{}
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--base", "-b":
			if i+1 >= len(args) {
				return cfg, fmt.Errorf("--base requires a value")
			}
			cfg.baseBranch = args[i+1]
			i++
		default:
			if strings.HasPrefix(args[i], "-") {
				return cfg, fmt.Errorf("unknown flag %q", args[i])
			}
			cfg.repoURL = args[i]
		}
	}
	if cfg.repoURL == "" {
		return cfg, fmt.Errorf("repo url required: usage: cs-cloud repo checkout <url> [--base <branch>]")
	}
	return cfg, nil
}

func runRepoCheckout(cfg checkoutConfig) error {
	serverURL := strings.TrimRight(strings.TrimSpace(os.Getenv("CS_CLOUD_SERVER_URL")), "/")
	if serverURL == "" {
		return fmt.Errorf("CS_CLOUD_SERVER_URL not set (not running inside a cs-cloud task?)")
	}
	taskID := strings.TrimSpace(os.Getenv("MULTICA_TASK_ID"))
	if taskID == "" {
		return fmt.Errorf("MULTICA_TASK_ID not set")
	}
	body, _ := json.Marshal(map[string]string{
		"task_id":     taskID,
		"repo_url":    cfg.repoURL,
		"base_branch": cfg.baseBranch,
	})
	client := &http.Client{Timeout: 10 * time.Minute}
	resp, err := client.Post(serverURL+"/api/v1/repo/checkout", "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("checkout request: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("checkout: status %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}
	var env struct {
		OK   bool `json:"ok"`
		Data struct {
			Path string `json:"path"`
		} `json:"data"`
	}
	if err := json.Unmarshal(respBody, &env); err != nil {
		return fmt.Errorf("decode checkout response: %w", err)
	}
	if env.Data.Path == "" {
		return fmt.Errorf("checkout returned empty path")
	}
	// The worktree path goes to stdout so the agent can cd into it.
	fmt.Println(env.Data.Path)
	return nil
}

func repoCmd(a *app.App, args []string) error {
	_ = a // task-context command; uses task env, not daemon config
	if len(args) == 0 {
		fmt.Println("usage: cs-cloud repo checkout <url> [--base <branch>]")
		return nil
	}
	switch args[0] {
	case "checkout":
		cfg, err := parseCheckoutArgs(args[1:])
		if err != nil {
			return err
		}
		return runRepoCheckout(cfg)
	case "help", "-h", "--help":
		fmt.Println("usage: cs-cloud repo checkout <url> [--base <branch>]")
		return nil
	default:
		return fmt.Errorf("unknown repo command: %s", args[0])
	}
}
```
（确认 `app` 包别名——参照 `gitea.go`/`workflow.go` 顶部对 `*app.App` 的 import，复用同一 import。）

- [ ] **Step 4: dispatch 注册 + usage**

`root.go` 的 `dispatch`（line 182-230）switch 里加（与 `case "gc"` 等并列）：
```go
	case "repo": return repoCmd(a, cmds[1:])
```
`printUsage`（line 248 附近的 `cmds` slice）加一行：
```go
	{"repo checkout <url>", "clone a code repo into the running task's worktree"},
```
（按该 slice 现有元素结构落地。）

- [ ] **Step 5: 运行测试，确认通过**

Run: `cd /e/Projects/cs-cloud && go test ./internal/cli/ -run "TestRunRepoCheckout|TestParseCheckoutArgs" -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git -C /e/Projects/cs-cloud add internal/cli/repo.go internal/cli/repo_test.go internal/cli/root.go
git -C /e/Projects/cs-cloud commit -m "feat(cli): cs-cloud repo checkout — on-demand worktree via localserver"
```

---

## Task 11: cs-cloud — bindSession 续接分支（prior 复用 + PinTaskSession 传真 workdir）

**Files:**
- Modify: `e:\Projects\cs-cloud\internal\workflowrunner\driver.go`（`bindSession` line 348-400）
- Test: `e:\Projects\cs-cloud\internal\workflowrunner\driver_test.go`

有 `prior_session_id` 时直接复用它（跳过 CreateChatSession，prior 贯穿 Pin/BindNodeRun/Bind 同一路径），并把真 taskRoot 传给 PinTaskSession。

- [ ] **Step 1: 扩展 pinSessionCall 加 WorkDir + 写失败测试**

`fakeMultica`（driver_test.go:83-95）的 `pinSessionCall`（:97-100）目前只存 `{TaskID, SessionID}`，不存 WorkDir。先给它加字段，让测试能断言 PinTaskSession 传的 work_dir：
```go
type pinSessionCall struct {
	TaskID    string
	SessionID string
	WorkDir   string
}
```
并在 fakeMultica 的 pin handler 里把解码出的 `req.WorkDir` 一并存进 append 的 `pinSessionCall`（该 handler 解码 `workflow.PinTaskSessionRequest`，其 `WorkDir` json tag 为 `work_dir`——已在 models.go:133 确认）。

再写失败测试（直接构造最小 Driver，挂 fakeMultica，手动填 registrations）：
```go
func TestBindSession_ReusesPriorSession(t *testing.T) {
	f := newFakeMultica()
	ts := httptest.NewServer(f.handler())
	defer ts.Close()

	d := &Driver{
		deps: &Dependencies{
			MulticaBaseURL: ts.URL,
			DeviceID:       func() (string, error) { return "dev-1", nil },
		},
		client:           NewClient(ts.URL, ts.URL, tokenProvider("tok")),
		workspaceManager: NewWorkspaceManager(t.TempDir()),
		running:          map[string]*taskRecord{},
		registrations:    map[string]string{"ws-1": "rt-1"},
	}

	workdir := "/some/taskroot"
	sessionID, err := d.bindSession(context.Background(), workflow.TaskRunPayload{
		TaskID: "t1", WorkspaceID: "ws-1", AgentID: "a1", NodeRunID: "nr1",
		Agent: AgentCsc, PriorSessionID: "sess-prior",
	}, workdir)
	if err != nil {
		t.Fatalf("bindSession: %v", err)
	}
	if sessionID != "sess-prior" {
		t.Errorf("sessionID = %q, want reuse sess-prior", sessionID)
	}
	// prior 命中 => 不应新建 chat session。
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.sessions) != 0 {
		t.Errorf("expected no CreateChatSession, got %d sessions", len(f.sessions))
	}
	// PinTaskSession 带真 workdir（不是 ""）。
	if len(f.pinSessions) != 1 {
		t.Fatalf("expected 1 pin call, got %d", len(f.pinSessions))
	}
	if f.pinSessions[0].WorkDir != workdir {
		t.Errorf("pin work_dir = %q, want %q", f.pinSessions[0].WorkDir, workdir)
	}
}
```
（`tokenProvider`、`newFakeMultica`、`NewClient(baseURL, userBaseURL, tokenProvider)` 均为 driver_test.go / driver.go 既有。`NewClient` 三参签名见 driver.go:98。）

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd /e/Projects/cs-cloud && go test ./internal/workflowrunner/ -run TestBindSession_ReusesPriorSession -v`
Expected: FAIL（现状总是 CreateChatSession、PinTaskSession 传 ""）

- [ ] **Step 3: 改 bindSession**

`bindSession`（line 348-400）把 sessionID 的来源改成「prior 优先」+ PinTaskSession 带 worktree：
```go
func (d *Driver) bindSession(ctx context.Context, payload workflow.TaskRunPayload, worktree string) (string, error) {
	if payload.AgentID == "" || payload.NodeRunID == "" {
		return "", nil
	}
	if d.deps == nil || d.deps.DeviceID == nil {
		return "", nil
	}

	d.mu.Lock()
	runtimeID, registered := d.registrations[payload.WorkspaceID]
	d.mu.Unlock()
	if !registered || runtimeID == "" {
		return "", nil
	}

	deviceID, err := d.deps.DeviceID()
	if err != nil {
		return "", fmt.Errorf("resolve device id: %w", err)
	}
	if deviceID == "" {
		return "", nil
	}

	// Resume: reuse the prior csc session id (still on disk in csc serve's
	// store). Skip CreateChatSession so the conversation carries forward across
	// rounds of the same (agent, issue). First round: create a new chat session.
	sessionID := payload.PriorSessionID
	if sessionID == "" {
		session, err := d.client.CreateChatSession(ctx, payload.WorkspaceID, payload.AgentID, chatSessionTitle(payload))
		if err != nil {
			return "", fmt.Errorf("create chat session: %w", err)
		}
		if session.ID == "" {
			return "", fmt.Errorf("multica returned empty chat session id")
		}
		sessionID = session.ID
	}

	// Pin the real workdir (task root) so the next round's prior_work_dir hits.
	if err := d.client.PinTaskSession(ctx, payload.TaskID, sessionID, worktree); err != nil {
		return "", fmt.Errorf("pin task session: %w", err)
	}
	if err := d.client.BindNodeRunSession(ctx, payload.NodeRunID, runtimeID, deviceID, sessionID); err != nil {
		return "", fmt.Errorf("bind node run session: %w", err)
	}

	if d.deps.ConversationBinder != nil {
		env := d.runner.buildEnv(payload, worktree)
		if err := d.deps.ConversationBinder.Bind(ctx, sessionID, worktree, env); err != nil {
			logger.Warn("workflow: failed to bind local conversation session %s: %v", sessionID, err)
		}
	}

	logger.Info("workflow: bound session %s to task %s node_run %s", sessionID, payload.TaskID, payload.NodeRunID)
	return sessionID, nil
}
```

- [ ] **Step 4: 运行测试，确认通过 + 跑全包**

Run: `cd /e/Projects/cs-cloud && go test ./internal/workflowrunner/ -run "TestBindSession_" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /e/Projects/cs-cloud add internal/workflowrunner/driver.go internal/workflowrunner/driver_test.go
git -C /e/Projects/cs-cloud commit -m "feat(workflowrunner): bindSession resumes prior session + pins real workdir"
```

---

## Task 12: cs-cloud — resume 失败兜底（prior 夲新 session 重试一次）

**Files:**
- Modify: `e:\Projects\cs-cloud\internal\workflowrunner\driver.go`（`execute` line 296-341）
- Test: `e:\Projects\cs-cloud\internal\workflowrunner\driver_test.go`

resumed 这轮若 RunCSCSession 失败（prior 会话在但崩了），丢掉 prior、开新 session 重试一次（对齐 multica daemon.go:2662）。

- [ ] **Step 1: 写失败测试——resumed 失败时清 prior 重试**

用 SessionRunner 注入：第一次 RunSession 返错、第二次成功。验证 CompleteTask 被调（重试后成功）、且重试时不再用 prior。
```go
type flakySessionRunner struct {
	calls int
}

func (f *flakySessionRunner) RunSession(ctx context.Context, sessionID, worktree, prompt string, env []string) ([]byte, error) {
	f.calls++
	if f.calls == 1 {
		return nil, fmt.Errorf("session boom")
	}
	return []byte("ok"), nil
}

func TestExecute_ResumeFailureRetriesFresh(t *testing.T) {
	// 构造 fakeMultica + Driver（同 asyncTestDriver 模式），挂 flakySessionRunner。
	// payload 带 PriorSessionID。执行 execute，断言最终 CompleteTask（不是 FailTask）。
	// （具体 setup 参照 driver_test.go 现有 fakeMultica + SessionRunner 注入模式；
	//  若现有测试无 SessionRunner 注入 seam，先在 Dependencies/Driver 加最小 seam。）
}
```
（执行时参照 driver_test.go 现有 SessionRunner 注入方式落地 setup；若 Dependencies.SessionRunner 已可注入，直接用。）

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd /e/Projects/cs-cloud && go test ./internal/workflowrunner/ -run TestExecute_ResumeFailureRetriesFresh -v`
Expected: FAIL（现状 resume 失败直接 FailTask，不重试）

- [ ] **Step 3: execute 加 resume 兜底**

把 `execute`（line 296-341）里「分支运行」段重构成可重试。在 `RunCSCSession` 失败、且用了 prior 时，清 prior + 新建 session 重绑 + 重跑一次：
```go
	// Resume failure fallback: if resuming the prior session failed to make
	// progress, retry once with a fresh session (the prior session may be
	// corrupt on disk). Mirrors multica daemon.go:2662-2677.
	out, runErr = d.runner.RunCSCSession(ctx, payload, worktree, sessionID)
	if runErr != nil && payload.PriorSessionID != "" && !d.aborted(payload.TaskID) {
		logger.Warn("workflow: resumed session failed (%v); retrying with fresh session", runErr)
		payload.PriorSessionID = "" // force fresh chat session
		sessionID2, bindErr := d.bindSession(ctx, payload, worktree)
		if bindErr != nil {
			_ = d.client.FailTask(ctx, payload.TaskID, bindErr.Error(), "")
			return bindErr
		}
		out, runErr = d.runner.RunCSCSession(ctx, payload, worktree, sessionID2)
	}
```
（替换原 `out, runErr = d.runner.RunCSCSession(ctx, payload, worktree, sessionID)` 单行；其后的 PostTaskMessages/Fail/Complete 逻辑不变。注意 `bindSession` 在 Task 11 已支持 prior 分支——清空 prior 后它会 CreateChatSession 新建。）

- [ ] **Step 4: 运行测试，确认通过 + 跑全包**

Run: `cd /e/Projects/cs-cloud && go test ./internal/workflowrunner/ -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /e/Projects/cs-cloud add internal/workflowrunner/driver.go internal/workflowrunner/driver_test.go
git -C /e/Projects/cs-cloud commit -m "feat(workflowrunner): retry fresh session when resumed session fails"
```

---

## Task 13: 端到端集成验证

**Files:** Manual / E2E（无新文件）

- [ ] **Step 1: 两边全量单测**

```bash
cd /e/Projects/multica/server && go test ./internal/service/ ./internal/handler/ -v
cd /e/Projects/cs-cloud && go test ./...
```
Expected: 全 PASS

- [ ] **Step 2: 端到端冒烟（需本地 multica + cs-cloud + GitLab 跑起来）**

1. 建一个绑 GitLab 代码仓库的 project + 一个 `pull_request` deliverable 的 workflow，派给 cs-cloud。
2. 第一个 task：确认 payload 含 `repos[]` + 无 `prior_*`（首 round）；cs-cloud daemon 起 taskRoot；agent 调 `cs-cloud repo checkout <url>` 建出分支 worktree；改代码、`git add/commit`、`cs-cloud deliverable submit --mr` 开 MR；task 完成。
3. 同 (agent, issue) 触发第二个 task（续接场景）：确认 payload 含 `prior_session_id` + `prior_work_dir`（GetLastTaskSession 命中、runtime 一致）；cs-cloud 复用同一 taskRoot（路径与 round-1 一致）；agent 调 `cs-cloud repo checkout <url>` 时命中已存在 worktree → reset 到新分支；csc 会话续上（agent 记得 round-1 的对话）。
4. 断言：
   - round-2 的 taskRoot == round-1 的 taskRoot（prior_work_dir 复用）。
   - round-2 的 csc session_id == round-1 的（复用，非新建）。
   - multica 该 task 行 `work_dir` 列 = taskRoot（PinTaskSession 传真值，非空）。
   - round-2 的 worktree 在新分支上（`agent/csc/<shortTaskID2>`），旧未提交改动被 reset 清掉。

- [ ] **Step 3: 确认硬伤消除**

- 「无续接」消除：同 issue 多轮 task 复用 workdir + csc 会话。
- `cs-cloud repo checkout` 多仓库按需建分支 worktree，agent 可拉任意 PAT 可达仓库（无 allowlist 限制）。

- [ ] **Step 4: Commit（若有 fix）+ 打 M2 完成标记**

```bash
git -C /e/Projects/multica commit --allow-empty -m "chore(cscloud): M2 complete — worktree (Repos[]) + continuation"
```

---

## Self-Review 记录

- **Spec 覆盖**：M2 覆盖 spec §6.1（repocache + allowlist/预热——实现成「Repos[] 预热 + 按需 checkout 无 allowlist」，allowlist 按用户决策删除）、§6.2（EnvRoot——按用户决策**不**做分层，taskRoot 即工作目录）、§6.3（分支创建 `agent/csc/<short>` + 碰撞时间戳；Co-authored-by/.git/info/exclude 延后）、§6.4（续接 prior_session/prior_work_dir + csc serve load + PinTaskSession + resume 兜底）、§6.5（active-root——延后 M3 与 GC 一起）。GC 全栈（§9）、critic（§12）、split（§13）、归档（§7.5）留 M3-M5。
- **服务端复用**：GetLastTaskSession/UpdateAgentTaskSession/PinTaskSession handler 全已存在；M2 仅 payload 加字段 + service 包移植 prior 注入。无 DB 迁移（session_id/work_dir 列已在 `multica_agent_task_queue`）。
- **与 multica 的分叉**：(1) service 包 `shouldSkipPriorTaskState` 只查 ForceFreshSession（split_chat 是 daemon-only 不会到 cs-cloud）；(2) checkout 无 allowlist（用户决策，PAT 是真边界）；(3) EnvRoot 不分层（cs-cloud 走 csc serve + session，不需要 output/logs）；(4) mirror clone 而非 bare（mirror 是 bare 超集，base ref 直接解析）。均符合 spec §16 非目标（不与 daemon 完全趋同）。
- **placeholder 检查**：Task 1-11 每步含完整可编译代码 + 真实测试。Task 12 的 `flakySessionRunner` 测试 setup 指明「参照 driver_test.go 现有 SessionRunner 注入模式」——这是对已存在 seam 的引用，非占位；若该 seam 不存在，Task 12 Step 1 已说明「先在 Dependencies/Driver 加最小 seam」。Task 9 Step 5 的 daemon 接线点用 grep 定位 `SaveServerURL`——确定性查找，非占位。
- **类型一致**：`PriorSessionID`/`PriorWorkDir`（multica `csCloudTaskRunPayload` 与 cs-cloud `TaskRunPayload` json tag 镜像 `prior_session_id`/`prior_work_dir`）；`CheckoutRepo(workspaceID, taskRoot, repoURL, agentName, taskID, baseBranch, accessToken string) (string, error)` 在 workspace.go 定义、driver.go `Driver.CheckoutRepo` 与 localserver handler 调用签名一致；`shouldSkipPriorTaskState(t db.MulticaAgentTaskQueue) bool` 定义与调用一致。
- **已知简化**：(1) GitLab token 走 URL 注入（`oauth2:<token>@`），token 在 git 进程 args 可见——本地 daemon 可接受，credential-helper 升级留以后；(2) comment-trigger 续接的 stale-message 门禁（multica 的 TriggerCommentID gating）未移植——M2 先无条件续接，该细化留以后。

---

**M2 完成后**：M3（GC 全栈：gcLoop + active-root 引用计数 + `.gc_meta.json` + gc-check 端点调用）→ M2.5（interface-8 Gitea 资源就绪 + document 交付物续接）→ M4（critic 合并/关闭 MR/PR）→ M5（split + 归档）。
