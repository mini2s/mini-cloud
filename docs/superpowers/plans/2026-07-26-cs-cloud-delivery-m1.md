# cs-cloud 交付物重设计 M1：端到端 payload + agent CLI + 显式回报

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** multica 升级 dispatch payload（`repos[]` + `deliverables[]` + 项目多仓库选仓库修复），cs-cloud 消费新 payload、砍掉 daemon 自动创 MR（`OpenCodeMR`）、扩展 `deliverable submit` CLI 支持 GitLab MR、显式回报 PR URL——消除「代码 MR 靠正则抠 URL」的硬伤。

**Architecture:** multica `dispatchTaskToCSCloud` 组装结构化 `repos[]`/`deliverables[]`；cs-cloud `TaskRunPayload` 加对应字段消费；砍 `driver.execute` 的 `OpenCodeMR` 段 + 删 `coderepo.go`；`deliverable submit` CLI 加 GitLab provider 分支（`openGitlabMR`）；回报复用 `reportDeliverablePR`（不区分 provider）。

**Tech Stack:** Go（multica server `github.com/multica-ai/multica/server` + cs-cloud `module cs-cloud`），标准 `testing` + `httptest`，无 testify。

**Spec:** `docs/superpowers/specs/2026-07-26-cs-cloud-delivery-redesign-design.md`（§5/§7/§10）

---

## File Structure

**multica（`e:\Projects\multica\server\`）：**
- `internal/service/task_cscloud_push.go` — 改 `csCloudTaskRunPayload`（加 `Repos`/`Deliverables`）、`resolveCodeRepoAndProject`（返回多仓库）、`buildCSCloudPayload`（组装）、`appendCodeRepoPrompt`（prompt 教 agent 用 CLI）
- `internal/service/task_cscloud_push_test.go` — 新增/扩展测试

**cs-cloud（`e:\Projects\cs-cloud\`）：**
- `internal/workflow/models.go` — `TaskRunPayload` 加 `Repos`/`Deliverables` 字段
- `internal/workflowrunner/driver.go` — 砍 `execute` 的 `OpenCodeMR` 段（line 340-354）
- `internal/workflowrunner/coderepo.go` — **删除整文件**（`runGitCtx` 在 `workspace.go`，保留）
- `internal/cli/gitea.go` — `submitDeliverable` 加 provider 分发 + 新增 `openGitlabMR` + `readGitlabCredential`
- `internal/cli/gitea_test.go` — 加 GitLab happy-path 测试
- `internal/workflowrunner/driver_test.go` — 砍 OpenCodeMR 后的回归测试

---

## Task 1: multica — 新增 RepoSpec/DeliverableSpec struct + payload 字段

**Files:**
- Modify: `server/internal/service/task_cscloud_push.go`（`csCloudTaskRunPayload` 定义在 line 40-54）
- Test: `server/internal/service/task_cscloud_push_test.go`

- [ ] **Step 1: 写失败测试——payload 序列化含 repos/deliverables**

在 `task_cscloud_push_test.go` 加：
```go
func TestCsCloudPayloadSerializesReposAndDeliverables(t *testing.T) {
	payload := csCloudTaskRunPayload{
		TaskID: "t-1", WorkspaceID: "ws", Agent: "csc", Prompt: "p",
		Repos: []csCloudRepoSpec{
			{URL: "https://gitlab.example.com/o/r.git", Provider: "gitlab", Role: "code", BaseBranch: "main", Alias: "后端"},
		},
		Deliverables: []csCloudDeliverableSpec{
			{ID: "d1", Kind: "pull_request", RepoAlias: "后端"},
		},
	}
	raw, err := json.Marshal(payload)
	if err != nil { t.Fatalf("marshal: %v", err) }
	var got csCloudTaskRunPayload
	if err := json.Unmarshal(raw, &got); err != nil { t.Fatalf("unmarshal: %v", err) }
	if len(got.Repos) != 1 || got.Repos[0].URL != "https://gitlab.example.com/o/r.git" {
		t.Errorf("repos round-trip mismatch: %+v", got.Repos)
	}
	if len(got.Deliverables) != 1 || got.Deliverables[0].Kind != "pull_request" {
		t.Errorf("deliverables round-trip mismatch: %+v", got.Deliverables)
	}
}
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd server && go test ./internal/service/ -run TestCsCloudPayloadSerializesReposAndDeliverables -v`
Expected: FAIL（`csCloudRepoSpec`/`csCloudDeliverableSpec` undefined）

- [ ] **Step 3: 加 struct + payload 字段**

在 `task_cscloud_push.go` 的 `csCloudTaskRunPayload` 上方加：
```go
// csCloudRepoSpec describes one repository the agent may work in.
type csCloudRepoSpec struct {
	URL        string `json:"url"`
	Provider   string `json:"provider"`           // "gitlab" | "gitea"
	Role       string `json:"role"`               // "code" | "delivery"
	BaseBranch string `json:"base_branch"`        // code=远端默认；delivery=inst branch
	Alias      string `json:"alias,omitempty"`    // 给 agent 的语义标签
	BotToken   string `json:"bot_token,omitempty"` // 仅 delivery（Gitea team bot）；code 不带（CLI 现取）
}

// csCloudDeliverableSpec is one deliverable contract for the node.
type csCloudDeliverableSpec struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`           // "document" | "pull_request"
	RepoAlias string `json:"repo_alias,omitempty"` // 映射 repos[].alias，提示用哪个仓库（选择权仍在 agent）
	Report    csCloudReportSpec `json:"report"`
}

type csCloudReportSpec struct {
	Endpoint  string `json:"endpoint"`   // 如 /api/node-runs/{nid}/deliverables/{did}/submit
	Method    string `json:"method"`     // "POST"
	BodyField string `json:"body_field"` // "pull_request_url"
}
```

改 `csCloudTaskRunPayload`（line 40-54）：把 `RepoURL string` 替换成 `Repos` + `Deliverables`，删掉 `RepoURL`（被 `Repos` 取代）：
```go
type csCloudTaskRunPayload struct {
	TaskID      string            `json:"task_id"`
	WorkspaceID string            `json:"workspace_id"`
	IssueID     string            `json:"issue_id,omitempty"`
	ProjectID   string            `json:"project_id,omitempty"`
	NodeRunID   string            `json:"node_run_id,omitempty"`
	AgentID     string            `json:"agent_id,omitempty"`
	Agent       string            `json:"agent"`
	Prompt      string            `json:"prompt"`
	Env         map[string]string `json:"env,omitempty"`
	Kind        string            `json:"kind,omitempty"`
	Repos       []csCloudRepoSpec        `json:"repos,omitempty"`
	Deliverables []csCloudDeliverableSpec `json:"deliverables,omitempty"`
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd server && go test ./internal/service/ -run TestCsCloudPayloadSerializesReposAndDeliverables -v`
Expected: PASS

- [ ] **Step 5: 编译全包，修后续 task 引用 RepoURL 的编译错误（暂时留 TODO 注释，Task 3 处理）**

Run: `cd server && go build ./internal/service/`
Expected: `buildCSCloudPayload` 里 `RepoURL: codeRepoURL` 编译错——先注释掉那行 + 加 `// TODO Task 3: 用 Repos 取代`，让编译过。

- [ ] **Step 6: Commit**

```bash
git -C /e/Projects/multica add server/internal/service/task_cscloud_push.go server/internal/service/task_cscloud_push_test.go
git -C /e/Projects/multica commit -m "feat(cscloud): add repos/deliverables structs to task payload"
```

---

## Task 2: multica — resolveCodeRepoAndProject 改返回多仓库

**Files:**
- Modify: `server/internal/service/task_cscloud_push.go`（`resolveCodeRepoAndProject` line 236-264）
- Test: `server/internal/service/task_cscloud_push_test.go`

现状：`resolveCodeRepoAndProject` 只取 workspace `repos` 第一条非空 URL（line 242-247），忽略 project 的 github_repo resources。改成返回项目绑定的若干仓库（对齐 daemon 的 `handler/daemon.go:1290` 逻辑）。

- [ ] **Step 1: 写失败测试——project 多仓库全部返回**

```go
func TestResolveCodeRepoAndProject_ProjectMultipleRepos(t *testing.T) {
	// 建一个 project + 两条 github_repo resource + issue 挂该 project
	// 调 resolveCodeRepoAndProject，期望返回 2 条 repo（按 project_resource，不按 workspace）
	// （用现有 test fixture 模式；具体 setup 参考同文件其它 resolve 测试）
}
```
（执行时参照 `task_cscloud_push_test.go` 现有 fixture 风格补全 setup；若该文件无 DB fixture，改用 handler 层测试 `server/internal/handler/daemon_test.go:1751` 的 `TestClaimTask_ProjectGithubReposOverrideWorkspaceRepos` 模式。）

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd server && go test ./internal/service/ -run TestResolveCodeRepoAndProject_ProjectMultipleRepos -v`
Expected: FAIL（现状只返回第一条）

- [ ] **Step 3: 改 resolveCodeRepoAndProject 返回 []csCloudRepoSpec**

把签名从 `(repoURL, gitlabToken, projectID string)` 改成 `(repos []csCloudRepoSpec, projectID string)`。逻辑：
1. 若 issue 有 project_id → 查 project_resources（`Queries.ListProjectResourcesByProject` 或现有查询），把 `resource_type='github_repo'` 的 URL 全部收集成 `repos`（provider=gitlab, role=code, base_branch 留空由 cs-cloud 解析远端默认）。
2. 若 project 无 github_repo → fallback 到 workspace `repos`（全部非空 URL，line 241-247 现状逻辑改成遍历全部而非 break 第一条）。
3. gitlabToken 仍从 workspace settings `gitlab_access_token` 读（保留），通过 env 下发（Task 3）。

```go
func (s *TaskService) resolveCodeRepoAndProject(ctx context.Context, task db.MulticaAgentTaskQueue, workspaceID pgtype.UUID) (repos []csCloudRepoSpec, gitlabToken, projectID string) {
	// 1. project github_repo resources（覆盖 workspace）
	if task.IssueID.Valid {
		if issue, err := s.Queries.GetIssue(ctx, task.IssueID); err == nil && issue.ProjectID.Valid {
			projectID = util.UUIDToString(issue.ProjectID)
			rows, err := s.Queries.ListProjectResourcesByProject(ctx, issue.ProjectID)
			if err == nil {
				for _, row := range rows {
					if row.ResourceType != "github_repo" { continue }
					var ref struct{ URL string `json:"url"` }
					if json.Unmarshal(row.ResourceRef, &ref) == nil && strings.TrimSpace(ref.URL) != "" {
						repos = append(repos, csCloudRepoSpec{
							URL: ref.URL, Provider: "gitlab", Role: "code",
						})
					}
				}
			}
		}
	}
	// 2. fallback workspace repos
	if len(repos) == 0 {
		if ws, err := s.Queries.GetWorkspace(ctx, workspaceID); err == nil {
			var wsRepos []struct{ URL string `json:"url"` }
			if json.Unmarshal(ws.Repos, &wsRepos) == nil {
				for _, r := range wsRepos {
					if u := strings.TrimSpace(r.URL); u != "" {
						repos = append(repos, csCloudRepoSpec{URL: u, Provider: "gitlab", Role: "code"})
					}
				}
			}
			var settings struct{ GitlabAccessToken string `json:"gitlab_access_token"` }
			if json.Unmarshal(ws.Settings, &settings) == nil {
				gitlabToken = strings.TrimSpace(settings.GitlabAccessToken)
			}
		}
	} else {
		// project repos 命中时仍要读 token
		if ws, err := s.Queries.GetWorkspace(ctx, workspaceID); err == nil {
			var settings struct{ GitlabAccessToken string `json:"gitlab_access_token"` }
			if json.Unmarshal(ws.Settings, &settings) == nil {
				gitlabToken = strings.TrimSpace(settings.GitlabAccessToken)
			}
		}
	}
	return repos, gitlabToken, projectID
}
```
（若 `ListProjectResourcesByProject` 查询不存在，用 `listProjectResourcesForProject` 同款 SQL——参考 `server/internal/handler/project_resource.go` 的查询，必要时加 sqlc query。）

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd server && go test ./internal/service/ -run TestResolveCodeRepoAndProject_ProjectMultipleRepos -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /e/Projects/multica add server/internal/service/task_cscloud_push.go server/internal/service/task_cscloud_push_test.go
git -C /e/Projects/multica commit -m "fix(cscloud): resolve all project github_repo resources, not just first workspace repo"
```

---

## Task 3: multica — buildCSCloudPayload 组装 repos/deliverables + env

**Files:**
- Modify: `server/internal/service/task_cscloud_push.go`（`buildCSCloudPayload` line 151-230）

- [ ] **Step 1: 改 buildCSCloudPayload 消费新 resolveCodeRepoAndProject**

把 line 203-215 的 `codeRepoURL, gitlabToken, projectID := s.resolveCodeRepoAndProject(...)` + `env["MULTICA_CODE_REPO_URL"]` + `env["MULTICA_GITLAB_TOKEN"]` + `RepoURL: codeRepoURL` 改成：

```go
// Code repository: resolve project/workspace repos + gitlab token.
repos, gitlabToken, projectID := []csCloudRepoSpec{}, "", ""
if phase == "worker" {
	repos, gitlabToken, projectID = s.resolveCodeRepoAndProject(ctx, task, runtime.WorkspaceID)
	if len(repos) > 0 {
		if gitlabToken != "" {
			env["MULTICA_GITLAB_TOKEN"] = gitlabToken // CLI 现取/复用，对齐 hide tokens
		}
		prompt = appendCodeRepoPrompt(prompt, repos) // 见 Task 4
	}
}
```

返回的 payload（line 217-229）：
```go
return csCloudTaskRunPayload{
	TaskID:       util.UUIDToString(task.ID),
	WorkspaceID:  util.UUIDToString(runtime.WorkspaceID),
	IssueID:      util.UUIDToString(task.IssueID),
	ProjectID:    projectID,
	NodeRunID:    util.UUIDToString(task.WorkflowNodeRunID),
	AgentID:      util.UUIDToString(task.AgentID),
	Agent:        "csc",
	Prompt:       prompt,
	Env:          env,
	Repos:        repos,
	Deliverables: deliverableSpecsForTask(ctx, s, task), // 见下
	Kind:         kind,
}, nil
```

`deliverableSpecsForTask`：查 node 的 deliverables（`ListWorkflowNodeDeliverables`），转成 `[]csCloudDeliverableSpec`（kind + report endpoint）。`pull_request` → report `/api/node-runs/{nid}/deliverables/{did}/submit`；`document` → `/api/daemon/node-runs/{nid}/deliverables/{did}/report-pr`。

```go
func deliverableSpecsForTask(ctx context.Context, s *TaskService, task db.MulticaAgentTaskQueue) []csCloudDeliverableSpec {
	if !task.WorkflowNodeRunID.Valid { return nil }
	nr, err := s.Queries.GetWorkflowNodeRun(ctx, task.WorkflowNodeRunID)
	if err != nil { return nil }
	rows, err := s.Queries.ListWorkflowNodeDeliverables(ctx, nr.WorkflowNodeID)
	if err != nil { return nil }
	nid := util.UUIDToString(nr.ID)
	var out []csCloudDeliverableSpec
	for _, d := range rows {
		spec := csCloudDeliverableSpec{ID: util.UUIDToString(d.ID), Kind: string(d.Kind)}
		switch d.Kind {
		case "pull_request":
			spec.Report = csCloudReportSpec{
				Endpoint: "/api/node-runs/" + nid + "/deliverables/" + util.UUIDToString(d.ID) + "/submit",
				Method: "POST", BodyField: "pull_request_url",
			}
		case "document":
			spec.Report = csCloudReportSpec{
				Endpoint: "/api/daemon/node-runs/" + nid + "/deliverables/" + util.UUIDToString(d.ID) + "/report-pr",
				Method: "POST", BodyField: "pull_request_url",
			}
		}
		out = append(out, spec)
	}
	return out
}
```

- [ ] **Step 2: 编译 + 跑现有 service 测试**

Run: `cd server && go build ./internal/service/ && go test ./internal/service/ -run TestCSCloud -v`
Expected: 编译过、现有测试过（若有 `RepoURL` 断言需更新）

- [ ] **Step 3: Commit**

```bash
git -C /e/Projects/multica add server/internal/service/task_cscloud_push.go
git -C /e/Projects/multica commit -m "feat(cscloud): build payload with repos + deliverables contract"
```

---

## Task 4: multica — appendCodeRepoPrompt 改教 agent 用 deliverable submit

**Files:**
- Modify: `server/internal/service/task_cscloud_push.go`（`appendCodeRepoPrompt` line 268-279）

现状 prompt 说「平台会自动提交/推送/开 MR」（line 276）——这是 daemon 自动创 MR 的暗示，M1 砍掉后要改成教 agent 自己用 CLI 开 MR。

- [ ] **Step 1: 改 appendCodeRepoPrompt 签名 + 文案**

签名从 `(prompt, repoURL string)` 改成 `(prompt string, repos []csCloudRepoSpec)`：
```go
func appendCodeRepoPrompt(prompt string, repos []csCloudRepoSpec) string {
	var b strings.Builder
	b.WriteString(prompt)
	if prompt != "" && !strings.HasSuffix(prompt, "\n") { b.WriteByte('\n') }
	b.WriteString("\n---\n## 代码仓库开发\n\n")
	b.WriteString("你的工作环境已准备好以下代码仓库（选你要改的那个，调用 `cs-cloud repo checkout <url>` 拉取到本地后编辑）：\n")
	for _, r := range repos {
		label := r.Alias
		if label == "" { label = r.URL }
		fmt.Fprintf(&b, "- %s (`%s`)\n", label, r.URL)
	}
	b.WriteString("\n完成编码后，对每个 `kind=pull_request` 交付物：在工作区内 `git add/commit`，然后运行 `cs-cloud deliverable submit --repo <url> --deliverable <id> --mr` 开 Merge Request 并自动上报 MR 链接。\n")
	b.WriteString("Token 从环境变量读取（`$MULTICA_GITLAB_TOKEN`），无需自己找。**不要**等平台自动开 MR——你自己用 CLI 开。\n")
	b.WriteString("\n---\n\n")
	return b.String()
}
```

- [ ] **Step 2: 编译 + 跑测试**

Run: `cd server && go build ./internal/service/ && go test ./internal/service/ -v`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git -C /e/Projects/multica add server/internal/service/task_cscloud_push.go
git -C /e/Projects/multica commit -m "feat(cscloud): prompt agent to open MR via deliverable submit CLI"
```

---

## Task 5: cs-cloud — TaskRunPayload 加 Repos/Deliverables 字段

**Files:**
- Modify: `e:\Projects\cs-cloud\internal\workflow\models.go`（`TaskRunPayload` line 68-85）
- Test: `e:\Projects\cs-cloud\internal\workflow\models_test.go`（新建或扩展）

- [ ] **Step 1: 写失败测试——payload 反序列化 repos/deliverables**

```go
// models_test.go
package workflow

import "encoding/json"
import "testing"

func TestTaskRunPayloadReposAndDeliverables(t *testing.T) {
	raw := `{"task_id":"t1","agent":"csc","prompt":"p",
		"repos":[{"url":"https://gitlab/o/r.git","provider":"gitlab","role":"code"}],
		"deliverables":[{"id":"d1","kind":"pull_request"}]}`
	var p TaskRunPayload
	if err := json.Unmarshal([]byte(raw), &p); err != nil { t.Fatalf("unmarshal: %v", err) }
	if len(p.Repos) != 1 || p.Repos[0].URL != "https://gitlab/o/r.git" {
		t.Errorf("repos: %+v", p.Repos)
	}
	if len(p.Deliverables) != 1 || p.Deliverables[0].Kind != "pull_request" {
		t.Errorf("deliverables: %+v", p.Deliverables)
	}
}
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd /e/Projects/cs-cloud && go test ./internal/workflow/ -run TestTaskRunPayloadReposAndDeliverables -v`
Expected: FAIL（`p.Repos`/`p.Deliverables` undefined）

- [ ] **Step 3: 加 RepoSpec/DeliverableSpec struct + TaskRunPayload 字段**

在 `models.go` 加（和 multica 的 struct 镜像，json tag 一致）：
```go
type RepoSpec struct {
	URL        string `json:"url"`
	Provider   string `json:"provider"`
	Role       string `json:"role"`
	BaseBranch string `json:"base_branch,omitempty"`
	Alias      string `json:"alias,omitempty"`
	BotToken   string `json:"bot_token,omitempty"`
}

type DeliverableSpec struct {
	ID        string       `json:"id"`
	Kind      string       `json:"kind"`
	RepoAlias string       `json:"repo_alias,omitempty"`
	Report    ReportSpec   `json:"report"`
}

type ReportSpec struct {
	Endpoint  string `json:"endpoint"`
	Method    string `json:"method"`
	BodyField string `json:"body_field"`
}
```

`TaskRunPayload` 加字段（保留 `RepoURL` 供过渡，标 deprecated）：
```go
type TaskRunPayload struct {
	// ... 现有字段 ...
	RepoURL      string            `json:"repo_url,omitempty"` // deprecated: 被 Repos 取代，M2 移除
	Kind         string            `json:"kind,omitempty"`
	Repos        []RepoSpec        `json:"repos,omitempty"`
	Deliverables []DeliverableSpec `json:"deliverables,omitempty"`
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd /e/Projects/cs-cloud && go test ./internal/workflow/ -run TestTaskRunPayloadReposAndDeliverables -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /e/Projects/cs-cloud add internal/workflow/models.go internal/workflow/models_test.go
git -C /e/Projects/cs-cloud commit -m "feat(workflow): add repos/deliverables to TaskRunPayload"
```

---

## Task 6: cs-cloud — 砍 driver.execute 的 OpenCodeMR 段 + 删 coderepo.go

**Files:**
- Modify: `e:\Projects\cs-cloud\internal\workflowrunner\driver.go`（删 line 340-354 的 if 块）
- Delete: `e:\Projects\cs-cloud\internal\workflowrunner\coderepo.go`（整文件）
- Test: `e:\Projects\cs-cloud\internal\workflowrunner\driver_test.go`

- [ ] **Step 1: 写失败测试——代码任务不再自动开 MR（output 不含 "Merge request:"）**

在 `driver_test.go` 加（参照现有 fakeMultica httptest 模式）：
```go
func TestExecute_CodeRepoNoAutoMR(t *testing.T) {
	// payload 带 Repos（代码仓库）+ Deliverables（pull_request）
	// 跑 execute，断言 CompleteTask 收到的 output 不含 "Merge request:"
	// （MR 创接交给 agent CLI，driver 不再自动开）
}
```
（执行时参照 `driver_test.go` 现有 `fakeMultica` + 任务跑 fake agent 的 setup。）

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd /e/Projects/cs-cloud && go test ./internal/workflowrunner/ -run TestExecute_CodeRepoNoAutoMR -v`
Expected: FAIL（现状 output 含 "Merge request:"）

- [ ] **Step 3: 删 driver.execute 的 OpenCodeMR 段**

`driver.go` 删掉 line 340-354 整段（从 `// Code-repo task: commit...` 到 `}`），让 execute 在 PostTaskMessages + 错误检查后直接 `return d.client.CompleteTask(ctx, payload.TaskID, output)`。同时删文件头 `strings` import（若仅此处用——确认后再删，`truncateOutput` 等可能也用 strings）。

- [ ] **Step 4: 删 coderepo.go 整文件**

```bash
git -C /e/Projects/cs-cloud rm internal/workflowrunner/coderepo.go
```
**先确认**：`runGitCtx`（在 workspace.go:181，不在 coderepo.go）保留；`gitOutput`/`sanitizeBranchSegment`/`worktreeHasStagedChanges`/`defaultBranch`/`createGitlabMR`/`codeRepoParts`/`codeMRHTTPClient` 都只在 coderepo.go 用，随文件删。

- [ ] **Step 5: 编译 + 跑测试**

Run: `cd /e/Projects/cs-cloud && go build ./... && go test ./internal/workflowrunner/ -v`
Expected: 编译过、新测试 PASS、现有测试可能需更新（砍了 OpenCodeMR 相关断言）

- [ ] **Step 6: Commit**

```bash
git -C /e/Projects/cs-cloud add -A
git -C /e/Projects/cs-cloud commit -m "refactor(workflowrunner): remove daemon-auto OpenCodeMR, MR now opened by agent CLI"
```

---

## Task 7: cs-cloud — deliverable submit 扩展支持 GitLab MR

**Files:**
- Modify: `e:\Projects\cs-cloud\internal\cli\gitea.go`（`submitDeliverable` line 172-236 + 新增 `openGitlabMR` + `readGitlabCredential`）
- Modify: `e:\Projects\cs-cloud\internal\cli\workflow.go`（`deliverableCmd` 加 `--mr` flag 透传）
- Test: `e:\Projects\cs-cloud\internal\cli\gitea_test.go`

关键（调研结论）：`reportDeliverablePR` 不区分 provider，复用即可。GitLab 走 `worktree`（agent 工作目录，已被 agent checkout），不像 Gitea 走临时 dir clone。所以 GitLab 分支更简单：不 clone/不 writefile，只 push 当前分支 + 开 MR + report。

- [ ] **Step 1: 写失败测试——GitLab happy path（push + 开 MR + report）**

在 `gitea_test.go` 加（参照现有 Gitea 测试的 httptest + fakeGitOps 模式）：
```go
func TestSubmitDeliverable_GitLabMR(t *testing.T) {
	// env: MULTICA_GITLAB_TOKEN, MULTICA_SERVER_URL, MULTICA_TOKEN, MULTICA_NODE_RUN_ID
	// httptest fake: GitLab POST /api/v4/projects/<enc>/merge_requests → 200 {web_url}
	//                multica POST /api/daemon/node-runs/.../report-pr → 200
	// 调 submitDeliverable（provider=gitlab, --mr 模式）
	// 断言: GitLab 收到 merge_requests 请求（header PRIVATE-TOKEN, body source_branch/target_branch）
	//       multica 收到 report-pr（pull_request_url = web_url）
	//       fakeGitOps.Push 被调用（push 当前分支）
}
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd /e/Projects/cs-cloud && go test ./internal/cli/ -run TestSubmitDeliverable_GitLabMR -v`
Expected: FAIL（`openGitlabMR` undefined / 无 gitlab 分支）

- [ ] **Step 3: 加 openGitlabMR + readGitlabCredential**

在 `gitea.go` 加（镜像 `openGiteaPR`，差异：endpoint `/api/v4/projects/<urlencoded>/merge_requests`、header `PRIVATE-TOKEN`、字段 `web_url`）：
```go
func openGitlabMR(ctx context.Context, base, token, repoURL, sourceBranch, targetBranch, title string) (string, error) {
	project := strings.TrimSuffix(strings.TrimPrefix(repoURL, base+"/"), ".git")
	// 更稳：用 url.Parse 提取 path（参照 coderepo.go 旧 codeRepoParts，但那已删——这里重写一个精简版）
	body, _ := json.Marshal(map[string]string{
		"source_branch": sourceBranch,
		"target_branch": targetBranch,
		"title":         title,
	})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost,
		strings.TrimRight(base, "/")+"/api/v4/projects/"+url.PathEscape(project)+"/merge_requests",
		bytes.NewReader(body))
	req.Header.Set("PRIVATE-TOKEN", token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := giteaHTTPClient.Do(req)
	if err != nil { return "", fmt.Errorf("gitlab MR request: %w", err) }
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("gitlab MR: status %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}
	var mr struct{ WebURL string `json:"web_url"` }
	if err := json.Unmarshal(respBody, &mr); err != nil { return "", err }
	if mr.WebURL == "" { return "", fmt.Errorf("empty web_url") }
	return mr.WebURL, nil
}

func readGitlabCredential() (base, token string, err error) {
	token = strings.TrimSpace(os.Getenv("MULTICA_GITLAB_TOKEN"))
	if token == "" {
		return "", "", fmt.Errorf("MULTICA_GITLAB_TOKEN not set")
	}
	// base 从 repo URL 推导（调用方传 repoURL 时算），或 env MULTICA_GITLAB_BASE_URL
	base = strings.TrimSpace(os.Getenv("MULTICA_GITLAB_BASE_URL"))
	return base, token, nil
}
```

- [ ] **Step 4: 改 submitDeliverable 加 provider 分发 + --mr 模式**

`submitConfig` 加字段：
```go
type submitConfig struct {
	// ... 现有 ...
	provider  string // "gitea" | "gitlab"，从 --mr flag 或 repo 推断
	mrMode    bool   // --mr: GitLab 代码 MR 模式（不 clone/writefile，只 push+开MR+report）
	repoURL   string // GitLab 模式：代码仓库 URL
}
```

`parseSubmitArgs` 加 `--repo <url>` + `--mr` flag。`runGiteaSubmit` 透传。

`submitDeliverable` 加 gitlab 分支（在 gitea 分支之前判断）：
```go
func submitDeliverable(cfg submitConfig) error {
	if cfg.mrMode {
		return submitGitlabMR(cfg) // 新函数：push 当前 worktree 分支 + openGitlabMR + reportDeliverablePR
	}
	// ... 现有 gitea 流程不变 ...
}
```

`submitGitlabMR`：从 env 读 worktree 路径（`CS_CLOUD_WORKTREE`）+ node_run_id；push 当前分支到 repo（token 注入 URL，参照 injectTokenIntoURL）；调 `openGitlabMR`；调 `reportDeliverablePR`（endpoint 用 `/api/node-runs/{nid}/deliverables/{did}/submit`，body 同 `pull_request_url`——submit 端点和 report-pr 端点 body 一致，复用 reportDeliverablePR 但 endpoint 可参数化）。

注意：`reportDeliverablePR` 现在硬编码 report-pr 端点。改成 endpoint 可传参（或新加 `reportSubmit` 调 submit 端点）。两者 body 都是 `{"pull_request_url": "..."}`，只是路径不同。

- [ ] **Step 5: 运行测试，确认通过**

Run: `cd /e/Projects/cs-cloud && go test ./internal/cli/ -run TestSubmitDeliverable_GitLabMR -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git -C /e/Projects/cs-cloud add internal/cli/gitea.go internal/cli/gitea_test.go internal/cli/workflow.go
git -C /e/Projects/cs-cloud commit -m "feat(cli): deliverable submit supports GitLab MR via --mr"
```

---

## Task 8: 端到端集成验证

**Files:**
- Manual / E2E（无新文件）

- [ ] **Step 1: multica + cs-cloud 各自跑全量单测**

```bash
cd /e/Projects/multica/server && go test ./internal/service/ ./internal/handler/ -v
cd /e/Projects/cs-cloud && go test ./...
```
Expected: 全 PASS

- [ ] **Step 2: 端到端冒烟（需要本地 multica + cs-cloud + GitLab 跑起来）**

1. 建一个带 `pull_request` deliverable 的 workflow node + 绑定 GitLab 代码仓库的 project。
2. dispatch 给 cs-cloud，确认 payload 含 `repos[]` + `deliverables[]`（看 cs-cloud daemon 日志或加临时 debug）。
3. agent（csc）执行：调 `cs-cloud deliverable submit --repo <url> --deliverable <id> --mr`。
4. 断言：
   - GitLab 上出现 MR（agent 的分支 → 默认分支）。
   - multica 该 deliverable 的 `pull_request_url` 落库（**不靠正则**，是 CLI 显式 report）。
   - task output **不含** "Merge request:"（OpenCodeMR 已砍）。

- [ ] **Step 3: 确认硬伤消除**

- 代码 MR URL 由 CLI 显式 report → `extractPullRequestURLFromWorkerOutput` 正则不再是主路径（保留作 fallback）。
- 文档/代码都用 `cs-cloud deliverable submit`（代码加 `--mr`）→ 两套割裂消除。

- [ ] **Step 4: Commit（若有 fix）+ 打 M1 完成标记**

```bash
git -C /e/Projects/multica commit --allow-empty -m "chore(cscloud): M1 complete — payload + agent CLI + explicit report"
```

---

## Self-Review 记录

- **Spec 覆盖**：M1 覆盖 spec §5（payload schema repos/deliverables）、§7.1-7.3（提交/MR/显式回报）、§10.1（multica dispatch payload + 选仓库修复）。续接（§6.4）、GC（§9）、critic（§12）、split（§13）、归档（§7.5）留 M2-M5。
- **placeholder**：Task 2 的测试 setup 让执行者参照现有 fixture（因 service 层 DB fixture 模式要看现有代码），这是合理的执行指引，不是占位。
- **类型一致**：`csCloudRepoSpec`/`csCloudDeliverableSpec`（multica）与 `RepoSpec`/`DeliverableSpec`（cs-cloud）json tag 镜像对齐。
- **已知简化**：M1 保留 `payload.Env["MULTICA_GITLAB_TOKEN"]`（现状机制），token 的结构化（repos[].bot_token 仅 delivery）在 M2 随 worktree 一起做；M1 代码 MR token 走 env 是务实过渡，不违背 hide tokens（仍是服务端下发、不暴露前端）。

---

**M1 完成后**：续接（M2，prior_session_id + PinTaskSession + csc serve load）→ worktree 对齐 multica repocache → GC（M3）→ critic（M4）→ split+归档（M5）。
