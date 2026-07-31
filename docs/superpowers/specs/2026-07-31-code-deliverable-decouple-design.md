# 代码交付物解耦：不再打包进 node→inst PR，审核通过直写 inst

Date: 2026-07-31
Branch: `feat/deliverable-kind-unification`

## 背景

当前代码 MR 链接（人工 + agent）提交时，会被打包进文档共用的 node→inst 交付 PR：
`ArchiveNodeCodeLinks` 把链接写进 node 分支的 `代码合并请求.md`，并 ensure 一个
node→inst PR。审核通过时，`mergeDeliverablePRs` 把这个 PR（连同文档）合并进 inst 分支。

用户希望把代码 MR 从这条「打包进 Gitea PR」的路径里摘出来。

## 目标（用户决策）

- **文档流程不动。** 仍走 node 分支 + node→inst PR，审核通过仍合并进 inst。
- **代码 MR 链接不再打包进 node→inst PR**，只作为独立链接记录、展示、逐条审核。
- **审核通过后**，把本轮代码 MR 链接直接 commit 到 inst 分支留底（因为它不再搭文档
  PR 的车）。
- 人工 + agent 两条代码提交路径都改。

## 改动

### 提交侧：去掉打包

移除三处 fire-and-forget 的 `ArchiveNodeCodeLinks` 调用：

- `server/internal/handler/workflow_run.go` — `SubmitNodeRunDeliverable`（agent 提交代码 MR）
- `server/internal/service/workflow.go` — worker 输出后 autoSubmit 的代码 MR
- `server/internal/service/workflow_deliverable_repo.go` — `UploadMemberDeliverablePR`（人工提交）

代码 MR 链接只存 submission（`pull_request_url`），展示 / 逐条 approve-reject 不变。

### 审核侧：直写 inst

- 删除 `ArchiveNodeCodeLinks`（node 分支 `.md` + `OpenReviewRequest` 那套）。
- 新增 `archiveCodeLinksToInst(ctx, nodeRun)`：收集本 node-run 的 live（非
  `missing`/`rejected`）外部代码 MR 链接，构建 `代码合并请求.md`，用
  `repoProvider.UpsertFile` 直接 commit 到 inst 分支的
  `NodeDir/代码合并请求.md`。**不开 PR、不合并。**
- 在 `ReviewNodeRun` approve 成功分支调用（`mergeDeliverablePRs` 成功后，与
  `markDeliverableSubmissionsApproved` 并列，best-effort，失败仅记日志）。

### 不变

- 文档：`UploadMemberDeliverable` 仍写 node 分支 + 开 node→inst PR；
  `mergeDeliverablePRs` 仍合并文档 PR。
- 外部代码 MR：multica 从不自动合并（用户自己合）。
- inst 分支仍由 scaffold 创建、保持非保护。
- `isArchiveGiteaURL`、`codeLinksArchiveFile` 常量复用。

## 细节

- 审计文件路径与旧流程一致（`NodeDir/代码合并请求.md`），只是落点从
  「node 分支 → PR 合并进 inst」改为「直接 commit 到 inst」。
- 文档 PR 合并 与 代码审计直写 inst 互不冲突：前者带文档文件进 inst，后者写
  `代码合并请求.md`，不同文件；且 `代码合并请求.md` 已不再出现在文档 PR 里。
- node 分支不再承载代码 `.md`；文档仍用 node 分支。

## 测试

更新 / 重写下列测试以断言新行为：

- `workflow_run_deliverable_test.go` — Submit 不再触发 archive。
- `e2e_archive_codelinks_test.go` — 改为验证 approve 后直写 inst。
- `workflow_default_test.go`、`workflow_deliverable_repo_test.go` —
  `ArchiveNodeCodeLinks` 相关改为 `archiveCodeLinksToInst`（写 inst、不开 PR）。
