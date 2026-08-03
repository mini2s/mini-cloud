# cs-cloud 交付物重设计 M2.5：interface-8 dispatch 兜底 + repos[] delivery + document checkout 统一 + node-run 续接

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** multica dispatch 时对 document 交付物调 interface-8 兜底确保 Gitea wf repo + 把 delivery 仓库放进 `repos[] role=delivery`（带 bot_token + inst base_branch）；cs-cloud 的 CheckoutRepo 按 role 自动选分支（delivery = `node/<shortNodeRunID>` off inst）；`deliverable submit` document 路径从 tmp-clone 改为 worktree-based（完全统一代码/文档）；workflow task（issue_id=NULL）通过 node-run handback 也能续接 session。

**Architecture:** multica `buildCSCloudPayload` 对 document deliverable：① 若 workspace.settings 无 Gitea 数据则调 `InitWorkflow` 兜底；② emit `repos[]` 加一个 `role=delivery`（Gitea clone URL + inst base_branch + bot_token + alias="delivery"）；③ 在 `deliverables[]` 的 document 项标 `repo_alias="delivery"`；④ prior 注入加 node-run handback fallback（`GetWorkflowNodeRun.session_id`）。cs-cloud `Driver.CheckoutRepo` 从 `payload.Repos[]` 按 URL 查 role → delivery 用 `node/<shortNodeRunID>` 分支 off inst；`deliverable submit` document 改读 `CS_CLOUD_WORKTREE`（worktree-based，跟 `--mr` 同构）。

**Tech Stack:** Go（multica server + cs-cloud），标准 `testing` + `httptest`。

**Spec:** `docs/superpowers/specs/2026-07-26-cs-cloud-delivery-redesign-design.md`（§5/§7.5/§8/§10.1/§13）

---

## File Structure

**multica（`e:\Projects\multica\server\`）：**
- `internal/service/task.go` — `TaskService` struct 加 `TeamNamespace` 字段。
- `cmd/server/main.go` + `internal/handler/handler.go` — 构造 TaskService 后 set TeamNamespace。
- `internal/service/task_cscloud_push.go` — `buildCSCloudPayload`：dispatch interface-8 兜底 + `repos[] role=delivery` + node-run handback。
- `internal/service/task_cscloud_push_test.go` — 对应测试。

**cs-cloud（`e:\Projects\cs-cloud\`）：**
- `internal/workflowrunner/driver.go` — `CheckoutRepo` 从 payload.Repos[] 查 role，传给 WorkspaceManager。
- `internal/workflowrunner/workspace.go` — `CheckoutRepo` 加 role 参数；delivery 分支 = `node/<shortNodeRunID>`。
- `internal/localserver/repo_handler.go` — RPC 请求加 role（可选，或 daemon 从 payload 查）。
- `internal/cli/gitea.go` — `submitDeliverable` document 路径从 tmp-clone 改 worktree-based。
- `internal/cli/gitea_test.go` — 对应测试。

---

## Task 1: multica — TaskService 加 TeamNamespace 字段

**Files:** `internal/service/task.go`（struct line 27-36）; `cmd/server/main.go:561`; `internal/handler/handler.go:171`

- [ ] **Step 1:** 在 `TaskService` struct 加字段（跟 `CSCloudPush` 同级，post-construction set）：
```go
	// TeamNamespace provisions Gitea wf repos for document deliverables at dispatch.
	TeamNamespace *teamnamespace.Client
```
（加 import `"github.com/multica-ai/multica/server/internal/teamnamespace"`）

- [ ] **Step 2:** 在两个构造点 set（main.go:561 + handler.go:171，`taskSvc` 构造后）：
```go
	taskSvc.TeamNamespace = <teamNamespaceClient>  // 从已有的 teamnamespace.NewClient(...) 拿
```
（确认 main.go / handler.go 里 teamnamespace.Client 的构造变量名——grep `teamnamespace.New` 或 `teamnamespace.Client` 找到它）

- [ ] **Step 3:** 编译 + `go test ./internal/service/`。Commit: `feat(service): wire TeamNamespace client into TaskService for dispatch-time Gitea provisioning`

---

## Task 2: multica — buildCSCloudPayload dispatch interface-8 兜底

**Files:** `internal/service/task_cscloud_push.go`（`buildCSCloudPayload` ~line 258）

- [ ] **Step 1:** 写失败测试——document task + workspace.settings 无 Gitea 数据 → buildCSCloudPayload 调 InitWorkflow → repos[] 含 delivery 项。（用 pushTaskDB mock；mock InitWorkflow 通过 TeamNamespace 字段——需注入一个 fake client 或 mock。）

- [ ] **Step 2:** 在 `buildCSCloudPayload`，在 `deliverables = s.deliverableSpecsForTask(...)` 之后（worker phase 有 document deliverable 时），加兜底：
```go
	// Document deliverable: ensure Gitea wf repo + inst branch exist (safety net
	// if run-start ScaffoldRunDeliverables failed/skipped). Idempotent.
	if hasDocumentDeliverable(deliverables) && s.TeamNamespace != nil && teamNamespaceConfigured(s) {
		if settingsLackGiteaData(env) {  // workspace.settings 无 gitea_pat / gitea_clone_url
			s.ensureDeliveryRepo(ctx, task, runtime.WorkspaceID)  // 调 InitWorkflow + persist settings
		}
	}
```
`ensureDeliveryRepo`：build `WorkflowInitRequest`（WorkflowDefSlug from workflow def, InstanceID from run），调 `s.TeamNamespace.InitWorkflow`，persist bot_credentials into workspace.settings（复用 `persistTeamNamespaceSettings` 逻辑 from `workflow_deliverable_repo.go`）。

- [ ] **Step 3:** 测试通过 + Commit: `feat(cscloud): dispatch-time interface-8 ensure for document deliverables`

---

## Task 3: multica — repos[] role=delivery + RepoAlias

**Files:** `internal/service/task_cscloud_push.go`（`buildCSCloudPayload` repos 组装段 ~line 251 + `deliverableSpecsForTask` ~line 367）

- [ ] **Step 1:** 写失败测试——document task 的 payload `repos[]` 含一个 `role=delivery`（Gitea URL + inst base_branch + bot_token），且 deliverables[] 的 document 项有 `repo_alias="delivery"`。

- [ ] **Step 2:** 在 `buildCSCloudPayload` 的 repos 组装段，worker phase 有 document deliverable 时，从 workspace.settings 读 Gitea 数据，emit delivery repo：
```go
	if deliveryRepo, ok := s.resolveDeliveryRepo(ctx, runtime.WorkspaceID); ok {
		repos = append(repos, deliveryRepo)  // csCloudRepoSpec{URL, Provider:"gitea", Role:"delivery", BaseBranch: inst, BotToken: pat, Alias:"delivery"}
	}
```
`resolveDeliveryRepo`：从 workspace.settings 读 `gitea_clone_url` / `last_instance_branch` / `gitea_pat` / `gitea_bot_username` → 组装 csCloudRepoSpec。

在 `deliverableSpecsForTask`，document deliverable 项设 `RepoAlias: "delivery"`。

- [ ] **Step 3:** 测试通过 + Commit: `feat(cscloud): add repos[] role=delivery for Gitea wf repo + link document deliverables via repo_alias`

---

## Task 4: multica — node-run handback（workflow task 续接）

**Files:** `internal/service/task_cscloud_push.go`（prior 注入块 ~line 267-296）

- [ ] **Step 1:** 写失败测试——workflow task（issue_id NULL）+ GetLastTaskSession miss + GetWorkflowNodeRun 有 session_id + runtime 匹配 → prior_session_id 注入。

- [ ] **Step 2:** 在 prior 注入块，GetLastTaskSession 之后，加 fallback（移植 handler/daemon.go:1382-1392）：
```go
	// Workflow node-run handback: if GetLastTaskSession missed (no issue or no
	// match), fall back to the node-run's bound session. Lets workflow tasks
	// (issue_id NULL) continue via the node-run session binding. Ported from
	// handler/daemon.go:1382-1392.
	if priorSessionID == "" && task.WorkflowNodeRunID.Valid {
		if nr, err := s.Queries.GetWorkflowNodeRun(ctx, task.WorkflowNodeRunID); err == nil {
			if nr.SessionID.Valid && nr.RuntimeID.Valid && nr.RuntimeID == task.RuntimeID {
				priorSessionID = nr.SessionID.String
			}
		}
	}
```

- [ ] **Step 3:** 测试通过 + Commit: `feat(cscloud): node-run handback fallback for workflow task continuation`

---

## Task 5: cs-cloud — CheckoutRepo role 感知分支命名

**Files:** `internal/workflowrunner/driver.go`（`CheckoutRepo` ~line 468）; `internal/workflowrunner/workspace.go`（`CheckoutRepo` ~line 345 + `agentBranch` ~line 254）

- [ ] **Step 1:** 写失败测试——CheckoutRepo 对 role=delivery 的仓库用 `node/<shortNodeRunID>` 分支（不是 `agent/csc/<task>`）。

- [ ] **Step 2:** 
(a) `Driver.CheckoutRepo` 从 `payload.Repos[]` 按 URL 查出 `Role` + `NodeRunID`（从 payload）：
```go
	func (d *Driver) CheckoutRepo(taskID, repoURL, baseBranch string) (string, error) {
		...
		role := lookupRepoRole(rec.payload.Repos, repoURL)  // "code" | "delivery"
		nodeRunID := rec.payload.NodeRunID
		return d.workspaceManager.CheckoutRepo(rec.payload.WorkspaceID, rec.taskRoot, repoURL,
			rec.payload.Agent, taskID, baseBranch, token, role, nodeRunID)
	}
```
(b) `WorkspaceManager.CheckoutRepo` 加 `role, nodeRunID string` 参数。分支命名按 role：
```go
	var branchName string
	if role == "delivery" {
		branchName = "node/" + shortID(nodeRunID)
	} else {
		branchName = agentBranch(agentName, taskID)
	}
```

- [ ] **Step 3:** 测试通过 + Commit: `feat(workflowrunner): role-aware CheckoutRepo — delivery uses node/<shortNodeRunID> branch`

---

## Task 6: cs-cloud — deliverable submit document → worktree-based

**Files:** `internal/cli/gitea.go`（`submitDeliverable` ~line 246-314）

- [ ] **Step 1:** 写失败测试——document submit 读 `CS_CLOUD_WORKTREE`（不 tmp-clone），push worktree 的分支 + 开 PR。

- [ ] **Step 2:** `submitDeliverable` document 路径改为 worktree-based（跟 `--mr` 同构）：
- 读 `CS_CLOUD_WORKTREE`（agent 已 checkout 的 Gitea worktree）。
- **不** MkdirTemp + Clone。
- 读当前分支（`gitOps.CurrentBranch(worktree)`）—— 是 `node/<short>` 分支（CheckoutRepo 建的）。
- 写文件（`WriteFile` 到 worktree 内 deliverable path）。
- Commit + Push（push worktree 的分支到 Gitea，token 注入 URL）。
- `openGiteaPR`（head=当前分支, base=inst branch）。
- `reportDeliverablePR`。
- 保留 env 读取（MULTICA_GITEA_OWNER/REPO/INST_BRANCH/TOKEN 等）用于 PR API + push URL。

- [ ] **Step 3:** 测试通过 + Commit: `refactor(cli): deliverable submit document path uses worktree (unify with code --mr)`

---

## Task 7: multica — prompt 教 agent checkout Gitea 仓库

**Files:** `internal/service/task_cscloud_push.go`（`appendDeliverablePrompt` ~line 446-466）

- [ ] **Step 1:** 改 document deliverable prompt——从「`git clone $MULTICA_REPO_CLONE_URL_AUTHED` + `deliverable submit --file`」改成「`cs-cloud repo checkout <gitea-url> --base <inst>` → 在 worktree 写文档 → `deliverable submit --deliverable <id>`（不 --file，worktree 已有）」。
```go
	b.WriteString("对每个 document 交付物：调 `cs-cloud repo checkout <delivery-repo-url> --base <inst-branch>` 拉取 Gitea 交付仓库到 worktree，在 worktree 内写文档，然后 `cs-cloud deliverable submit --deliverable <id>` 推送 + 开 PR。\n")
```

- [ ] **Step 2:** 编译 + Commit: `feat(cscloud): prompt agent to checkout Gitea delivery repo for document deliverables`

---

## Task 8: 端到端验证

- [ ] 两边全量单测。
- [ ] mock E2E（仿 M2 的 mock 设备）：document task push → mock 回调 → 验证 repos[] 含 delivery + deliverables 有 repo_alias + node-run handback 注入 prior。
- [ ] 确认：document deliverable 走 checkout → worktree → submit（不再 tmp-clone）。

---

## Self-Review 记录

- **Spec 覆盖**：M2.5 覆盖 §5（repos[] delivery schema）、§7.5（代码 MR 归档基建——repos[] 为归档提供结构化 delivery 仓库）、§8（Gitea 资源就绪 dispatch 兜底）、§10.1（dispatch interface-8 + repos[] delivery + prompt）、§6.4 node-run handback（M2 延后的）。
- **已确认决策**：A 完全统一（document 走 M2 checkout）、cs-cloud role 感知分支（node/<shortNodeRunID>）、node-run handback 移植、TaskService TeamNamespace 注入。
- **延后**：split 子 issue 交付物归档 → M5（依赖 split 实现）。GC → M3。critic → M4。
- **已知简化**：document deliverable submit 保留 env 读取（MULTICA_GITEA_*）用于 PR API + push URL（repos[] 主要给 checkout 用）；env 作 fallback。

---

**M2.5 完成后**：M3（GC 全栈）→ M4（critic 合并/关闭）→ M5（split + 归档 + 子 issue 交付物归档）。
