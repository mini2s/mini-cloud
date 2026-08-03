# GitLab/GitHub 设置页整合代码仓库（按域名分流）+ 移除启用开关

## 背景与目标

设置页「工作区」分组下当前有四个 tab：通用、代码仓库、GitHub、GitLab。其中：

- **GitLab tab**（[gitlab-tab.tsx](packages/views/settings/components/gitlab-tab.tsx)）顶部有一个「启用 GitLab 功能」总开关（写 `gitlab_enabled`），下方是 Webhook / 令牌等连接配置。
- **GitHub tab**（[github-tab.tsx](packages/views/settings/components/github-tab.tsx)）结构类似：顶部「启用 GitHub 功能」总开关（写 `github_enabled`），下方是 GitHub App 连接、Features（PR 侧栏 / Co-authored-by / 自动关联）、以及一个跳转到代码仓库 tab 的快捷卡片。
- **代码仓库 tab**（[repositories-tab.tsx](packages/views/settings/components/repositories-tab.tsx)）是独立 tab，管理 `workspace.repos`（工作区关联的 Git 仓库 URL 列表），被两个平台共用。
- 平台 tab 显隐由 `workspace.settings.code_platform` 单选控制：`"github"` 显示 GitHub tab 隐藏 GitLab tab，否则（默认）反之。**`code_platform` 后端完全不读**（server grep 无匹配），纯前端 UI 开关。

后端语义：master 开关（`gitlab_enabled` / `github_enabled`）门控的是 **webhook 自动关联副作用**——`workspaceGitlabAutoLinkEnabled`（[gitlab.go:308](server/internal/handler/gitlab.go)）与 `workspaceAutoLinkPRsEnabled`（[github.go:1000](server/internal/handler/github.go)）在 master 为 `false` 时 short-circuit，不建立 issue↔MR/PR 链接。MR/PR 镜像本身的存储不受门控。

**目标：**

1. 移除 GitLab 与 GitHub 的「启用功能」总开关，让两个集成恒为开启（前后端一致）。
2. 把独立的「代码仓库」tab 整合进 GitLab 与 GitHub 两个平台 tab，移除独立的代码仓库 tab。
3. 仓库按 URL 域名分流：`github.com` 仓库归 GitHub tab，其余归 GitLab tab。两个平台 tab 对所有工作区常驻，允许一个工作区同时挂 GitHub + GitLab 双集成。

## 决策摘要（已与用户确认）

- **启用开关范围**：GitLab 与 GitHub 总开关一并隐藏、恒开；前后端都改。GitHub Features 子开关去掉 master 门控，改为仅受管理员权限门控。
- **整合 + 分流**：移除独立代码仓库 tab；两个平台 tab 各自内嵌代码仓库 section。仓库按 URL 域名分流——`github.com` → GitHub tab，其余 → GitLab tab。
- **tab 常驻**：移除 `code_platform` 单选隐藏，GitHub / GitLab tab 对所有工作区都显示。允许同时挂双集成。
- **增加仓库交互**：输入即分流——任一 tab 的添加框都能输任意 URL，保存后按域名自动归到对应 tab。

## 范围

**包含：**

- 抽取共享的 `<RepositoriesSection />`，按域名分片，GitLab / GitHub tab 各自内嵌。
- 移除独立的代码仓库 tab（导航 + 路由 + i18n）。
- 移除 `code_platform` 的 tab 显隐逻辑（前端 settings-page）。
- 前端隐藏 GitLab / GitHub 启用开关，`deriveGitlabSettings` / `deriveGitHubSettings` 的 `enabled` 恒 `true`，下游 `!flags.enabled` 门控清理。
- 后端 `workspaceGitlabAutoLinkEnabled` / `workspaceAutoLinkPRsEnabled` 移除 master short-circuit。
- 相关 i18n（en + zh-Hans 同步）与测试更新。

**不包含（YAGNI）：**

- **不**为 GitLab tab 补齐 Features section（MR 侧栏 / 自动关联开关）。GitLab tab 现状不渲染 Features，保持不变。
- **不**做存量数据迁移。`*_enabled` / `code_platform` 字段在被后端/前端停止读取后成为孤儿，留库无害。
- **不**清理 `HandleUpdateGitlabSettings` / `HandleGetGitlabSettings` 这条前端未使用的 settings 专用端点（前端走通用 `api.updateWorkspace`）。
- **不**为 `workspace.repos` 增加平台归属字段——分流完全靠 URL 域名过滤，底层仍为扁平数组。

## 详细设计

### 1. 代码仓库整合 + 按域名分流

**分流规则函数**（放在 `packages/views/settings/components/repositories-section.tsx` 或共享 util）：

```ts
// 与现有 githubRepoCount 的 /github\.com/i 口径一致
function repoHost(url: string): "github" | "other" {
  return /github\.com/i.test(url) ? "github" : "other";
}
```

GitHub tab 的 section 显示 `repoHost(url) === "github"` 的仓库；GitLab tab 显示 `=== "other"` 的。

**新增 `repositories-section.tsx`**：从 [repositories-tab.tsx](packages/views/settings/components/repositories-tab.tsx) 抽取，返回单个 `<section>` 片段（含 `<h2>` 标题 + `<Card>` 仓库列表 + 增删改保存），**去掉外层 `<div className="space-y-8">` 包裹**，由宿主 tab 的 `space-y-8` 统一管理间距。

接受一个 prop 指定分片：

```ts
interface RepositoriesSectionProps {
  host: "github" | "other";
}
```

**数据模型不变**：底层仍是 `workspace.repos` 扁平数组。section 内部 local state 维护全量副本（保存时写回全量 `updateWorkspace(repos)`），但**只显示 `host` 分片**。增删改操作全量数组，显示按 `host` 过滤。

**输入即分流**：添加仓库时不校验域名——用户在任一 tab 输入任意 URL，保存时追加到全量 `workspace.repos`。由于显示按域名过滤，输错域名的仓库会「流」到对应 tab：

- 在 GitLab tab 输入 `https://github.com/org/repo.git` → 保存后它出现在 GitHub tab，GitLab tab 列表不显示它。
- 为避免「刚加的仓库消失了」的困惑，保存成功 toast 需区分：若新加仓库的域名不属于当前 tab，提示「仓库已保存，已按域名归入 {对端平台} 标签页」（新 i18n key）。

**权限**：沿用 workspace 级 owner/admin 判定（`canManageWorkspace = role === "owner" || "admin"`），非管理员只读。

**删除 `repositories-tab.tsx`**（+ 测试），内容迁入 `repositories-section.tsx`（+ 测试）。

**GitLab tab 内嵌**：在连接 section 之后渲染 `<RepositoriesSection host="other" />`。

**GitHub tab 内嵌**：删除原「repositories 跳转卡片」section（含 `githubRepoCount`、`repositoriesHref`、跳转按钮），在 Features section 之后渲染 `<RepositoriesSection host="github" />`。`githubRepoCount` 删除，其 `/github\.com/i` 过滤逻辑迁入 `repoHost`。

### 2. tab 常驻 + 移除 code_platform 显隐

**[settings-page.tsx](packages/views/settings/components/settings-page.tsx)：**

- 移除 `codePlatform` 变量及其判定（line 111–114）。
- `visibleWorkspaceTabs` 的 filter 移除 `github` / `gitlab` 特判——两者恒显示：

```ts
const visibleWorkspaceTabs = WORKSPACE_TAB_KEYS; // github & gitlab always visible
```

- `WORKSPACE_TAB_KEYS` / `WORKSPACE_TAB_VALUES` / `WORKSPACE_TAB_ICONS` 移除 `repositories` 项（见 §1）。
- 移除 `import { RepositoriesTab }`、`<TabsContent value="repositories">`、不再使用的 `FolderGit2` icon。

**i18n 死文案清理**（en + zh-Hans 同步）：`settings.repositories.code_platform_label`、`settings.repositories.platform_changed`、`settings.repositories.platform_save_failed` 是早期 Repositories tab 平台切换的残留（切换 UI 已移除），顺手删除。

`code_platform` 字段可能仍存在于历史 workspace.settings 中，前端不再读它，留库无害。

### 3. 启用开关恒开 —— 前端

**[deriveGitlabSettings](packages/core/gitlab/settings.ts)：** `enabled` 恒 `true`，不再读 `s.gitlab_enabled`：

```ts
return {
  enabled: true,
  mrSidebar: s.gitlab_mr_sidebar_enabled === true,
  autoLinkMRs: s.gitlab_auto_link_enabled === true,
};
```

**[deriveGitHubSettings](packages/core/github/settings.ts)：** 对称改动（保留子功能默认语义差异——GitLab 默认关、GitHub 默认开）：

```ts
return {
  enabled: true,
  prSidebar: s.github_pr_sidebar_enabled !== false,
  coAuthor: s.co_authored_by_enabled !== false,
  autoLinkPRs: s.github_auto_link_prs_enabled !== false,
};
```

**[gitlab-tab.tsx](packages/views/settings/components/gitlab-tab.tsx)：**

- 删除 master switch section（当前 line 163–191）。
- `persistSetting` / `savingKey` / `SettingsKey` 整体删除（gitlab tab 唯一用 persistSetting 的就是 master 开关；令牌相关用各自独立的 `regenerating` / `savingToken` 状态）。
- `configured` 判定（line 78–80）由 `gitlabSettings?.configured === true || (flags.enabled && hasAccessToken)` 简化为 `gitlabSettings?.configured === true || hasAccessToken`。

**[github-tab.tsx](packages/views/settings/components/github-tab.tsx)：**

- 删除 master switch section（当前 line 139–167）。
- `SettingsKey` type 移除 `"github_enabled"`（保留其余 Features key）。`persistSetting` / `savingKey` 保留（Features 子开关仍用）。
- Features 三个 `FeatureRow` 的 `disabled` 移除 `!flags.enabled`，改为 `!canManage || savingKey === "..."`。

**下游 `flags.enabled` 清理：** 全局 grep `packages/` 下 `flags.enabled` / `gitlab_enabled` / `github_enabled` 的消费点，凡作为「功能是否启用」门控的，移除该条件（恒 `true`）。已知点：issue-detail 的 MR/PR 侧栏可见性等。实现时逐一确认。

### 4. 启用开关恒开 —— 后端

**[workspaceGitlabAutoLinkEnabled](server/internal/handler/gitlab.go) (line 308)：** 移除 master short-circuit：

```go
// 移除：
//   if s.GitlabEnabled != nil && !*s.GitlabEnabled { return false }
// 保留（auto-link 默认关）：
return s.GitlabAutoLinkEnabled != nil && *s.GitlabAutoLinkEnabled
```

**[workspaceAutoLinkPRsEnabled](server/internal/handler/github.go) (line 1000)：** 对称移除：

```go
// 移除：
//   if s.GitHubEnabled != nil && !*s.GitHubEnabled { return false }
// 保留（auto-link 默认开）：
if s.GitHubAutoLinkPRsEnabled == nil { return true }
return *s.GitHubAutoLinkPRsEnabled
```

**不**改 `HandleGetGitlabSettings` / `HandleUpdateGitlabSettings` / github settings 端点的请求响应字段（`*_enabled` 仍可透传，只是不再有门控意义）。`HandleUpdateGitlabSettings` 的「首次启用生成 webhook token」逻辑保留（端点自洽）。

### 5. 布局

整合后两个 tab 都对所有工作区常驻，section 顺序：

- **GitLab tab**：页面描述 → 连接（Webhook URL / 密钥令牌 / 个人访问令牌）→ 代码仓库（host="other"）。
- **GitHub tab**：页面描述 → 连接（GitHub App）→ 功能（PR 侧栏 / Co-authored-by / 自动关联）→ 代码仓库（host="github"）。

### 6. i18n

[parity.test.ts](packages/views/locales/parity.test.ts) 要求 en 与 zh-Hans key 一致，增删同步。

**删除（两语言同步）：**

- `settings.gitlab.section_master`、`settings.gitlab.master_description_on`、`settings.gitlab.master_description_off`
- `settings.github.section_master`、`settings.github.master_description_on`、`settings.github.master_description_off`
- `settings.github.section_repositories`、`settings.github.repositories_shortcut_label`、`settings.github.repositories_shortcut_link`
- `settings.page.tabs.repositories`
- `settings.repositories.code_platform_label`、`settings.repositories.platform_changed`、`settings.repositories.platform_save_failed`（code_platform 死文案）

**新增（两语言同步）：**

- `settings.repositories.routed_to_other_tab`：输入即分流时，新仓库域名不属于当前 tab 的提示（如「仓库已保存，已按域名归入另一个平台标签页」）。具体文案实现时可细化为带平台名插值。

**保留：** `settings.repositories.*` 的 section_title / description / 按钮文案继续由 `RepositoriesSection` 使用。

## 影响面（文件清单）

**前端：**

- 新增 `packages/views/settings/components/repositories-section.tsx`（+ 测试）
- 删除 `packages/views/settings/components/repositories-tab.tsx`（+ 测试）
- 改 `packages/views/settings/components/settings-page.tsx`（移除 code_platform 显隐 + repositories tab）
- 改 `packages/views/settings/components/gitlab-tab.tsx`（+ 测试）
- 改 `packages/views/settings/components/github-tab.tsx`（+ 测试）
- 改 `packages/core/gitlab/settings.ts`（+ 测试）
- 改 `packages/core/github/settings.ts`（+ 测试）
- 改 `packages/views/locales/en/settings.json`、`packages/views/locales/zh-Hans/settings.json`
- grep 并清理 `packages/` 下所有 `flags.enabled` / `gitlab_enabled` / `github_enabled` 消费点

**后端：**

- 改 `server/internal/handler/gitlab.go`（`workspaceGitlabAutoLinkEnabled`）
- 改 `server/internal/handler/github.go`（`workspaceAutoLinkPRsEnabled`）
- 补/改对应 Go 单测

## 测试

- `deriveGitlabSettings` / `deriveGitHubSettings` 单测：`enabled` 恒 `true`（即使 settings 里 `*_enabled: false`）；子功能派生正确。
- `repositories-section` 测试：
  - `host="github"` 只渲染 github 域名仓库；`host="other"` 只渲染其余。
  - 输入即分流：在 `host="other"` section 加 github URL 保存后，该 URL 不在本 section 显示（归 github）；反之亦然。
  - 增删改保存逻辑（从原 repositories-tab 测试迁移）。
  - 非管理员只读。
- `settings-page` 测试：代码仓库 tab 不在导航中；`?tab=repositories` 回退默认 tab；**GitHub 与 GitLab tab 同时可见**（移除原 `code_platform: "github"` 只显 GitHub 的断言，改为两者都显）。
- `gitlab-tab` / `github-tab` 测试：开关不再渲染；GitHub Features 子开关可独立切换。
- 后端单测：`workspaceGitlabAutoLinkEnabled` / `workspaceAutoLinkPRsEnabled` 在 `*_enabled: false` 时仍按 auto-link 子 flag 返回（master 不再 short-circuit）。

## 风险

- **下游门控遗漏**：`flags.enabled` 在 packages 下可能有未发现的消费点。实现时全局 grep 兜底。
- **分片状态同步**：两个 tab 各有一个 `RepositoriesSection` 实例，各自维护 local state。切 tab 时未保存的 local 改动会因组件卸载丢失——沿用原 RepositoriesTab 的「显式保存」模式，UX 上保存提示 + 分流提示需到位。
- **i18n parity**：增删 key 必须 en + zh-Hans 同步，否则 parity.test.ts 失败。
- **后端行为变化**：移除 master short-circuit 后，存量 `*_enabled=false` 工作区的 auto-link 恢复生效。产品未发布，存量为测试数据，影响可控。
