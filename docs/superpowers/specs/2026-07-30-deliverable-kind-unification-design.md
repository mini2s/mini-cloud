# 交付物类型统一（去 kind）设计

| 字段 | 内容 |
|---|---|
| 日期 | 2026-07-30 |
| 状态 | 设计稿（待 review） |
| 相关仓库 | multica（服务端 + 前端）、cs-cloud（设备端执行） |
| 上游 spec | `docs/superpowers/specs/2026-07-26-cs-cloud-delivery-redesign-design.md`（M1–M5 重设计，本方案并入其分支） |
| 落地分支 | multica `feat/deliverable-kind-unification`（off `origin/main`）；cs-cloud `feat/deliverable-iteration`。M1–M5 已合并进 main，原 `fix/deliverable-verification` 已 stale（114 commits behind），不再使用 |

## 1. 背景与目标

当前节点交付物按 `kind` 区分 **document / pull_request** 两类，这个标签一旦设定就锁死整条链路：

- **人工提交**被劈成两套——文档类只能传文件（`UploadMemberDeliverable` → 写 Gitea inst → 开 PR），代码类只能贴 MR 链接（`UploadMemberDeliverablePR`）。前端两个独立组件、两个分区（`node-run-deliverables.tsx`）。
- **Agent 提交**被劈成两个 report 端点——document→`/api/daemon/node-runs/.../report-pr`，code→`/api/node-runs/.../submit`（`task_cscloud_push.go:657` 的 `switch d.Kind`）。
- **评审/关闭**按 kind 非对称——代码 MR 驳回时不关闭、留给 worker 原地改（`workflow_deliverable_repo.go:1007`）。
- 数据模型用裸字符串比较 `kind`（无 Go enum），service 层 6+ 处 `if d.Kind == ...` 硬分支。

**目标**：节点不再区分交付物类型。一个交付物就是一个**无类型的"PR 槽位"**。提交方式由**谁提交**决定：

- **人工**：既能上传文件，也能贴代码 PR 链接——两个动作始终可用。
- **Agent**：永远交一条 PR 链接（交付物仓 PR 或代码仓 MR），节点只收链接、不关心是哪种。

任何提交最终都归一为**一条 PR 链接**（上传的文件由服务端转成交付物仓 PR），从而评审/合并彻底按 URL 形状统一，不再按类型分叉。

## 2. 已确认的设计决策

| # | 决策 | 选择 |
|---|---|---|
| 1 | 提交物最终形态 | **统一成 PR 链接**——人工上传的文件由服务端写入交付物仓并开 PR；代码提交是 MR 链接。节点里所有交付物最终都是一条 PR 链接 |
| 2 | 交付物定义的类型字段 | **去掉**——设计者加交付物时只填标题/必填/排序，不选 document/code。提交方式交给提交者 |
| 3 | `kind` 列处置 | **直接删列**（含 migration 133 的 `NOT NULL ... CHECK`）。功能 dormant 未上线，删干净最省事，不留兼容 |
| 4 | Agent 如何决定写文档/代码 | **任务驱动**——payload 同时给交付物仓 + 代码仓，Agent 按节点 prompt 的任务语义自行选择去哪个仓库开 PR/MR。节点不管 |
| 5 | 人工 UI | 每个交付物槽位同时提供「上传文件」+「贴 PR 链接」两个动作，不再分文档区/代码区 |
| 6 | 评审/合并/关闭判据 | 按 **URL host**（Gitea vs GitLab），不再按 kind。代码 MR「驳回不关、原地改」的行为保留，判据换成 URL host |
| 7 | 落地范围 | **并入 M1–M5 分支一起合并**（`fix/deliverable-verification` / `feat/deliverable-iteration`），顺带把 M1–M5 已写的双 report 端点/非对称关闭改成统一 |

## 3. 核心模型

```
节点交付物（无类型 PR 槽位）
  ├─ 定义：title / required / sort_order            （删 kind）
  └─ 提交：content（上传原文，审计）+ pull_request_url（最终 PR）  ← 两者不再互斥
```

提交路径（谁提交决定怎么交）：

| 提交者 | 动作 | 服务端处理 | 节点最终存储 |
|---|---|---|---|
| 人工 | 上传文件 | 写交付物仓 inst → 开 Gitea PR | 该 PR 的 URL |
| 人工 | 贴链接 | 直接存 | 用户贴的 URL（任意仓库） |
| Agent | 开 PR/MR 后回报 | 直接存 | Agent 报的 URL（交付物仓 PR 或代码仓 MR） |

三条路径终点都是 `pull_request_url`，下游评审/合并/归档统一按 URL host 处理。

## 4. 数据模型变更

**migration 133（在 main，已应用）** 当前：
```sql
kind TEXT NOT NULL CHECK (kind IN ('document', 'pull_request'))
```
出现在两张表：`multica_workflow_node_deliverable`（定义，`133...up.sql:7`）与运行快照 `multica_workflow_node_run_deliverable`（`models.go:844`）。

**新 migration（编号 151——149 = multi-link、150 = `agent_plugin_name`（用户并行 plugin 工作），均已占用）**：
- `ALTER TABLE multica_workflow_node_deliverable DROP COLUMN kind;`
- `ALTER TABLE multica_workflow_node_run_deliverable DROP COLUMN kind;`
- 提交表 `multica_workflow_node_deliverable_submission`（`133...up.sql:23`）本就只有 `content`/`attachment_id`/`pull_request_url`，**无需改**——multi-link 靠同一表的多行（一个 URL 一行）实现，删 kind 不影响。

> **multi-link 与本方案的关系**：multi-link = 同一 (node_run, deliverable) 允许 N 条 submission 行（每条一个 `pull_request_url`），满足条件是「任一行 live」。它不引入数组列、不引入新表。删 kind 后，一个无类型交付物槽位可累积多条 PR 链接（人工多次上传/粘贴、Agent 多次回报），完全契合「统一成 PR 链接」。

**sqlc / 生成代码**：
- `WorkflowHasDocumentDeliverable` 查询（`workflow_deliverable.sql:11-16`）改为无 kind 谓词的 `WorkflowHasDeliverable`，与 M5 服务端 `hasAnyDeliverableSpec` 对齐（同一语义、不同层，统一命名）。
- 生成结构体 `MulticaWorkflowNodeDeliverable.Kind`（`models.go:775`）、`MulticaWorkflowNodeRunDeliverable.Kind`（`models.go:844`）随列删除而消失。
- 所有 sqlc `INSERT`/`UPDATE` 不再带 `kind` 字段；`CreateWorkflowNodeDeliverable` 不再默认 `req.Kind = "document"`（`workflow.go:1320-1322`）。

**前端类型**：
- 删除 `WorkflowDeliverableKind`（`packages/core/types/workflow.ts:757`）。
- `DeliverableWithSubmission`（`:790`）去掉 `kind` 字段。
- `workflow_preflight.go:208` 的 `validKind` 校验删除。

## 5. 提交入口（人工 + Agent）

### 5.1 人工（member / human worker）

**服务端**：multi-link 特征已让两条上传路径按 `deliverable_id` 定位（handler 接收 `deliverable_id`、mutation `useUploadIssueDeliverable(issueId,nodeRunId,deliverableId?)` 已带该参数）。本方案只需**去掉 `resolveUploadDeliverable` 里的 kind 守卫**：
- `resolveUploadDeliverable(deliverables, deliverableID, kind)`（`workflow_deliverable_repo.go:1210`）现校验 `d.Kind != kind` 报错、或返回首个匹配 kind 的交付物。删掉 `kind` 参数：给了 `deliverableID` 就按 ID 取（仅校验属于本 node-run）；未给则按「恰好一个交付物」取、多个则报错让调用方指定。两个上传方法 `UploadMemberDeliverable`（文档→服务端开交付物仓 PR，`:1412`）/`UploadMemberDeliverablePR`（多链接→每条开一个 PR，`:1304`）不再传 `"document"`/`"pull_request"`，任意交付物均可走任一端点。

> 两个端点路径可保留（`POST /issues/{id}/deliverables/upload` 与 `/upload-pr`），因为服务端行为不同（一个要开 PR、一个只存 URL）。统一的是「任何交付物都能走任一端点」。

**前端**：`node-run-deliverables.tsx` 重构——
- 删除 `kindById` / `hasDocument` / `hasPR` 的类型派生（`:37-45`）。
- 合并「文档」「代码」两个分区（`:77-98`）为**单一「交付物」分区**，遍历每个交付物槽位。
- 每个槽位（当 `canUpload`，即 worker 是 human 时）同时渲染 `<DocumentUpload>`（文件选择）与 `<PRLinkUpload>`（URL 输入）两个动作，二者均以 `deliverableId` 调对应 mutation。
- `execution-detail-panel.tsx:318` 的 `d.kind === ...` 渲染判断改为不区分。
- i18n：`document_section` / `code_section` 收敛为单一 `deliverables_section`；保留上传/链接两套文案。

### 5.2 Agent

**统一 report 端点**：M1–M5 的双端点合并为一个。`deliverableSpecsForTask`（`task_cscloud_push.go:638-678`）的 `switch d.Kind`（`:657`）删除——所有交付物走**同一个 report 端点 + `pull_request_url` 字段**。
- 端点选型：统一到 `/api/node-runs/{nr}/deliverables/{d}/submit`（`SubmitNodeRunDeliverable`，`workflow_run.go:1149`），即"正式交付物提交"端点。
- 删除该 handler 内 `kind == "document"` 拒绝 `content` 上传的分支（`:1180-1186`）——因为人工上传走 `/upload` 端点、Agent 只走 URL，submit 端点只收 `pull_request_url`，不再需要按 kind 拒内容。
- `HandleReportDeliverablePR`（`report_pr.go:20`，原 document 专用 daemon 端点）废弃；cs-cloud 的文档提交 CLI 改报统一端点（见 §6）。
- `ListNodeRunDeliverableSubmissions`（`:1135`）注释里「file picker vs PR-link input」的类型提示删除。

## 6. 仓库与 Agent 契约（cs-cloud payload）

**payload 组装**（`task_cscloud_push.go`）：
- `csCloudDeliverableSpec`（`:56-61`）删除 `Kind` 字段。
- `deliverableSpecsForTask`（`:638-678`）：所有交付物统一 `Report.Endpoint = "/api/node-runs/.../submit"`、`BodyField = "pull_request_url"`。删除 document 的 `RepoAlias = "delivery"` 特例——alias 不再按交付物类型绑定。
- `repos[]` **始终包含交付物仓（`role: "delivery"`）+ 已配置的代码仓（`role: "code"`）**，不论交付物是什么。`resolveDeliveryRepo`（`:533-556`）与 `resolveCodeRepoAndProject`（`:461-517`）逻辑保留，只是不再由 kind 决定是否注入。
- `repositoryDeliverableEnv`（`:790-936`）删除 `if d.Kind != "document" { continue }`（`:817`）——交付物仓 env（`CS_CLOUD_REPO_*` / `CS_CLOUD_GITEA_*`）对任何含交付物的 task 都注入，让 Agent 写文档时有仓库可用。

**Agent 决策（任务驱动）**：payload 同时给两类仓库，Agent 依据节点 prompt 的任务语义自行选择——
- 写文档 → `cs-cloud gitea submit --file`（写交付物仓 → 开 Gitea PR）。
- 写代码 → 在代码仓 worktree 编码 → 开 GitLab MR。
两种 CLI 的 git 操作不同，**保留两个命令**；但两者都报到 §5.2 的**统一端点**。

**cs-cloud 侧改动**：
- `internal/cli/gitea.go`：`submitDeliverable`（`:192-270`）原经 `reportDeliverablePR`（`:378`）报 `/report-pr`，改为报统一端点 `/submit`。
- `internal/cli/gitlab.go:19` `submitGitlabMR`：本就报 `/submit`，无需改。
- `internal/workflow/models.go`：`DeliverableSpec.Kind`（`:81`）删除；`RepoSpec`（`:69-76`）的 `Role` 保留（仍用于日志/可观测，`redact.go:79`）。
- `deliverableSummary`（`redact.go:79-92`）：去掉 kind 维度，只保留 repo alias。

## 7. 评审 / 合并 / 关闭（按 URL host）

- **合并**：`mergeReviewURL`（`workflow_deliverable_repo.go:910-929`）**已经**按 URL 形状派发（先 `gitea.ParsePullRequestIndex`，失败回退 `gitlab.ParseMergeRequestURL`）——保持，这是统一的地基。
- **关闭**：`closeDeliverableReviewRequests`（`:982-1029`）现 `if d.Kind == "document"`（`:1007`）跳过代码 MR。改为**按解析出的 URL host**判断：Gitea PR→驳回时关闭；GitLab MR→保留让 worker 原地续改。行为不变，判据由 kind 换成 URL host。
- `markDeliverableSubmissionsApproved`（`:1064-1093`）：`kind == "document" || == "pull_request"` 的条件直接退化为「所有 PR-backed 提交」，删 kind 判断。
- `mergeDeliverablePRs`（`:862-901`）的 `isPRBacked` 同理退化。
- **自动归档**：`autoSubmitSinglePullRequestDeliverable`（`workflow.go:1104-1147`）从「仅单个 `pull_request` 交付物」放宽到「**单个必填交付物**」——删 `if d.Kind != "pull_request"`（`:1116`），保留「仅当恰好一个必填交付物时触发」的去歧义守卫（`:1119-1121`）。

## 8. 归档

`ScaffoldRunDeliverables` / `ArchiveCodeDeliverable` / `ArchiveReviewComment`（`workflow_deliverable_repo.go:336-700`）：
- M5 已把 provisioning gate 从 `hasDocumentDeliverable` 放宽到 `hasAnyDeliverable`——本方案与之对齐，**无需再改 gate**。
- `ArchiveCodeDeliverable`（`:647-700`）原在 `SubmitNodeRunDeliverable` 内以 `d.Kind == "pull_request"` guard（`workflow_run.go:1217-1230`）。kind 删除后，改为以**提交是否带 `pull_request_url` 且指向代码仓（GitLab host）**作为 guard——即「这是一条代码 MR」由 URL 判定，不由类型判定。
- `ArchiveReviewComment`（`:593-645`）不依赖 kind，无需改。

## 9. 清理清单（删除的死代码/分支）

| 位置 | 删除内容 |
|---|---|
| `workflow_deliverable_repo.go` | 6 处 `d.Kind ==` 分支（ensureNodeRunBranch `:397`、close `:1007`、approve `:1072`、两条 Upload* 的目标筛选 `:1133`/`:1261`、mergeDeliverablePRs isPRBacked `:883`） |
| `task_cscloud_push.go` | `switch d.Kind`（`:657`）、`repositoryDeliverableEnv` 的 kind 守卫（`:817`）、`csCloudDeliverableSpec.Kind`（`:58`） |
| `workflow_run.go` | `deliverableKind` helper（`:1088`）、submit 端点拒内容分支（`:1180-1186`）、ArchiveCodeDeliverable 的 kind guard（`:1217-1230`） |
| `workflow.go` | `CreateWorkflowNodeDeliverable` 默认 kind（`:1320`）、`autoSubmit...` 的 kind 过滤（`:1116`）、default-workflow 硬编码 `Kind:"document"`（`:488-497`） |
| `daemon.go` / `issue_gitea_deliverables.go` | `giteaContextForNodeRun`（`:1852`）/ issue 级 Gitea 上下文（`:194`）的 `d.Kind != "document"` 过滤——改为「凡有交付物即建上下文」 |
| `report_pr.go` | `HandleReportDeliverablePR` 端点废弃（文档 CLI 改报 /submit） |
| `workflow_preflight.go` | `validKind` 校验（`:208`） |
| 前端 | `WorkflowDeliverableKind` 类型、`kindById`/`hasDocument`/`hasPR`、文档/代码双分区、`DocumentUpload`/`PRLinkUpload` 的 kind gating |
| cs-cloud | `DeliverableSpec.Kind`、`deliverableSummary` 的 kind 维度、gitea.go 报 `/report-pr` 的路径 |

## 10. 落地与分支

- 基线：multica `feat/deliverable-kind-unification`（已从 `origin/main` 切出、no-track，含 multi-link 特征）；cs-cloud `feat/deliverable-iteration`。M1–M5 已在 main，无需 rebase。
- 顺序建议：① multica migration 151 + sqlc；② service 去分支（`resolveUploadDeliverable` 去 kind、close/approve/branch/archive/auto-submit）；③ cs-cloud payload 去 kind；④ handler 清理；⑤ 前端两组件统一（`node-run-deliverables.tsx` + `node-run-delivery-form.tsx`）+ 类型/CRUD；⑥ 跨仓库 mock 设备联调（[[cs-cloud-local-e2e-registration]]）。
- 测试：DB 测试走 golang 容器（[[local-db-test-via-golang-container]]）；前端组件测试在 `packages/views/`；service 单测覆盖三条提交路径（文档上传/多链接粘贴/Agent 回报）+ URL-host 派发的合并/关闭。

## 11. 风险与回滚

- **风险 1：rebase 冲突**——两分支落后 main 且与近期 critic/split 改动交叠。缓解：先 rebase、小步提交、冲突点逐个核。
- **风险 2：删列不可逆**——migration DROP COLUMN。缓解：功能 dormant 未上线、无生产数据依赖；如需保守可改为"去 CHECK + 留空列"，但本次决策为直接删。
- **风险 3：Agent 选错仓库**——任务驱动下 Agent 可能写错地方（该写代码却开了文档 PR）。缓解：prompt 明确任务产出物；Agent 报错 URL 时 critic 评审可拦截。
- **风险 4：统一 report 端点的鉴权差异**——原 document 走 `/report-pr`（daemon auth）、code 走 `/submit`（runtime auth）。统一到 `/submit` 需确认 cs-cloud 文档提交路径具备 runtime 身份。cs-cloud 本身即 agent runtime、两条 CLI 同源身份，应可行；规划时用 mock 设备实测文档 PR 能否报进 `/submit`。
- **回滚**：单仓库内 revert 该 migration 的 down（重建 kind 列 + CHECK）+ revert 代码。因 dormant，回滚不影响在线行为。

## 12. 不在本次范围

- 节点角色（worker/critic/split）的统一——本次只去交付物 `kind`，不动节点 phase/role 模型。
- cs-cloud worktree/GC/critic 合并的既有 M1–M5 行为——保留，只把其中按 kind 分叉的部分改成按 URL host。
- 交付物仓 provisioning 的触发条件——M5 已放宽到 `hasAnyDeliverable`，沿用。
- 多交付物节点的 UI 布局美化——本次仅做「单分区 + 每槽位双动作」的结构统一，视觉打磨另行。
