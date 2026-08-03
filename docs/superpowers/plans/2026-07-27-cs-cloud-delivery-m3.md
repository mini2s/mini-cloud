# cs-cloud 交付物重设计 M3：GC 全栈（cs-cloud 照搬 multica gc.go + multica node-run gc-check + 鉴权验证）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** cs-cloud 引入 worktree/env-root GC（照搬 multica `server/internal/daemon/gc.go` 的决策状态机），task 完成时写 `.gc_meta.json`，gcLoop 周期扫描 `<WorkspacesRoot>` 按终态+TTL 回收；multica 侧补一个 `workflow-node-runs/{id}/gc-check` 端点（cs-cloud 跑的 workflow task 用），并用回归测试锁定 gc-check 对 cs-cloud user token 的鉴权（option ②，实测已由 `DaemonAuth` + `requireDaemonWorkspaceAccess` 的 membership fallback 覆盖）。

**Architecture:** cs-cloud `runtimeLoop` 已有 GC goroutine（`doGC` 是 nil-stub），挂 `d.runtime.gcFunc = d.runGC` 即可。新建 `internal/workflowrunner/gc.go`（方法挂在 `*Driver`）+ `internal/workflowrunner/execenv/` 包（GCMeta/GCKind/Read/Write，含新增 `GCKindWorkflowNodeRun`）；`Client` 加 5 个 `Get*GCCheck`；`workflow.Config` 加 GC 字段；`isActiveEnvRoot` 走 `d.running`；`Driver.execute` 写 `.gc_meta.json` + 戳 `CompletedAt`。multica 加 `GetWorkflowNodeRunGCCheck` handler（仿 `GetAutopilotRunGCCheck`，经父 `workflow_run` 解析 workspace）+ 路由 + 鉴权回归测试。

**Tech Stack:** Go（multica `server/` + cs-cloud），标准 `testing` + `httptest`。两仓：multica 分支 `fix/deliverable-verification`，cs-cloud 分支 `feat/deliverable-iteration`。

**Spec:** `docs/superpowers/specs/2026-07-26-cs-cloud-delivery-redesign-design.md`（§9 GC 决策表、§257 gc-check 鉴权）

**源文件（照搬基准）：**
- multica `server/internal/daemon/gc.go`（决策状态机，~570 行）
- multica `server/internal/daemon/gc_test.go`（~30 测试，照搬改 fixture）
- multica `server/internal/daemon/execenv/execenv.go` lines 329-398（GCMeta/GCKind/Read/Write）

---

## 关键结构差异（照搬时必须适配，不要盲抄）

| 维度 | multica | cs-cloud | 适配 |
|---|---|---|---|
| task 目录布局 | `<root>/<wsID>/<shortTaskID>` | `<root>/<wsID>/tasks/<taskID>` | `gcWorkspace` 扫 `<wsDir>/tasks/` 子目录 |
| bare cache 目录名 | `.repos` | `repos` | `runGC` 跳过 `repos`；`pruneRepoWorktrees` 扫 `<wsDir>/repos/` |
| 接收者 | `*Daemon` | `*Driver` | 全局替换 `d *Daemon`→`d *Driver` |
| logger | `d.logger.Info(...)` (slog) | `logger.Info("gc: ...", args...)` (cs-cloud `internal/logger`，printf 风格) | 替换调用 |
| HTTP client | `d.client.GetIssueGCCheck` (返回结构体) | `d.client.GetIssueGCCheck` (新加，返回结构体) | 方法名一致，见 Task 5 |
| 错误类型 | `requestError{StatusCode}` | `*StatusError{StatusCode}`（已存在 `client.go:28`） | `isAccessNotFound` 用 `*StatusError` |
| 配置 | `d.cfg.GC*` | `d.cfg.GC*`（Task 3 新增） | 字段名一致 |
| active root | refcount map | `d.running`（taskID→taskRecord.taskRoot） | `isActiveEnvRoot` 遍历 `d.running` |
| 循环驱动 | `gcLoop` 内 `sleepWithContext`+ticker | `runtimeLoop.loop` 已有 ticker | 不照搬 `gcLoop`，只实现 `runGC`，由 `runtime.gcFunc` 驱动 |

---

## File Structure

**multica（`e:\Projects\multica\server\`）：**
- `internal/handler/daemon.go` — 新增 `GetWorkflowNodeRunGCCheck` handler（~line 2537 后）。
- `cmd/server/router.go:423` — 注册 `r.Get("/workflow-node-runs/{nodeRunId}/gc-check", h.GetWorkflowNodeRunGCCheck)`。
- `internal/handler/daemon_test.go` — node-run gc-check 测试 + gc-check user-token 鉴权回归测试。

**cs-cloud（`e:\Projects\cs-cloud\`）：**
- `internal/workflow/config.go` — `Config` 加 `GCEnabled`/`GCTTL`/`GCOrphanTTL`/`GCArtifactTTL`/`GCArtifactPatterns` + defaults。
- `internal/config/load.go` — `CS_CLOUD_WORKFLOW_GC_*` env 读取 + `mergeWorkflowConfig` 合并。
- `internal/workflowrunner/execenv/gcmeta.go`（新文件）— `GCMeta`/`GCMetaKind`/`GCKind*`/`ReadGCMeta`/`WriteGCMeta`。
- `internal/workflow/protocol.go` — 5 个 gc-check 端点常量。
- `internal/workflowrunner/client.go` — 5 个 `Get*GCCheck` 方法 + `GCCheckStatus` 类型。
- `internal/workflowrunner/active_root.go`（新文件）— `isActiveEnvRoot`。
- `internal/workflowrunner/gc.go`（新文件）— 决策状态机（照搬 + 适配）。
- `internal/workflowrunner/gc_meta.go`（新文件）— `gcMetaForTask`（cs-cloud 判别器）。
- `internal/workflowrunner/driver.go` — `execute` 写 meta + 戳 CompletedAt；`Start` 挂 `gcFunc`。
- `internal/workflowrunner/gc_test.go`（新）+ `gcmeta_test.go`（新）+ `active_root_test.go`（新）。

---

## Task 1: multica — 新增 workflow-node-runs gc-check 端点

**Files:** `server/internal/handler/daemon.go`（~line 2537 `GetTaskGCCheck` 之后）; `server/cmd/server/router.go:423`; `server/internal/handler/daemon_test.go`

**背景：** cs-cloud 跑的 workflow task（`issue_id` NULL、`workflow_node_run_id` 有值）需要终态判定。`multica_workflow_node_run` 行有 `status`+`completed_at`，但无 `workspace_id`——经父 `multica_workflow_run` 解析 workspace（与 `GetAutopilotRunGCCheck` 经父 autopilot 完全同构）。终态集（出自 `cancelWorkflowNodeRuns` 的 `NOT IN` 白名单）：`completed/failed/blocked/skipped/cancelled/format_failed`。

- [ ] **Step 1: 写失败测试** — 在 `daemon_test.go` 仿 `TestGetIssueGCCheck_WithDaemonToken_*` 的形状，新增 `TestGetWorkflowNodeRunGCCheck`：建 workspace + workflow_run + workflow_node_run（status=`completed`，completed_at=10 天前）+ user PAT + membership，请求 `/api/daemon/workflow-node-runs/{id}/gc-check` 带 PAT，断言 200 + body `status=="completed"` + `completed_at` 非空。再加一个 cross-workspace 用例（membership 不属于该 workspace → 404，anti-enumeration）。

- [ ] **Step 2: 跑测试确认失败** — `cd server && go test ./internal/handler/ -run TestGetWorkflowNodeRunGCCheck -v` → FAIL（handler 未注册，404/路由缺失）。

- [ ] **Step 3: 加 handler** — 在 `daemon.go` `GetTaskGCCheck` 之后：
```go
// GetWorkflowNodeRunGCCheck returns the status and completed_at of a workflow
// node run for the cs-cloud GC loop. Workspace ownership is resolved via the
// parent workflow_run row — same parent-resolution shape as GetAutopilotRunGCCheck.
// Terminal node-run statuses (completed/failed/blocked/skipped/cancelled/
// format_failed) past GCTTL let cs-cloud reclaim the workdir.
func (h *Handler) GetWorkflowNodeRunGCCheck(w http.ResponseWriter, r *http.Request) {
	nodeRunID := chi.URLParam(r, "nodeRunId")
	nodeRunUUID, ok := parseUUIDOrBadRequest(w, nodeRunID, "node_run_id")
	if !ok {
		return
	}
	run, err := h.Queries.GetWorkflowNodeRun(r.Context(), nodeRunUUID)
	if err != nil {
		writeError(w, http.StatusNotFound, "workflow node run not found")
		return
	}
	wfRun, err := h.Queries.GetWorkflowRun(r.Context(), run.WorkflowRunID)
	if err != nil {
		// Parent run gone — treat as not found so cs-cloud falls through to
		// orphan-by-mtime rather than 500.
		writeError(w, http.StatusNotFound, "workflow node run not found")
		return
	}
	if !h.requireDaemonWorkspaceAccess(w, r, uuidToString(wfRun.WorkspaceID)) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":       run.Status,
		"completed_at": run.CompletedAt.Time,
	})
}
```
（确认 `GetWorkflowRun` 存在且返回行含 `WorkspaceID`——`grep -n "func (q \*Queries) GetWorkflowRun" server/pkg/db/generated/`；若行字段名不同以生成代码为准。）

- [ ] **Step 4: 注册路由** — `router.go:423` 后加一行：
```go
		r.Get("/workflow-node-runs/{nodeRunId}/gc-check", h.GetWorkflowNodeRunGCCheck)
```

- [ ] **Step 5: 跑测试通过** — `go test ./internal/handler/ -run TestGetWorkflowNodeRunGCCheck -v` → PASS。

- [ ] **Step 6: Commit** — `feat(handler): add workflow-node-runs gc-check endpoint for cs-cloud GC`

---

## Task 2: multica — gc-check user-token 鉴权回归测试（option ② 验证）

**Files:** `server/internal/handler/daemon_test.go`

**背景：** spec §257 担心 gc-check 挂 `DaemonAuth` 要 `mul_` PAT，cs-cloud 走 user token。实测：`DaemonAuth`（`middleware/daemon_auth.go:73`）已接受 `mul_`/JWT/Casdoor 并设 `X-User-ID`；`requireDaemonWorkspaceAccess`（`daemon.go:50`）已有 PAT/JWT membership fallback。cs-cloud 现有 token 已能驱动 `CompleteTask`/`BindNodeRunSession`（同一路径）。故 option ② 无需改端点代码，仅需回归测试锁定。

- [ ] **Step 1: 写测试** — `TestGetIssueGCCheck_WithUserPAT_Member`：建 user + workspace + membership + issue（status=done, updated_at=10d 前）+ 为该 user 发 PAT（`mul_` 前缀，复用 handler 测试现成的 PAT fixture helper——grep `TestGetIssueGCCheck` / PAT 创建 helper 找到范式）；请求 `/api/daemon/issues/{id}/gc-check` 带 `Authorization: Bearer <mul_ PAT>`，断言 200 + `status=="done"`。再加 `TestGetIssueGCCheck_WithUserPAT_NonMember` → 404（anti-enumeration，与 daemon token cross-workspace 同形状）。

- [ ] **Step 2: 跑测试** — `go test ./internal/handler/ -run 'TestGetIssueGCCheck_WithUserPAT' -v`。

- [ ] **Step 3: 判定** —
  - 若 PASS：option ② 已由现有 middleware 覆盖，无需改代码。Commit 测试：`test(handler): lock gc-check user-token access (option 2, no endpoint change needed)`。
  - 若 FAIL：读失败原因。若 `requireDaemonWorkspaceAccess` 在 user-token 路径有缺陷，修它（不要新加并行路由——扩展现有 fallback）。补改后再跑至 PASS，Commit：`fix(handler): allow user-token access on gc-check endpoints (option 2)`。

- [ ] **Step 4: 同样验证 node-run 端点** — Task 1 的 `TestGetWorkflowNodeRunGCCheck` 已用 PAT + membership，本身就是 user-token 路径的覆盖。确认它也走 PAT（不是 daemon token）。

---

## Task 3: cs-cloud — Config 加 GC 字段

**Files:** `internal/workflow/config.go`; `internal/config/load.go`

- [ ] **Step 1: 写失败测试** — `internal/workflow/config_test.go`（若无则新建）测 `DefaultConfig()` 返回 `GCEnabled==true`、`GCTTL==24*time.Hour`、`GCOrphanTTL==72*time.Hour`、`GCArtifactTTL==12*time.Hour`、`GCArtifactPatterns==[]string{"node_modules",".next",".turbo"}`。（注意 cs-cloud 现有 `GCInterval` 默认 24h——保留，但 GC loop 默认间隔建议改 1h 对齐 multica；本 task 仅加字段，间隔在 Task 9 wiring 用。）

- [ ] **Step 2: 跑确认失败** — `cd /e/Projects/cs-cloud && go test ./internal/workflow/ -run TestDefaultConfig -v`（编译失败：字段不存在）。

- [ ] **Step 3: 加字段** — `config.go` `Config` struct 加：
```go
	GCEnabled          bool          `json:"gc_enabled"`
	GCTTL              time.Duration `json:"gc_ttl"`
	GCOrphanTTL        time.Duration `json:"gc_orphan_ttl"`
	GCArtifactTTL      time.Duration `json:"gc_artifact_ttl"`
	GCArtifactPatterns []string      `json:"gc_artifact_patterns"`
```
`DefaultConfig()` 返回值加：
```go
		GCEnabled:          true,
		GCTTL:              24 * time.Hour,
		GCOrphanTTL:        72 * time.Hour,
		GCArtifactTTL:      12 * time.Hour,
		GCArtifactPatterns: []string{"node_modules", ".next", ".turbo"},
```

- [ ] **Step 4: env 读取 + merge** — `load.go` 仿 `CS_CLOUD_WORKFLOW_GC_INTERVAL`（line 46-50）加：
```go
	if v := platform.Getenv("CS_CLOUD_WORKFLOW_GC_ENABLED"); v != "" {
		cfg.Workflow.GCEnabled = v == "true" || v == "1" || v == "yes"
	}
	if v := platform.Getenv("CS_CLOUD_WORKFLOW_GC_TTL"); v != "" {
		if d, ok := parsePositiveDuration(v); ok {
			cfg.Workflow.GCTTL = d
		}
	}
	if v := platform.Getenv("CS_CLOUD_WORKFLOW_GC_ORPHAN_TTL"); v != "" {
		if d, ok := parsePositiveDuration(v); ok {
			cfg.Workflow.GCOrphanTTL = d
		}
	}
	if v := platform.Getenv("CS_CLOUD_WORKFLOW_GC_ARTIFACT_TTL"); v != "" {
		if d, ok := parsePositiveDuration(v); ok {
			cfg.Workflow.GCArtifactTTL = d
		}
	}
	if v := platform.Getenv("CS_CLOUD_WORKFLOW_GC_ARTIFACT_PATTERNS"); v != "" {
		cfg.Workflow.GCArtifactPatterns = strings.Split(v, ",")
	}
```
`mergeWorkflowConfig` 仿 `GCInterval` 分支（line 208-210），对每个新字段加 `if file.X != zero && current.X == defaults.X { current.X = file.X }`（`GCEnabled` 用 `file.GCEnabled || current.GCEnabled` 语义——file 显式 false 才关；`GCArtifactPatterns` 用 `len(file.GCArtifactPatterns) > 0 && sliceEq`）。

- [ ] **Step 5: 跑通过** — `go test ./internal/workflow/ ./internal/config/ -v` → PASS。

- [ ] **Step 6: Commit** — `feat(config): add GC TTL/orphan/artifact fields to workflow.Config`

---

## Task 4: cs-cloud — execenv 包（GCMeta/GCKind/Read/Write）

**Files:** `internal/workflowrunner/execenv/gcmeta.go`（新）; `internal/workflowrunner/execenv/gcmeta_test.go`（新）

照搬 multica `execenv.go:329-398`，加一个新 Kind。cs-cloud logger 用 `internal/logger`（非 slog），故 `WriteGCMeta` 签名去掉 `*slog.Logger`，改用包级 `logger.Debug`。

- [ ] **Step 1: 写失败测试** — `gcmeta_test.go`：`TestWriteReadGCMeta_RoundTrip`（写 `GCKindWorkflowNodeRun`+`NodeRunID`+`WorkspaceID`，读回字段一致 + `Kind` 一致 + `CompletedAt` 非零）；`TestReadGCMeta_LegacyNoKindDefaultsIssue`（无 `kind` 字段 → `GCKindIssue`）；`TestWriteGCMeta_EmptyKindSkips`（`Kind==""` → 不写文件）。

- [ ] **Step 2: 跑确认失败** — 编译失败（包不存在）。

- [ ] **Step 3: 实现** — `gcmeta.go`：
```go
// Package execenv persists per-task GC metadata (.gc_meta.json) so the cs-cloud
// GC loop can decide whether a workdir is reclaimable. Ported from multica
// server/internal/daemon/execenv/execenv.go (GCMeta/Read/Write), with an added
// GCKindWorkflowNodeRun for cs-cloud's workflow node-run tasks.
package execenv

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"cs-cloud/internal/logger"
)

type GCMetaKind string

const (
	GCKindIssue           GCMetaKind = "issue"
	GCKindChat            GCMetaKind = "chat"
	GCKindAutopilotRun    GCMetaKind = "autopilot_run"
	GCKindQuickCreate     GCMetaKind = "quick_create"
	GCKindWorkflowNodeRun GCMetaKind = "workflow_node_run" // cs-cloud: workflow task (issue_id NULL)
)

type GCMeta struct {
	Kind           GCMetaKind `json:"kind,omitempty"`
	IssueID        string     `json:"issue_id,omitempty"`
	ChatSessionID  string     `json:"chat_session_id,omitempty"`
	AutopilotRunID string     `json:"autopilot_run_id,omitempty"`
	TaskID         string     `json:"task_id,omitempty"`
	NodeRunID      string     `json:"node_run_id,omitempty"` // cs-cloud addition
	WorkspaceID    string     `json:"workspace_id"`
	CompletedAt    time.Time  `json:"completed_at"`
}

const gcMetaFile = ".gc_meta.json"

// WriteGCMeta writes GC metadata into envRoot, stamping CompletedAt. Empty Kind
// is a no-op (dir falls back to orphan-by-mtime).
func WriteGCMeta(envRoot string, meta GCMeta) error {
	if envRoot == "" {
		return nil
	}
	if meta.Kind == "" {
		logger.Debug("execenv: skipping .gc_meta.json write: kind is empty: %s", envRoot)
		return nil
	}
	if meta.CompletedAt.IsZero() {
		meta.CompletedAt = time.Now().UTC()
	}
	data, err := json.Marshal(meta)
	if err != nil {
		return fmt.Errorf("marshal gc meta: %w", err)
	}
	return os.WriteFile(filepath.Join(envRoot, gcMetaFile), data, 0o644)
}

// ReadGCMeta reads GC metadata. Pre-kind files normalize to GCKindIssue.
func ReadGCMeta(envRoot string) (*GCMeta, error) {
	data, err := os.ReadFile(filepath.Join(envRoot, gcMetaFile))
	if err != nil {
		return nil, err
	}
	var meta GCMeta
	if err := json.Unmarshal(data, &meta); err != nil {
		return nil, err
	}
	if meta.Kind == "" {
		meta.Kind = GCKindIssue
	}
	return &meta, nil
}
```
（注意：multica 的 `WriteGCMeta` 由调用方传 `CompletedAt`，但内部 `time.Now().UTC()` 覆盖。cs-cloud 这里仅在零值时戳，允许 Task 8 在任务完成时显式传完成时刻——更准。测试据此调整。）

- [ ] **Step 4: 跑通过** — `go test ./internal/workflowrunner/execenv/ -v` → PASS。

- [ ] **Step 5: Commit** — `feat(execenv): add GCMeta read/write with workflow_node_run kind`

---

## Task 5: cs-cloud — Client 加 5 个 Get*GCCheck

**Files:** `internal/workflow/protocol.go`; `internal/workflowrunner/client.go`

- [ ] **Step 1: 加端点常量** — `protocol.go` 加：
```go
	MulticaIssueGCCheckEndpoint           = "/api/daemon/issues/%s/gc-check"
	MulticaChatSessionGCCheckEndpoint     = "/api/daemon/chat-sessions/%s/gc-check"
	MulticaAutopilotRunGCCheckEndpoint    = "/api/daemon/autopilot-runs/%s/gc-check"
	MulticaTaskGCCheckEndpoint            = "/api/daemon/tasks/%s/gc-check"
	MulticaWorkflowNodeRunGCCheckEndpoint = "/api/daemon/workflow-node-runs/%s/gc-check"
```

- [ ] **Step 2: 加类型 + 方法** — `client.go` 加：
```go
// GCCheckStatus is the minimal payload returned by multica's gc-check
// endpoints. UpdatedAt is the TTL anchor for issue/chat; CompletedAt for
// autopilot/task/node-run. Either may be zero on non-terminal rows.
type GCCheckStatus struct {
	Status     string    `json:"status"`
	UpdatedAt  time.Time `json:"updated_at"`
	CompletedAt time.Time `json:"completed_at"`
}

func (c *Client) GetIssueGCCheck(ctx context.Context, issueID string) (GCCheckStatus, error) {
	var out GCCheckStatus
	err := c.request(ctx, http.MethodGet, fmt.Sprintf(workflow.MulticaIssueGCCheckEndpoint, issueID), nil, &out)
	return out, err
}

func (c *Client) GetChatSessionGCCheck(ctx context.Context, sessionID string) (GCCheckStatus, error) {
	var out GCCheckStatus
	err := c.request(ctx, http.MethodGet, fmt.Sprintf(workflow.MulticaChatSessionGCCheckEndpoint, sessionID), nil, &out)
	return out, err
}

func (c *Client) GetAutopilotRunGCCheck(ctx context.Context, runID string) (GCCheckStatus, error) {
	var out GCCheckStatus
	err := c.request(ctx, http.MethodGet, fmt.Sprintf(workflow.MulticaAutopilotRunGCCheckEndpoint, runID), nil, &out)
	return out, err
}

func (c *Client) GetTaskGCCheck(ctx context.Context, taskID string) (GCCheckStatus, error) {
	var out GCCheckStatus
	err := c.request(ctx, http.MethodGet, fmt.Sprintf(workflow.MulticaTaskGCCheckEndpoint, taskID), nil, &out)
	return out, err
}

// GetWorkflowNodeRunGCCheck queries the terminal status of a workflow node run
// (cs-cloud's workflow-task workdirs). Added in M3 alongside the multica endpoint.
func (c *Client) GetWorkflowNodeRunGCCheck(ctx context.Context, nodeRunID string) (GCCheckStatus, error) {
	var out GCCheckStatus
	err := c.request(ctx, http.MethodGet, fmt.Sprintf(workflow.MulticaWorkflowNodeRunGCCheckEndpoint, nodeRunID), nil, &out)
	return out, err
}
```
（404 由 `doRequest` 包成 `*StatusError{StatusCode:404}`，与 `Heartbeat` 的 `ErrRuntimeGone` 模式一致——`gc.go` 里用 `errors.As` 判 404。）

- [ ] **Step 3: 写测试** — `client_test.go`（仿现有 client 测试）用 `httptest` mock：`TestGetWorkflowNodeRunGCCheck_OK`（200+body→结构体字段对）、`TestGetIssueGCCheck_404`（404→`*StatusError` StatusCode=404）。若 cs-cloud 现有 client 测试用了别的 mock 范式（grep `httptest.NewServer` in `client_test.go`），沿用之。

- [ ] **Step 4: 跑通过** — `go test ./internal/workflowrunner/ -run GCCheck -v` → PASS。

- [ ] **Step 5: Commit** — `feat(client): add gc-check methods for issue/chat/autopilot/task/node-run`

---

## Task 6: cs-cloud — isActiveEnvRoot（active root 防误删）

**Files:** `internal/workflowrunner/active_root.go`（新）; `internal/workflowrunner/active_root_test.go`（新）

cs-cloud 不预声明 root（无 multica 的 predicted-root-ahead 场景），`d.running` 即活跃 taskRoot 的精确集合。

- [ ] **Step 1: 写失败测试** — `active_root_test.go`：建 `Driver{running: map[string]*taskRecord{}}`，塞一个 `taskRecord{taskRoot: "/a/b"}`，`isActiveEnvRoot("/a/b")==true`、`isActiveEnvRoot("/a/c")==false`、空 `running` 时任意 path `==false`。

- [ ] **Step 2: 跑确认失败** — 编译失败。

- [ ] **Step 3: 实现** — `active_root.go`：
```go
package workflowrunner

// isActiveEnvRoot reports whether any running task currently owns taskDir as its
// task root. The GC loop short-circuits on this so an in-flight task's workdir
// is never reclaimed — not even on the done/cancelled or 404 paths. A follow-up
// comment on an already-done issue can dispatch a task that reuses the prior
// workdir without bumping updated_at, so TTL alone wouldn't notice the resume.
//
// cs-cloud does not pre-claim predicted roots (unlike multica's refcount map),
// so d.running is the exact active set. Hold d.mu while iterating.
func (d *Driver) isActiveEnvRoot(taskDir string) bool {
	if taskDir == "" {
		return false
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	for _, rec := range d.running {
		if rec != nil && rec.taskRoot == taskDir {
			return true
		}
	}
	return false
}
```

- [ ] **Step 4: 跑通过** — `go test ./internal/workflowrunner/ -run IsActiveEnvRoot -v` → PASS。

- [ ] **Step 5: Commit** — `feat(workflowrunner): add isActiveEnvRoot guard for GC`

---

## Task 7: cs-cloud — gc.go 决策状态机（照搬 + 适配 + node-run）

**Files:** `internal/workflowrunner/gc.go`（新）; `internal/workflowrunner/gc_test.go`（新）

**这是最大的 task。** 照搬 multica `gc.go` 全部决策逻辑，按本 plan 顶部「关键结构差异」表适配。

- [ ] **Step 1: 写失败测试（照搬 gc_test.go）** — `gc_test.go` 仿 multica `newGCTestDaemon`，建 cs-cloud 的测试 helper：构造 `Driver{cfg: workflow.Config{WorkspacesRoot: t.TempDir(), GCEnabled:true, GCTTL:..., GCOrphanTTL:..., GCArtifactTTL:..., GCArtifactPatterns:...}, client: NewClient(mockSrv.URL, ...)}`（client 需要 tokenProvider——传一个返回固定 dummy cred 的 func；或给 Driver 加一个测试用的 `client` 直注）。task 目录建在 `<root>/<wsID>/tasks/<taskID>`（cs-cloud 布局）。

  照搬这些用例（每个改成 cs-cloud 布局 + `*Driver` 接收者）：
  - `TestShouldCleanTaskDir_DoneIssueOverTTL` / `_CancelledIssueOverTTL` / `_OpenIssueSkipped` / `_DoneButRecentSkipped`
  - `TestShouldCleanTaskDir_NoMetaRecentSkipped` / `_NoMetaOldOrphan`
  - `TestShouldCleanTaskDir_APIErrorSkipped` / `_Issue404OldOrphan` / `_Issue404RecentSkipped`
  - `TestCleanTaskDir_RemovesDirectory` / `TestGcWorkspace_CleansEmptyTasksDir`（注意扫 `tasks/` 子目录后，空的是 `tasks/` 还是 `<wsDir>`——按实现定）
  - `TestShouldCleanTaskDir_OpenIssueArtifactCleanup` / `_OpenIssueRecentTaskSkipped` / `_ArtifactTTLDisabled`
  - `TestShouldCleanTaskDir_ActiveEnvRootSkips*`（4 个，用 `d.running` 注活跃 root）
  - `TestCleanTaskArtifacts_RemovesOnlyMatchedDirs` / `_RejectsPatternsWithSeparators` / `_DoesNotFollowSymlinks`
  - `TestIsBareRepo`
  - `TestShouldCleanTaskDir_KindDispatch`（表驱动，照搬全部分支 + **新增 node-run 分支**：terminal `completed`+overTTL→clean、`working`→skip、404→orphanByMtime）
  - `TestShouldCleanTaskDir_ChatHardDeletedFreshMtime` / `_ChatActiveResistsOldMtime`

- [ ] **Step 2: 跑确认失败** — 编译失败（函数不存在）。

- [ ] **Step 3: 实现 gc.go** — 照搬 multica `gc.go`，按下表适配。**逐符号映射：**

  | multica 函数 | cs-cloud 处理 |
  |---|---|
  | `gcLoop` | **不照搬**（`runtimeLoop.loop` 已驱动）。只实现 `runGC`，签名改 `func (d *Driver) runGC() error`。开头加 `if !d.cfg.GCEnabled { return nil }`。结尾 `return nil`（满足 `gcFunc func() error`）。 |
  | `gcStats` | 照搬（结构体原样） |
  | `runGC` | 照搬，`d.cfg.WorkspacesRoot`→不变；`d.gcWorkspace(ctx,...)` 改 `d.gcWorkspace(...)`（cs-cloud 无 ctx 透传到 shouldClean——见下）；`d.pruneRepoWorktrees(root)` 不变。日志用 `logger.Info("gc: cycle complete: cleaned=%d ...", ...)`。 |
  | `gcWorkspace` | **适配布局**：扫 `<wsDir>/tasks/` 子目录（不是 `wsDir` 本身）。跳过 `repos`（cache）。task dir = `filepath.Join(wsDir, "tasks", entry.Name())`。清完后若 `tasks/` 空则删 `tasks/`（不删 `wsDir`，除非 wsDir 也空——可选）。 |
  | `gcAction` 常量 + `shouldCleanTaskDir` | 照搬，但去掉 `ctx context.Context` 参数（cs-cloud client 自建 ctx）；`d.isActiveEnvRoot`（Task 6）；`execenv.ReadGCMeta`（Task 4）；switch 加 `case execenv.GCKindWorkflowNodeRun: return d.gcDecisionWorkflowNodeRun(taskDir, meta)`。 |
  | `orphanByMTime` | 照搬，logger 换 cs-cloud |
  | `isAccessNotFound` | 照搬，`requestError`→`*StatusError` |
  | `gcDecisionIssue` / `gcDecisionChat` / `gcDecisionAutopilotRun` / `gcDecisionQuickCreate` | 照搬，`d.client.Get*GCCheck`（Task 5），内部 `ctx, cancel := context.WithTimeout(context.Background(), gcAPITimeout)`（新增 const `gcAPITimeout = 10*time.Second`）。terminal 判定函数 `isAutopilotRunTerminal`/`isAgentTaskTerminal` 照搬。 |
  | `gcDecisionWorkflowNodeRun`（**新增**） | 仿 `gcDecisionAutopilotRun`：调 `d.client.GetWorkflowNodeRunGCCheck(meta.NodeRunID)`；404→`orphanByMTime`；其他错→skip；`isWorkflowNodeRunTerminal(status)` + `completed_at` 超 `GCTTL`→clean。 |
  | `isWorkflowNodeRunTerminal`（**新增**） | `switch status { case "completed","failed","blocked","skipped","cancelled","format_failed": return true; default: return false }` |
  | `cleanTaskDir` / `cleanTaskArtifacts` / `dirSize` / `isBareRepo` | 照搬（纯文件操作，logger 换 cs-cloud） |
  | `pruneRepoWorktrees` / `pruneWorktree` | **适配**：bare cache 在 `<wsDir>/repos/`（不是 `.repos`），且层级是 `<root>/<wsID>/repos/<repoName>`。改扫 `<workspacesRoot>/<wsEntry>/repos/`。 |

  **`gcDecisionWorkflowNodeRun` 完整代码：**
  ```go
  func (d *Driver) gcDecisionWorkflowNodeRun(taskDir string, meta *execenv.GCMeta) gcAction {
  	ctx, cancel := context.WithTimeout(context.Background(), gcAPITimeout)
  	defer cancel()
  	status, err := d.client.GetWorkflowNodeRunGCCheck(ctx, meta.NodeRunID)
  	if err != nil {
  		if isAccessNotFound(err) {
  			return d.orphanByMTime(taskDir, "workflow node run not accessible")
  		}
  		return gcActionSkip
  	}
  	if isWorkflowNodeRunTerminal(status.Status) {
  		anchor := status.CompletedAt
  		if anchor.IsZero() {
  			anchor = meta.CompletedAt
  		}
  		if !anchor.IsZero() && time.Since(anchor) > d.cfg.GCTTL {
  			logger.Info("gc: eligible for cleanup: dir=%s kind=workflow_node_run node_run=%s status=%s",
  				filepath.Base(taskDir), meta.NodeRunID, status.Status)
  			return gcActionClean
  		}
  	}
  	return gcActionSkip
  }
  ```
  其余 decision 函数把 multica 的 `ctx` 形参去掉、函数体首行加 `ctx, cancel := context.WithTimeout(context.Background(), gcAPITimeout); defer cancel()`。

- [ ] **Step 4: 跑测试** — `go test ./internal/workflowrunner/ -run 'GC|ShouldClean|CleanTask|IsBare|KindDispatch|ChatHardDeleted|ChatActive' -v` → 全 PASS。逐一对照 multica gc_test.go 的断言。

- [ ] **Step 5: Commit** — `feat(workflowrunner): port multica gc.go decision state machine (+ workflow_node_run kind)`

---

## Task 8: cs-cloud — gcMetaForTask + execute 写 .gc_meta.json

**Files:** `internal/workflowrunner/gc_meta.go`（新）; `internal/workflowrunner/driver.go`（`execute` ~line 316-379）; `internal/workflowrunner/gc_meta_test.go`（新）

cs-cloud payload 字段（`workflow.TaskRunPayload`）：`TaskID`/`WorkspaceID`/`IssueID`/`NodeRunID`（无 ChatSessionID/AutopilotRunID/QuickCreatePrompt——这几个 Kind 对 cs-cloud 是 dead path，但照搬保留决策函数）。

- [ ] **Step 1: 写失败测试** — `gc_meta_test.go` 仿 multica `TestGCMetaForTask`：
  - `NodeRunID` 有值 → `GCKindWorkflowNodeRun` + `NodeRunID` 对（**即使 IssueID 也有值，NodeRunID 优先**——workdir 归 node-run 生命周期管）
  - 仅 `IssueID` → `GCKindIssue`
  - 仅 `TaskID` → `GCKindQuickCreate`
  - 全空 → `ok=false`

- [ ] **Step 2: 跑确认失败** — 编译失败。

- [ ] **Step 3: 实现 gcMetaForTask** — `gc_meta.go`：
  ```go
  package workflowrunner

  import (
  	"cs-cloud/internal/workflow"
  	"cs-cloud/internal/workflowrunner/execenv"
  )

  // gcMetaForTask picks the GCKind + ID for a task's .gc_meta.json. Priority:
  // workflow node-run (most specific lifecycle parent) > issue > quick-create
  // (task row). Returns ok=false when no ID is known — caller skips the write
  // and the dir falls back to orphan-by-mtime.
  func gcMetaForTask(p workflow.TaskRunPayload) (execenv.GCMeta, bool) {
  	switch {
  	case p.NodeRunID != "":
  		return execenv.GCMeta{Kind: execenv.GCKindWorkflowNodeRun, NodeRunID: p.NodeRunID, TaskID: p.TaskID, WorkspaceID: p.WorkspaceID}, true
  	case p.IssueID != "":
  		return execenv.GCMeta{Kind: execenv.GCKindIssue, IssueID: p.IssueID, TaskID: p.TaskID, WorkspaceID: p.WorkspaceID}, true
  	case p.TaskID != "":
  		return execenv.GCMeta{Kind: execenv.GCKindQuickCreate, TaskID: p.TaskID, WorkspaceID: p.WorkspaceID}, true
  	default:
  		return execenv.GCMeta{}, false
  	}
  }
  ```
  （确认 `workflow.TaskRunPayload` 字段名 `NodeRunID`/`IssueID`/`TaskID`/`WorkspaceID` 与 `workflow/models.go` 一致——survey 已确认。）

- [ ] **Step 4: 在 execute 写 meta** — `driver.go execute()`：
  - line 324-329（`rec.taskRoot = worktree` 那块）**之后**加：写初始 meta（无 CompletedAt）：
    ```go
    if meta, ok := gcMetaForTask(payload); ok {
    	if err := execenv.WriteGCMeta(worktree, meta); err != nil {
    		logger.Warn("workflow: write gc meta failed: task=%s err=%v", payload.TaskID, err)
    	}
    }
    ```
  - CompleteTask/FailTask **之前**（line 374/379 前）戳 CompletedAt 重写：
    ```go
    if meta, ok := gcMetaForTask(payload); ok {
    	meta.CompletedAt = time.Now().UTC()
    	if err := execenv.WriteGCMeta(worktree, meta); err != nil {
    		logger.Warn("workflow: stamp gc meta completed_at failed: task=%s err=%v", payload.TaskID, err)
    	}
    }
    ```
    （成功路径在 `return d.client.CompleteTask(...)` 前；失败路径在 `_ = d.client.FailTask(...)` 前。两处都要——FailTask 后 workdir 也可能被 GC，需 CompletedAt 作 artifact-only TTL anchor。）

- [ ] **Step 5: 跑通过** — `go test ./internal/workflowrunner/ -run GCMetaForTask -v` → PASS。

- [ ] **Step 6: Commit** — `feat(workflowrunner): write .gc_meta.json at task prepare + completion`

---

## Task 9: cs-cloud — 挂 gcLoop（runtime.gcFunc）

**Files:** `internal/workflowrunner/driver.go`（`Start` ~line 105-106）

- [ ] **Step 1: 写测试** — `driver_test.go`（若无合适 fixture，加一个轻量测）：`Start()` 后 `d.runtime.gcFunc != nil`（之前是 nil）。或测 `doGC()` 调用 `runGC`（mock `cfg.WorkspacesRoot` 指向空目录，`runGC` 应无错返回）。优先用现有 driver 测试范式（grep `func Test.*Driver.*Start`）。

- [ ] **Step 2: 挂钩** — `Start()` line 106（`d.runtime.maintainFunc = d.maintainRegistrations`）后加：
  ```go
  	if d.cfg.GCEnabled {
  		d.runtime.gcFunc = d.runGC
  		logger.Info("workflow: gc enabled: interval=%s ttl=%s orphan_ttl=%s artifact_ttl=%s",
  			d.cfg.GCInterval, d.cfg.GCTTL, d.cfg.GCOrphanTTL, d.cfg.GCArtifactTTL)
  	} else {
  		logger.Info("workflow: gc disabled")
  	}
  ```
  （`GCInterval` 默认 24h；建议对齐 multica 改 1h——在 `DefaultConfig()` 把 `GCInterval: 24 * time.Hour` 改 `1 * time.Hour`。这一改放在 Task 3 或本 task 都可，本 task 顺手。）

- [ ] **Step 3: 跑通过** — `go test ./internal/workflowrunner/ -run 'Start|GC' -v` → PASS。

- [ ] **Step 4: Commit** — `feat(workflowrunner): wire gcLoop into runtime loop (gc-default-enabled)`

---

## Task 10: 全栈验证

- [ ] **multica:** `cd server && go test ./internal/handler/ ./internal/middleware/ -v`（含 Task 1/2 新测试）→ 全绿。
- [ ] **cs-cloud:** `cd /e/Projects/cs-cloud && go test ./internal/workflowrunner/... ./internal/workflow/ ./internal/config/ -v` → 全绿。
- [ ] **编译:** 两仓 `go build ./...` 通过。
- [ ] **mock E2E（可选，仿 M2 mock 设备）:** multica push 一个 workflow task → mock cs-cloud 回调 run/complete → 手动在 `<WorkspacesRoot>/<wsID>/tasks/<taskID>` 建老 task + 调 `doGC` → 验证终态+TTL 的被清、活跃的 skip、无 meta 的走 orphan。（若时间紧，单测覆盖已足够，E2E 留 manual。）

---

## Self-Review 记录

- **Spec 覆盖**：§9 GC 决策表全分支（issue/chat/autopilot/quick_create + 新增 node-run）、orphan-mtime、artifact-only、active-root、worktree prune、`.gc_meta.json` 读写、GC 默认值对齐；§257 鉴权（实测由 DaemonAuth+membership fallback 覆盖，回归测试锁定）。
- **已确认决策**：B 全量方案（照搬 multica gc.go 全部决策函数，含 cs-cloud 暂不用的 chat/autopilot/quick_create——保 1:1 + 单测覆盖）；鉴权 option ②（端点已支持，无需改 multica 端点代码）；node-run 新增端点（仿 autopilot，经父 workflow_run 解析 workspace）。
- **关键结构适配**：cs-cloud task 布局 `<root>/<wsID>/tasks/<taskID>`、cache `repos/`（非 `.repos`）、logger 风格、`isActiveEnvRoot` 走 `d.running`、无 `gcLoop`（复用 `runtimeLoop`）、client ctx 自建。
- **延后**：真实 E2E（真 cs-cloud daemon + 真 multica gc-check 调用链）留 manual；M4 critic、M5 split/归档。
- **已知简化**：`gcDecision*` 去掉 multica 的 `ctx` 形参，内部自建 `gcAPITimeout` ctx（cs-cloud `runtimeLoop.loop` 不透传 ctx 到 gcFunc）。chat/autopilot/quick_create 决策函数照搬但 cs-cloud 当前不产这几类 meta（dead path，零害，单测覆盖保 fidelity）。

---

**M3 完成后**：M4（critic — GitLab MR 合并扩展 + CloseReviewRequest）→ M5（split + 归档）。
