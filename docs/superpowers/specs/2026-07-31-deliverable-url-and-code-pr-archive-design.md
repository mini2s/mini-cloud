# 交付物地址公网转换 + 代码 PR 链接统一归档设计

| 字段 | 内容 |
|---|---|
| 日期 | 2026-07-31 |
| 状态 | 设计稿（待 review） |
| 相关仓库 | multica（服务端 + 前端） |
| 上游 spec | `2026-07-30-deliverable-kind-unification-design.md`（去 kind 统一，本方案接续其分支） |
| 落地分支 | `feat/deliverable-kind-unification`（续） |

## 1. 背景

去 kind 统一之后，节点交付物是无类型「PR 槽位」，一切提交归一为一条 PR 链接。但留了两个缺口：

**缺口 1（链接打不开）**：交付物 PR 链接 `pull_request_url` 取自 Gitea 的 `html_url`，带的是 Gitea 内网 host（如 `10.20.x.x:33000`）。原样写 DB → 原样返回 API → 前端原样渲染 `<a href>`（[node-run-deliverables.tsx:68](../../../packages/views/workflows/components/node-run-deliverables.tsx) 等三处）。用户在浏览器点开 → 打不开。代码里只有 cs-cloud dispatch payload 的**克隆 URL** 做了内网→公网改写（`rewriteGiteaHostToPublic`，[task_cscloud_push.go:951](../../../server/internal/service/task_cscloud_push.go)），**用户看的 PR 链接没做**。

**缺口 2（代码链接归档不统一）**：交付物最终归档到 Gitea 归档仓。文档上传→开 Gitea PR 留档；但代码 PR 链接三条路各干各的——
- 人工贴代码链（[UploadMemberDeliverablePR:1286](../../../server/internal/service/workflow_deliverable_repo.go)）：Gitea 配了→每条开一个独立 Gitea PR + 写一个 flat `.md`；没配→只存 URL。
- Agent 报 GitLab MR（[workflow_run.go:1188](../../../server/internal/handler/workflow_run.go)）：写 `code/<id>.md` 到 inst 分支，**不开 PR**。
- Agent 报其他 host / Gitea PR：**不归档**。

## 2. 目标（已与用户确认）

统一模型：

- **代码链接**：一个 node-run 的**所有**代码 MR 链接（人 + agent、历次提交）**攒进同一个 `.md` 文件**，新链接加一行；该 `.md` 提交到节点主分支 `NodeBranch`，**复用** `NodeBranch → inst` 这一个节点 PR（不开新 PR）。
- **文档**：维持现状（各自 PR）。
- 人和 agent 代码链接都走这套。
- 用户点交付物链接 → 打开节点 PR；地址换成公网 `zgsmtest.xyz:30443`（缺口 1）。

## 3. 已确认决策

| # | 决策 | 选择 |
|---|---|---|
| 1 | 地址转换层 | **后端读取时转换**——API 响应层复用 `rewriteGiteaHostToPublic`，前端零改动 |
| 2 | 转换范围 | **仅 Gitea 交付仓 PR**——新模型下代码链也存 Gitea PR url，故显示的链接都能被转换 |
| 3 | 代码链接归档 | **每个 node-run 一个 `.md`**，攒该节点所有代码链接（人 + agent），提交到节点主分支 `NodeBranch`、复用节点 PR（`NodeBranch → inst`，不开新 PR） |
| 4 | 存储的 `pull_request_url` | **保留真实代码 MR url**（不覆写）——用户点链接即可自行去合并（匹配「用户自己合」）。节点 PR 仅作归档宿主，其 url 不写进 submission |
| 5 | 代码 MR 的合并 | **Multica 不代合代码 MR，用户自行合并**。`mergeReviewURL` 跳过外部（非归档 Gitea）URL；approve 只合并归档 Gitea 文档 PR（签收） |
| 6 | agent 代码 MR 入口 | 覆盖三条提交路径：显式 `/submit`、人工 `UploadMemberDeliverablePR`、**worker-output 自动提交 `autoSubmitSingleRequiredDeliverable`**（当前主路径、且未归档） |

## 4. 改动 A —— 地址公网转换（后端读取层）

**单点**：[workflow_run.go:1061](../../../server/internal/handler/workflow_run.go) `workflowNodeDeliverableSubmissionToResponse`，返回 `PullRequestURL` 前过一遍 host 改写。

- 这是**唯一**带 `pull_request_url` 的响应出口（已核实）：list（`ListNodeRunDeliverableSubmissions`）与 submit（`SubmitNodeRunDeliverable`）都走它；`UploadIssueDeliverablePR` 只回 `{ok:true}`。前端三处渲染点全部来自这个 API → 一处改，全覆盖。
- **复用** `rewriteGiteaHostToPublic`（[task_cscloud_push.go:951](../../../server/internal/service/task_cscloud_push.go)），**导出为 `service.RewriteGiteaHostToPublic`**，handler 调用（handler 本就依赖 service）。
- exact-match gated：只改写 scheme+host 精确命中内部 Gitea 的 URL，其余原样透传。应用到**所有** `pull_request_url` 安全。
- merge/close 不受影响（用独立配置的 client，只解析 PR 序号、不看 host）。
- **无 schema 变更**。

**测试**：内部 Gitea host 的 PR → 响应里是 `zgsmtest.xyz:30443`；GitLab / 其他 host → 响应原样；`GITEA_PUBLIC_BASE_URL` 未设 → 原样。

## 5. 改动 B —— 代码链接攒进一个 `.md`（复用节点主分支的 PR）

> 用户决策：**不开新 PR**。代码链接 `.md` 提交到节点主分支 `NodeBranch`（节点执行时 `ensureNodeRunBranch` 已建），用 `NodeBranch → inst` 这一个节点 PR 承载。人和 agent 都往这同一个 `.md` 攒。

### B1. 单 `.md` 模型（每个 node-run 一个文件）

- 每个 node-run **一个** `.md` 文件（如 `<nodeDir>/代码合并请求.md`），列出该节点所有代码 MR 链接（跨交付物、人 + agent、历次提交）。
- 内容由服务端**从该 node-run 当前所有 code-link submission 重建**（frontmatter + 链接列表），每次有新代码链接提交就重建并 `UpsertFile`。幂等，无并发追加冲突。
- **不再**每条链接一个 `.md`（废弃当前人工路径的 per-link flat `.md`、agent 路径的 `code/<id>.md`）。

### B2. 存放位置：复用节点主分支的 PR

- `.md` 提交到节点主分支 `NodeBranch`（`gitea.NodeBranch(nodeSeq, nodeRunID)`，`ensureNodeRunBranch` 已建）。
- 节点 PR = `NodeBranch → inst`，**find-or-create**（`OpenReviewRequest` 已是幂等的——已有开放 PR 则复用，否则新建）。
- 人和 agent 提代码链接都写入 `NodeBranch` 上的同一个 `.md`、同一个节点 PR（统一入口）。
- **不开** `<NodeBranch>-link-<hash>` 这类衍生分支 / 衍生 PR。
- 文档上传维持现状（仍用各自的 `<NodeBranch>-deliverable-<后缀>` PR），本次不动。

### B3. Agent 显式提交（[SubmitNodeRunDeliverable](../../../server/internal/handler/workflow_run.go), workflow_run.go:1188-1207）

现状：存外部 MR url；仅 GitLab MR 写 `code/<id>.md` 到 inst；其他 host 不归档。

改为：**保留存真实 MR url**（不覆写）；删除「GitLab parser 才归档 / Gitea PR skip / 其他 host 静默」三分支；upsert 后异步触发共享归档（B6）。Gitea 未配置 → 仅存链接、不归档（fallback）。

### B4. 人工提交（[UploadMemberDeliverablePR](../../../server/internal/service/workflow_deliverable_repo.go):1286）

现状：每条链开独立 Gitea PR + flat `.md`，且**用 Gitea PR url 覆盖**原始链接。

改为：**存原始代码链接**（不覆写、不开 per-link 分支/PR）；`runLockedMemberUpload` 返回（提交已落库）后异步触发共享归档（B6）。配置与否都先存链接，Gitea 未配置则不归档。

### B5. Worker-output 自动提交（[autoSubmitSingleRequiredDeliverable](../../../server/internal/service/workflow.go):1109，调用点 workflow.go:1015）

现状：从 worker 输出正则抽 MR url → 直接 upsert submission（**无任何归档**，且是 agent 代码 MR 的主路径）。

改为：`SubmitWorkerOutput` 的事务提交成功后，异步触发共享归档（B6）。`autoSubmitSingleRequiredDeliverable` 本身仍只 upsert（保留真实 MR url），不动其签名；归档由调用方在 commit 后触发。

### B6. 时序 + 统一入口

- 归档 = best-effort **异步**（goroutine，永不阻塞提交、失败仅 log），在 submission 落库之后触发。三条路径（B3/B4/B5）都调同一个共享 service 方法。
- 共享方法 `ArchiveNodeCodeLinks(ctx, nodeRunID)`：解析 run/node → 列该 node-run 全部 submission → 过滤代码链接（`pull_request_url != ""` 且 host ≠ 归档 Gitea）→ 重建节点 `.md` → `UpsertFile` 到 `NodeBranch` → `CreateBranch`(幂等) + `OpenReviewRequest(NodeBranch → inst)` find-or-create 节点 PR。无代码链接则 no-op。**不返回/不存节点 PR url**（归档宿主而已）。
- 复用现有 run/node 解析与 `repoProvider`；判别「代码链接 vs 归档 Gitea 文档 PR」用 host 精确匹配 `GITEA_BASE_URL`（与 `rewriteGiteaHostToPublic` 同一判据）。

## 6. 代码 MR 合并策略（已确认）

- **Multica 不代合代码 MR，用户自行合并**（用户决策）。
- 改动 [`mergeReviewURL`](../../../server/internal/service/workflow_deliverable_repo.go):913：**外部（GitLab/GitHub 等）URL 一律跳过**（`return nil`），只有归档 Gitea 文档 PR 才在 approve 时合并（签收）。
- 因此 submission 里保留的真实代码 MR url 仅作展示 + 供用户点击自行合并；Multica 不会去合它。
- 现有 code-deliverable loop 里「Multica 合并 GitLab MR」的语义被本方案有意去掉。`retryGitlabMR` 若不再有调用方，留作 dead code 或一并删（实现时定）。

## 7. 不在本次范围

- GitLab / 外部代码 MR 本身的 host 公网转换（需求 1 只转 Gitea 交付仓 PR）。
- 文档上传的 Gitea PR 评审流（不变）。
- 归档元数据 `code_repo` / `branch` / `agent` 补全（M5 follow-up）。

## 8. 测试

- **service（ArchiveNodeCodeLinks）**：有代码链接 → `.md`（含该 node-run 全部代码链接）写到 `NodeBranch` + `OpenReviewRequest(NodeBranch, inst)`；多次调用同一 node-run → 同文件同 PR（幂等）；无代码链接 → no-op；dormant（Gitea 未配）→ no-op。
- **三条入口**：agent `/submit`、人工 `UploadMemberDeliverablePR`、worker-output 自动提交，落库后都触发 `ArchiveNodeCodeLinks`；且 submission 的 `pull_request_url` **保留真实 MR url**（不覆写）。
- **handler**：地址转换用例（内部 Gitea→public；GitLab 原样；env 未设原样）。
- **merge**：`mergeReviewURL` 对外部 URL（GitLab/GitHub）return nil（不代合）；归档 Gitea PR 仍合。
- **调整旧测试**：agent submit 不再期望直接写 inst / `code/<id>.md`；member 上传不再期望 per-link PR / flat `.md` / 覆盖链接；`TestSubmitNodeRunDeliverable_ArchivesGitLabMRPointer` 改为期望 `NodeBranch` + 节点 `.md`。

## 9. 风险与回滚

- **风险 1**：`rewriteGiteaHostToPublic` 导出后跨包调用——核心逻辑已有 `task_cscloud_push_test.go` 覆盖。
- **风险 2**：复用节点 PR（`NodeBranch → inst`）的 find-or-create——依赖 `OpenReviewRequest` 幂等；`.md` 由服务端从该 node-run 的 code-link submission 全量重建，避免追加冲突。注意 `NodeBranch` 也是文档衍生分支的基点，代码 `.md` 与文档文件分处 `NodeBranch` 与 `<NodeBranch>-deliverable-<后缀>`，互不干扰。
- **风险 3**：去掉「Multica 合并代码 MR」语义——现有 code-deliverable E2E loop 若依赖该语义需相应调整（代码 MR 改由用户合，§6）。
- **回滚**：纯代码改动（无 migration），revert 即可。
