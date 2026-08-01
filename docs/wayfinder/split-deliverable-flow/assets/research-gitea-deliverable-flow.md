# Gitea 文档交付物流现状摸底（research）

> 对应 ticket: `docs/wayfinder/split-deliverable-flow/tickets/01-gitea-deliverable-flow.md`
> 目的：为「拆分节点产出 task.md 作为文档交付物存 Gitea」的设计提供现状事实。
> 所有结论标注源码锚点；标注「未找到/不确定」的条目为显式空白，不要当作事实引用。

## TL;DR

1. **存储拓扑**：每个 workspace 一个私有 Gitea org `t-<ws[:8]>`，每个 workflow 一个 repo `wf-<wf[:8]>`（默认 workflow 用 `wf-deliverable-archive`）；每次 run 一条 `inst-<run[:8]>` 分支作为长期归档分支，每个 node run 一条 `node/<NN>-<nodeRunShort>` 分支，文档经 node→inst PR 评审、approve 时由服务端 merge 进 inst。锚点：`server/internal/gitea/topology.go:31,37,57,85,92`。
2. **写入路径有两条**：(a) agent 侧——服务端在派发/认领时把 owner/repo/带 token 的 clone URL/分支/交付物路径注入 env，agent 用**外部二进制 `cs-cloud`** 的 `workflow deliverable submit` 完成 push + 开 PR + 回注 PR URL（该 CLI 实现不在本仓库）；(b) 人侧——`POST /api/issues/{id}/deliverables/upload` 服务端代写 Gitea + 开 PR。
3. **读取路径是空白**：本仓库的 Gitea client 没有公开的「读文件内容 / 读 commit SHA」API（只有私有 `getFileSHA` 服务于 UpsertFile 的更新分支）；approve 时只 merge PR，从不回读内容或记录 SHA。「approve 时刻拉最新内容 + 记录 SHA」需要新建能力。
4. **与 DB 的关系**：Gitea 上的文档与 `multica_workflow_node_deliverable_submission` 仅靠 `pull_request_url`（node→inst PR 的 web URL）关联；submission 不存内容、不存路径、不存 SHA。document 场景下 `content`/`attachment_id` 在 Gitea 配置启用时被显式禁用（422）。
5. ticket 中提到的 `/ns/upload`、`gitea-ns` 路由**已不存在**，被新路由替代（见 Q2/Q4）。

---

## Q1. 存储结构：repo / 分支 / 目录约定

### 命名拓扑（`server/internal/gitea/topology.go`）

| 层级 | 约定 | 锚点 |
|---|---|---|
| Org（team namespace） | `t-<workspace UUID 前 8 hex>` | `topology.go:31`（`OrgName`） |
| Repo（自定义 workflow） | `wf-<workflow UUID 前 8 hex>`；非 UUID slug 走 v2 escape 规则 | `topology.go:37`（`RepoName`） |
| Repo（默认 workflow / issue 归档） | `wf-deliverable-archive`（`DefaultArchiveRepoName()` = `deliverable-archive`，外面再套 `RepoName` 加 `wf-` 前缀） | `topology.go:57` + `server/internal/service/workflow_deliverable_repo.go:70-82`（`DeliverableRepoName`，注释记录了 bare slug 导致 404 的教训） |
| 实例分支（每 run 一条，长期保留的审计分支） | `inst-<run UUID 前 8 hex>`，基于 main | `topology.go:85`（`InstBranch`） |
| 节点分支（每 node run 一条，PR merge 后删除） | `node/<NN>-<nodeRunShort>`，NN = 拓扑序（1-based，补零）；**分支名严格 ASCII，不含 CJK 标题** | `topology.go:92`（`NodeBranch`）、`topology.go:221`（`NodeTopoOrder`，Kahn + (sort_order,title,ID) tiebreak） |
| 节点目录（repo 内，UTF-8 可含 CJK） | `nodes/<NN>-<nodeTitle>-<nodeRunShort>`（标题清洗后为空则省略标题段） | `topology.go:100`（`NodeDir`） |
| 文档交付物路径（agent 流） | `<NodeDir>/<deliverableTitle>.md`（标题即文件名，空标题回退 `untitled`；同名冲突由调用方加后缀） | `topology.go:116`（`DeliverablePath`） |
| 评审意见归档 | `<NodeDir>/reviews/<RR>-<reviewer>-<通过|驳回>.md` | `topology.go:128`（`ReviewPath`），写入方 `workflow_deliverable_repo.go:594`（`ArchiveReviewComment`） |
| 代码 MR 指针归档 | `<NodeDir>/code/<deliverableID>.md` | `topology.go:144`（`CodePath`），写入方 `workflow_deliverable_repo.go:659`（`ArchiveCodeDeliverable`） |
| 拆分子任务地址索引 | 父 run 的 `<splitNodeDir>/splits/<childIssueNumber>[-<title>].md`，内容含 child clone_url + inst branch | `topology.go:153`（`SplitChildPath`），写入方 `workflow_deliverable_repo.go:712`（`ArchiveSubIssueAddress`） |
| 代码链接汇总（approve 时直写 inst） | `<NodeDir>/代码合并请求.md` | `workflow_deliverable_repo.go:866`（`codeLinksArchiveFile` 常量）、`:884`（`archiveCodeLinksToInst`） |

**注意（两路写入的目录不一致）**：agent 流把文档写到 `DeliverablePath`（`<NodeDir>/<title>.md`）；而**成员上传流**把文件写到 `<NodeDir>/deliverables/<deliverableID前8>/<原始文件名>`（`workflow_deliverable_repo.go:1360-1375`，`UploadMemberDeliverable`）。设计 task.md 落盘路径时需决定跟哪一套。

###  provisioning（repo/分支什么时候被建出来）

- workspace 创建时（异步、best-effort）：建 team namespace（org + bot）、同步成员、预建 `wf-deliverable-archive`。`workflow_deliverable_repo.go:495`（`ProvisionWorkspaceGitea`）、`:273`（`initDefaultArchiveRepo`）。
- workflow 激活时（status→active）：预建 `wf-<wf[:8]>` repo + main 分支保护。`workflow_deliverable_repo.go:521`（`ProvisionWorkflowRepo`）、`:551`（`provisionTeamNamespaceWorkflowRepo`）。
- run 启动时（`StartWorkflowRun` 后 goroutine）：仅当 run 有 deliverable 要求时才 `InitWorkflow` 建 inst 分支；失败会把 run 置 failed（Gitea 是文档 workflow 的硬依赖）。`workflow_deliverable_repo.go:344`（`ScaffoldRunDeliverables`）。
- 节点进入执行时：建 node 分支。`workflow_deliverable_repo.go:395`（`ensureNodeRunBranch`）。
- cs-cloud 派发时的安全网：若 workspace.settings 缺 Gitea 数据则补 provisioning。`server/internal/service/task_cscloud_push.go:287-292`、`:1344`（`ensureDeliveryRepo`）。

provisioning 实际经由 **costrict-web team-namespace 内部 API**（不是直接调 Gitea admin API）：
- `POST /api/internal/teams`（CreateTeam，返回 org + bot 凭据）——`server/internal/teamnamespace/client.go:130`
- `POST /api/internal/workflow/init`（InitWorkflow，返回 `wf_repo_path`/`wf_clone_url`/`wf_web_url`/`instance_branch`/bot 凭据/带 token clone URL）——`client.go:156`
- `POST /api/internal/teams/{id}/members:sync`（SyncMembers，full_sync）——`client.go:136`

回写进 `workspace.settings` 的 key：`team_ns_org`、`gitea_base_url`、`gitea_bot_username`、`gitea_pat`、`gitea_pat_sha256`、`last_wf_repo_path`、`last_instance_branch`、`gitea_clone_url`、`gitea_web_url`、`gitea_clone_url_token`、`gitea_algorithm_ver`、`gitea_team_ns_exists`。锚点：`workflow_deliverable_repo.go:196-222`（`ensureTeamNamespace`）、`:234-271`（`initWorkflowNamespace`）。

运行时文件读写则走直连 Gitea 的 admin client（`server/internal/gitea/client.go`，env `GITEA_BASE_URL` + `GITEA_ADMIN_TOKEN`），封装在 `coderepo.RepositoryProvider` 接口后面（`CreateBranch`/`UpsertFile`/`OpenReviewRequest`/`MergeReviewRequest`/`CloseReviewRequest`/`ListOrgMembers`）。锚点：`server/internal/coderepo/provider.go:16-25`；选择逻辑 `workflow_deliverable_repo.go:30-35`（`deliverableRepository`）。

---

## Q2. 写入路径：agent 怎么把文档传上 Gitea

### 2a. agent 流（云端 cs-cloud / 本地 daemon 同一模型）

**执行提交的 CLI 是 `cs-cloud workflow deliverable submit --deliverable <id> --file <path>`，其实现不在本仓库**（`server/cmd/` 下只有 `cs-workflow`、`server`、`migrate`、`backfill_*`；全仓 grep 无 `cs-cloud` 命令实现）。本仓库只负责把上下文与凭据喂给它：

- **cs-cloud（云 agent）派发时注入 env**：`CS_CLOUD_REPO_OWNER/NAME/BASE_URL/TOKEN/CLONE_URL/CLONE_URL_AUTHED/INST_BRANCH/NODE_BRANCH/DELIVERABLES`（+ 旧名 `CS_CLOUD_GITEA_*` 别名桥），其中 `CLONE_URL_AUTHED` 内嵌 bot PAT，`DELIVERABLES` 是 `[{deliverable_id,title,path}]`（path = `DeliverablePath`）。锚点：`task_cscloud_push.go:767`（`repositoryDeliverableEnv`）、`:869-905`（env map + 别名桥）、`:922`（`injectGiteaToken`）。prompt 模板：`task_cscloud_push.go:700`（`appendDeliverablePrompt`，明确指示 clone→checkout node 分支→逐 deliverable 提交）。同时 Gitea delivery repo 以 `role=delivery` 注入 `payload.Repos[]`：`task_cscloud_push.go:528`（`resolveDeliveryRepo`）。
- **本地 daemon agent**：claim 响应携带同样的 `gitea_deliverables` 上下文（owner/repo/clone_url/inst_branch/node_branch/deliverables+path），daemon 转成 `MULTICA_REPO_*` / `MULTICA_GITEA_*` env 给 agent 进程。锚点：`server/internal/handler/daemon.go:1656-1659`（claim 挂上下文）、`:1815,1827`（`buildGiteaDeliverableContext`/`giteaContextForNodeRun`）、`server/internal/daemon/daemon.go:2301-2325`（`buildAgentEnv`）、prompt 在 `server/internal/daemon/prompt.go:84-96`（同样指示跑 `cs-cloud workflow deliverable submit`）。
- **该 CLI 的语义**（据本仓库注释描述）：从 inst 分支建/推 node 分支 → 把文件写到服务端预先算好的 path → 开 node→inst 评审 PR → 把 PR URL 回注 multica。回注走 HTTP API `POST /api/node-runs/{nodeRunId}/deliverables/{deliverableId}/submit`（body `pull_request_url`）。锚点：注释 `task_cscloud_push.go:695-699`、`server/internal/handler/issue_deliverable_upload.go:29-33`；回注 handler `server/internal/handler/workflow_run.go:1125`（`SubmitNodeRunDeliverable`），路由 `server/cmd/server/router.go:734`。
- **凭据来源**：bot PAT 存在 `workspace.settings.gitea_pat`（provisioning 时由 costrict-web 铸），服务端直接注入 env；daemon/CLI 也可调 `GET /api/repositories/credential`（旧别名 `GET /api/gitea/credential`）取 `{base_url, provider:"gitea", token}`——daemon token 鉴权，workspace 从 token 推导。锚点：`server/internal/handler/repository_credential.go:60-97`、路由 `router.go:462-467`（注释原文 “Repository credential for the cs-workflow CLI document-deliverable flow”）。

**注意**：本仓库的 `cs-workflow` CLI **没有** document deliverable submit 命令；只有只读的 `cs-workflow issue deliverables <issue-id> [--descendants]`（打印 repo 地址 + 交付物清单，`server/cmd/cs-workflow/cmd_issue_workflow.go:131-199`，底层调 `GET /api/daemon/issues/{issue}/gitea-deliverables`）。ticket 里的 `/ns/upload`、`gitea-ns` 路由在全仓 grep 无匹配，已被上述路由取代。

### 2b. 成员（人）上传流——服务端代写

- `POST /api/issues/{id}/deliverables/upload`：文件 base64 上传 → 服务端在 node 分支（没有则建）写 `<NodeDir>/deliverables/<delivShort>/<filename>` → 开 node→inst PR → submission 记录 PR URL → 满足集齐后推进到 awaiting_critic 并派发 critic。锚点：handler `issue_deliverable_upload.go:37`；service `workflow_deliverable_repo.go:1341`（`UploadMemberDeliverable`）、`:1123`（`runLockedMemberUpload`，行锁串行化）、`:1210`（`recordMemberUploadAndAdvance`）。
- `POST /api/issues/{id}/deliverables/upload-pr`：粘贴外部 MR 链接，原样存 submission，不碰 Gitea（approve 时才汇总归档到 inst）。`issue_deliverable_upload.go:116`；`workflow_deliverable_repo.go:1277`（`UploadMemberDeliverablePR`）。
- 权限门：仅该 node run 的 human worker（未指定则任意 active member，owner/admin 可兜底）；agent/squad 跑的节点拒收成员上传。`issue_deliverable_upload.go:190`（`deliverableUploadWorkerAllowed`）。
- 路由：`router.go:603-604`（在 `/api/issues/{id}` 组下）。

### 2c. 服务端自己的归档写入（评审意见 / 代码指针 / 拆分子任务地址）

统一用 `repoProvider.UpsertFile`（Gitea contents API，存在则带 blob SHA 走 PUT 更新）直写 **inst 分支**，不开 PR。锚点：`server/internal/gitea/client.go:269`（`UpsertFile`）；调用方 `ArchiveReviewComment`（`workflow_deliverable_repo.go:594`）、`ArchiveCodeDeliverable`（`:659`）、`ArchiveSubIssueAddress`（`:712`）、`archiveCodeLinksToInst`（`:884`）。

**对拆分节点 task.md 的启示**：最接近的现成模式是 `ArchiveSubIssueAddress`——拆分相关产物由服务端用 bot 身份直写父 run 的 inst 分支；而「可评审的正式交付物」模式是 node 分支 + PR + submission。

---

## Q3. 读取路径：按 node run / issue 取最新内容与 commit SHA

### 已有的「读」

- **按 issue 解析 Gitea 拓扑 + 交付物清单（元数据，不含内容）**：`GET /api/daemon/issues/{issue}/gitea-deliverables?descendants=true`，返回 owner/repo/clone_url/inst_branch + 每个交付物的 in-repo path。handler `issue_gitea_deliverables.go:60`（`HandleGetIssueGiteaDeliverables`）、`:157`（`giteaContextForRun`）；路由 `router.go:448`；daemon 鉴权。
- **按 node run 的同款上下文**：claim 响应内嵌（`daemon.go:1657`）与 `giteaContextForNodeRun`（`daemon.go:1827`）。
- **agent 侧读内容**：prompt 指示 agent 在 clone 出来的 repo 里用 git 读——`git fetch origin && git show origin/$CS_CLOUD_REPO_INST_BRANCH:<path>`（`task_cscloud_push.go:716-717`）。即「读最新内容」现状是 **git CLI，不是 HTTP API**。
- **submission 状态读**：`GET /api/node-runs/{nodeRunId}/deliverables`（`workflow_run.go:1090`，路由 `router.go:733`）——只有 submission 行（status/PR URL），无内容、无 SHA。

### 关键空白（未找到）

- **服务端没有公开的「读 Gitea 文件内容」调用**。`server/internal/gitea/client.go` 唯一的内容读是私有 `getFileSHA`（`client.go:305`，GET `/repos/{o}/{r}/contents/{p}?ref=...` 只取 blob SHA），仅供 `UpsertFile` 更新分支使用（`client.go:289`）。`coderepo.RepositoryProvider` 接口（`provider.go:16-25`）没有任何 Read/Get 方法。
- **没有任何代码记录 commit SHA**。approve 时刻的动作是 `mergeDeliverablePRs`（`workflow_deliverable_repo.go:962`，经 `gitea.ParsePullRequestIndex` 解析 PR 序号后 `MergePR`，`merge.go:23`）+ `markDeliverableSubmissionsApproved`（`:1058`），不回读 merge commit、不存 SHA 到 DB。submission 表也没有 SHA 列（见 Q5）。
- 结论：设计要的「approve 时拉最新内容 + 记录 SHA」**无现成 API 可复用**，需新增（候选：扩展 `gitea.Client` 加 contents read / commits API，或让 agent 侧 git rev-parse 后上报）。

---

## Q4. 人的编辑面：前端跳转链接 + Gitea 权限模型

### 前端链接

- 全仓（`packages/`、`apps/`）grep `gitea`：**前端不拼接任何 Gitea 文件查看/编辑 URL**。唯一的「跳 Gitea」入口是渲染 submission 的 `pull_request_url`（node→inst PR 的 web URL，形如 `https://<gitea>/<org>/<repo>/pulls/<n>`）：
  - `packages/views/workflows/components/node-run-deliverables.tsx:39-77`（`<a href={s.pull_request_url} target="_blank">`）
  - 执行面板同款：`packages/views/issues/components/execution/execution-detail-panel.tsx`（测试锚点 `execution-detail-panel.test.tsx:801`）、`runtime-node-card.test.tsx:634`
- PR web URL 来自 Gitea 开 PR 响应的 `html_url`（`server/internal/gitea/merge.go:61-99`，`OpenPR`），存进 submission 后由 API 原样吐出。
- **未找到**：`/_edit/`、`/src/branch/` 这类 Gitea 文件级 URL 的构造代码——不存在。「人在 Gitea 编辑文档」的现状入口是点进 PR 再自己在 Gitea UI 里导航；直接跳编辑页的 URL（Gitea 原生约定 `<base>/<owner>/<repo>/_edit/<branch>/<path>`）需要前端新增拼接，所需原料（owner/repo/branch/path）目前**没有**通过 API 暴露给前端（`gitea_deliverables` 上下文只走 daemon 通道，`router.go:443-448` 在 daemon 鉴权组内）。
- workspace.settings 里的 `gitea_web_url`（`workflow_deliverable_repo.go:255`）只被服务端 cs-cloud env 拼装消费（`task_cscloud_push.go:847,862`），未暴露给 web 前端。

### Gitea 权限模型（工作区成员 → Gitea repo）

- workspace 创建/run 启动时把全体成员同步进 workspace 的 Gitea org：`syncWorkspaceMembers`（`workflow_deliverable_repo.go:448`）→ costrict-web `members:sync`（`teamnamespace/client.go:136`）。成员身份用 cs-user `subject_id`（`usr_<uuid>`）解析（`workflow_deliverable_repo.go:89-100`）。
- org 是 **private**（`client.go:122-131` `CreateOrg` 的 `visibility:"private"`、`members_can_create_repos:false`），repo 也是 private（`client.go:163-168`）。
- 写路径收紧：main 有分支保护禁直推（`client.go:332` `ProtectBranch`；注释明确 inst 不做保护因为 daemon/multica 要直推）；文档统一经 node 分支 + PR，merge 由服务端用 admin token 执行（`merge.go:23`）。bot 的 PAT（`write:repository`+`read:user`，`client.go:387` `CreateUserToken`）是 agent 推送凭据。
- **不确定**：成员同步进 org 后落在哪个 Gitea team、对 repo 是 read 还是 write——这发生在 costrict-web 侧，本仓库不可见。本仓库内的直连兜底 `AddOrgMember`（`client.go:452`，加到 org 第一个 team 即 Owners）在 team-namespace 模式下似乎不被调用（未找到生产调用点，仅供兼容/测试）。Multica 侧的评审权限门（谁能 approve/reject）是另一套：workspace owner/admin、issue 创建者、issue 负责人、节点指定 critic（`server/internal/handler/deliverable_review_access.go:20-34`）。
- router 注释提示：「Gitea UI routes are not proxied by Multica」（`router.go:469`）——浏览器直接访问 Gitea，登录态由 Gitea/cs-user 体系负责，Multica 不管。

---

## Q5. 与 deliverable submission 表的关系

### 表结构（迁移链）

- `multica_workflow_node_deliverable`（节点定义级 deliverable）：`migrations/133_workflow_deliverables.up.sql:8-17`；`kind`('document'|'pull_request') 已在 `migrations/151_deliverable_drop_kind.up.sql` 删除——**现在 deliverable 无 kind，统一是「PR 槽位」**。
- `multica_workflow_node_run_deliverable`（run 级快照/requirements，`source_deliverable_id` 指回定义）：`migrations/144_workflow_runtime_isolation.up.sql:61-74`。
- `multica_workflow_node_deliverable_submission`：`migrations/133:20-37`。字段：`submitted_by_type`('member'|'agent'|'system')、`status`('missing'|'submitted'|'approved'|'rejected')、`content`、`attachment_id`、`pull_request_url`、`review_comment`。唯一键经 `migrations/149` 改为 `(workflow_node_run_id, deliverable_id, pull_request_url)`——**一个 deliverable 可挂多条链接 submission；空 URL 的文档 submission 保持一 deliverable 一行**。FK 在 `migrations/144:290-302` 从定义表改指 run 级快照表。

### document 场景下字段怎么用（现状）

- `pull_request_url`：**唯一与 Gitea 的联结**——node→inst 评审 PR 的 web URL。判断一个 URL 是否平台 Gitea 文档 PR（vs 外部代码 MR）靠与 `GITEA_BASE_URL` 比 host：`workflow_deliverable_repo.go:840-863`（`isArchiveGiteaURL`）；merge 时靠 `ParsePullRequestIndex` 能否解析出 PR 序号：`workflow_deliverable_repo.go:1004-1017`（`mergeReviewURL`）。
- `content` / `attachment_id`：**Gitea 配置启用时被禁用**——`SubmitNodeRunDeliverable` 对带 content/attachment 的请求直接 422（`workflow_run.go:1146-1152`：“deliverables are submitted via git PR; inline content upload is disabled”）。仅 Gitea dormant 时允许 inline content（测试 `workflow_run_deliverable_test.go:83,183`）。成员上传流里 `Content:""` 硬编码（`workflow_deliverable_repo.go:1398`）。
- `status` 机：`submitted`（默认）→ approve 时 `markDeliverableSubmissionsApproved` 批量置 `approved`（`workflow_deliverable_repo.go:1058`）；critic 驳回由评审事务置 `rejected`；`missing` 是保留态（全仓只有过滤逻辑 `workflow.go:1121` 等，未找到写入 `missing` 的代码路径——不确定是否遗留）。
- 满足判定：required deliverable 有任一条 live（非 missing/rejected）submission 即算满足（`workflow.go:1100-1133`，`requiredDeliverablesSatisfiedWithQueries`）；worker 完成时还会从 worker output 正则抽 GitLab MR URL 自动补一条 submission（`workflow.go:1157`，`autoSubmitSingleRequiredDeliverable`）。
- upsert 语义：同 `(node_run, deliverable, url)` 重复提交是幂等且 status 重置为 `submitted`（rework-resubmit 契约），见 `server/pkg/db/queries/workflow_deliverable.sql:69-77` 注释。

### 与 Gitea 文档的对应关系（结论）

Gitea 文件 ↔ submission 是 **1 个 deliverable（run 级快照行）: 1 条文档 submission 行**，联结只有 PR URL；in-repo path 不存 DB，各处用 `DeliverablePath(seq, nodeTitle, nodeRunID, title)` 现算（需要 run 拓扑序，见 `issue_gitea_deliverables.go:178-190`、`daemon.go:1846-1855`）。拆分节点的 task.md 若走「注册为节点 deliverable definition + submission」，可直接复用：node 分支推送 + node→inst PR + submission 记 PR URL + approve merge 全链路；若走轻量路径（服务端直写 inst，像 `ArchiveSubIssueAddress`/`ArchiveReviewComment`），则无 PR、无 submission、不进评审门。

---

## 附：与拆分节点直接相关的现有触点

- 拆分草稿现状走 DB + 专用 API，**不经 Gitea**：`cs-workflow workflow split draft add/submit`（`server/cmd/cs-workflow/cmd_workflow_split.go:26-58`）→ `POST /api/node-runs/{id}/split/draft-submit`（路由 `router.go:731`）。
- 拆分产出（子 issue）与 Gitea 的唯一桥梁：`ArchiveSubIssueAddress`（`workflow_deliverable_repo.go:712`）——子 run  scaffold 后在父 run repo 的 split 节点目录下登记子任务交付仓库地址（clone_url + inst branch），供后续节点/人浏览父 repo 时发现子任务交付物。
- 拆分评审：`POST /api/node-runs/{id}/split/approve`（`router.go:737`），与 deliverable 评审是两套。

## 明确未查清 / 不确定清单

1. `cs-cloud workflow deliverable submit` 的具体实现（push、开 PR、错误处理、是否支持多文件/更新）——二进制在仓库外，仅能从 prompt/注释推断语义。
2. 工作区成员在 Gitea org 内的 team/权限级别（read vs write）——发生在 costrict-web 侧，本仓库不可见。
3. submission `status='missing'` 的写入路径——全仓未找到，疑似遗留枚举值。
4. 前端无任何 Gitea 文件级 URL 拼接；`/_edit/` 链接需新建，且所需 owner/repo/branch/path 目前无面向浏览器的 API 暴露。
5. ticket 提到的 `/ns/upload`、`gitea-ns` 路由已不存在（全仓 grep 无匹配）；现行为 Q2/Q4 所列路由。
