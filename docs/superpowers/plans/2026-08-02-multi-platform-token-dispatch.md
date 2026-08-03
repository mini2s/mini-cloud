# 多平台 token 下发 + cs-cloud 提交分流 — Implementation Plan (Spec B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** multica 按 code repo URL 域名推断 GitLab/GitHub，下发对应平台 token + `CS_CLOUD_CODE_PROVIDER` env；cs-cloud 提交侧按 Provider 分流（GitLab MR / GitHub PR / Gitea delivery），补齐 GitHub PR 路径。设置页 GitHub tab 加 PAT 入口（与 Spec A 合并）。

**Architecture:** multica 侧 `codeRepoProvider` helper 推断 provider → `resolveCodeRepoAndProject` 返回 provider-aware repos + 双 token → `buildCSCloudPayload` 按 provider 设 env → `appendCodeRepoPrompt` 按 provider 给鉴权提示。cs-cloud 侧 `submitDeliverable` 读 `CS_CLOUD_CODE_PROVIDER` env 分流（github→新 `submitGithubPR`，gitlab→现有 `submitGitlabMR`，gitea/delivery→现有路径），`injectTokenIntoURL` 按 host 选 `x-access-token` vs `oauth2`。

**Tech Stack:** Go (Chi/sqlc), TypeScript (React + TanStack Query), Vitest, i18n (en + zh-Hans with parity test).

**Spec:** [docs/superpowers/specs/2026-08-02-multi-platform-token-dispatch-design.md](../specs/2026-08-02-multi-platform-token-dispatch-design.md)

---

## Pre-flight

### multica branch

Spec B depends on Spec A (GitHub PAT UI lands in the Spec A-refactored github-tab; both platform tabs are always-visible only after Spec A). So branch off the Spec A branch:

```bash
git -C /e/Projects/multica switch --create feat/multi-platform-token-dispatch --no-track feat/settings-repo-integration
git -C /e/Projects/multica branch -vv   # confirm NO [origin/main]
```

### cs-cloud branch

```bash
git -C /e/Projects/cs-cloud switch --create feat/multi-platform-token-dispatch --no-track
git -C /e/Projects/cs-cloud branch -vv   # confirm NO [origin/main]
```

> **CRITICAL:** multica repo currently has ANOTHER session editing unrelated files (assignee/responsible + notification). Implementers MUST stage only their own files. NEVER use `git add -A`. Always `git add <explicit-files>`.

---

## File Structure

### multica (`e:\Projects\multica`)

| File | Action |
|---|---|
| `server/internal/service/task_cscloud_push.go` | Modify: `codeRepoProvider` helper, `codeRepoTokens` struct, `resolveCodeRepoAndProject` return type + provider inference, `buildCSCloudPayload` token dispatch + `CS_CLOUD_CODE_PROVIDER`, `appendCodeRepoPrompt` per-provider auth, drop `--mr` from prompt |
| `server/internal/service/task_cscloud_push_test.go` | Modify: update `resolveCodeRepoAndProject` callers, add `codeRepoProvider` test, add provider-aware token/prompt tests |
| `packages/views/settings/components/github-tab.tsx` | Modify: add PAT input section (mirror gitlab-tab access token pattern) |
| `packages/views/locales/en/settings.json` | Modify: add `github.access_token_*` keys |
| `packages/views/locales/zh-Hans/settings.json` | Modify: add `github.access_token_*` keys |

### cs-cloud (`e:\Projects\cs-cloud`)

| File | Action |
|---|---|
| `internal/cli/github.go` | **NEW**: `readGithubCredential`, `githubAPIBase`, `submitGithubPR`, `openGithubPR`, `findExistingGithubPR` |
| `internal/cli/github_test.go` | **NEW**: tests for all above |
| `internal/cli/gitea.go` | Modify: `submitDeliverable` Provider-driven branch, `injectTokenIntoURL`/`injectToken` host-aware username |
| `internal/cli/gitea_test.go` | Modify: update `submitDeliverable` tests, add `injectTokenIntoURL` github cases |

---

## Task 1 (multica): `codeRepoProvider` helper + unit test

**Files:**
- Modify: `server/internal/service/task_cscloud_push.go`
- Modify: `server/internal/service/task_cscloud_push_test.go`

- [ ] **Step 1: Write the failing test**

Append to `server/internal/service/task_cscloud_push_test.go` (after the last test function):

```go
func TestCodeRepoProvider(t *testing.T) {
	tests := []struct {
		name string
		url  string
		want string
	}{
		{"github.com HTTPS", "https://github.com/org/repo.git", "github"},
		{"github.com SSH scheme", "git@github.com:org/repo.git", "github"},
		{"github.com uppercase", "HTTPS://GITHUB.COM/ORG/REPO.GIT", "github"},
		{"gitlab.com", "https://gitlab.com/group/repo.git", "gitlab"},
		{"self-hosted gitlab", "https://gitlab.example.com/group/repo.git", "gitlab"},
		{"self-hosted gitea (code repo via github_repo resource)", "https://gitea.local/org/repo.git", "gitlab"},
		{"empty", "", "gitlab"},
		{"bare hostname", "github.com/org/r", "github"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := codeRepoProvider(tc.url); got != tc.want {
				t.Errorf("codeRepoProvider(%q) = %q, want %q", tc.url, got, tc.want)
			}
		})
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /e/Projects/multica/server && go test ./internal/service/ -run TestCodeRepoProvider -v`
Expected: FAIL — `undefined: codeRepoProvider`.

- [ ] **Step 3: Add the helper function**

In `server/internal/service/task_cscloud_push.go`, add the function near the top of the file (after the `promptMaxRunes` constant block, around line 42):

```go
// codeRepoProvider infers the code-repo platform from the URL host.
// github.com → "github"; everything else → "gitlab".
// Self-hosted GitLab and Gitea (when used as a code repo via github_repo
// resources) both fall under "gitlab" — only GitHub SaaS uses "github".
// Delivery repos (role=delivery) are always "gitea" and bypass this helper.
func codeRepoProvider(rawURL string) string {
	if strings.Contains(strings.ToLower(rawURL), "github.com") {
		return "github"
	}
	return "gitlab"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /e/Projects/multica/server && go test ./internal/service/ -run TestCodeRepoProvider -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /e/Projects/multica add server/internal/service/task_cscloud_push.go server/internal/service/task_cscloud_push_test.go
git -C /e/Projects/multica commit -m "feat(cs-cloud-dispatch): add codeRepoProvider helper for URL-host platform inference"
```

---

## Task 2 (multica): `resolveCodeRepoAndProject` returns `codeRepoTokens` + Provider inference

**Files:**
- Modify: `server/internal/service/task_cscloud_push.go`
- Modify: `server/internal/service/task_cscloud_push_test.go`

This task changes `resolveCodeRepoAndProject` to:
1. Use `codeRepoProvider` instead of hardcoded `"gitlab"` for each repo's Provider field.
2. Read `github_access_token` from workspace settings alongside `gitlab_access_token`.
3. Return a `codeRepoTokens` struct instead of bare `gitlabToken string`.

- [ ] **Step 1: Add the `codeRepoTokens` struct**

In `task_cscloud_push.go`, add the struct after the `codeRepoProvider` helper:

```go
// codeRepoTokens holds the workspace PATs for each code-repo platform.
// Both fields may be empty (token not configured).
type codeRepoTokens struct {
	GitlabToken string
	GithubToken string
}
```

- [ ] **Step 2: Change `resolveCodeRepoAndProject` signature and body**

Replace the function signature and body. The function is at approximately line 456:

```go
// resolveCodeRepoAndProject returns all code repos for the task's issue,
// the workspace's GitLab/GitHub PATs, and the issue's project ID.
//
// Each code repo's Provider is inferred from its URL host via codeRepoProvider
// (github.com → "github", everything else → "gitlab"). Delivery repos are
// NOT handled here (see resolveDeliveryRepo).
//
// Project-bound github_repo resources take priority (all collected). If the
// issue's project has no github_repo resources, falls back to all non-empty
// workspace repos. Best-effort: errors are logged and yield empty results so a
// lookup hiccup never blocks dispatch.
func (s *TaskService) resolveCodeRepoAndProject(ctx context.Context, task db.MulticaAgentTaskQueue, workspaceID pgtype.UUID) (repos []csCloudRepoSpec, tokens codeRepoTokens, projectID string) {
	// 1. Try project github_repo resources (override workspace repos).
	if task.IssueID.Valid {
		if issue, err := s.Queries.GetIssue(ctx, task.IssueID); err == nil && issue.ProjectID.Valid {
			projectID = util.UUIDToString(issue.ProjectID)
			rows, err := s.Queries.ListProjectResources(ctx, issue.ProjectID)
			if err == nil {
				for _, row := range rows {
					if row.ResourceType != "github_repo" {
						continue
					}
					var ref struct {
						URL string `json:"url"`
					}
					if json.Unmarshal(row.ResourceRef, &ref) == nil && strings.TrimSpace(ref.URL) != "" {
						repos = append(repos, csCloudRepoSpec{
							URL:      strings.TrimSpace(ref.URL),
							Provider: codeRepoProvider(ref.URL),
							Role:     "code",
						})
					}
				}
			}
		}
	}

	// 2. Read workspace settings (gitlab + github tokens).
	if ws, err := s.Queries.GetWorkspace(ctx, workspaceID); err == nil {
		var settings struct {
			GitlabAccessToken string `json:"gitlab_access_token"`
			GithubAccessToken string `json:"github_access_token"`
		}
		if json.Unmarshal(ws.Settings, &settings) == nil {
			tokens.GitlabToken = strings.TrimSpace(settings.GitlabAccessToken)
			tokens.GithubToken = strings.TrimSpace(settings.GithubAccessToken)
		}

		// 3. Fallback: if project had no github_repo resources, use all workspace repos.
		if len(repos) == 0 {
			var wsRepos []struct {
				URL string `json:"url"`
			}
			if json.Unmarshal(ws.Repos, &wsRepos) == nil {
				for _, r := range wsRepos {
					if u := strings.TrimSpace(r.URL); u != "" {
						repos = append(repos, csCloudRepoSpec{
							URL:      u,
							Provider: codeRepoProvider(u),
							Role:     "code",
						})
					}
				}
			}
		}
	} else {
		slog.Warn("cs-cloud code repo: get workspace", "error", err)
	}
	return repos, tokens, projectID
}
```

- [ ] **Step 3: Update the caller in `buildCSCloudPayload`**

In the same file, locate the call site in `buildCSCloudPayload` (approximately line 346-353):

Replace:
```go
		repos, gitlabToken, projectID = s.resolveCodeRepoAndProject(ctx, task, runtime.WorkspaceID)
		if len(repos) > 0 {
			if gitlabToken != "" {
				env["CS_CLOUD_GITLAB_TOKEN"] = gitlabToken
			}
			prompt = appendCodeRepoPrompt(prompt, repos)
		}
```

With:
```go
		repos, codeTokens, projectID = s.resolveCodeRepoAndProject(ctx, task, runtime.WorkspaceID)
		if len(repos) > 0 {
			// Dispatch platform token(s) and the code provider indicator so
			// cs-cloud can route the submit to the correct API.
			if codeTokens.GitlabToken != "" {
				env["CS_CLOUD_GITLAB_TOKEN"] = codeTokens.GitlabToken
			}
			if codeTokens.GithubToken != "" {
				env["CS_CLOUD_GITHUB_TOKEN"] = codeTokens.GithubToken
			}
			// CS_CLOUD_CODE_PROVIDER tells cs-cloud's submit path which
			// platform to use for the MR/PR API. Set from the first code
			// repo (the common case is a single code repo).
			if len(repos) > 0 {
				env["CS_CLOUD_CODE_PROVIDER"] = repos[0].Provider
			}
			prompt = appendCodeRepoPrompt(prompt, repos)
		}
```

- [ ] **Step 4: Update existing tests**

In `task_cscloud_push_test.go`, update all tests that call `resolveCodeRepoAndProject` to match the new return type. Locate and update each:

**`TestResolveCodeRepo_FallbackAllWorkspaceRepos`** (approx line 704):

Replace:
```go
		repos, token, projectID := svc.resolveCodeRepoAndProject(context.Background(), task, testUUID(1))

		if token != "tok-abc" {
			t.Fatalf("gitlab token = %q, want tok-abc", token)
		}
```
With:
```go
		repos, tokens, projectID := svc.resolveCodeRepoAndProject(context.Background(), task, testUUID(1))

		if tokens.GitlabToken != "tok-abc" {
			t.Fatalf("gitlab token = %q, want tok-abc", tokens.GitlabToken)
		}
```

**`TestResolveCodeRepo_ProjectResourcesOverrideWorkspace`** (approx line 751):

Replace:
```go
		repos, token, projectID := svc.resolveCodeRepoAndProject(context.Background(), task, testUUID(1))

		if token != "tok-xyz" {
			t.Fatalf("gitlab token = %q, want tok-xyz", token)
		}
```
With:
```go
		repos, tokens, projectID := svc.resolveCodeRepoAndProject(context.Background(), task, testUUID(1))

		if tokens.GitlabToken != "tok-xyz" {
			t.Fatalf("gitlab token = %q, want tok-xyz", tokens.GitlabToken)
		}
```

**`TestResolveCodeRepo_ProjectNoGithubRepoFallsBackToWorkspace`** (approx line 803):

Replace:
```go
		repos, token, projectID := svc.resolveCodeRepoAndProject(context.Background(), task, testUUID(1))

		if token != "tok-fb" {
			t.Fatalf("gitlab token = %q, want tok-fb", token)
		}
```
With:
```go
		repos, tokens, projectID := svc.resolveCodeRepoAndProject(context.Background(), task, testUUID(1))

		if tokens.GitlabToken != "tok-fb" {
			t.Fatalf("gitlab token = %q, want tok-fb", tokens.GitlabToken)
		}
```

**`TestResolveCodeRepo_NoIssueReturnsEmpty`** (approx line 850):

Replace:
```go
		repos, token, projectID := svc.resolveCodeRepoAndProject(context.Background(), task, testUUID(1))

		if token != "" {
			t.Fatalf("token = %q, want empty", token)
		}
```
With:
```go
		repos, tokens, projectID := svc.resolveCodeRepoAndProject(context.Background(), task, testUUID(1))

		if tokens.GitlabToken != "" {
			t.Fatalf("gitlab token = %q, want empty", tokens.GitlabToken)
		}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /e/Projects/multica/server && go test ./internal/service/ -run 'TestResolveCodeRepo|TestCodeRepoProvider' -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C /e/Projects/multica add server/internal/service/task_cscloud_push.go server/internal/service/task_cscloud_push_test.go
git -C /e/Projects/multica commit -m "refactor(cs-cloud-dispatch): resolveCodeRepoAndProject returns codeRepoTokens + infers provider"
```

---

## Task 3 (multica): `appendCodeRepoPrompt` per-Provider auth hint

**Files:**
- Modify: `server/internal/service/task_cscloud_push.go`
- Modify: `server/internal/service/task_cscloud_push_test.go`

- [ ] **Step 1: Write the failing test**

Append to `task_cscloud_push_test.go`:

```go
func TestAppendCodeRepoPrompt_GitlabAuth(t *testing.T) {
	repos := []csCloudRepoSpec{
		{URL: "https://gitlab.example.com/a/backend.git", Provider: "gitlab", Role: "code"},
	}
	got := appendCodeRepoPrompt("", repos)
	// GitLab repos must use oauth2: + CS_CLOUD_GITLAB_TOKEN
	if !strings.Contains(got, "oauth2:${CS_CLOUD_GITLAB_TOKEN}@") {
		t.Fatalf("gitlab prompt missing oauth2 auth hint:\n%s", got)
	}
}

func TestAppendCodeRepoPrompt_GithubAuth(t *testing.T) {
	repos := []csCloudRepoSpec{
		{URL: "https://github.com/org/repo.git", Provider: "github", Role: "code"},
	}
	got := appendCodeRepoPrompt("", repos)
	// GitHub repos must use x-access-token: + CS_CLOUD_GITHUB_TOKEN
	if !strings.Contains(got, "x-access-token:${CS_CLOUD_GITHUB_TOKEN}@") {
		t.Fatalf("github prompt missing x-access-token auth hint:\n%s", got)
	}
}

func TestAppendCodeRepoPrompt_NoHardcodedMrFlag(t *testing.T) {
	repos := []csCloudRepoSpec{
		{URL: "https://github.com/org/repo.git", Provider: "github", Role: "code"},
	}
	got := appendCodeRepoPrompt("", repos)
	// The prompt should NOT hardcode --mr; cs-cloud reads CS_CLOUD_CODE_PROVIDER.
	if strings.Contains(got, "--mr") {
		t.Fatalf("prompt must not hardcode --mr (cs-cloud reads CS_CLOUD_CODE_PROVIDER):\n%s", got)
	}
	// Must still teach cs-cloud workflow deliverable submit --repo <url> --deliverable <id>
	if !strings.Contains(got, "cs-cloud workflow deliverable submit --repo") {
		t.Fatalf("prompt missing submit instruction:\n%s", got)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /e/Projects/multica/server && go test ./internal/service/ -run 'TestAppendCodeRepoPrompt_GitlabAuth|TestAppendCodeRepoPrompt_GithubAuth|TestAppendCodeRepoPrompt_NoHardcodedMrFlag' -v`
Expected: FAIL — current prompt uses `oauth2:${CS_CLOUD_GITLAB_TOKEN}@` unconditionally and hardcodes `--mr`.

- [ ] **Step 3: Rewrite `appendCodeRepoPrompt`**

Replace the function body (approx line 654-674):

```go
// appendCodeRepoPrompt tells the worker agent which code repos are available
// and instructs it to open MRs/PRs via CLI (not via platform auto-MR).
// The clone auth hint is per-provider: gitlab uses oauth2:<token>@,
// github uses x-access-token:<token>@. The submit command does NOT pass
// --mr; cs-cloud reads CS_CLOUD_CODE_PROVIDER env to route to the
// correct platform API.
func appendCodeRepoPrompt(prompt string, repos []csCloudRepoSpec) string {
	var b strings.Builder
	b.WriteString(prompt)
	if prompt != "" && !strings.HasSuffix(prompt, "\n") {
		b.WriteByte('\n')
	}
	b.WriteString("\n---\n## 代码仓库开发\n\n")

	// Determine the primary provider from the first code repo for the
	// clone instruction. (Mixed-repo workspaces are uncommon; both
	// tokens are always set so the agent can clone any repo.)
	primaryProvider := "gitlab"
	if len(repos) > 0 && repos[0].Provider == "github" {
		primaryProvider = "github"
	}

	switch primaryProvider {
	case "github":
		b.WriteString("你的任务根目录是 $CS_CLOUD_WORKTREE。用原生 git clone 把要改的代码仓库拉到任务根目录下：clone 时把仓库 URL 的 `https://` 换成 `https://x-access-token:${CS_CLOUD_GITHUB_TOKEN}@` 来鉴权（token 在环境变量里），然后 cd 进去建分支开发。例如：`git clone https://x-access-token:${CS_CLOUD_GITHUB_TOKEN}@github.com/<owner>/<repo>.git $CS_CLOUD_WORKTREE/<repo> && cd $CS_CLOUD_WORKTREE/<repo>`。\n")
		b.WriteString("Token 从环境变量 `$CS_CLOUD_GITHUB_TOKEN` 读取，无需自己找。**不要**等平台自动开 MR——你自己用 CLI 开。\n")
	default: // gitlab
		b.WriteString("你的任务根目录是 $CS_CLOUD_WORKTREE。用原生 git clone 把要改的代码仓库拉到任务根目录下：clone 时把仓库 URL 的 `https://` 换成 `https://oauth2:${CS_CLOUD_GITLAB_TOKEN}@` 来鉴权（token 在环境变量里），然后 cd 进去建分支开发。例如：`git clone https://oauth2:${CS_CLOUD_GITLAB_TOKEN}@<host>/<group>/<repo>.git $CS_CLOUD_WORKTREE/<repo> && cd $CS_CLOUD_WORKTREE/<repo>`。\n")
		b.WriteString("Token 从环境变量 `$CS_CLOUD_GITLAB_TOKEN` 读取，无需自己找。**不要**等平台自动开 MR——你自己用 CLI 开。\n")
	}

	b.WriteString("可选的代码仓库：\n")
	for _, r := range repos {
		label := r.Alias
		if label == "" {
			label = r.URL
		}
		fmt.Fprintf(&b, "- %s (`%s`)\n", label, r.URL)
	}
	b.WriteString("\n完成编码后，在仓库目录内 `git add/commit`，然后运行 `cs-cloud workflow deliverable submit --repo <url> --deliverable <id>` 开 Merge Request / Pull Request 并自动上报链接（务必在仓库目录内运行该命令）。\n")
	b.WriteString("\n---\n\n")
	return b.String()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /e/Projects/multica/server && go test ./internal/service/ -run 'TestAppendCodeRepoPrompt' -v`
Expected: PASS. Note: the existing `TestAppendCodeRepoPrompt_MultiRepo` test may need updating because it checks for `--mr`. Let us check.

Run: `cd /e/Projects/multica/server && go test ./internal/service/ -run 'TestAppendCodeRepoPrompt_MultiRepo' -v`
If it fails, update the test: remove the assertion that checks for `--mr`:

Replace:
```go
	if !strings.Contains(got, "--mr") {
		t.Fatalf("prompt missing --mr flag:\n%s", got)
	}
```
With (or remove the block entirely — the `TestAppendCodeRepoPrompt_NoHardcodedMrFlag` test already covers the inverse):
```go
	// --mr is no longer in the prompt; cs-cloud reads CS_CLOUD_CODE_PROVIDER.
	if strings.Contains(got, "--mr") {
		t.Fatalf("prompt must not hardcode --mr:\n%s", got)
	}
```

Re-run to confirm PASS.

- [ ] **Step 5: Commit**

```bash
git -C /e/Projects/multica add server/internal/service/task_cscloud_push.go server/internal/service/task_cscloud_push_test.go
git -C /e/Projects/multica commit -m "feat(cs-cloud-dispatch): appendCodeRepoPrompt per-provider auth, drop --mr"
```

---

## Task 4 (multica): `csCloudRepoSpec` comment update

**Files:**
- Modify: `server/internal/service/task_cscloud_push.go`

- [ ] **Step 1: Update the Provider field comment**

In the `csCloudRepoSpec` struct (approx line 45-52), update the Provider comment:

Replace:
```go
	Provider   string `json:"provider"`            // "gitlab" | "gitea"
```
With:
```go
	Provider   string `json:"provider"`            // "gitlab" | "github" | "gitea"
```

- [ ] **Step 2: Commit**

```bash
git -C /e/Projects/multica add server/internal/service/task_cscloud_push.go
git -C /e/Projects/multica commit -m "chore(cs-cloud-dispatch): update csCloudRepoSpec.Provider comment to include github"
```

---

## Task 5 (multica): GitHub PAT UI in github-tab + i18n

**Files:**
- Modify: `packages/views/settings/components/github-tab.tsx`
- Modify: `packages/views/locales/en/settings.json`
- Modify: `packages/views/locales/zh-Hans/settings.json`

- [ ] **Step 1: Add i18n keys to BOTH locale files**

In `packages/views/locales/en/settings.json`, add under `"github"` (after `"toast_failed"`):

```json
    "access_token_label": "Personal Access Token",
    "access_token_hint": "Create a token in GitHub → Settings → Developer settings → Personal access tokens (fine-grained or classic), then paste it here.",
    "toast_access_token_saved": "Access token saved",
    "toast_access_token_save_failed": "Failed to save access token"
```

In `packages/views/locales/zh-Hans/settings.json`, add under `"github"` (after `"toast_failed"`):

```json
    "access_token_label": "个人访问令牌",
    "access_token_hint": "在 GitHub → Settings → Developer settings → Personal access tokens 中创建令牌（fine-grained 或 classic），粘贴到这里。",
    "toast_access_token_saved": "访问令牌已保存",
    "toast_access_token_save_failed": "保存访问令牌失败"
```

Also reuse the existing `gitlab.save_token`, `gitlab.saving`, `gitlab.change_token`, `gitlab.add_token`, `gitlab.show_token`, `gitlab.hide_token`, `gitlab.cancel` keys for the GitHub tab's token UI. These are identical across both tabs. The existing `github-tab.tsx` already imports `useT("settings")`, so `$t($.gitlab.save_token)` works. No new keys needed for those shared labels.

- [ ] **Step 2: Add PAT input section to `github-tab.tsx`**

In `packages/views/settings/components/github-tab.tsx`, add the access token state and save function, then add the UI section. Mirror the pattern from `gitlab-tab.tsx` lines 44-48, 67-68, 102-122, 197-263.

Add imports at the top of the file (alongside existing imports):

```tsx
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import { useCurrentWorkspace } from "@multica/core/paths";
import { useRef } from "react";
```

> Note: `useCurrentWorkspace` and `useQueryClient` may already be imported or available. Check existing imports. The file already imports `useCurrentWorkspace` at line 21 and `useQueryClient` at line 4.

Add `Input` and `Label` imports, `Eye`/`EyeOff` from lucide, and `useRef` from react:

Add to the existing lucide import:
```tsx
import { GitCommitHorizontal, Link2, PanelRight, Eye, EyeOff } from "lucide-react";
```

Add the UI imports:
```tsx
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
```

Add `useRef` to the react import:
```tsx
import { useState, useRef } from "react";
```

Inside the component, after the `connecting`/`disconnectTarget`/`disconnecting` state declarations (approx line 65-68), add the access token state:

```tsx
  // Access token state
  const [accessTokenValue, setAccessTokenValue] = useState("");
  const [isEditingToken, setIsEditingToken] = useState(false);
  const [savingToken, setSavingToken] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const tokenInputRef = useRef<HTMLInputElement>(null);

  const hasAccessToken =
    ((workspace?.settings as Record<string, unknown>)?.github_access_token as string)?.length > 0;
```

Add the save handler (after `handleDisconnect`, approx line 118):

```tsx
  async function handleSaveAccessToken() {
    if (!workspace || !accessTokenValue || savingToken) return;
    setSavingToken(true);
    try {
      const merged = {
        ...((workspace.settings as Record<string, unknown>) ?? {}),
        github_access_token: accessTokenValue,
      };
      const updated = await api.updateWorkspace(workspace.id, { settings: merged });
      qc.setQueryData(workspaceKeys.list(), (old: Workspace[] | undefined) =>
        old?.map((ws) => (ws.id === updated.id ? updated : ws)),
      );
      toast.success(t(($) => $.github.toast_access_token_saved));
      setIsEditingToken(false);
      setAccessTokenValue("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t(($) => $.github.toast_access_token_save_failed));
    } finally {
      setSavingToken(false);
    }
  }
```

Add the Access Token section in the JSX, after the connection section's closing `</section>` and before the features section. Insert after the `</section>` that closes the connection Card (approx line 218):

```tsx
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{t(($) => $.github.access_token_label)}</h2>
        <Card>
          <CardContent className="space-y-1.5">
            <p className="text-[11px] text-muted-foreground">{t(($) => $.github.access_token_hint)}</p>
            {isEditingToken ? (
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Input
                    ref={tokenInputRef}
                    type={showToken ? "text" : "password"}
                    value={accessTokenValue}
                    onChange={(e) => setAccessTokenValue(e.target.value)}
                    placeholder="ghp_..."
                    className="text-xs pr-9"
                    autoFocus
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                    onClick={() => setShowToken((v) => !v)}
                    aria-label={showToken ? t(($) => $.gitlab.hide_token) : t(($) => $.gitlab.show_token)}
                  >
                    {showToken ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  </Button>
                </div>
                <Button
                  size="sm"
                  disabled={!accessTokenValue || savingToken}
                  onClick={handleSaveAccessToken}
                >
                  {savingToken ? t(($) => $.gitlab.saving) : t(($) => $.gitlab.save_token)}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setIsEditingToken(false);
                    setAccessTokenValue("");
                  }}
                >
                  {t(($) => $.gitlab.cancel)}
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  type="password"
                  value={hasAccessToken ? "••••••••" : ""}
                  placeholder="—"
                  className="text-xs"
                />
                {canManage && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsEditingToken(true)}
                  >
                    {hasAccessToken
                      ? t(($) => $.gitlab.change_token)
                      : t(($) => $.gitlab.add_token)}
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </section>
```

- [ ] **Step 3: Verify typecheck + views tests**

Run: `cd /e/Projects/multica && pnpm --filter @multica/views exec tsc --noEmit 2>&1 | head -30`
Expected: no errors in `github-tab.tsx`.

- [ ] **Step 4: Verify i18n parity**

Run: `cd /e/Projects/multica && pnpm --filter @multica/views exec vitest run locales/parity`
Expected: PASS (en and zh-Hans key sets match).

- [ ] **Step 5: Commit**

```bash
git -C /e/Projects/multica add packages/views/settings/components/github-tab.tsx packages/views/locales/en/settings.json packages/views/locales/zh-Hans/settings.json
git -C /e/Projects/multica commit -m "feat(settings): add GitHub PAT input to github-tab (mirror gitlab-tab pattern)"
```

---

## Task 6 (cs-cloud): `submitDeliverable` Provider-driven branch

**Files:**
- Modify: `e:\Projects\cs-cloud\internal\cli\gitea.go`
- Modify: `e:\Projects\cs-cloud\internal\cli\gitea_test.go`

- [ ] **Step 1: Write the failing test**

In `e:\Projects\cs-cloud\internal\cli\gitea_test.go`, add a test for the new Provider-driven dispatch:

```go
// TestSubmitDeliverable_ProviderEnvRoutesToGithub tests that CS_CLOUD_CODE_PROVIDER=github
// routes to submitGithubPR (even without --mr flag). Uses a fake GitHub PR server
// and fake backend.
func TestSubmitDeliverable_ProviderEnvRoutesToGithub(t *testing.T) {
	var submittedURL string
	var ghAgentID string
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/submit") {
			var body struct {
				PullRequestURL string `json:"pull_request_url"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			submittedURL = body.PullRequestURL
			ghAgentID = r.Header.Get("X-Agent-ID")
			jsonResponse(w, 200, map[string]any{"id": "sub-1"})
		}
	}))
	defer backend.Close()

	// Fake GitHub API: POST /repos/{owner}/{repo}/pulls
	var gotAuthHeader string
	githubSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuthHeader = r.Header.Get("Authorization")
		jsonResponse(w, 201, map[string]any{"html_url": "https://github.com/org/repo/pulls/1", "number": 1})
	}))
	defer githubSrv.Close()

	t.Setenv("CS_CLOUD_CODE_PROVIDER", "github")
	t.Setenv("CS_CLOUD_GITHUB_TOKEN", "ghp-test-token")
	t.Setenv("CS_CLOUD_GITHUB_API_BASE", githubSrv.URL)
	t.Setenv("CS_CLOUD_BACKEND_URL", backend.URL)
	t.Setenv("CS_CLOUD_TOKEN", "tok")
	t.Setenv("CS_CLOUD_NODE_RUN_ID", "nr-1")
	t.Setenv("CS_CLOUD_AGENT_ID", "agent-1")
	t.Setenv("CS_CLOUD_TASK_ID", "task-1")

	repoDir := t.TempDir()
	t.Chdir(repoDir)

	fake := &fakeGitOps{currentBranch: "feat/test"}
	stderr := captureStderr(t, func() {
		err := submitDeliverable(submitConfig{
			mrMode:        false, // no --mr flag — provider env drives routing
			deliverableID: "d1",
			repoURL:       "https://github.com/org/repo.git",
			gitOps:        fake,
		})
		if err != nil {
			t.Fatalf("submitDeliverable (github provider): %v", err)
		}
	})
	if !strings.Contains(stderr, "submitting GitHub PR") {
		t.Fatalf("stderr missing github dispatch:\n%s", stderr)
	}
	if submittedURL != "https://github.com/org/repo/pulls/1" {
		t.Errorf("submitted URL = %q, want github PR html_url", submittedURL)
	}
	if !strings.Contains(gotAuthHeader, "token ghp-test-token") {
		t.Errorf("Authorization header = %q, want 'token ghp-test-token'", gotAuthHeader)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /e/Projects/cs-cloud && go test ./internal/cli/ -run TestSubmitDeliverable_ProviderEnvRoutesToGithub -v`
Expected: FAIL — `submitDeliverable` does not read `CS_CLOUD_CODE_PROVIDER`, so it falls through to the Gitea delivery path and fails on missing `CS_CLOUD_NODE_RUN_ID` Gitea context.

- [ ] **Step 3: Rewrite the `submitDeliverable` dispatch in `gitea.go`**

Replace the function header in `e:\Projects\cs-cloud\internal\cli\gitea.go` (approx line 193-196):

Replace:
```go
func submitDeliverable(cfg submitConfig) error {
	if cfg.mrMode {
		return submitGitlabMR(cfg)
	}
```
With:
```go
func submitDeliverable(cfg submitConfig) error {
	// Provider-driven dispatch: CS_CLOUD_CODE_PROVIDER env (set by multica)
	// takes priority over the legacy --mr flag. This lets the agent submit
	// without --mr and lets cs-cloud route to the correct platform API.
	provider := strings.ToLower(strings.TrimSpace(os.Getenv("CS_CLOUD_CODE_PROVIDER")))
	switch provider {
	case "github":
		return submitGithubPR(cfg)
	case "gitlab":
		return submitGitlabMR(cfg)
	}
	// Backward compat: --mr flag implies gitlab (pre-provider agent prompts).
	if cfg.mrMode {
		return submitGitlabMR(cfg)
	}
```

- [ ] **Step 4: Run test to verify it still fails (github.go not yet created)**

Run: `cd /e/Projects/cs-cloud && go test ./internal/cli/ -run TestSubmitDeliverable_ProviderEnvRoutesToGithub -v`
Expected: FAIL — `undefined: submitGithubPR`. This confirms the dispatch routing is correct; the next task provides the function.

- [ ] **Step 5: Verify backward compat tests still pass**

Run: `cd /e/Projects/cs-cloud && go test ./internal/cli/ -run 'TestSubmitDeliverable_HappyPath|TestSubmitDeliverable_GitLabMR' -v`
Expected: PASS (Gitea delivery path and --mr→GitLab path are unchanged).

- [ ] **Step 6: Commit**

```bash
git -C /e/Projects/cs-cloud add internal/cli/gitea.go internal/cli/gitea_test.go
git -C /e/Projects/cs-cloud commit -m "feat(deliverable): submitDeliverable Provider-driven dispatch via CS_CLOUD_CODE_PROVIDER"
```

---

## Task 7 (cs-cloud): `injectTokenIntoURL` / `injectToken` host-aware username

**Files:**
- Modify: `e:\Projects\cs-cloud\internal\cli\gitea.go`
- Modify: `e:\Projects\cs-cloud\internal\cli\gitea_test.go`

- [ ] **Step 1: Write the failing test**

In `e:\Projects\cs-cloud\internal\cli\gitea_test.go`, update `TestInjectTokenIntoURL` and add a new case:

```go
func TestInjectTokenIntoURL_HostAwareUsername(t *testing.T) {
	tests := []struct {
		name         string
		cloneURL     string
		token        string
		wantContains string
	}{
		{"gitea uses oauth2", "http://gitea:3000/t-aaa/wf-bbb.git", "tok123", "oauth2:tok123@"},
		{"gitlab uses oauth2", "https://gitlab.test/g/r.git", "tok", "oauth2:tok@"},
		{"github.com uses x-access-token", "https://github.com/org/repo.git", "ghp", "x-access-token:ghp@"},
		{"github.com uppercase host", "https://GITHUB.COM/org/repo.git", "ghp", "x-access-token:ghp@"},
		{"GHE uses x-access-token", "https://ghe.example.com/org/repo.git", "ghp", "x-access-token:ghp@"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := injectTokenIntoURL(tt.cloneURL, tt.token)
			if got == "" {
				t.Fatalf("injectTokenIntoURL(%q, %q) returned empty", tt.cloneURL, tt.token)
			}
			if !strings.Contains(got, tt.wantContains) {
				t.Errorf("injectTokenIntoURL(%q, %q) = %q, want substring %q", tt.cloneURL, tt.token, got, tt.wantContains)
			}
		})
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /e/Projects/cs-cloud && go test ./internal/cli/ -run TestInjectTokenIntoURL_HostAwareUsername -v`
Expected: FAIL — current impl returns `oauth2:tok@` for github.com URLs.

- [ ] **Step 3: Update `injectTokenIntoURL`**

In `e:\Projects\cs-cloud\internal\cli\gitea.go` (approx line 314-321), replace:

```go
func injectTokenIntoURL(cloneURL, token string) string {
	u, err := url.Parse(strings.TrimSpace(cloneURL))
	if err != nil || u.Host == "" {
		return ""
	}
	u.User = url.UserPassword("oauth2", token)
	return u.String()
}
```
With:

```go
func injectTokenIntoURL(cloneURL, token string) string {
	u, err := url.Parse(strings.TrimSpace(cloneURL))
	if err != nil || u.Host == "" {
		return ""
	}
	user := tokenUsername(u.Host)
	u.User = url.UserPassword(user, token)
	return u.String()
}

// tokenUsername returns the git auth username for embedding a PAT into a
// clone URL. GitHub (SaaS and Enterprise) requires "x-access-token" for
// fine-grained PAT compatibility; GitLab and Gitea accept "oauth2".
func tokenUsername(host string) string {
	if strings.Contains(strings.ToLower(host), "github.com") || strings.Contains(strings.ToLower(host), "github.") {
		return "x-access-token"
	}
	return "oauth2"
}
```

- [ ] **Step 4: Update `injectToken` similarly**

Replace (approx line 302-310):

```go
func injectToken(baseURL, owner, repo, token string) string {
	u, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil || u.Host == "" {
		return ""
	}
	u.User = url.UserPassword("oauth2", token)
	u.Path = fmt.Sprintf("/%s/%s.git", owner, repo)
	return u.String()
}
```
With:

```go
func injectToken(baseURL, owner, repo, token string) string {
	u, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil || u.Host == "" {
		return ""
	}
	u.User = url.UserPassword(tokenUsername(u.Host), token)
	u.Path = fmt.Sprintf("/%s/%s.git", owner, repo)
	return u.String()
}
```

- [ ] **Step 5: Run all injectToken tests**

Run: `cd /e/Projects/cs-cloud && go test ./internal/cli/ -run 'TestInjectTokenIntoURL' -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C /e/Projects/cs-cloud add internal/cli/gitea.go internal/cli/gitea_test.go
git -C /e/Projects/cs-cloud commit -m "fix(deliverable): injectTokenIntoURL uses x-access-token for GitHub hosts"
```

---

## Task 8 (cs-cloud): New `cli/github.go` — `submitGithubPR`, `openGithubPR`, `readGithubCredential`

**Files:**
- Create: `e:\Projects\cs-cloud\internal\cli\github.go`
- Create: `e:\Projects\cs-cloud\internal\cli\github_test.go`

- [ ] **Step 1: Create `internal/cli/github.go`**

```go
package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
)

// submitGithubPR handles the GitHub code-PR path: pushes the current worktree
// branch, opens a GitHub PR, and reports to the server's submit endpoint.
// Mirrors submitGitlabMR (gitlab.go) but targets GitHub's REST API.
func submitGithubPR(cfg submitConfig) error {
	ctx := context.Background()

	cred, err := readGithubCredential()
	if err != nil {
		return fmt.Errorf("github credential: %w", err)
	}

	// The agent cloned the code repo itself and runs this command from inside it.
	worktree, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("resolve cwd: %w", err)
	}

	nodeRunID := os.Getenv("CS_CLOUD_NODE_RUN_ID")
	if nodeRunID == "" {
		return fmt.Errorf("CS_CLOUD_NODE_RUN_ID not set")
	}

	serverURL := envOr("CS_CLOUD_BACKEND_URL", "")
	if serverURL == "" {
		return fmt.Errorf("CS_CLOUD_BACKEND_URL not set")
	}
	token := os.Getenv("CS_CLOUD_TOKEN")

	currentBranch, err := cfg.gitOps.CurrentBranch(worktree)
	if err != nil {
		return fmt.Errorf("current branch: %w", err)
	}

	fmt.Fprintf(os.Stderr, "deliverable %s: submitting GitHub PR node_run=%s branch=%s\n", cfg.deliverableID, nodeRunID, currentBranch)

	// Push current branch. injectTokenIntoURL handles the x-access-token username.
	authURL := injectTokenIntoURL(cfg.repoURL, cred.Token)
	fmt.Fprintf(os.Stderr, "deliverable %s: pushing PR branch=%s\n", cfg.deliverableID, currentBranch)
	if err := cfg.gitOps.Push(worktree, authURL, currentBranch); err != nil {
		return fmt.Errorf("push: %w", err)
	}

	targetBranch := envOr("CS_CLOUD_GITHUB_TARGET_BRANCH", "main")
	title := "deliverable " + cfg.deliverableID
	fmt.Fprintf(os.Stderr, "deliverable %s: opening PR source=%s target=%s\n", cfg.deliverableID, currentBranch, targetBranch)
	prURL, err := openGithubPR(ctx, cred.BaseURL, cred.Token, cfg.repoURL, currentBranch, targetBranch, title)
	if err != nil {
		return fmt.Errorf("open PR: %w", err)
	}

	submitEndpoint := serverURL + "/api/node-runs/" + nodeRunID + "/deliverables/" + cfg.deliverableID + "/submit"
	fmt.Fprintf(os.Stderr, "deliverable %s: reporting PR\n", cfg.deliverableID)
	if err := reportToServer(ctx, serverURL, token, submitEndpoint, prURL, os.Getenv("CS_CLOUD_WORKSPACE_ID"), os.Getenv("CS_CLOUD_AGENT_ID"), os.Getenv("CS_CLOUD_TASK_ID")); err != nil {
		return fmt.Errorf("report submit: %w", err)
	}

	fmt.Fprintf(os.Stderr, "deliverable %s: submitted pr=%s\n", cfg.deliverableID, prURL)
	fmt.Println(prURL)
	return nil
}

// readGithubCredential reads CS_CLOUD_GITHUB_TOKEN and derives the API base URL
// from CS_CLOUD_GITHUB_API_BASE (set by multica dispatch). Falls back to
// deriving from the repo URL host: github.com → api.github.com, GHE → {host}/api/v3.
func readGithubCredential() (*gitlabCredential, error) {
	token := strings.TrimSpace(os.Getenv("CS_CLOUD_GITHUB_TOKEN"))
	if token == "" {
		return nil, fmt.Errorf("CS_CLOUD_GITHUB_TOKEN not set (the task payload must provide the GitHub PAT)")
	}
	baseURL := strings.TrimSpace(os.Getenv("CS_CLOUD_GITHUB_API_BASE"))
	if baseURL == "" {
		// Derive from repo URL if available (not available in readGithubCredential
		// itself, but submitGithubPR will re-derive when calling openGithubPR).
		baseURL = "https://api.github.com"
	}
	return &gitlabCredential{
		BaseURL: baseURL,
		Token:   token,
	}, nil
}

// githubAPIBase derives the GitHub REST API base from a repo URL host.
// github.com → https://api.github.com; GHE → https://<host>/api/v3.
func githubAPIBase(repoURL string) string {
	u, err := url.Parse(strings.TrimSpace(repoURL))
	if err != nil || u.Host == "" {
		return "https://api.github.com"
	}
	if u.Host == "github.com" {
		return "https://api.github.com"
	}
	return fmt.Sprintf("https://%s/api/v3", u.Host)
}

// openGithubPR POSTs /repos/{owner}/{repo}/pulls and returns html_url.
// Mirrors openGitlabMR (gitlab.go) but targets GitHub's REST API with
// Authorization: token <pat> header.
func openGithubPR(ctx context.Context, base, token, repoURL, sourceBranch, targetBranch, title string) (string, error) {
	// Derive API base from repo URL if base is the default (submitted
	// without explicit env, or env not set).
	effectiveBase := base
	if effectiveBase == "https://api.github.com" {
		effectiveBase = githubAPIBase(repoURL)
	}

	u, err := url.Parse(strings.TrimSpace(repoURL))
	if err != nil {
		return "", fmt.Errorf("parse repo URL %q: %w", repoURL, err)
	}
	// Extract owner/repo from path (e.g. "/org/repo.git" → "org/repo").
	project := strings.Trim(u.Path, "/")
	project = strings.TrimSuffix(project, ".git")
	if project == "" {
		return "", fmt.Errorf("cannot extract owner/repo from repo URL %q", repoURL)
	}

	body, _ := json.Marshal(map[string]string{
		"title": title,
		"head":  sourceBranch,
		"base":  targetBranch,
	})
	endpoint := strings.TrimRight(effectiveBase, "/") + "/repos/" + url.PathEscape(project) + "/pulls"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("build create PR request: %w", err)
	}
	req.Header.Set("Authorization", "token "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := sharedHTTPClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("create PR request: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode == http.StatusUnprocessableEntity || resp.StatusCode == http.StatusConflict {
		// PR already exists (or validation error). Try to find existing.
		return findExistingGithubPR(ctx, effectiveBase, token, project, sourceBranch, targetBranch)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("github create PR: status %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}
	var pr struct {
		HTMLURL string `json:"html_url"`
		Number  int    `json:"number"`
	}
	if err := json.Unmarshal(respBody, &pr); err != nil {
		return "", fmt.Errorf("parse PR response: %w", err)
	}
	if strings.TrimSpace(pr.HTMLURL) == "" {
		return "", fmt.Errorf("github create PR: response missing html_url: %s", strings.TrimSpace(string(respBody)))
	}
	return pr.HTMLURL, nil
}

// findExistingGithubPR lists open PRs filtered by head branch and returns the
// first match's html_url. Used when create-PR returns 422/409 so submission
// is idempotent across retries.
func findExistingGithubPR(ctx context.Context, base, token, project, sourceBranch, targetBranch string) (string, error) {
	endpoint := fmt.Sprintf("%s/repos/%s/pulls?state=open&head=%s&base=%s",
		strings.TrimRight(base, "/"), url.PathEscape(project),
		url.QueryEscape(sourceBranch), url.QueryEscape(targetBranch))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", fmt.Errorf("build list PR request: %w", err)
	}
	req.Header.Set("Authorization", "token "+token)
	resp, err := sharedHTTPClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("list PR request: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("github list PRs: status %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}
	var prs []struct {
		HTMLURL string `json:"html_url"`
		Head    struct {
			Ref string `json:"ref"`
		} `json:"head"`
	}
	if err := json.Unmarshal(respBody, &prs); err != nil {
		return "", fmt.Errorf("parse PR list: %w", err)
	}
	for _, pr := range prs {
		if pr.Head.Ref == sourceBranch && strings.TrimSpace(pr.HTMLURL) != "" {
			return pr.HTMLURL, nil
		}
	}
	return "", fmt.Errorf("github create PR returned error but no open PR for head %q", sourceBranch)
}
```

- [ ] **Step 2: Create `internal/cli/github_test.go`**

```go
package cli

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestReadGithubCredential_Valid(t *testing.T) {
	t.Setenv("CS_CLOUD_GITHUB_TOKEN", "ghp-test")
	t.Setenv("CS_CLOUD_GITHUB_API_BASE", "https://api.github.com")

	cred, err := readGithubCredential()
	if err != nil {
		t.Fatalf("readGithubCredential: %v", err)
	}
	if cred.Token != "ghp-test" {
		t.Errorf("Token = %q, want ghp-test", cred.Token)
	}
	if cred.BaseURL != "https://api.github.com" {
		t.Errorf("BaseURL = %q, want https://api.github.com", cred.BaseURL)
	}
}

func TestReadGithubCredential_MissingToken(t *testing.T) {
	t.Setenv("CS_CLOUD_GITHUB_TOKEN", "")
	if _, err := readGithubCredential(); err == nil {
		t.Fatal("expected error when CS_CLOUD_GITHUB_TOKEN is empty")
	}
}

func TestGithubAPIBase(t *testing.T) {
	tests := []struct {
		name string
		url  string
		want string
	}{
		{"github.com SaaS", "https://github.com/org/repo.git", "https://api.github.com"},
		{"GHE", "https://ghe.example.com/org/repo.git", "https://ghe.example.com/api/v3"},
		{"empty", "", "https://api.github.com"},
		{"bare host", "github.com/org/repo", "https://api.github.com"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := githubAPIBase(tt.url); got != tt.want {
				t.Errorf("githubAPIBase(%q) = %q, want %q", tt.url, got, tt.want)
			}
		})
	}
}

func TestOpenGithubPR_HappyPath(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && strings.Contains(r.URL.Path, "/pulls") {
			if got := r.Header.Get("Authorization"); !strings.Contains(got, "token ghp-pat") {
				t.Errorf("Authorization = %q, want token ghp-pat", got)
			}
			jsonResponse(w, 201, map[string]any{"html_url": "https://github.com/org/repo/pulls/42", "number": 42})
			return
		}
		http.NotFound(w, r)
	}))
	defer srv.Close()

	// Set env so readGithubCredential returns the test server as base.
	t.Setenv("CS_CLOUD_GITHUB_TOKEN", "ghp-pat")
	t.Setenv("CS_CLOUD_GITHUB_API_BASE", srv.URL)

	url, err := openGithubPR(context.Background(), srv.URL, "ghp-pat",
		"https://github.com/org/repo.git", "feat/x", "main", "test PR")
	if err != nil {
		t.Fatalf("openGithubPR: %v", err)
	}
	if url != "https://github.com/org/repo/pulls/42" {
		t.Errorf("url = %q, want the PR html_url", url)
	}
}

func TestOpenGithubPR_DuplicateResolvesExisting(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && strings.Contains(r.URL.Path, "/pulls"):
			jsonResponse(w, 422, map[string]any{"message": "Validation Failed", "errors": []map[string]string{{"resource": "PullRequest", "code": "custom", "message": "A pull request already exists"}}})
		case r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/pulls"):
			jsonResponse(w, 200, []map[string]any{{
				"html_url": "https://github.com/org/repo/pulls/7",
				"head":     map[string]string{"ref": "feat/x"},
			}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	t.Setenv("CS_CLOUD_GITHUB_TOKEN", "ghp-pat")
	t.Setenv("CS_CLOUD_GITHUB_API_BASE", srv.URL)

	url, err := openGithubPR(context.Background(), srv.URL, "ghp-pat",
		"https://github.com/org/repo.git", "feat/x", "main", "test PR")
	if err != nil {
		t.Fatalf("openGithubPR on 422: %v", err)
	}
	if url != "https://github.com/org/repo/pulls/7" {
		t.Errorf("url = %q, want the EXISTING PR html_url", url)
	}
}

func TestOpenGithubPR_RejectsEmptyHTMLURL(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, 201, map[string]any{"html_url": ""})
	}))
	defer srv.Close()

	t.Setenv("CS_CLOUD_GITHUB_TOKEN", "ghp-pat")
	t.Setenv("CS_CLOUD_GITHUB_API_BASE", srv.URL)

	if _, err := openGithubPR(context.Background(), srv.URL, "ghp-pat",
		"https://github.com/org/repo.git", "feat/x", "main", "test PR"); err == nil {
		t.Fatal("expected error when PR response has empty html_url, got nil")
	}
}
```

- [ ] **Step 3: Run tests**

Run: `cd /e/Projects/cs-cloud && go test ./internal/cli/ -run 'TestReadGithubCredential|TestGithubAPIBase|TestOpenGithubPR' -v`
Expected: PASS.

Also re-run the Task 6 test which should now pass:
Run: `cd /e/Projects/cs-cloud && go test ./internal/cli/ -run TestSubmitDeliverable_ProviderEnvRoutesToGithub -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git -C /e/Projects/cs-cloud add internal/cli/github.go internal/cli/github_test.go
git -C /e/Projects/cs-cloud commit -m "feat(github): add submitGithubPR, openGithubPR, readGithubCredential for GitHub PR path"
```

---

## Task 9 (multica): Integration test — `buildCSCloudPayload` sets correct env per provider

**Files:**
- Modify: `server/internal/service/task_cscloud_push_test.go`

- [ ] **Step 1: Write the test**

Append to `task_cscloud_push_test.go`:

```go
func TestBuildCSCloudPayload_GithubCodeRepoSetsGithubEnv(t *testing.T) {
	// Verify that when a workspace has a GitHub code repo URL + github_access_token,
	// the payload env contains CS_CLOUD_GITHUB_TOKEN + CS_CLOUD_CODE_PROVIDER=github
	// and does NOT contain CS_CLOUD_GITLAB_TOKEN.
	wsRepos, _ := json.Marshal([]struct{ URL string }{
		{URL: "https://github.com/org/backend.git"},
	})
	wsSettings, _ := json.Marshal(struct {
		GitlabAccessToken string `json:"gitlab_access_token"`
		GithubAccessToken string `json:"github_access_token"`
	}{GitlabAccessToken: "tok-gl", GithubAccessToken: "tok-gh"})
	mdb := &resolveTestDB{
		workspace: &db.MulticaWorkspace{
			ID:       testUUID(1),
			Repos:    wsRepos,
			Settings: wsSettings,
		},
		issue: &db.MulticaIssue{ID: testUUID(5), WorkspaceID: testUUID(1)},
	}
	svc := &TaskService{Queries: db.New(mdb)}
	task := db.MulticaAgentTaskQueue{IssueID: testUUID(5)}

	repos, tokens, projectID := svc.resolveCodeRepoAndProject(context.Background(), task, testUUID(1))

	if tokens.GithubToken != "tok-gh" {
		t.Fatalf("github token = %q, want tok-gh", tokens.GithubToken)
	}
	if tokens.GitlabToken != "tok-gl" {
		t.Fatalf("gitlab token = %q, want tok-gl (still read even when repos are github)", tokens.GitlabToken)
	}
	if len(repos) != 1 {
		t.Fatalf("repos count = %d, want 1", len(repos))
	}
	if repos[0].Provider != "github" {
		t.Fatalf("repo provider = %q, want github", repos[0].Provider)
	}
	if projectID != "" {
		t.Fatalf("projectID = %q, want empty", projectID)
	}
}

func TestBuildCSCloudPayload_MixedReposSetsBothTokens(t *testing.T) {
	// Workspace with both a GitLab and a GitHub code repo. Both tokens should
	// be returned; CS_CLOUD_CODE_PROVIDER should match the first repo.
	wsSettings, _ := json.Marshal(struct {
		GitlabAccessToken string `json:"gitlab_access_token"`
		GithubAccessToken string `json:"github_access_token"`
	}{GitlabAccessToken: "tok-gl", GithubAccessToken: "tok-gh"})
	mdb := &resolveTestDB{
		workspace: &db.MulticaWorkspace{
			ID:       testUUID(1),
			Settings: wsSettings,
		},
		issue: &db.MulticaIssue{ID: testUUID(5), WorkspaceID: testUUID(1)},
		projResRows: []db.MulticaProjectResource{
			{ResourceType: "github_repo", ResourceRef: []byte(`{"url":"https://github.com/org/repo-a.git"}`)},
			{ResourceType: "github_repo", ResourceRef: []byte(`{"url":"https://gitlab.example.com/org/repo-b.git"}`)},
		},
	}
	svc := &TaskService{Queries: db.New(mdb)}
	task := db.MulticaAgentTaskQueue{IssueID: testUUID(5)}

	repos, tokens, _ := svc.resolveCodeRepoAndProject(context.Background(), task, testUUID(1))

	if tokens.GitlabToken != "tok-gl" {
		t.Fatalf("gitlab token = %q, want tok-gl", tokens.GitlabToken)
	}
	if tokens.GithubToken != "tok-gh" {
		t.Fatalf("github token = %q, want tok-gh", tokens.GithubToken)
	}
	if len(repos) != 2 {
		t.Fatalf("repos count = %d, want 2", len(repos))
	}
	if repos[0].Provider != "github" {
		t.Fatalf("repos[0] provider = %q, want github (first is github)", repos[0].Provider)
	}
	if repos[1].Provider != "gitlab" {
		t.Fatalf("repos[1] provider = %q, want gitlab", repos[1].Provider)
	}
}
```

- [ ] **Step 2: Run tests**

Run: `cd /e/Projects/multica/server && go test ./internal/service/ -run 'TestBuildCSCloudPayload_GithubCodeRepoSetsGithubEnv|TestBuildCSCloudPayload_MixedReposSetsBothTokens' -v`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git -C /e/Projects/multica add server/internal/service/task_cscloud_push_test.go
git -C /e/Projects/multica commit -m "test(cs-cloud-dispatch): verify github token + provider in payload env"
```

---

## Task 10: Full verification

### multica

- [ ] **Step 1: Run all service tests**

Run: `cd /e/Projects/multica/server && go test ./internal/service/ -run 'TestCodeRepoProvider|TestResolveCodeRepo|TestAppendCodeRepoPrompt|TestBuildCSCloudPayload_Github|TestBuildCSCloudPayload_Mixed' -v`
Expected: PASS.

- [ ] **Step 2: Grep for leftover hardcoded `Provider: "gitlab"`**

Run: `grep -n 'Provider: "gitlab"' /e/Projects/multica/server/internal/service/task_cscloud_push.go`
Expected: only in comments or the `csCloudRepoSpec` struct doc; no remaining hardcoded assignments.

- [ ] **Step 3: Typecheck frontend**

Run: `cd /e/Projects/multica && pnpm typecheck 2>&1 | tail -5`
Expected: no errors.

- [ ] **Step 4: Run views tests**

Run: `cd /e/Projects/multica && pnpm --filter @multica/views exec vitest run locales/parity 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 5: Verify i18n parity for new keys**

Run: `grep -c 'access_token_label\|access_token_hint\|toast_access_token_saved\|toast_access_token_save_failed' /e/Projects/multica/packages/views/locales/en/settings.json /e/Projects/multica/packages/views/locales/zh-Hans/settings.json`
Expected: both files return the same count (4 each).

### cs-cloud

- [ ] **Step 6: Run all CLI tests**

Run: `cd /e/Projects/cs-cloud && go test ./internal/cli/ -v`
Expected: PASS.

- [ ] **Step 7: Verify no hardcoded `oauth2` in token injection paths**

Run: `grep -n 'oauth2' /e/Projects/cs-cloud/internal/cli/gitea.go`
Expected: only in `tokenUsername` return and the `openGiteaPR` Authorization header (Gitea API uses `token` auth, not `oauth2` in the URL — the `oauth2` there is in the clone URL for Gitea repos which is correct).

- [ ] **Step 8: Inspect branch state**

```bash
git -C /e/Projects/multica branch -vv
git -C /e/Projects/multica log --oneline -10
git -C /e/Projects/cs-cloud branch -vv
git -C /e/Projects/cs-cloud log --oneline -10
```

Confirm: no `[origin/main]` tracking, all commits in order.

---

## Self-Review (completed by plan author)

- **Spec coverage:**
  - Spec §1 (Provider inference) → Tasks 1, 2
  - Spec §2 (token dispatch by Provider + `CS_CLOUD_CODE_PROVIDER`) → Tasks 2, 9
  - Spec §3 (prompt per-Provider auth hint) → Task 3
  - Spec §4 (`github_access_token` field + UI) → Task 5
  - Spec §5 (cs-cloud submit Provider-driven branch) → Tasks 6, 8
  - Spec §5 (token injection username by Provider) → Task 7
  - Spec §6 (token env convention table) → verified by Tasks 2, 9

- **Placeholder scan:** no TBD/TODO/FIXME. Every task shows real code with exact function names, imports, and test assertions. Line number references say "approx line" where the actual line may have shifted.

- **Type consistency:**
  - `codeRepoTokens` struct used consistently in `resolveCodeRepoAndProject` return, caller in `buildCSCloudPayload`, and tests.
  - `CS_CLOUD_CODE_PROVIDER`, `CS_CLOUD_GITHUB_TOKEN` env names consistent between multica dispatch and cs-cloud reads.
  - `tokenUsername` helper used in both `injectTokenIntoURL` and `injectToken` for DRY.

- **Real code vs spec line numbers:**
  - `resolveCodeRepoAndProject` is at line 456 in the current file (spec says ~456) — matches.
  - `Provider: "gitlab"` hardcoded at lines 472 and 501 (spec says ~472 and ~501) — matches.
  - `buildCSCloudPayload` token dispatch at lines 346-353 (spec says ~294-363) — actual lines are 346-363, close enough.
  - `CS_CLOUD_GITLAB_TOKEN` env set at line 351 (spec says ~351) — matches.
  - `appendCodeRepoPrompt` at line 654-674 (spec says ~661) — matches.
  - `csCloudRepoSpec` struct at lines 45-52 (spec says ~45-52) — matches.
  - cs-cloud `submitDeliverable` at line 193 (spec says ~193) — matches.
  - cs-cloud `injectTokenIntoURL` at line 314 (spec says ~314) — matches.
  - cs-cloud `injectToken` at line 302 (spec says ~302) — matches.

- **Backward compat:** `--mr` flag still routes to gitlab when `CS_CLOUD_CODE_PROVIDER` is unset. Gitea delivery path unchanged. Existing agent prompts that still say `--mr` will continue to work.

- **Risk noted:** GitHub Enterprise API base URL derivation (`githubAPIBase`) uses the repo URL host. For `github.com` it returns `https://api.github.com` (SaaS default). For GHE it returns `https://<host>/api/v3`. This matches the spec's "默认 SaaS, 自建 GHE 留后续" decision. A `CS_CLOUD_GITHUB_API_BASE` env override is provided for explicit control.
