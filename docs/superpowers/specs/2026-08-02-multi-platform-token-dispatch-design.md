# 多平台 token 下发 + cs-cloud 提交分流（Spec B）

> 与 [2026-08-02-gitlab-repo-integration-design.md](2026-08-02-gitlab-repo-integration-design.md)（Spec A，设置页整合）关联：本 spec 引用 Spec A 新增的 GitHub PAT 入口作为 token 数据源。实现时两 spec 的 GitHub tab 改动合并。

## 背景与目标

数智人执行任务时 clone 的 code 仓库可能来自 GitLab 或 GitHub。当前下发链路（multica → cs-cloud）存在两个病灶：

1. **Provider 全硬编码**：[task_cscloud_push.go](server/internal/service/task_cscloud_push.go) 里 code repo 的 `Provider` 永远 = `"gitlab"`（line 472 project 资源分支、line 501 workspace.repos 兜底），从不看 URL 域名。`github.com` 的仓库也被打成 gitlab、套 GitLab 的 `oauth2:` 鉴权 → 私有仓必挂。
2. **GitHub 完全无 token**：无 `github_access_token` 字段、无下发、cs-cloud 提交侧（`submitDeliverable`）只用 `--mr` flag 二分（`--mr`→永远 GitLab MR，否则→永远 Gitea PR），GitHub PR 完全不支持。

cs-cloud 本体**不 clone 仓库**（agent 靠 env+prompt 自己 clone）；cs-cloud 只在**提交 MR/PR** 时用 token。所以"能 clone 三平台私有仓"靠 multica 下发正确的 token env + 带认证 URL，"能正确开 MR/PR"靠 cs-cloud 提交侧按平台分流。

**daemon（pull）路径不在本次范围**——已完全由 cs-cloud 取代。

**目标：**

1. multica 下发时按 code repo URL 域名区分 GitLab / GitHub，下发对应平台 token。
2. cs-cloud 提交侧按 Provider 分流，补 GitHub PR 路径。

## 决策摘要（已与用户确认）

- **平台模型**：靠 role 区分——`role=delivery` → Gitea（现状硬编码，不动）；`role=code` → binary 区分（`github.com` → GitHub，其余 → GitLab）。**Gitea 不在 code repo 里识别**，没有"Gitea 域名任意"难点。
- **GitHub token 来源**：设置页 GitHub tab 加 PAT 入口（`workspace.settings.github_access_token`），下发走 env。
- **cs-cloud 范围**：提交侧按 Provider 分流，补 GitHub PR。
- **daemon 路径**：不考虑（cs-cloud 已取代）。

## 范围

**包含：**

- multica `task_cscloud_push.go`：code repo Provider 按 URL host 推断；token 按 Provider 下发；prompt 按 Provider 给 clone 鉴权提示。
- `workspace.settings` 加 `github_access_token` 字段；设置页 GitHub tab 加 PAT 入口（UI 与 Spec A 合并）。
- cs-cloud `submitDeliverable` 改为 Provider 驱动；新增 GitHub PR 路径。

**不包含（YAGNI / 显式排除）：**

- **不**改 daemon（pull）路径的 credential 端点（cs-cloud 已取代 daemon）。
- **不**在 code repo 里识别 Gitea（Gitea 仅 delivery）。
- **不**用 GitHub App installation token（改用 PAT 入口）。
- **不**改 delivery（Gitea）路径——它已正确。

## 详细设计

### 1. multica — code repo Provider 推断

[task_cscloud_push.go](server/internal/service/task_cscloud_push.go) 的 `resolveCodeRepoAndProject`（line 456）当前两处都字面量 `Provider: "gitlab"`（line 472、501）。改为按 URL host 推断：

```go
// 新增 helper（与现有 githubRepoCount 的 /github\.com/i 口径一致）
func codeRepoProvider(rawURL string) string {
	if strings.Contains(strings.ToLower(rawURL), "github.com") {
		return "github"
	}
	return "gitlab"
}
```

两处赋值改为 `Provider: codeRepoProvider(repoURL)`。delivery repo 的 `Provider: "gitea"`（line 546）保持不变。

### 2. multica — token 按 Provider 下发

`buildCSCloudPayload`（line 261）当前在 worker 阶段只下发 `CS_CLOUD_GITLAB_TOKEN`（line 351，读 `workspace.settings.gitlab_access_token`）。改为按 code repo 的 Provider 分发：

- `Provider == "github"` → 下发 `CS_CLOUD_GITHUB_TOKEN`（读 `workspace.settings.github_access_token`）。
- `Provider == "gitlab"` → 下发 `CS_CLOUD_GITLAB_TOKEN`（现有逻辑）。
- 同时下发 `CS_CLOUD_CODE_PROVIDER`（= 该 code repo 的 Provider），供 cs-cloud 提交侧分流读取。

delivery（Gitea）的 `CS_CLOUD_GITEA_*` env（`repositoryDeliverableEnv`，line 767）保持不变。

> 字段读取沿用现有「workspace.settings JSONB 直读」模式（与 `gitlab_access_token` 一致），不新建专用端点。

### 3. multica — prompt 鉴权提示

`appendCodeRepoPrompt`（line 661）当前固定教 agent 用 `https://oauth2:${CS_CLOUD_GITLAB_TOKEN}@<host>/...`。改为按 Provider 分支：

- gitlab：`https://oauth2:${CS_CLOUD_GITLAB_TOKEN}@<host>/...`（不变）。
- github：`https://x-access-token:${CS_CLOUD_GITHUB_TOKEN}@github.com/...`（GitHub PAT 用 `x-access-token` 用户名；传统 PAT 也接受空用户名 `<token>@`，取 `x-access-token` 以兼容 fine-grained PAT）。

### 4. 凭据模型 + 设置页（衔接 Spec A）

- `workspace.settings` 新增 `github_access_token` 字段（与 `gitlab_access_token` 对称）。GET/PUT 走现有通用 `updateWorkspace` 路径，透传即可。
- 设置页 GitHub tab 加 PAT 入口（label/input/save，复用 GitLab tab 的 access token 交互模式）。**此 UI 改动并入 Spec A 的 GitHub tab 重构**（Spec A 已让 GitHub tab 常驻）。
- i18n 新增 `settings.github.access_token_label` / `access_token_hint` / `save_token` 等（en + zh-Hans 同步，参照 `settings.gitlab.access_token_*`）。

### 5. cs-cloud — 提交侧 Provider 分流

当前 [gitea.go](../cs-cloud/internal/cli/gitea.go) 的 `submitDeliverable`（line 193）只用 `--mr` flag 二分。改为 Provider 驱动：

**判定来源**：读 env `CS_CLOUD_CODE_PROVIDER`（multica 下发，见 §2）。无此变量时，向后兼容：`--mr` flag 存在 → gitlab，否则 → gitea（delivery）。

**分流**：

| Provider / 模式 | 路径 | 文件 |
|---|---|---|
| `github`（code） | **新增** `submitGithubPR` → `openGithubPR` | `internal/cli/github.go`（新） |
| `gitlab`（code） | 现有 `submitGitlabMR` → `openGitlabMR` | `internal/cli/gitlab.go` |
| gitea（delivery，默认） | 现有 `openGiteaPR` | `internal/cli/gitea.go` |

**新增 `openGithubPR`**：`POST {base}/repos/{owner}/{repo}/pulls`，`Authorization: token <CS_CLOUD_GITHUB_TOKEN>`，base 从 repo URL host 推（默认 `https://api.github.com`，自建需支持）。owner/repo 从 repo URL path 解析。409 冲突复用现有 `findExisting*` 模式。

**token 注入用户名按平台**：cs-cloud 现有 `injectTokenIntoURL`（[gitea.go:314](../cs-cloud/internal/cli/gitea.go)）硬编码 `oauth2` 用户名——对 GitLab/Gitea 有效，对 GitHub 无效。改为按 Provider 选用户名：github → `x-access-token`，gitlab/gitea → `oauth2`。

**clone 不改**：cs-cloud 本体不 clone（agent 靠 env+prompt）；确保 `CS_CLOUD_GITHUB_TOKEN` 随 `payload.Env` 透传到 agent 子进程（现有 `buildEnv` 已透传 `payload.Env`，无需改）。

### 6. token env 约定（最终）

| env 变量 | 平台 / role | 来源 |
|---|---|---|
| `CS_CLOUD_GITLAB_TOKEN` | GitLab code | `workspace.settings.gitlab_access_token`（现有） |
| `CS_CLOUD_GITHUB_TOKEN` | GitHub code | `workspace.settings.github_access_token`（新） |
| `CS_CLOUD_GITEA_TOKEN` | Gitea delivery | gitea bundle（现有） |
| `CS_CLOUD_CODE_PROVIDER` | code repo 平台标识 | multica 推断（新，供 cs-cloud 提交分流） |

## 影响面（文件清单）

**multica：**

- `server/internal/service/task_cscloud_push.go` — Provider 推断、token 下发、prompt（核心）
- `workspace.settings` — `github_access_token` 字段（透传，无 schema 迁移）
- `packages/views/settings/components/github-tab.tsx` — PAT 入口（并入 Spec A）
- `packages/views/locales/{en,zh-Hans}/settings.json` — github access_token i18n

**cs-cloud（e:\Projects\cs-cloud）：**

- `internal/cli/github.go` — 新增（submitGithubPR / openGithubPR / readGithubCredential）
- `internal/cli/gitea.go` — `submitDeliverable` 改 Provider 驱动；`injectTokenIntoURL` 按平台选用户名
- `internal/cli/gitlab.go` — 无实质改动（保持）
- 对应 `_test.go`

## 测试

**multica：**

- `codeRepoProvider` 单测：github.com URL → github；gitlab.com / 自建 / gitea URL → gitlab。
- `buildCSCloudPayload`：code repo 为 github 时 env 含 `CS_CLOUD_GITHUB_TOKEN` + `CS_CLOUD_CODE_PROVIDER=github`，不含 GITLAB token；gitlab 时反之。
- prompt 按 Provider 含正确鉴权片段。

**cs-cloud：**

- `submitDeliverable`：`CS_CLOUD_CODE_PROVIDER=github` → 走 `submitGithubPR`；`=gitlab` → `submitGitlabMR`；无变量 + `--mr` → gitlab（兼容）；无变量无 `--mr` → gitea。
- `openGithubPR`：正确的 `/repos/{owner}/{repo}/pulls` URL + `Authorization: token` 头。
- `injectTokenIntoURL`：github → `x-access-token:<token>@`；gitlab/gitea → `oauth2:<token>@`。

## 风险

- **GitHub PAT clone 认证格式**：`x-access-token:<token>@` 对 fine-grained PAT 必需；传统 PAT 也接受。实现时用真实 GitHub PAT 验证一次 clone + push + 开 PR 全链路。
- **cs-cloud `--mr` 向后兼容**：现有 agent prompt / 旧任务可能仍传 `--mr`。保留 `--mr` → gitlab 的兼容语义，避免破坏在途任务。
- **自建 GitHub Enterprise**：`api.github.com` 默认对 SaaS；Enterprise 的 host 不同（`<host>/api/v3/...`）。本次默认 SaaS，自建 GHE 留后续（与自建 GitLab base_url 问题同类）。
- **prompt 教 agent 选提交命令**：cs-cloud 改 Provider 驱动后，agent 调 `cs-cloud workflow deliverable submit`（不带 `--mr`），cs-cloud 按 env 自动选路径。multica 的 prompt 要相应更新，不再硬编码 `--mr`。
