# 默认 Workflow M2 实施计划：member "UI 上传 → git"

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** member 派单的 Issue 也能归档文档——member 在网页上传，服务端代写进 Gitea 默认 repo + 开 PR，走与 agent 完全对称的评审+合并。

**Architecture:** (1) 把 member 派单也接上默认 workflow（worker_type=human，等上传）；(2) 新增服务端能力"代写交付物 + 开 PR"（Gitea contents API + 新 `OpenPR`）；(3) 新端点 `POST /api/issues/{id}/deliverables/upload`；(4) 复用 `SubmitWorkerOutput` 把 node-run 推进到 `awaiting_critic` → 现有 critic（=创建者）评审 + merge 路径。dormant：Gitea 未配置时端点 503/404、member 派单退回现状。

**Spec:** `docs/superpowers/specs/2026-07-20-default-workflow-archive-design.md` §3.3
**前置：** M1 已合并（`is_default`、默认 workflow、StartDefaultRunForIssue、dispatch 读 node-run）。

---

## 关键事实（已核对）

- Gitea 客户端有 `CreateBranch(owner,repo,branch,fromRef)`、`CreateFile(owner,repo,branch,path,content,message)`、`MergePR`、`GetBranch`；**无 `OpenPR`**（cs-workflow 客户端 raw HTTP 实现，见 `cmd/cs-workflow/cmd_gitea.go:267`）→ 需新增。
- PR 注册 + node-run 推进：`SubmitWorkerOutput(ctx, nodeRunID, output)`（`service/workflow.go:906`）接受 `worker_assigned`，置 `awaiting_critic` + 调 `dispatchCritic`（读 node-run critic=human/创建者 → `critic_reviewing`，等 UI 评审）。
- 提交登记：`UpsertNodeRunDeliverableSubmission`（`workflow_deliverable.sql`）带 `pull_request_url`、status 自动 `submitted`。
- 拓扑：`owner=OrgName(ws)`、`repo=RepoName(wf)`、`inst=InstBranch(run)`、`node=NodeBranch(nodeRun)`、`path=DeliverablePath(nodeRun, deliverable)`。
- member 派单今天：CreateIssue/UpdateIssue 不建任务、不归档（`shouldEnqueueAgentTask` 对 member 返回 false）。
- 端点写操作需 cookie `multica_auth` + `X-CSRF-Token`（用户面路由）。

---

## Task 1: Gitea 客户端 `OpenPR`

**Files:** Modify `server/internal/gitea/client.go`；Test `server/internal/gitea/client_test.go`（或复用 fake server 模式）

- [ ] 写 `OpenPR(ctx, owner, repo, head, base, title) (htmlURL string, err error)`：`POST /repos/{o}/{r}/pulls`，解析 `html_url`。镜像 `cmd_gitea.go:267 openGiteaPR`。
- [ ] 测试：fake Gitea server返回 PR JSON → `OpenPR` 返回 html_url；非 2xx → error。
- [ ] `go test ./internal/gitea/`；commit `feat(gitea): OpenPR client method`。

## Task 2: 服务 `UploadMemberDeliverable`

**Files:** Modify `server/internal/service/workflow_gitea.go`；Test `server/internal/service/workflow_default_test.go`

- [ ] 写 `(s *WorkflowService) UploadMemberDeliverable(ctx, issue db.MulticaIssue, content string) error`：
  1. dormant 守卫（`s.Gitea==nil||!Configured()` → error）。
  2. 取 issue.WorkflowRunID → run → workflow → `ListWorkflowNodeRunsByRun` 取单 node-run → `ListWorkflowNodeDeliverables` 取 kind=document 的交付物。
  3. owner/repo/inst/node/path 派生。
  4. `GetBranch(node)`；不存在则 `CreateBranch(node, inst)`。
  5. `CreateFile(node, path, content, "deliverable upload")`。
  6. `OpenPR(node, inst, title)` → prURL。
  7. `UpsertNodeRunDeliverableSubmission{...SubmittedByType:"member", SubmittedByID: memberID, PullRequestUrl: prURL}`。
  8. `SubmitWorkerOutput(nodeRunID, json{pr_url})` → 推进 awaiting_critic + 派发 critic。
- [ ] 测试：fake Gitea server（记录 branch/file/PR 调用）+ DB 种子（member Issue + 默认 run）→ 调用后断言 submission 有 prURL、node-run 在 `critic_reviewing`、PR 被开。
- [ ] commit `feat(workflow): UploadMemberDeliverable server-side write + PR`。

## Task 3: 上传端点

**Files:** Modify `server/internal/handler/`（新文件 `issue_deliverable_upload.go`）+ 路由

- [ ] `POST /api/issues/{id}/deliverables/upload` body `{content: string}`：
  - cookie+CSRF（用户面）；权限：调用者必须是该 workspace 成员（且建议是 assignee 或 creator）。
  - dormant：`!isGiteaConfigured()` → 503 "deliverable upload requires Gitea"。
  - 解析 issue（loader），校验 `issue.WorkflowRunID.Valid`（无默认 run → 409/404）。
  - 调 `WorkflowService.UploadMemberDeliverable(ctx, issue, content)`。
- [ ] 测试：handler 级，fake/真 Gitea 配置 → 上传 → 200 + submission 响应；dormant → 503。
- [ ] commit `feat(issue): POST /issues/{id}/deliverables/upload (member upload→git)`。

## Task 4: member 派单接默认 workflow

**Files:** Modify `server/internal/handler/issue.go`（CreateIssue + UpdateIssue member 分支）

- [ ] member 派单后：`if isGiteaConfigured() { StartDefaultRunForIssue } `（worker 自动 = human，等上传）；否则保持现状（什么都不做）。
  - 注意：member 的 StartDefaultRunForIssue 不派 agent 任务（dispatchWorker 的 human 分支只置 `worker_assigned`），所以不会重复派发。
- [ ] 测试：member 派单 Issue → 有 WorkflowRunID、node-run worker=human/critic=创建者；dormant → 无 run。
- [ ] commit `feat(issue): route member-assigned issues to default workflow (Gitea-gated)`。

## Task 5: 前端上传控件

**Files:** `packages/views/`（issue 执行面板，挨着 NodeRunCard 的交付物区）

- [ ] 调研：issue 执行面板渲染 node-run 交付物的位置（M1 后 agent 的 PR 链接已在此渲染）。
- [ ] 加上传控件：当 node-run worker=human 且无 submission 时，显示"上传交付物"（textarea/文件选择 → 内容）→ POST 上传端点 → 刷新显示 PR 链接。
- [ ] i18n（en+zh，按 conventions）。
- [ ] commit `feat(views): member deliverable upload control`。

---

## Self-Review

- **Spec 覆盖**：member 上传→git（§3.3）→ T1-T5 全覆盖。评审+合并复用（§3.4）→ SubmitWorkerOutput + 现有 ReviewNodeRun/merge，无新逻辑。
- **dormant**：T3 端点 503、T4 member 退回现状——与 M1 一致。
- **待执行核对**：fake Gitea server 需加 `/pulls` POST handler；handler 权限用哪个 helper（requireWorkspaceMember?）；前端面板锚点文件。
