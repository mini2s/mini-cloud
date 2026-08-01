# cs-cloud 交付物重设计 M4：critic 合并 GitLab MR + reject 关闭文档 PR

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** critic 节点 approve 时能合并 worker 的 GitLab 代码 MR（现状只合 Gitea 文档 PR，GitLab MR URL 直接 blocked）；reject 时关闭本轮文档交付物 PR（代码 MR 不关，留给 worker 继续改）。纯 multica 服务端改动。

**Architecture:** 新建 server 端 `internal/gitlab/` 包（`MergeMR`，URL→base/project/iid 解析，PRIVATE-TOKEN 鉴权）。`mergeDeliverablePRs` 加 URL 分派（Gitea `/pulls/{n}` vs GitLab `/merge_requests/{n}`），GitLab client 用 `workspace.settings.gitlab_access_token` + MR URL 的 host 现造。Gitea 加 `ClosePR` + `RepositoryProvider.CloseReviewRequest`。新 `closeDeliverableReviewRequests(nodeRun)` 只关 **document kind** 的 submission PR（pull_request/code MR 跳过），best-effort。`ReviewNodeRun` reject 分支 tx 提交后调 close。

**Tech Stack:** Go（multica `server/`），标准 `testing` + `httptest`。分支 `fix/deliverable-verification`。

**Spec:** `docs/superpowers/specs/2026-07-26-cs-cloud-delivery-redesign-design.md` §12。

**已确认决策（grilling）：**
1. GitLab 客户端 = **并行 concrete `gitlab.Client`**（不做 RepositoryProvider；GitLab 不托管 multica 交付文档，无需 CreateBranch/UpsertFile）。`CloseReviewRequest` 加到 RepositoryProvider + GiteaAdapter（spec 字面），但 GitLab 不实现它。
2. GitLab base URL = **从 MR URL 解析 host**（自托管 gitlab.local 友好；移植 `cmd_mr.go` 的 `extractBaseFromRemote`）。
3. reject 关闭失败 = **best-effort（log warn，不阻塞 rework/blocked 流程）**。
4. **reject 只关文档交付物 PR（document kind），不关代码 MR（pull_request kind）**——代码 MR 留给 worker 继续改（保留 findOpenPR 复用）。approve 时代码 MR 照常合并。
5. 推论：**GitLab 客户端只需要 `MergeMR`，不需要 CloseMR**（代码 MR 从不被服务端关）。

---

## File Structure

- `internal/gitlab/merge.go`（新）— `Client.MergeMR` + URL 解析（`ParseMergeRequestIID`、`ExtractBase`、`ExtractProjectPath`）+ `ErrMergeConflict`。
- `internal/gitlab/merge_test.go`（新）— httptest 模拟 GitLab merge API。
- `internal/gitea/merge.go` — 加 `Client.ClosePR`（`PATCH /repos/{owner}/{repo}/pulls/{index}` state=closed）。
- `internal/gitea/merge_test.go` — 加 `TestClient_ClosePR`。
- `internal/coderepo/provider.go` — `RepositoryProvider` 加 `CloseReviewRequest`；`GiteaAdapter` 实现（委托 `Client.ClosePR`）。
- `internal/coderepo/provider_test.go`（新或扩）— GiteaAdapter.CloseReviewRequest。
- `internal/service/workflow_deliverable_repo.go` — `mergeDeliverablePRs` URL 分派；新 `closeDeliverableReviewRequests`。
- `internal/service/workflow.go` — `ReviewNodeRun` reject 分支 tx 后调 close。
- `internal/service/workflow_deliverable_repo_test.go` — GitLab merge-on-approve + reject→close-document-PR + 代码 MR 不被关。

---

## Task 1: `internal/gitlab/` — URL 解析 + MergeMR 客户端

**Files:** `internal/gitlab/merge.go`（新）; `internal/gitlab/merge_test.go`（新）

**参考：** `cmd/cs-workflow/cmd_mr.go:157-298`（`extractBaseFromRemote`/`extractPathFromRemote`/`findProject`/merge_requests API 形状）——移植 URL 解析到 server 端（cmd/ 不能被 server import）。

- [ ] **Step 1: 写失败测试** — `merge_test.go`：
  - `TestParseMergeRequestURL`：`http://gitlab.local/root/repo/-/merge_requests/7` → base=`http://gitlab.local`、projectPath=`root/repo`、iid=7。也测无 `/-/` 的形式（`http://host/g1/g2/-/merge_requests/3`、子组 `http://host/g/sub/proj/-/merge_requests/1`）。
  - `TestClient_MergeMR`：httptest mock `PUT /api/v4/projects/root%2Frepo/merge_requests/7/merge`，验 header `PRIVATE-TOKEN: tok`、返回 200 → nil。
  - `TestClient_MergeMR_ConflictReturnsSentinel`：返回 405/406/409 → `ErrMergeConflict`（terminal）。
  - `TestClient_MergeMR_NotConfigured`：空 token/base → error。

- [ ] **Step 2: 跑确认失败** — 编译失败（包不存在）。

- [ ] **Step 3: 实现** — `merge.go`：
  ```go
  package gitlab

  import (
      "context"
      "encoding/json"
      "errors"
      "fmt"
      "io"
      "net/http"
      "net/url"
      "strconv"
      "strings"
      "time"
  )

  // ErrMergeConflict is returned when GitLab refuses to merge (conflict,
  // unmergeable, already merged). Terminal — callers should not retry.
  var ErrMergeConflict = errors.New("gitlab: merge request not mergeable")

  // MergeRequestRef identifies a GitLab MR by web URL components.
  type MergeRequestRef struct {
      BaseURL     string // e.g. http://gitlab.local
      ProjectPath string // e.g. root/repo (namespace/project, may be nested)
      IID         int
  }

  // ParseMergeRequestURL parses a GitLab MR web URL into its API components.
  // Accepts both ".../-/merge_requests/{n}" (canonical) and ".../merge_requests/{n}".
  func ParseMergeRequestURL(mrURL string) (MergeRequestRef, error) {
      // 找 "/merge_requests/{n}" 段；其前为 {base}/<projectPath>[-/-]，其后为 iid。
      // 移植 cmd_mr.go extractBaseFromRemote + extractPathFromRemote 的思路。
      ... // 见 cmd_mr.go:157-247；产出 BaseURL + ProjectPath + IID
  }

  // Client issues GitLab merge API calls. Stateless; constructed per call with
  // the workspace's gitlab_access_token (there is no server-level GitLab admin
  // token, unlike Gitea).
  type Client struct {
      HTTP *http.Client
  }

  // MergeMR merges the MR. PUT {base}/api/v4/projects/{urlEncodedPath}/merge_requests/{iid}/merge.
  func (c *Client) MergeMR(ctx context.Context, ref MergeRequestRef, token string) error {
      if token == "" || ref.BaseURL == "" || ref.ProjectPath == "" || ref.IID == 0 {
          return fmt.Errorf("gitlab: merge request ref or token incomplete")
      }
      u := fmt.Sprintf("%s/api/v4/projects/%s/merge_requests/%d/merge",
          ref.BaseURL, url.PathEscape(ref.ProjectPath), ref.IID)
      req, _ := http.NewRequestWithContext(ctx, http.MethodPut, u, nil)
      req.Header.Set("PRIVATE-TOKEN", token)
      resp, err := c.httpClient().Do(req)
      if err != nil { return err }
      defer resp.Body.Close()
      switch {
      case resp.StatusCode >= 200 && resp.StatusCode < 300:
          return nil
      case resp.StatusCode == http.StatusMethodNotAllowed /*405*/ ||
          resp.StatusCode == http.StatusNotAcceptable /*406*/ ||
          resp.StatusCode == http.StatusConflict /*409*/:
          return fmt.Errorf("%w: status %d", ErrMergeConflict, resp.StatusCode)
      default:
          b, _ := io.ReadAll(resp.Body)
          return fmt.Errorf("gitlab merge mr %d: status %d: %s", ref.IID, resp.StatusCode, b)
      }
  }
  func (c *Client) httpClient() *http.Client {
      if c.HTTP != nil { return c.HTTP }
      return &http.Client{Timeout: 30 * time.Second}
  }
  ```
  （`ParseMergeRequestURL` 的具体正则/分割照搬 `cmd_mr.go:157-247` 的 `extractBaseFromRemote`+`extractPathFromRemote` 逻辑，适配 web URL 的 `/-/merge_requests/{n}` 段。用 `strconv.Atoi` 解析 iid；失败返 error。）

- [ ] **Step 4: 跑通过** — `go test ./internal/gitlab/ -v` → PASS。

- [ ] **Step 5: Commit** — `feat(gitlab): add server-side MergeMR client + MR URL parser`

---

## Task 2: Gitea `ClosePR` + RepositoryProvider.CloseReviewRequest

**Files:** `internal/gitea/merge.go`; `internal/gitea/merge_test.go`; `internal/coderepo/provider.go`; `internal/coderepo/provider_test.go`（若无则新建）

- [ ] **Step 1: 写失败测试** — `gitea/merge_test.go` 加 `TestClient_ClosePR`：httptest mock `PATCH /repos/{owner}/{repo}/pulls/{index}`，验 body `{"state":"closed"}`、200 → nil。加 `TestClient_ClosePR_NotConfigured`。

- [ ] **Step 2: 实现 ClosePR** — `gitea/merge.go`（仿 `MergePR` :23-38）：
  ```go
  // ClosePR closes a pull request (state=closed). Used by the critic reject
  // path to close document deliverable PRs.
  func (c *Client) ClosePR(ctx context.Context, owner, repo string, index int) error {
      if !c.configured { return ErrNotConfigured }
      body, _ := json.Marshal(map[string]string{"state": "closed"})
      req, _ := http.NewRequestWithContext(ctx, http.MethodPatch,
          fmt.Sprintf("%s/repos/%s/%s/pulls/%d", c.baseURL, owner, repo, index), bytes.NewReader(body))
      req.Header.Set("Authorization", "token "+c.token)
      req.Header.Set("Content-Type", "application/json")
      resp, err := c.do(req) // 复用现有 (*Client).do（含 configured token + error decode）
      if err != nil { return err }
      defer resp.Body.Close()
      if resp.StatusCode >= 200 && resp.StatusCode < 300 { return nil }
      return decodeError(resp)
  }
  ```
  （对齐 `MergePR` 的 `c.do`/`configured`/`decodeError` 模式——确认 `gitea/client.go` 的 `do`/`configured` 字段名，以现有代码为准。）

- [ ] **Step 3: 加接口方法** — `coderepo/provider.go`：
  ```go
  type RepositoryProvider interface {
      ... // 现有 6 方法
      CloseReviewRequest(ctx context.Context, owner, repo string, index int) error
  }
  ```
  `GiteaAdapter.CloseReviewRequest` 委托 `a.Client.ClosePR(...)`（仿 `MergeReviewRequest` :73）。

- [ ] **Step 4: provider 测试** — `coderepo/provider_test.go`（或 factory_test.go 旁）：断言 `GiteaAdapter.CloseReviewRequest` 调 `Client.ClosePR`（可用一个记录调用的假 `*gitea.Client`，或直接 httptest）。

- [ ] **Step 5: 跑通过 + 编译全 coderepo** — `go test ./internal/gitea/ ./internal/coderepo/ -v` → PASS（注意：加了接口方法后，任何其他 RepositoryProvider 实现也要补 CloseReviewRequest——grep `RepositoryProvider` 的实现者，目前只有 GiteaAdapter）。

- [ ] **Step 6: Commit** — `feat(coderepo): add CloseReviewRequest (Gitea ClosePR) for critic reject path`

---

## Task 3: `mergeDeliverablePRs` URL 分派（GitLab MR 合并）

**Files:** `internal/service/workflow_deliverable_repo.go:808-851`; `internal/service/workflow_deliverable_repo_test.go`

**背景：** 现状 `gitea.ParsePullRequestIndex`（:842）是 Gitea-only 门槛，GitLab MR URL → error → blocked。改成按 URL 分派：Gitea PR → workspace bot token；GitLab MR → 一次性 `gitlab.Client`（workspace PAT + URL host）。

- [ ] **Step 1: 写失败测试** — `workflow_deliverable_repo_test.go` 仿 `TestReviewNodeRun_MergesDocumentDeliverablePRs`（:905）：建一个 `pull_request` kind 的 submission，`pull_request_url = fakeGitlabServer.URL + "/root/repo/-/merge_requests/7"`，approve → 断言 fakeGitlabServer 收到 `PUT /api/v4/projects/root%2Frepo/merge_requests/7/merge`（计数器+1）、node-run `completed`、submission approved。workspace.settings 带非空 `gitlab_access_token`。再加一个冲突用例（GitLab 返 405 → blocked）。

- [ ] **Step 2: 跑确认失败** — 当前 `ParsePullRequestIndex` 解析 GitLab URL 失败 → 用例 FAIL。

- [ ] **Step 3: 实现 URL 分派** — 改 `mergeDeliverablePRs` 的循环（:838-849）：
  ```go
  for _, sub := range submissions {
      if !isPRBacked[util.UUIDToString(sub.DeliverableID)] || sub.PullRequestUrl == "" {
          continue
      }
      if err := s.mergeReviewURL(ctx, run.WorkspaceID, sub.PullRequestUrl); err != nil {
          return fmt.Errorf("merge %q: %w", sub.PullRequestUrl, err)
      }
  }
  ```
  新 helper `mergeReviewURL`：
  ```go
  // mergeReviewURL merges a document PR (Gitea) or code MR (GitLab) by URL.
  func (s *WorkflowService) mergeReviewURL(ctx context.Context, workspaceID pgtype.UUID, rawURL string) error {
      // Gitea PR?
      if index, err := gitea.ParsePullRequestIndex(rawURL); err == nil {
          // existing Gitea path (workspace bot token, computed owner/repo)
          run, _ := s.Queries.GetWorkflowRun(ctx, ...) // 复用已加载的 run/workflow——见下注
          owner := gitea.OrgName(util.UUIDToString(workspaceID))
          repo := DeliverableRepoNameForWorkflow(workflow)
          return retryMergeDocPR(ctx, s.deliverableRepository(), owner, repo, index)
      }
      // GitLab MR?
      ref, err := gitlab.ParseMergeRequestURL(rawURL)
      if err != nil { return fmt.Errorf("unrecognized review URL: %w", err) }
      token, err := s.gitlabAccessToken(ctx, workspaceID)
      if err != nil { return fmt.Errorf("gitlab token: %w", err) }
      return retryGitlabMR(ctx, &gitlab.Client{}, ref, token)
  }
  ```
  `retryGitlabMR` 仿 `retryMergeDocPR`（3 次退避，`ErrMergeConflict` terminal）。`gitlabAccessToken(ctx, workspaceID)` 读 `workspace.settings.gitlab_access_token`（**镜像 `task_cscloud_push.go:380-385` 的读取**——grep 确认是 workspace row 的 settings JSONB 字段；service 包若无现成 helper，加一个）。
  注：`owner/repo` 需 run/workflow——把它们作为参数传入 mergeReviewURL（避免循环内重复查询），或保留 mergeDeliverablePRs 顶部的 run/workflow 加载传下来。

- [ ] **Step 4: 跑通过** — `go test ./internal/service/ -run 'MergeGitlab|ReviewNodeRun' -v` → PASS。

- [ ] **Step 5: Commit** — `feat(service): mergeDeliverablePRs dispatches by URL (GitLab MR merge on approve)`

---

## Task 4: `closeDeliverableReviewRequests`（reject 关文档 PR，代码 MR 不关）

**Files:** `internal/service/workflow_deliverable_repo.go`; `internal/service/workflow_deliverable_repo_test.go`

- [ ] **Step 1: 写失败测试** — 建一个 node-run 带两个 PR-backed submission：① document kind，`pull_request_url` 是 fake Gitea server 的 `/pulls/5`；② pull_request (code) kind，`pull_request_url` 是 fake GitLab server 的 `/-/merge_requests/9`。调 `closeDeliverableReviewRequests(ctx, nodeRun)` → 断言：fake Gitea 收到 `PATCH .../pulls/5`（计数+1）、fake GitLab **没**收到任何 `/merge_requests/9/merge` 或 close（计数 0）。再加：close 失败（Gitea 返 500）→ 函数返回 nil（best-effort，不阻塞）+ 有 warn 日志。

- [ ] **Step 2: 跑确认失败** — 函数不存在 → FAIL。

- [ ] **Step 3: 实现** — `workflow_deliverable_repo.go`：
  ```go
  // closeDeliverableReviewRequests closes the node-run's DOCUMENT deliverable
  // PRs (Gitea) after a critic rejection. Code MRs (pull_request kind) are
  // deliberately left open so the worker can revise them in place across retry
  // rounds (findOpenPR reuse). Best-effort: failures are logged and do not
  // block the rework/blocked transition.
  func (s *WorkflowService) closeDeliverableReviewRequests(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) {
      run, err := s.Queries.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
      if err != nil { slog.Warn("close deliverable PRs: get run", "error", err); return }
      workflow, err := s.Queries.GetWorkflow(ctx, run.WorkflowID)
      if err != nil { slog.Warn("close deliverable PRs: get workflow", "error", err); return }
      owner := gitea.OrgName(util.UUIDToString(run.WorkspaceID))
      repo := DeliverableRepoNameForWorkflow(workflow)

      deliverables, err := s.Queries.ListWorkflowNodeDeliverables(ctx, nodeRun.WorkflowNodeID)
      if err != nil { slog.Warn("close deliverable PRs: list deliverables", "error", err); return }
      isDocument := make(map[string]bool, len(deliverables))
      for _, d := range deliverables {
          if d.Kind == "document" { isDocument[util.UUIDToString(d.ID)] = true }  // 仅文档
      }
      submissions, err := s.Queries.ListNodeRunDeliverableSubmissions(ctx, nodeRun.ID)
      if err != nil { slog.Warn("close deliverable PRs: list submissions", "error", err); return }
      provider := s.deliverableRepository() // GiteaAdapter (CloseReviewRequest)
      if provider == nil { return }
      for _, sub := range submissions {
          if !isDocument[util.UUIDToString(sub.DeliverableID)] || sub.PullRequestUrl == "" {
              continue // 跳过代码 MR + 无 URL
          }
          index, err := gitea.ParsePullRequestIndex(sub.PullRequestUrl)
          if err != nil { slog.Warn("close deliverable PR: parse url", "url", sub.PullRequestUrl, "error", err); continue }
          if err := provider.CloseReviewRequest(ctx, owner, repo, index); err != nil {
              slog.Warn("close deliverable PR failed (best-effort)", "index", index, "error", err)
          }
      }
  }
  ```
  （`slog` 已在 workflow.go 用——确认 import。`deliverableRepository()` 返回 GiteaAdapter 或 nil——确认 nil 时跳过，对齐 dormancy。）

- [ ] **Step 4: 跑通过** — `go test ./internal/service/ -run CloseDeliverableReviewRequests -v` → PASS。

- [ ] **Step 5: Commit** — `feat(service): closeDeliverableReviewRequests (document PRs only, best-effort)`

---

## Task 5: `ReviewNodeRun` reject 分支调 close

**Files:** `internal/service/workflow.go:1476`（tx 提交后、archive 段旁）

- [ ] **Step 1: 写失败测试** — `workflow_deliverable_repo_test.go` 加端到端：`ReviewNodeRun(ctx, nodeRunID, approved=false, ...)` 一个带 document PR submission 的 node-run → 断言 fake Gitea 收到 close + node-run 进 `critic_rework`（retry < MaxRetries）。再加 blocked 路径（retry 已达 MaxRetries）→ 也 close。再加：approved=true 不触发 close（只 merge）。

- [ ] **Step 2: 跑确认失败** — reject 不关 PR（计数 0）→ FAIL。

- [ ] **Step 3: 接线** — `workflow.go` tx 提交后（:1476 后，archive 段 :1478 旁）加：
  ```go
  // Critic rejected: close the node-run's document deliverable PRs (code MRs
  // are left open for revision). Best-effort — mirrors the archive call below.
  if !approved {
      s.closeDeliverableReviewRequests(context.Background(), nodeRun)
  }
  ```
  （`nodeRun` 是 tx 后的最新值——确认 :1461/:1471 的 `nodeRun = updated` 赋值使此处的 nodeRun 是 post-tx 版本。`context.Background()` 对齐 archive 的 best-effort 语义——archive 也是 `context.Background()` 在 :1479。）

- [ ] **Step 4: 跑通过** — `go test ./internal/service/ -run 'ReviewNodeRun.*Close|ReviewNodeRun.*Reject' -v` → PASS。回归现有 `TestReviewNodeRun_*`（MergesDocumentDeliverablePRs / BlocksWhenMergeConflicts / CompletesWithoutMergeWhenGiteaNil）全绿。

- [ ] **Step 5: Commit** — `feat(service): ReviewNodeRun closes document PRs on critic reject`

---

## Task 6: 全栈验证

- [ ] **编译 + vet:** `cd server && go build ./... && go vet ./internal/gitlab/ ./internal/gitea/ ./internal/coderepo/ ./internal/service/`。
- [ ] **单测:** `go test ./internal/gitlab/ ./internal/gitea/ ./internal/coderepo/ ./internal/service/`（service 的 DB-backed 测试走 golang 容器：`docker run --rm --network multica_default -v 'E:\Projects\multica\server:/src' -w /src -e DATABASE_URL='postgres://root:password@postgres:5432/multica?sslmode=disable' golang:1.26-alpine go test ./internal/service/ -run 'ReviewNodeRun|MergeGitlab|CloseDeliverable' -count=1 -v`）。
- [ ] **手工 E2E（可选）:** 真实 GitLab（gitlab.local）+ critic approve 一个代码 MR → 验证 PUT .../merge 被调、MR 进 merged；reject 一个文档 PR → 验证 Gitea PR 进 closed、代码 MR 不动。

---

## Self-Review 记录

- **Spec §12 覆盖**：approved→合并 GitLab MR（Task 3）+ Gitea PR（已有）；rejected→关闭文档 PR（Task 4/5，新增 CloseReviewRequest）；合并失败→blocked（对齐）；超 MaxRetries blocked 也关（Task 5 reject 路径覆盖）。
- **已确认决策**：并行 gitlab.Client（只 MergeMR）；base URL 从 MR URL 解析；close best-effort；**reject 只关文档 PR、代码 MR 不关**（保留 findOpenPR 复用）。
- **与 spec §12 字面的偏离（已 grilling 确认）**：GitLab 不实现 RepositoryProvider（并行 concrete client，避免 dead stub）；GitLab 无 CloseMR（代码 MR 不被关）。
- **延后**：真实 GitLab E2E（需 gitlab.local + PAT，留 manual）；M5 split + 归档。
- **已知简化**：GitLab merge 冲突码（405/406/409）映射 ErrMergeConflict，以 httptest 单测验证、真实 API 行为留 E2E 确认；`gitlabAccessToken` 读 workspace.settings 镜像 task_cscloud_push.go:380-385 模式。

---

**M4 完成后**：M5（split + 归档：cs-cloud split prompt + ArchiveSplitDecision + ArchiveCodeDeliverable）。
