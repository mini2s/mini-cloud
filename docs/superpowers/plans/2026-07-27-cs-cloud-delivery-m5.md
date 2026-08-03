# cs-cloud 交付物重设计 M5：代码 MR 归档 + 子 issue 交付物地址登记

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** ① 把代码 MR（GitLab）信息归档到本 run 的 Gitea 交付物仓库（让 Gitea 成为所有交付物的统一归档地）；② 子 issue 创建自己交付物仓库时，把它的交付物地址登记到父 issue 的 Gitea 仓库里（拆出它的 split 节点目录下），让父 issue 仓可查到各子任务的交付物仓库。两件都 best-effort（无 Gitea 仓就跳过）。

**Architecture:** ① 扩展 run-start provisioning（`ScaffoldRunDeliverables`）+ dispatch safety net 的 gate，从「有 document 交付物」放宽到「有任何交付物（document OR pull_request）」——让纯代码工作流 run 也建 Gitea 仓；新增 `ArchiveCodeDeliverable`（模仿 `ArchiveReviewComment`），在代码 MR 报到端点（`SubmitNodeRunDeliverable`）成功后写入 `nodes/<worker节点>/code/<交付物id>.md`。② 新增 `ArchiveSubIssueAddress`，钩在 `ScaffoldRunDeliverables` 末尾（子 run 建仓后）：子 run → 子 issue（`SourceIssueID`）→ 父 issue（`ParentIssueID`）→ 父 run（按 `SourceIssueID` 查）→ 父 run 的 split 类型 node-run → 写子 issue 交付物地址到父仓 `nodes/<split节点>/splits/<子issue编号>.md`。

**Tech Stack:** Go（multica server），标准 `testing`。

**Spec:** `docs/superpowers/specs/2026-07-26-cs-cloud-delivery-redesign-design.md`（§7.5、§13 的子任务仓库可查询部分）。

**决策（grilling 确认）：** A 代码 MR 归档 = spec §7.5 选择点 ①（扩展 provisioning 到所有有交付物的 run）；B = 用户提议的简化版（钩子点放在子 run 建仓时，只登记子 issue 交付物地址，不写 split 方案 plan.md，不做 cs-cloud split 接入）。

---

## File Structure

**`internal/gitea/topology.go`** — 新增 `CodePath` + `SplitChildPath`（对齐 `ReviewPath` 风格）。

**`pkg/db/queries/workflow.sql`** + 生成代码 — 新增 `GetWorkflowRunBySourceIssue`（按 source_issue_id 查最近 run，B 用来从父 issue 找父 run）。

**`internal/service/workflow_deliverable_repo.go`** — 新增 `hasAnyDeliverable`；`ScaffoldRunDeliverables` gate 从 `hasDocumentDeliverable` 改 `hasAnyDeliverable` + 末尾钩 `ArchiveSubIssueAddress`；新增 `ArchiveCodeDeliverable` + `ArchiveSubIssueAddress`（模仿 `ArchiveReviewComment`）。

**`internal/service/task_cscloud_push.go`** — 新增 `hasAnyDeliverableSpec`；dispatch safety net gate 从 `hasDocumentDeliverableSpec` 改 `hasAnyDeliverableSpec`（让纯代码 run 也触发兜底）。

**`internal/handler/workflow_run.go`** — `SubmitNodeRunDeliverable` 在 upsert 成功后钩 `ArchiveCodeDeliverable`（pull_request 类型）。

测试随实现走，放对应包。

---

## Task 1: gitea 路径 helper + hasAnyDeliverable + 按 source issue 查 run 的查询

**Files:** `internal/gitea/topology.go`、`internal/gitea/topology_test.go`、`pkg/db/queries/workflow.sql`、`internal/service/workflow_deliverable_repo.go`（新增 `hasAnyDeliverable`）、`internal/service/task_cscloud_push.go`（新增 `hasAnyDeliverableSpec`）

- [ ] **Step 1：gitea 路径 helper（failing test 先行）**

在 `internal/gitea/topology_test.go` 加：
```go
func TestCodePath(t *testing.T) {
	got := CodePath("d1a2b3c4-d5e6-7890-abcd-ef1234567890")
	if got != "code/d1a2b3c4-d5e6-7890-abcd-ef1234567890.md" {
		t.Fatalf("CodePath = %q", got)
	}
}

func TestSplitChildPath(t *testing.T) {
	got := SplitChildPath(42, "登录模块拆分")
	if got != "splits/42-登录模块拆分.md" {
		t.Fatalf("SplitChildPath = %q", got)
	}
	got = SplitChildPath(7, "")
	if got != "splits/7.md" {
		t.Fatalf("SplitChildPath empty title = %q", got)
	}
}
```

- [ ] **Step 2：跑测试确认失败** `cd server && go test ./internal/gitea/ -run TestCodePath -v` → FAIL（undefined: CodePath/SplitChildPath）。

- [ ] **Step 3：实现 helper**（`topology.go`，紧接 `ReviewPath` 之后）：
```go
// CodePath is the in-repo path — relative to a NodeDir — where one code MR
// deliverable is archived: code/<deliverableID>.md. deliverableID is a UUID;
// it is used verbatim (no sanitization needed — UUIDs are path-safe) so the
// archived entry is traceable back to the multica deliverable row. The full
// path is NodeDir(...) + "/" + CodePath(...).
func CodePath(deliverableID string) string {
	return "code/" + deliverableID + ".md"
}

// SplitChildPath is the in-repo path — relative to the PARENT run's split-node
// NodeDir — where one split-out child issue's deliverable-address is registered:
// splits/<issueNumber>[-<sanitizedTitle>].md. issueNumber is the child issue's
// human-readable workspace-scoped number; title is optional (omitted when empty
// or all-symbol, like NodeDir). Lets the parent repo browser list every child
// task's deliverable repo at a glance.
func SplitChildPath(issueNumber int, childTitle string) string {
	title := sanitizePathSeg(childTitle)
	if title == "" {
		return fmt.Sprintf("splits/%d.md", issueNumber)
	}
	return fmt.Sprintf("splits/%d-%s.md", issueNumber, title)
}
```

- [ ] **Step 4：跑测试确认通过** `go test ./internal/gitea/ -run "TestCodePath|TestSplitChildPath" -v` → PASS。

- [ ] **Step 5：新增 sqlc 查询 `GetWorkflowRunBySourceIssue`**

在 `pkg/db/queries/workflow.sql` 加（找一个现有 `:one` 查询附近放）：
```sql
-- name: GetWorkflowRunBySourceIssue :one
SELECT * FROM multica_workflow_run
WHERE source_issue_id = $1
ORDER BY created_at DESC
LIMIT 1;
```
跑 `make sqlc` 重新生成。确认 `pkg/db/generated/workflow.sql.go` 出现 `GetWorkflowRunBySourceIssue` + `GetWorkflowRunBySourceIssueParams`（或直接收 `pgtype.UUID`）。

- [ ] **Step 6：新增 `hasAnyDeliverable`**（`workflow_deliverable_repo.go`，紧接现有 `hasDocumentDeliverable` 之后）。它跟 `hasDocumentDeliverable` 唯一区别是不限定 Kind：
```go
// hasAnyDeliverable reports whether the workflow has ANY deliverable (document
// OR pull_request). Used to gate Gitea provisioning: with M5 decision ①, every
// deliverable-bearing run gets a Gitea repo (so code MRs have an archive home
// too), not just document-bearing runs.
func (s *WorkflowService) hasAnyDeliverable(ctx context.Context, workflowID pgtype.UUID) (bool, error) {
	nodes, err := s.Queries.ListWorkflowNodes(ctx, workflowID)
	if err != nil {
		return false, fmt.Errorf("list nodes: %w", err)
	}
	for _, n := range nodes {
		deliverables, err := s.Queries.ListWorkflowNodeDeliverables(ctx, n.ID)
		if err != nil {
			return false, fmt.Errorf("list deliverables: %w", err)
		}
		if len(deliverables) > 0 {
			return true, nil
		}
	}
	return false, nil
}
```

- [ ] **Step 7：新增 `hasAnyDeliverableSpec`**（`task_cscloud_push.go`，紧接现有 `hasDocumentDeliverableSpec` 之后）：
```go
// hasAnyDeliverableSpec reports whether the deliverable slice has ANY entry
// (document OR pull_request). M5 decision ①: the dispatch safety net fires for
// any deliverable-bearing worker task, so code-only runs also get a Gitea repo
// provisioned (for code-MR archiving).
func hasAnyDeliverableSpec(deliverables []csCloudDeliverableSpec) bool {
	return len(deliverables) > 0
}
```

- [ ] **Step 8：编译 + 单测 + 提交** `go build ./...`、`go test ./internal/gitea/ ./internal/service/`、`go vet ./...`、`make sqlc`（确认无 drift）。Commit: `feat(gitea): CodePath/SplitChildPath helpers + hasAnyDeliverable + GetWorkflowRunBySourceIssue query`

---

## Task 2: A — provisioning gate 放宽到「任何交付物」（决策 ①）

**Files:** `internal/service/workflow_deliverable_repo.go`（`ScaffoldRunDeliverables` gate ~line 353 + `provisionWorkflowRepo` 注释 ~line 707-712）、`internal/service/task_cscloud_push.go`（safety net gate ~line 219）

- [ ] **Step 1：failing test** — code-only workflow（只有 pull_request 交付物、无 document）现在也 scaffold。在 `workflow_deliverable_repo_test.go` 加一个测试，mock 一个 workflow 其节点只有 `kind=pull_request` 交付物，调 `ScaffoldRunDeliverables`，断言 `gitea.ScaffoldRunDeliverable`（或 team-ns init）被调用。镜像现有 `TestScaffoldRunDeliverables_ProvisionsBotAndScaffoldsRepo` 的 fixture 风格，把 deliverable Kind 改成 `pull_request`。

- [ ] **Step 2：跑测试确认失败**（code-only 走到 `if !has { return }` 提前返回，没 scaffold）。

- [ ] **Step 3：放宽 gate**。
  - `workflow_deliverable_repo.go` `ScaffoldRunDeliverables`：把 `has, err := s.hasDocumentDeliverable(ctx, workflow.ID)`（~line 353）改成 `has, err := s.hasAnyDeliverable(ctx, workflow.ID)`，注释 `// code-only workflow — no Gitea repo needed` 改成 `// deliverable-free workflow — no Gitea repo needed`。
  - `workflow_deliverable_repo.go` `provisionWorkflowRepo`（~line 707-712）：把 `has, err := s.hasDocumentDeliverable(ctx, workflowID)` 改成 `hasAnyDeliverable`，注释 `Only create the repo if the workflow has document deliverables (code-only ...)` 改成 `Only create the repo if the workflow has any deliverable (M5 decision ①: code-only runs get a repo for code-MR archiving)`。
  - `task_cscloud_push.go` safety net（~line 219）：把 `if phase == "worker" && hasDocumentDeliverableSpec(deliverables) && ...` 改成 `hasAnyDeliverableSpec(deliverables)`。同步更新上方注释（把 "Document deliverable: ..." 改成 "Any deliverable: ... (M5 decision ①: code-only runs too, for code-MR archiving)"）。

- [ ] **Step 4：跑测试确认通过**（code-only 现在 scaffold；现有 document fixture 仍 scaffold）。`go test ./internal/service/`。

- [ ] **Step 5：回归** — 确认 Task 2/3 of M2.5 的 safety net 测试仍绿（`TestBuildCSCloudPayload_DocDeliverableSafetyNet_*`）。`go test ./internal/service/ -run TestBuildCSCloudPayload`。

- [ ] **Step 6：编译 + 提交** Commit: `feat(cscloud): provision Gitea repo for any deliverable-bearing run (M5 decision ①, code-only included)`

---

## Task 3: A — ArchiveCodeDeliverable + 代码 MR 报到钩子

**Files:** `internal/service/workflow_deliverable_repo.go`（新 `ArchiveCodeDeliverable`）、`internal/service/workflow_deliverable_repo_test.go`、`internal/handler/workflow_run.go`（`SubmitNodeRunDeliverable` ~line 1165）

- [ ] **Step 1：failing test** — `ArchiveCodeDeliverable` 写到本 run 的 Gitea 仓 `nodes/<NN>-.../code/<deliverableID>.md`，内容含 MR URL + 代码仓库地址。镜像 `TestArchiveReviewComment_WritesReviewUnderNodeDir`（`workflow_deliverable_repo_test.go:525`）的 fixture：mock `RepositoryProvider.UpsertFile`，断言 owner/repo/inst/path/content。content 至少含 `mr_url`、`repo_url`、`branch`、`deliverable_id`。

- [ ] **Step 2：跑测试确认失败**（undefined: ArchiveCodeDeliverable）。

- [ ] **Step 3：实现 `ArchiveCodeDeliverable`**（`workflow_deliverable_repo.go`，紧接 `ArchiveReviewComment` 之后）。模仿 `ArchiveReviewComment`（line 734-791）的结构——同样 `s.deliverableRepository()` Configured 守卫、GetWorkflowRun + GetWorkflow + GetWorkflowNode + NodeTopoOrder 算 `nodeSeq`、`UpsertFile`、best-effort 出错只 slog.Warn：
```go
// ArchiveCodeDeliverable archives a code (GitLab MR) deliverable's pointer into
// the run's Gitea repo (inst branch), co-located with the node's other
// deliverables under nodes/<NN>-<nodeTitle>-<nodeRunShort>/code/<deliverableID>.md.
// The MR itself stays in GitLab (the source of truth); this is a best-effort,
// read-only audit copy so the Gitea repo is the unified archive of EVERYTHING a
// node produced (document + code + review + split). Errors are logged, never
// block the submission.
func (s *WorkflowService) ArchiveCodeDeliverable(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun, deliverable db.MulticaWorkflowNodeDeliverable, mrURL, codeRepoURL, codeBranch, agentName string) {
	repoProvider := s.deliverableRepository()
	if !repoProvider.Configured() || mrURL == "" {
		return
	}
	run, err := s.Queries.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
	if err != nil {
		slog.Warn("archive code deliverable: get run", "error", err)
		return
	}
	workflow, err := s.Queries.GetWorkflow(ctx, run.WorkflowID)
	if err != nil {
		slog.Warn("archive code deliverable: get workflow", "error", err)
		return
	}
	nodeRunIDStr := util.UUIDToString(nodeRun.ID)
	nodeSeq := int(nodeRun.SortOrder)
	node, err := s.Queries.GetWorkflowNode(ctx, nodeRun.WorkflowNodeID)
	if err == nil {
		nodeSeq = int(node.SortOrder)
		if topo, err := NodeTopoOrder(ctx, s.Queries, run.WorkflowID); err == nil {
			nodeSeq = topo[util.UUIDToString(node.ID)]
		}
	}
	nodeTitle := nodeRun.NodeTitle
	if err != nil {
		nodeTitle = nodeRun.NodeTitle // fall back; node lookup optional
	}
	path := gitea.NodeDir(nodeSeq, nodeTitle, nodeRunIDStr) + "/" + gitea.CodePath(util.UUIDToString(deliverable.ID))
	content := fmt.Sprintf("---\ndeliverable_id: %s\nmr_url: %s\ncode_repo: %s\nbranch: %s\nagent: %s\nnode_run: %s\n---\n\n## 代码 MR\n\n%s\n",
		util.UUIDToString(deliverable.ID), mrURL, codeRepoURL, codeBranch, agentName, nodeRunIDStr, mrURL)
	owner := gitea.OrgName(util.UUIDToString(run.WorkspaceID))
	repo := DeliverableRepoNameForWorkflow(workflow)
	inst := gitea.InstBranch(util.UUIDToString(run.ID))
	if err := repoProvider.UpsertFile(ctx, owner, repo, inst, path, content, "code mr: "+util.UUIDToString(deliverable.ID)); err != nil {
		slog.Warn("archive code deliverable: write file", "node_run_id", nodeRunIDStr, "path", path, "error", err)
		return
	}
	slog.Info("archived code deliverable", "node_run_id", nodeRunIDStr, "deliverable_id", util.UUIDToString(deliverable.ID), "path", path)
}
```
（注意 `nodeRun.SortOrder` 字段名以实际 sqlc 生成模型为准——若 node-run 行没 SortOrder，就只用 `node.SortOrder` 兜底；实现时核对 `MulticaWorkflowNodeRun` 字段。）

- [ ] **Step 4：跑测试确认通过**。

- [ ] **Step 5：在 `SubmitNodeRunDeliverable` 钩子**（`handler/workflow_run.go`，line 1165 `UpsertNodeRunDeliverableSubmission` 成功之后、`writeJSON` 之前）。需要拿到 nodeRun + deliverable + kind + 代码仓库地址。代码仓库地址从 task payload 的 `repos[]` 拿不到（handler 层），但 MR URL 是 `req.PullRequestURL`，代码仓库地址/分支可以从 MR URL 反推或留空——**决策**：handler 只传 `mrURL`，`codeRepoURL`/`codeBranch`/`agentName` 可从 node-run 的 task payload context 解析；若拿不到就传空字符串（content 里相应字段留空）。先简单实现：handler 调 `h.WorkflowService.ArchiveCodeDeliverable(ctx, nodeRun, deliverable, req.PullRequestURL, "", "", "")`，在单独 goroutine 跑（best-effort，不阻塞响应）。
```go
	// M5: archive the code MR pointer into the run's Gitea repo (best-effort,
	// async — never blocks the submission response). Document deliverables are
	// submitted via git PR and don't go through this archive path.
	if req.PullRequestURL != "" {
		nr, _ := h.Queries.GetWorkflowNodeRun(r.Context(), nrUUID)
		d, _ := h.Queries.GetWorkflowNodeDeliverable(r.Context(), dUUID)
		if nr.WorkflowNodeID.Valid && d.ID.Valid {
			go h.WorkflowService.ArchiveCodeDeliverable(
				context.Background(), nr, d, req.PullRequestURL, "", "", "")
		}
	}
```
（核对 `GetWorkflowNodeDeliverable` 查询名是否存在；若无，用 `ListWorkflowNodeDeliverables` 过滤或新增 `:one` 查询。`d.ID.Valid` 检查以实际字段为准。）

- [ ] **Step 6：handler 测试** — `SubmitNodeRunDeliverable` 带 `PullRequestURL` → 断言 `ArchiveCodeDeliverable` 被调（用 spy `WorkflowService` 或 spy `RepositoryProvider`）。镜像现有 handler 测试风格。

- [ ] **Step 7：编译 + 测试 + 提交** `go build ./...`、`go test ./internal/service/ ./internal/handler/`。Commit: `feat(cscloud): archive code MR deliverable pointer to Gitea repo (§7.5)`

---

## Task 4: B — ArchiveSubIssueAddress + 子 run 建仓钩子

**Files:** `internal/service/workflow_deliverable_repo.go`（新 `ArchiveSubIssueAddress` + `ScaffoldRunDeliverables` 末尾钩子）、`internal/service/workflow_deliverable_repo_test.go`

- [ ] **Step 1：failing test** — 子 run scaffold 后，若子 issue 有 `ParentIssueID`，把子 issue 交付物地址写到**父** run 的 Gitea 仓 `nodes/<split节点NN>-.../splits/<子issue编号>-<标题>.md`。mock：子 run + 子 issue（带 ParentIssueID + OriginType="workflow_split"）+ 父 issue + 父 run + 父 run 里一个 split 类型 node-run。spy `RepositoryProvider.UpsertFile` 断言：写到**父** owner/repo/inst、路径在 split 节点 NodeDir 下、content 含子 issue 的 clone URL + inst branch + 编号。

- [ ] **Step 2：跑测试确认失败**（undefined: ArchiveSubIssueAddress）。

- [ ] **Step 3：实现 `ArchiveSubIssueAddress`**（`workflow_deliverable_repo.go`）。链路：子 run → 子 issue（`SourceIssueID`）→ 父 issue（`ParentIssueID`）→ 父 run（`GetWorkflowRunBySourceIssue`）→ 父 run 的 split node-run（`ListWorkflowNodeRunsByRun` + 过滤 node 类型 split）→ 写父仓。best-effort，任何一环失败 slog.Warn + return。
```go
// ArchiveSubIssueAddress registers a split-out child issue's deliverable-repo
// address into the PARENT issue's Gitea repo, under the split node's directory
// (nodes/<split-NN>-.../splits/<childIssueNumber>-<title>.md). Hooked at the
// child run's ScaffoldRunDeliverables (after the child's own repo is created),
// so the parent repo incrementally indexes each child's deliverable repo as
// children are provisioned — letting later nodes / humans discover children's
// deliverables by browsing the parent repo. Best-effort: skips silently when
// the child has no parent issue, the parent has no Gitea repo, or the parent
// run has no split node. Errors are logged, never block the child run.
func (s *WorkflowService) ArchiveSubIssueAddress(ctx context.Context, childRun db.MulticaWorkflowRun, childWorkflow db.MulticaWorkflow) {
	repoProvider := s.deliverableRepository()
	if !repoProvider.Configured() || !childRun.SourceIssueID.Valid {
		return
	}
	// child run -> child issue -> parent issue
	childIssue, err := s.Queries.GetIssue(ctx, childRun.SourceIssueID)
	if err != nil || !childIssue.ParentIssueID.Valid {
		return
	}
	parentIssue, err := s.Queries.GetIssue(ctx, childIssue.ParentIssueID)
	if err != nil {
		return
	}
	// parent issue -> parent run (most recent run sourced from it)
	parentRun, err := s.Queries.GetWorkflowRunBySourceIssue(ctx, childIssue.ParentIssueID)
	if err != nil {
		return
	}
	parentWorkflow, err := s.Queries.GetWorkflow(ctx, parentRun.WorkflowID)
	if err != nil {
		return
	}
	// find the split node-run in the parent run (the one whose node type is "split")
	nodeRuns, err := s.Queries.ListWorkflowNodeRunsByRun(ctx, parentRun.ID)
	if err != nil {
		return
	}
	var splitNR db.MulticaWorkflowNodeRun
	var splitNode db.MulticaWorkflowNode
	found := false
	for _, nr := range nodeRuns {
		n, err := s.Queries.GetWorkflowNode(ctx, nr.WorkflowNodeID)
		if err != nil {
			continue
		}
		if workflowNodeType(n.FormatSchema) == "split" {
			splitNR, splitNode, found = nr, n, true
			break
		}
	}
	if !found {
		return
	}
	// resolve split node's NN (topo) for the dir
	topo, err := NodeTopoOrder(ctx, s.Queries, parentRun.WorkflowID)
	if err != nil {
		return
	}
	splitSeq := topo[util.UUIDToString(splitNode.ID)]
	splitNRIDStr := util.UUIDToString(splitNR.ID)
	path := gitea.NodeDir(splitSeq, splitNR.NodeTitle, splitNRIDStr) + "/" + gitea.SplitChildPath(int(childIssue.Number), childIssue.Title)
	// child's deliverable address (just provisioned by the caller)
	childCloneURL := giteaCloneURLFromSettings(ctx, s, childRun.WorkspaceID, childWorkflow)
	childInst := gitea.InstBranch(util.UUIDToString(childRun.ID))
	content := fmt.Sprintf("---\nchild_issue: %d\ntitle: %s\nchild_run: %s\nclone_url: %s\ninst_branch: %s\nparent_issue: %s\n---\n\n## 子任务交付物仓库\n\n- clone: %s\n- inst: %s\n",
		childIssue.Number, childIssue.Title, util.UUIDToString(childRun.ID), childCloneURL, childInst, util.UUIDToString(parentIssue.ID), childCloneURL, childInst)
	owner := gitea.OrgName(util.UUIDToString(parentRun.WorkspaceID))
	repo := DeliverableRepoNameForWorkflow(parentWorkflow)
	inst := gitea.InstBranch(util.UUIDToString(parentRun.ID))
	if err := repoProvider.UpsertFile(ctx, owner, repo, inst, path, content, "split child: "+fmt.Sprint(childIssue.Number)); err != nil {
		slog.Warn("archive sub-issue address: write file", "child_run", util.UUIDToString(childRun.ID), "path", path, "error", err)
		return
	}
	slog.Info("archived sub-issue address", "child_run", util.UUIDToString(childRun.ID), "child_issue", childIssue.Number, "parent_run", util.UUIDToString(parentRun.ID), "path", path)
}
```
（`workflowNodeType(n.FormatSchema)` 是已有 helper——见 `workflow_split.go:619/751/790` 用法；核对它是否 export / 在 service 包可见，否则内联判断。`giteaCloneURLFromSettings` 是个小 helper：从 workspace.settings 读 `gitea_clone_url`，拼上子 workflow 的 repo 名——复用 `repositoryDeliverableEnv` / `resolveDeliveryRepo` 的 settings 读取逻辑，提一个共享 helper；或先内联。`childIssue.Number` 字段类型核对。）

- [ ] **Step 4：跑测试确认通过**。

- [ ] **Step 5：在 `ScaffoldRunDeliverables` 末尾钩子**（`workflow_deliverable_repo.go`，两条 provisioning 路径——team-ns 与 gitea-scaffold——成功 return 之前各加一次调用，或函数末尾统一加）。注意 team-ns 路径在 `initWorkflowNamespace` 后 `return`、gitea 路径在 `syncWorkspaceMembers` 后函数结束。**决策**：在两条成功路径的 return 前各调一次 `go s.ArchiveSubIssueAddress(context.Background(), run, workflow)`（async best-effort）。team-ns 路径（~line 369 `return` 前）+ gitea 路径（~line 393 函数末尾）。
```go
	// M5: register this child run's deliverable address into its parent issue's
	// Gitea repo (if this run's source issue is a split-out child). Best-effort,
	// async — never blocks scaffolding.
	go s.ArchiveSubIssueAddress(context.Background(), run, *workflow)
```

- [ ] **Step 6：回归测试** — 现有 `TestScaffoldRunDeliverables_*` 不应受影响（ArchiveSubIssueAddress 对无父 issue 的 run 是 no-op）。`go test ./internal/service/`。

- [ ] **Step 7：编译 + 测试 + 提交** Commit: `feat(cscloud): register split child issue deliverable address into parent repo (§13)`

---

## Task 5: 端到端验证

- [ ] 全量 `go test ./internal/service/ ./internal/handler/ ./internal/gitea/` + `go build ./...` + `go vet ./...` + `make sqlc`（确认无 drift）。
- [ ] 交叉核对：① 纯代码工作流 run 现在 scaffold Gitea 仓（Task 2）；② 代码 MR 报到 → 归档到本 run 仓 `code/`（Task 3）；③ 子 run scaffold → 父 run 仓 `splits/` 出现子任务地址（Task 4）。
- [ ] 跨仓库一致性自检（M2.5 经验）：本任务全在 multica 侧，cs-cloud 无改动——确认 cs-cloud 无需联动（代码 MR 归档是服务端动作、子任务地址登记是服务端动作，都不经 cs-cloud）。

---

## Self-Review 记录

- **Spec 覆盖**：M5 覆盖 §7.5（代码 MR 归档，决策 ①）+ §13 的「子任务交付物仓库可查询」（用户简化版：登记地址而非写 plan.md）。
- **已确认决策**：A = ①（扩展 provisioning 到所有有交付物的 run）；B = 子 run 建仓时登记地址到父 split 节点；两件 best-effort；砍掉 cs-cloud split 接入 + plan.md。
- **延后/不做**：cs-cloud 的 split phase 路由（generate/chat/repair）、ArchiveSplitDecision 的 plan.md、§13 的「cs-cloud agent 用 cs-workflow split CLI」引导——split 仍由现有 daemon/人做。
- **已知简化**：① ArchiveCodeDeliverable 的 codeRepoURL/codeBranch/agentName 在 handler 层暂传空（MR URL 是关键信息，其余可后续从 task payload 解析补全）；② 多 split 节点的父 run 取第一个 split node-run（罕见，best-effort）；③ `giteaCloneURLFromSettings` 复用既有 settings 读取逻辑（提共享 helper 或内联，实现时定）。
- **跨仓库**：M5 全在 multica，cs-cloud 零改动。

---

**M5 完成后**：M4（critic：GitLab MR 合并 + CloseReviewRequest）→ 真实 E2E（M2.5/M3/M5 合并后统一验）。
