# cs-cloud 交付物行为重设计

| 字段 | 内容 |
|---|---|
| 日期 | 2026-07-26 |
| 状态 | 设计稿（待 review） |
| 相关仓库 | multica（服务端 dispatch）、cs-cloud（设备端执行）、costrict-web（Gitea 资源管理） |
| 参照实现 | multica daemon `server/internal/daemon/`（repocache / execenv / gc / 续接） |

## 1. 背景与目标

cs-cloud 现有的交付物（文档 / 代码）流程存在四个硬伤：

1. **worktree 从不清理、GC 是空 stub**——长期运行会堆积大量废弃 worktree，磁盘膨胀（cs-cloud 设计文档自认）。
2. **代码 MR 靠正则从 task output 抠 URL**（`/-/merge_requests/\d+`）——格式一变或多个交付物就丢失（multica `workflow.go:1319` 的 `extractPullRequestURLFromWorkerOutput`）。
3. **文档（Gitea CLI）与代码（daemon 自动创 MR）两套割裂**——文档走 `cs-cloud workflow deliverable submit`（agent 触发），代码走 cs-cloud driver 的 `OpenCodeMR`（daemon 自动），心智模型不一致、维护两份。
4. **无续接**——每个 task 全新 worktree + 全新 session，同 issue 多轮不延续上下文。

本方案在 **cs-cloud 现有架构（push 模式 + CoStrict 隧道 + 单 csc serve 长驻）内**重构交付链路，对齐 multica daemon 已验证的成熟模型，消除上述四个硬伤。

## 2. 已确认的设计决策

| # | 决策 | 选择 |
|---|---|---|
| 1 | 方案定位 | 重构 cs-cloud 现状（保持 push / 隧道 / csc serve 架构，不推翻重做） |
| 2 | 硬伤范围 | 四个硬伤全改（worktree/GC、正则回报、文档代码统一、续接） |
| 3 | 职责划分 | **混合**：环境归 daemon（clone/worktree/分支基线/清理/GC），内容归 agent（写/commit/push/创 MR/回报） |
| 4 | 续接模式 | 服务端驱动，对齐 multica（prior_session_id/prior_work_dir 由 multica 在 dispatch 时带） |
| 5 | 服务端边界 | 接受改 multica 服务端（跨 multica + cs-cloud 两仓库） |
| 6 | 主线方案 | A：统一「交付上下文」模型，文档/代码同构 |
| 7 | 仓库选择权 | 交 agent（`repos[]` allowlist + agent 按需 checkout） |
| 8 | Gitea 仓库创建 | multica 服务端在 dispatch 前调 costrict-web 接口 8 确保 wf repo + inst branch 就绪 |
| 9 | node branch 归属 | **执行端建**（cs-cloud daemon checkout 时建，base = inst branch），放弃「下发前服务端创建 node branch」 |
| 10 | 节点交付物 | 交付物驱动——节点不一定有交付物，无交付物节点不碰任何仓库 |
| 11 | 文档/代码统一 | 统一成同一套行为：agent 自行决定拉不拉、拉哪个、切什么分支 |
| 12 | 资源 vs 工作分支 | **资源（wf repo + inst branch）服务端建；工作分支（node/feature）执行端建** |
| 13 | csc 续接 | csc serve **支持 load 已有 session**（已确认），续接可行，不改 csc 集成层 |
| 14 | 接口 8 落地 | costrict-web `POST /api/internal/workflow/init` **已实现**，无前置阻塞 |

## 3. 整体架构

cs-cloud 仍是 push 模式：multica 服务端 `dispatchTaskToCSCloud` 把 task 推给 cs-cloud 设备。payload 升级：把原来散落的 `RepoURL` + `MULTICA_GITEA_*` env 收敛成统一的 `repos[]` + `deliverables[]`，外加续接用的 `prior_session_id` / `prior_work_dir`。

三层职责切分（贯穿全方案）：

| 层 | 归属 | 内容 |
|---|---|---|
| 资源就绪 | multica 服务端 | 调 costrict-web 接口 8 确保 wf repo + inst branch 存在；下发 `repos[]` + `deliverables[]` + prior |
| 环境准备 | cs-cloud daemon | bare clone 缓存、worktree、EnvRoot、工作分支、active root 防误删、GC |
| 内容产出 | agent（csc） | 写文件、commit、push、开 MR/PR、显式回报 |

## 4. 端到端数据流

```
① multica 服务端 dispatchTaskToCSCloud
   ├─ 查 GetLastTaskSession(agent_id, issue_id) → 带 prior_session_id / prior_work_dir
   ├─ 对 document 交付物：调 costrict-web 接口 8 确保 wf repo + inst branch，拿 bot_credentials
   ├─ 组装 repos[]（项目绑定的若干仓库 + Gitea 交付仓库）+ deliverables[]
   └─ POST /device/{id}/proxy/.../tasks/{id}/run

② cs-cloud daemon 收到（driver.execute）
   ├─【环境】repos[] 全部加入 allowlist + 后台预热 bare clone
   ├─【环境】写 .gc_meta.json、标记 active root
   ├─【环境】起 csc agent（prior_session_id → csc serve load session 续接）
   └─ daemon 不碰 commit/push/MR（归 agent）

③ agent（csc）执行
   ├─ 看 deliverables[] + 任务描述，自行决定拉不拉、拉哪个仓库
   ├─ 调 cs-cloud checkout 入口（daemon 按需建 worktree + 工作分支）
   ├─【内容】在 worktree 写文件、git add、git commit
   ├─【内容】cs-cloud deliverable submit（统一 CLI，按 provider 开 GitLab MR / Gitea PR）
   └─【内容】CLI 显式调 report 端点回报 PR URL（不靠正则）

④ cs-cloud 流出 session_id → 回调 multica PinTaskSession（持久化续接指针）

⑤ cs-cloud CompleteTask

⑥ GC 周期：cs-cloud 查 multica gc-check 端点 → 决定清理 worktree
```

## 5. Payload Schema

multica → cs-cloud 的 task payload：

```jsonc
{
  "task_id": "...",
  "workspace_id": "...",
  "issue_id": "...",              // 续接 key（对齐 multica 的 (agent, issue)）
  "prior_session_id": "...",      // 续接：上一次同 (agent,issue) 的 csc session
  "prior_work_dir": "...",        // 续接：上一次的 workdir 路径

  // ① 候选仓库 allowlist（项目绑定的若干代码仓库 + Gitea 交付仓库）
  "repos": [
    {
      "url": "https://gitlab.../backend.git",
      "provider": "gitlab",
      "role": "code",            // code | delivery
      "base_branch": "main",     // 代码 = 远端默认；delivery = inst branch（服务端已确保存在）
      "alias": "后端服务"         // 给 agent 的语义标签（可选）
    },
    {
      "url": "https://gitea.../t-<team>/wf-<def>.git",
      "provider": "gitea",
      "role": "delivery",
      "base_branch": "inst-<short>",
      "bot_token": "cs-bot-..."  // 仅 delivery 仓库带（costrict-web 接口 8 返回的 team bot token）
    }
  ],

  // ② 交付物契约（本节点要产出什么，可空）
  "deliverables": [
    {
      "id": "<deliverable_id>",
      "kind": "pull_request",     // document | pull_request
      "repo_alias": "后端服务",    // 可选：映射到 repos[].alias，提示这个交付物用哪个仓库（选择权仍在 agent）
      "report": {
        "endpoint": "/api/node-runs/{nid}/deliverables/{did}/submit",
        "method": "POST",
        "body_field": "pull_request_url"
      }
    }
  ]
}
```

**关键约定**：
- `work_branch` **不进 payload**——工作分支由 cs-cloud daemon 在 checkout 时按 provider 规则生成（代码 = `agent/<name>/<short_task>`；文档 = `node/<seq>/<run>` off inst branch）。
- `deliverables[]` **可为空**——无交付物节点（纯分析/评论/状态变更）不带任何仓库字段，agent 一个仓库都不拉。
- `repos[]` 里 `role=delivery` 的项带 `bot_token`（Gitea team bot，costrict-web 接口 8 返回）；`role=code` 的项**不带 token**（GitLab token 由 CLI 现取，见 §9）。
- 一个 task 可同时有代码 MR + 文档 PR（`deliverables[]` 多项 + `repos[]` 多个），同一套流程处理。

## 6. 拉取 / worktree / 分支 / 续接（环境归 daemon）

### 6.1 拉取：bare clone 缓存 + agent 按需 checkout

cs-cloud 引入 repocache（对齐 multica `server/internal/daemon/repocache/cache.go`）：
- **缓存路径**：`<workspacesRoot>/.repos/<workspaceID>/<bareDirName(url)>`，`git clone --bare` + 后续 `git fetch`。
- **allowlist**：task 收到后，`repos[]` 全部加入 allowlist + 后台预热 clone（不阻塞 task 启动）。
- **按需 checkout**：cs-cloud 新增给 agent 的 checkout 入口（对齐 multica 的 `cs-workflow repo checkout`，形态为本地 RPC 或 `cs-cloud repo checkout` 子命令）。agent 选定仓库后调它，daemon 验证 URL 在 allowlist、按需 `CreateWorktree`。**worktree 不预先建**，等 agent 选了才建。

### 6.2 worktree + EnvRoot 目录树

- **EnvRoot**：`<workspacesRoot>/<workspaceID>/<shortTaskID>/`，下含 `workdir/`、`output/`、`logs/`（对齐 multica `execenv.Prepare` + `PredictRootDir`）。
- **worktree 路径**：`<workdir>/<repoNameFromURL(url)>`。
- 每个 task 一个 EnvRoot；续接时复用 prior workdir（见 6.4）。

### 6.3 分支创建（执行端建）

daemon 在 `CreateWorktree` 时建工作分支：
- **代码仓库**：`agent/<sanitize(agent_name)>/<short_task_id>`（对齐 multica `cache.go:449`）。
- **Gitea 交付仓库**：`node/<node_seq>/<node_run_id>`，**base = inst branch**（inst branch 由 multica 调接口 8 已确保就绪）。
- 新建：`git worktree add -b <branch> <path> <base_ref>`；分支名冲突加 `-{unix_timestamp}` 后缀重试（对齐 multica）。
- 副作用：agent 上下文文件（`.agent_context`、`CLAUDE.md`、`AGENTS.md` 等）加入 `.git/info/exclude`；按 workspace 设置装/卸 `Co-authored-by` 钩子（对齐 multica）。

### 6.4 续接（服务端驱动，对齐 multica）

- multica `dispatchTaskToCSCloud` 查 `GetLastTaskSession(agent_id, issue_id)`，在 payload 带 `prior_session_id` + `prior_work_dir`。
- cs-cloud 收到后：
  - **prior_work_dir 命中**（worktree 还在）→ `updateExistingWorktree`：`git reset --hard` + `git clean -fd` + `git checkout -b <新分支> <base>`（对齐 multica `cache.go:619`）。上次未提交改动丢弃（已 commit/push 的不丢），重建干净分支。**worktree 文件重置与 csc session 续接相互独立**：session 上下文在 csc serve 内存侧，不受 worktree 文件重置影响；reset 丢的是未提交文件，session 记忆的对话/决策仍完整保留。
  - **prior_work_dir 没命中**（被 GC / 换机器）→ 走新建 Prepare。
  - **prior_session_id** → 传给 csc serve **load** 已有 session（已确认 csc serve 支持）。
- cs-cloud 流出 session_id 后，**回调 multica `PinTaskSession`**（`POST /api/daemon/tasks/{taskId}/session`，持久化指针，daemon 崩了也不丢，对齐 multica `daemon.go:2985`）。
- **resume 失败兜底**：cs-cloud 检测到 resume 没建立 session（`SessionID == ""`），自动开新 session 重试一次（对齐 multica `daemon.go:2662-2677`）。

### 6.5 active root 防误删

cs-cloud 维护 `activeEnvRoots` 引用计数（对齐 multica `daemon.go:3270`）：task 运行中标记 EnvRoot，GC 扫到时直接跳过，防止误删在跑的任务目录。续接场景下同时标记预测根 + prior 根。

## 7. 提交 / MR/PR 创建 / 交付物回报（内容归 agent）

### 7.1 提交（agent）

- agent 在 worktree 写文件、`git add`、`git commit`。
- **砍掉 cs-cloud 现状的 daemon 自动 commit**（`OpenCodeMR` 里的 `git add -A` + `git commit`）——改归 agent。
- daemon 装的 `Co-authored-by` 钩子自动加 trailer（环境副作用，agent 无感）。

### 7.2 MR/PR 创建（agent 用统一 CLI）

扩展 cs-cloud 的交付 CLI，**一个命令支持两种 provider**：

```
cs-cloud deliverable submit \
  --repo <repo_url> \        # repos[] 里选定的仓库
  --deliverable <id>         # 对应 deliverables[] 的交付物（纯代码任务可空）
```

CLI 内部按 repo 的 `provider` 分发，干同一套事：
1. push 当前分支（token 注入 URL）。
2. 按 provider 调平台 API：GitLab `POST /api/v4/projects/{id}/merge_requests`；Gitea `POST /api/v1/repos/{owner}/{repo}/pulls`。
3. 拿到 MR/PR 的 web URL。

**砍掉 cs-cloud 现状的 daemon 自动 `OpenCodeMR`**——代码 MR 不再由 daemon 在 task 结束时自动创，改 agent 用此统一 CLI（与文档 PR 同一命令）。

### 7.3 交付物回报（显式契约，消除正则）

CLI 创完 MR/PR 后，**显式调** multica report 端点（不再靠正则从 task output 抠 URL）：

| 交付物类型 | 回报端点 | body |
|---|---|---|
| `document` | `POST /api/daemon/node-runs/{id}/deliverables/{id}/report-pr` | `{"pull_request_url": "..."}` |
| `pull_request` | `POST /api/node-runs/{id}/deliverables/{id}/submit` | `{"pull_request_url": "..."}` |

这消除了「代码 MR 靠正则抠 URL」的脆弱硬伤——URL 是 CLI 创完直接报，不经过 task output 文本。multica 服务端的 `extractPullRequestURLFromWorkerOutput` 正则路径作为 fallback 保留，但不再是主路径。

### 7.4 多个交付物与更新（B 模型）

**多个代码交付物**：一个 task 可有多个 `kind=pull_request` 交付物（如同时改 backend + frontend 各开一个 MR）。`deliverable.repo_alias`（可选）映射到 `repos[].alias`，提示该交付物用哪个仓库；**选择权仍在 agent**（符合决策 7/11）。agent 为每个代码交付物调一次 CLI（`--repo <url> --deliverable <id>`），各自创 MR、各自按 `deliverable_id` 回报。

**更新交付物（B 模型：每次 task 新分支新 MR，upsert 覆盖）**：
- **同 task 内迭代**：agent 在同一工作分支上 commit + push 多次，MR/PR 自动更新（git 分支级更新，无需新开），最后 report 一次 URL 即可。
- **跨 task（续接/重试）**：新 task 建新工作分支（§6.4），开新 MR，report 新 URL；服务端 `UpsertNodeRunDeliverableSubmission` upsert 覆盖旧 URL。旧 MR 不自动关闭（留存，靠人工或后续清理）——这是对齐 multica daemon 现状的取舍，换取简单与一致。

**交付物状态查询**：agent 可调 `GET /api/node-runs/{id}/deliverables` 查看本节点交付物列表 + 已提交状态（哪些已提交、PR URL 是啥），据此决定新开还是更新（对齐 multica daemon prompt 里教 agent curl 查交付物列表的做法）。

### 7.5 代码交付物归档到交付物仓库

代码交付物（GitLab MR）除了显式回报 multica（§7.3），multica 服务端把代码仓库地址 + MR 信息**归档到 Gitea 交付物仓库**，让 Gitea 仓库成为所有交付物的统一归档地（文档交付物、代码 MR、评审意见、拆解方案都聚在一个 `nodes/<NN>-.../` 下）。

- **触发**：multica 收到代码 MR 的 report（`POST /api/node-runs/{id}/deliverables/{id}/submit`）后，归档到 Gitea。
- **归档内容**：代码仓库地址（clone URL）、分支、MR URL、deliverable id、agent、时间。
- **归档路径**：`nodes/<NN>-<title>-<nr>/code/<deliverable_id>.md`（inst 分支）。
- **实现**：新增 `ArchiveCodeDeliverable`（模仿 `ArchiveReviewComment`，`workflow_deliverable_repo.go:698`），用 Gitea admin/bot token 写入。
- **谁做**：multica 服务端（有 Gitea token），agent 不直接写 Gitea。

**⚠️ 依赖（选择点 §14）**：代码 MR 归档到 Gitea 需要该 run 有 Gitea 交付物仓库（wf repo + inst branch）。两种处理：① 扩展 Gitea 资源就绪到「所有有交付物的 run」（含纯代码 run）——代码 MR 必有归档处（推荐）；② 仅在该 run 已有 Gitea 仓库（有 document 交付物）时归档，纯代码 run 跳过。

## 8. token 机制（两种 provider 不同，因 token 性质不同）

| | Gitea bot token（文档交付） | GitLab token（代码 MR） |
|---|---|---|
| 性质 | costrict team bot（非用户） | workspace 用户 PAT |
| 敏感度 | 低 | 高 |
| 传递方式 | multica 调接口 8 拿到，**放进 payload** `repos[].bot_token` | **CLI 现取** `GET /api/gitlab/credential`（对齐 multica daemon），不进 payload |
| 使用 | cs-cloud 用它 clone/push Gitea | agent 创 MR 时 CLI 现取 |
| 日志约束 | `clone_url_with_token` 禁止落日志（对齐 costrict-web 文档） | — |

两者机制不同合理：Gitea 是平台 bot（低敏感，可内存传递），GitLab 是用户 PAT（高敏感，现取更彻底 hide）。

## 9. GC 决策表（cs-cloud 照搬 multica，复用 gc-check）

cs-cloud 引入 `gcLoop`（每 `GCInterval` = 1h 扫一次 `<workspacesRoot>`），决策状态机完全照搬 multica `server/internal/daemon/gc.go`：

| 判定 | 动作 |
|---|---|
| `isActiveEnvRoot`（task 运行中） | skip（引用计数防误删） |
| 无 `.gc_meta.json` | orphanByMTime（`GCOrphanTTL` = 72h mtime 后清） |
| Kind=issue | 查 `GET /api/daemon/issues/{id}/gc-check`，`status ∈ {done,cancelled}` + 超 `GCTTL`(24h) → 清整个目录；还开着但超 `GCArtifactTTL`(12h) → 只清 `node_modules/.next/.turbo` 等，**保留 .git 和源码** |
| Kind=chat | 查 `GET /api/daemon/chat-sessions/{id}/gc-check`；404 立即清（用户删除信号） |
| Kind=autopilot_run / quick_create | 查对应 gc-check 端点，终态 + TTL → 清 |
| 全部扫完 | `git worktree prune` 清理 bare cache 的悬空 worktree |

`.gc_meta.json` 由 cs-cloud 在 task 完成时写（Kind 按 task 的 IssueID/ChatSessionID/AutopilotRunID/QuickCreatePrompt 判定，对齐 multica `gcMetaForTask`）。

GC 默认值（对齐 multica，env 可覆盖）：`GCInterval=1h`、`GCTTL=24h`、`GCOrphanTTL=72h`、`GCArtifactTTL=12h`、`GCArtifactPatterns=[node_modules,.next,.turbo]`。

**⚠️ 认证细节**（进实现解决）：multica 的 gc-check 端点挂在 `DaemonAuth` 下（要 `mul_` PAT），cs-cloud 现在用 user OAuth token。两种解法二选一：① 给 cs-cloud 发 daemon 身份（注册为 runtime 拿 PAT）；② gc-check 端点放宽接受 user token + workspace 校验。方案层面不阻塞。

## 10. 三方改动清单

### 10.1 multica 服务端

| 改动点 | 文件 | 内容 |
|---|---|---|
| **dispatch 带 prior** | `server/internal/service/task_cscloud_push.go` `dispatchTaskToCSCloud` | 查 `GetLastTaskSession(agent_id, issue_id)`，payload 带 `prior_session_id`/`prior_work_dir` |
| **统一 payload** | `task_cscloud_push.go` `buildCSCloudPayload` | 用 `repos[]` + `deliverables[]` 替代原 `RepoURL` + 散落的 `MULTICA_GITEA_*` env |
| **修复选仓库规则** | `task_cscloud_push.go` `resolveCodeRepoAndProject` | 从「只取 workspace 第一条 repo」改成「项目绑定的若干仓库」（对齐 daemon 的 project github_repo 逻辑，`handler/daemon.go:1290`），消除 daemon 与 cs-cloud 选仓库不一致 |
| **Gitea 资源就绪** | `task_cscloud_push.go` | 对 document 交付物，调 costrict-web 接口 8 确保 wf repo + inst branch，拿 `bot_credentials` 放进 `repos[]` 的 delivery 项 |
| 复用 PinTaskSession | `server/internal/handler/task_lifecycle.go:67`（已有） | cs-cloud 回调，无需改 |
| 复用 4 个 gc-check | `server/cmd/server/router.go:415-418`（已有） | cs-cloud 复用（认证见 §9） |
| 复用 task status | `router.go`（已有） | 取消信号，无需改 |
| **critic 合并 GitLab MR**（§12） | `workflow_deliverable_repo.go` `mergeDeliverablePRs` + `coderepo/provider.go` | 扩展支持 GitLab MR（现状只合 Gitea PR），用 GitLab PAT 调 merge API |
| **critic 关闭 PR/MR**（§12，新增） | `coderepo/provider.go` `RepositoryProvider` + `gitea/merge.go` + GitLab adapter | 新增 `CloseReviewRequest`（Gitea `PATCH .../pulls/{index}` state=closed + GitLab 等价），在 `ReviewNodeRun` rejected 分支调用 |
| **split 结果归档**（§13，新增） | `workflow_deliverable_repo.go` | 新增 `ArchiveSplitDecision`（模仿 `ArchiveReviewComment`），split approve 后写 `nodes/<NN>-.../splits/plan.md` 到 inst 分支 |
| **cs-cloud split prompt**（§13） | `task_cscloud_push.go` `buildCSCloudPayload` phase 路由 | 新增 `split_generate`/`split_chat` 分支 + `appendSplitPrompt`（对齐 daemon `buildSplitPrompt`），让 cs-cloud 能跑 split |
| **代码 MR 归档**（§7.5，新增） | `workflow_deliverable_repo.go` | 新增 `ArchiveCodeDeliverable`：收到代码 MR report 后，把代码仓库地址 + MR 信息写入 Gitea inst 分支 `nodes/<NN>-.../code/<did>.md` |
| **扩展 Gitea 资源就绪**（§7.5） | `task_cscloud_push.go` | 从「仅 document 节点」扩到「所有有交付物的 run」（含纯代码 run），让代码 MR 有归档处 |

### 10.2 costrict-web

- `POST /api/internal/workflow/init`（接口 8）：**已实现**，multica 直接调，确保 wf repo + inst branch + 返回 bot_credentials。
- `POST /api/internal/teams`（接口 1）：team ns + bot 创建入口（若 team 尚未创建，作为更早的前置；通常 team 在 workspace 绑定 costrict 时已建）。
- 无需为本方案新增接口。

### 10.3 cs-cloud 设备端

| 新增 | 对齐 multica 的 |
|---|---|
| repocache（bare clone + worktree + bareDirName + credential helper） | `repocache/cache.go` |
| execenv（EnvRoot 目录树 + `.gc_meta.json`） | `execenv/` |
| gcLoop（GC 决策表 + active root 引用计数 + artifact-only） | `gc.go` |
| 给 agent 的 checkout 入口（本地 RPC / `cs-cloud repo checkout`） | `cs-workflow repo checkout` + `/repo/checkout` |
| 续接（消费 prior + 回调 PinTaskSession + csc serve load session + resume 失败兜底） | daemon 续接全套 |

| 砍掉 / 改造 | 原因 |
|---|---|
| **砍 `OpenCodeMR`**（`internal/workflowrunner/coderepo.go`，daemon 自动 commit + 创 GitLab MR） | 改归 agent 用统一 CLI |
| **扩展 `cs-cloud workflow deliverable submit`** 支持 gitlab MR | 文档/代码统一一个命令 |
| **改造 payload 消费** | 从 `RepoURL` + env 改成 `repos[]` + `deliverables[]` |
| **砍 output 正则提取的依赖** | 改显式回报；正则路径在 multica 侧降级为 fallback |

## 11. 节点交付物类型与行为（交付物驱动）

| 节点类型 | `deliverables[]` | Gitea 资源 | 代码仓库 | cs-cloud/agent 行为 |
|---|---|---|---|---|
| 文档交付节点 | `kind=document` | ✅ 接口 8 确保 wf repo + inst | — | clone Gitea repo、checkout node branch、写文档、开 PR、回报 |
| 代码交付节点 | `kind=pull_request` | — | ✅ `repos[]` allowlist | agent 按需 checkout 代码仓库、改代码、开 MR、回报 |
| 无交付物节点 | 空 | — | — | 普通执行（分析/评论/状态变更），不碰任何仓库 |

## 12. 评审（critic）环节的交付物操作

critic 节点评审 worker 提交的交付物，按结论合并/关闭。合并/关闭是平台动作，由 multica 服务端做，cs-cloud 不碰。

**执行与结论记录**（对齐现状）：
- critic 节点的 cs-cloud agent 评审 worker 的 MR/PR，输出 `{approved: bool, comment: string}`。
- multica 服务端解析后存 `multica_workflow_node_run.critic_output` + `critic_comment`（`workflow.go:1891`）。
- 评审意见归档到交付物仓库（复用 `ArchiveReviewComment`，写 `nodes/<NN>-.../reviews/<RR>-<reviewer>-<通过|驳回>.md` 到 inst 分支）。

**approved → 合并对应 MR/PR**：
- Gitea PR：复用 `mergeDeliverablePRs`（`workflow_deliverable_repo.go:773`，Gitea admin token，已实现）。
- **GitLab MR：扩展支持**（现状真空）——新增 GitLab merge（用 GitLab PAT 调 `PUT /api/v4/projects/{id}/merge_requests/{iid}/merge`），让 worker 的代码 MR 也能被 critic 批准后自动合并。
- 合并失败 → node-run 置 `blocked`（对齐现状）。

**rejected → 关闭对应 MR/PR**（**新增**，现状完全没实现）：
- 新增 `CloseReviewRequest` 到 `coderepo.RepositoryProvider` 接口 + `GiteaAdapter.CloseReviewRequest`（`PATCH /repos/{owner}/{repo}/pulls/{index}` state=closed）+ GitLab 等价物。
- 在 `ReviewNodeRun` rejected 分支调用，关闭本轮 worker 开的 MR/PR（替代现状「留着不管、靠 findOpenPR 复用」）。超过 `MaxRetries` 进 `blocked` 时也关闭。

**critic agent 的可见性**：critic 要能看到 worker 提交的 PR 才能评审——调 `GET /api/node-runs/{id}/deliverables`（§7.4）查 worker 已提交的 PR URL + 状态。

## 13. 拆解（split）环节的交付物记录

split 节点把任务拆成子 issue，拆解结果落地到交付物仓库供后续节点查询。

**cs-cloud 支持 split**（**新增**，现状 cs-cloud 不能跑 split）：
- `task_cscloud_push.go` 的 phase 路由新增 `split_generate` / `split_chat` 分支，调 `appendSplitPrompt`（对齐 daemon 的 `buildSplitPrompt`）。
- 引导 cs-cloud agent 用 `cs-workflow workflow split draft add/submit` CLI（后端 API 已通）。

**拆解结果落地到交付物仓库**（**新增**，现状只存 multica DB）：
- 新增 `ArchiveSplitDecision(nodeRun, plan)`（模仿 `ArchiveReviewComment`），在 split approve 后把拆解方案写入 Gitea inst 分支：路径 `nodes/<NN>-<title>-<nr>/splits/plan.md`，内容含子任务列表（key、标题、描述、依赖、子 issue id + 子 run id）。
- 让交付物仓库成为拆解信息的载体，不只靠 multica DB。

**子任务交付物仓库可查询**（用户需求）：
- cs-cloud agent 执行后续节点时，要能查到「拆解出的子任务 + 各子任务的交付物仓库（地址/inst branch/已产出 PR）」。
- 复用现有 multica API（`HandleGetIssueGiteaDeliverables` 已返回子任务 Gitea owner/repo/inst_branch + deliverable 列表）：`GET /api/daemon/issues/{issue}/gitea-deliverables?descendants=true` + `GET /api/daemon/issues/{issue}/workflow-tree?descendants=true`。

## 14. 实现时确认的细节（不阻塞方案）

1. **gc-check 认证**（§9）：cs-cloud 调 multica gc-check 的鉴权方式二选一。
2. **checkout 入口形态**：cs-cloud 给 agent 的 checkout 入口是本地 RPC 还是 `cs-cloud repo checkout` 子命令（对齐 multica 的 `cmd_repo.go`）。
3. **统一 CLI 命令名**：`cs-cloud deliverable submit` 是扩展现有子命令还是新建。
4. **Co-authored-by 设置来源**：cs-cloud 怎么拿到 workspace 的 `co_authored_by_enabled` 设置（payload 带一个 flag，或调 multica 查）。
5. **payload 日志脱敏**：cs-cloud 收到 payload 时若打 debug 日志，需对 `repos[].bot_token` 脱敏（对齐 §8 的日志约束，token 不落日志）。
6. **split 是否在 cs-cloud 跑**（§13）：cs-cloud 支持 split 节点，还是保持 daemon-only。
7. **cs-cloud agent 查询途径**（§13）：查子任务交付物走 cs-workflow CLI / cs-cloud 新子命令 / curl API，三者选一。
8. **代码 MR 归档的 Gitea 资源就绪**（§7.5）：纯代码 run 要不要也调接口 8 建 Gitea 仓库（让代码 MR 有归档处），还是仅在有 document 交付物时归档。

## 15. 测试策略

### 单元测试（cs-cloud，Go）
- repocache：`bareDirName` URL→目录名映射、clone/fetch credential helper 注入、`CreateWorktree` 新建 vs `updateExistingWorktree` 复用（reset/clean/checkout-b）、分支名冲突时间戳兜底。
- gc：决策状态机各分支（issue done+TTL→clean、issue 开着+ArtifactTTL→artifact-only、chat 404→立即清、orphan mtime、active root 跳过）、`.gc_meta.json` 读写。
- 续接：prior_work_dir 命中/没命中分支、resume 失败兜底（SessionID 空 → 开新 session）。

### 单元测试（multica，Go）
- `dispatchTaskToCSCloud`：prior 注入（GetLastTaskSession 命中/不命中/poison 过滤）、`repos[]` 组装（项目仓库覆盖 workspace）、document 交付物调接口 8 mock。
- `resolveCodeRepoAndProject`：项目绑定多仓库时全部进 `repos[]`（修复「只取第一条」的回归测试）。

### 集成测试
- 端到端：document 节点 → multica dispatch（带 prior + 接口 8 就绪）→ cs-cloud clone Gitea + node branch → agent 写文档 + commit + 开 PR → 显式 report-pr 落库。
- 端到端：pull_request 节点 → agent 按需 checkout 代码仓库 → 改代码 + 开 MR → 显式 submit 落库（验证不走 output 正则）。
- 续接：同 issue 第二个 task → 复用 workdir + csc serve load session + PinTaskSession 回写。

### 验证硬伤消除
- worktree 不清理：长跑后 `git worktree prune` 生效、`.gc_meta` 驱动的目录被回收。
- 正则抠 URL：代码 MR 的 `pull_request_url` 由 CLI 显式 report，不再依赖 output 文本格式。
- 文档/代码割裂：两种交付物走同一个 `cs-cloud deliverable submit` CLI。
- 无续接：同 issue 多轮 task 复用 workdir + session。

## 16. 非目标（YAGNI）

- **不推翻 cs-cloud 架构**：不改 push 模式、不拆隧道、不换 csc serve 为 spawn CLI（csc serve 已支持 session load）。
- **不做 cs-cloud 与 multica daemon 完全趋同**：只对齐交付链路，不统一两边的 runtime/claim 机制。
- **不做 GitHub PR**：代码交付仅支持 GitLab MR（对齐现状），文档仅支持 Gitea PR。
- **不做跨 task 的 worktree 共享**：worktree 绑 (workdir, repo)，按 task/续接维度，不跨 issue 共享。
- **不改 multica daemon 本地路径**：本方案只改 cs-cloud 路径（`dispatchTaskToCSCloud`），multica daemon 的 claim 路径（`ClaimTaskByRuntime`）不动。
