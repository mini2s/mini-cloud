# Deliverable-Only Agent Surface — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the agent-facing comment + attachment channels and give the cs-cloud agent a single deliverable-centric surface in `cs-workflow`: read the workflow chain (with descendants), read deliverable repo addresses (with descendants), and submit deliverables.

**Architecture:** `cs-workflow` (multica repo) is the sole agent CLI. Add one new daemon-auth endpoint (`workflow-tree`) + two cs-workflow read subcommands; reuse the existing `gitea-deliverables` endpoint. Delete the comment/attachment CLI from multica and the dead/duplicate `workflow issue/*` + `deliverable submit` from the cs-cloud daemon repo. Backend comment/attachment endpoints stay (human UI uses them).

**Tech Stack:** Go (Chi router, sqlc), cobra CLI. Two repos: `e:\Projects\multica`, `e:\Projects\cs-cloud`.

**Spec:** `docs/superpowers/specs/2026-07-23-deliverable-only-agent-surface-design.md`

**Conventions:** Run a single Go test with `cd server && go test ./<pkg>/ -run TestName`. Commit with conventional format. End commit messages with the Co-Authored-By line. Comments in English only.

---

## File Map

**multica — create:**
- `server/internal/handler/issue_workflow_tree.go` — `GET /api/daemon/issues/{issue}/workflow-tree` handler + response structs.
- `server/cmd/cs-workflow/cmd_issue_workflow.go` — `issue workflow` + `issue deliverables` subcommands.

**multica — modify:**
- `server/cmd/server/router.go` — register the new route in the daemon block.
- `server/internal/service/task_cscloud_push.go` — update `appendDeliverablePrompt`.
- `server/cmd/cs-workflow/cmd_issue.go` — delete the `comment` subcommand group.
- `server/cmd/cs-workflow/cmd_issue_test.go` — delete comment/attachment tests.
- `server/cmd/cs-workflow/main.go` — drop `attachmentCmd` registration.
- `server/internal/service/task_cscloud_push_test.go` — update prompt assertions.

**multica — delete:**
- `server/cmd/cs-workflow/cmd_attachment.go` — the `attachment download` command.

**cs-cloud — modify:**
- `internal/cli/workflow.go` — drop `issue`/`deliverable` dispatcher cases + usage entries.
- `internal/cli/workflow_test.go` — fix usage assertion.
- `internal/workflowrunner/client.go` — delete 3 dead methods.
- `internal/workflow/protocol.go` — delete 2 constants.
- `internal/workflow/models.go` — delete 2 structs (check `models_test.go`).

**cs-cloud — delete:**
- `internal/cli/workflow_issue.go`, `internal/cli/gitea.go`, `internal/cli/gitea_test.go`.

---

## Task 1: workflow-tree endpoint (multica)

**Files:**
- Create: `server/internal/handler/issue_workflow_tree.go`
- Modify: `server/cmd/server/router.go` (daemon block, after the `gitea-deliverables` route ~line 430)
- Test: `server/internal/handler/issue_workflow_tree_test.go` (model on `issue_gitea_deliverables_test.go`)

- [ ] **Step 1: Write the failing handler test**

Create `server/internal/handler/issue_workflow_tree_test.go`. Copy the test harness boilerplate (server setup, workspace/issue/workflow-run/node-run fixture helpers) from `issue_gitea_deliverables_test.go`. The test creates one root issue with a workflow run + one node run with one document deliverable + one submission, and a child issue with its own workflow run; then:

```go
func TestHandleGetIssueWorkflowTree_Descendants(t *testing.T) {
	// fixtures: root issue (workflow run R1, node N1, deliverable D1, submission status "submitted")
	//           child issue (parent = root, workflow run R2, node N2, no submission yet)
	req := newDaemonJSONRequest(t, "GET", "/api/daemon/issues/"+rootNumberOrUUID+"/workflow-tree?descendants=true", nil)
	resp := serveDaemonRequest(t, req)
	assertStatus(t, resp, 200)

	var got IssueWorkflowTreeResponse
	decodeJSON(t, resp, &got)
	require.Len(t, got.Issues, 2)

	root := got.Issues[0]
	require.Equal(t, 0, root.Depth)
	require.NotNil(t, root.WorkflowRun)
	require.Len(t, root.WorkflowRun.NodeRuns, 1)
	require.Equal(t, "submitted", root.WorkflowRun.NodeRuns[0].Deliverables[0].SubmissionStatus)

	child := got.Issues[1]
	require.Equal(t, 1, child.Depth)
	require.NotNil(t, child.WorkflowRun)
	// child's deliverable has no submission yet → empty submission_status
	require.Equal(t, "", child.WorkflowRun.NodeRuns[0].Deliverables[0].SubmissionStatus)
}

func TestHandleGetIssueWorkflowTree_SingleIssueNoWorkflowRun(t *testing.T) {
	// issue with no workflow run, no descendants flag → returns the bare issue, workflow_run null
	req := newDaemonJSONRequest(t, "GET", "/api/daemon/issues/"+iss+"/workflow-tree", nil)
	resp := serveDaemonRequest(t, req)
	assertStatus(t, resp, 200)
	var got IssueWorkflowTreeResponse
	decodeJSON(t, resp, &got)
	require.Len(t, got.Issues, 1)
	require.Nil(t, got.Issues[0].WorkflowRun)
}
```

Use the same daemon-auth request helpers (`newDaemonJSONRequest`/`serveDaemonRequest` — match whatever `issue_gitea_deliverables_test.go` actually names them; read that file first and mirror it exactly).

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && go test ./internal/handler/ -run TestHandleGetIssueWorkflowTree`
Expected: build failure / `undefined: IssueWorkflowTreeResponse`.

- [ ] **Step 3: Create the handler + structs**

Create `server/internal/handler/issue_workflow_tree.go`:

```go
package handler

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/multica-ai/multica/server/internal/middleware"
	"github.com/multica-ai/multica/server/internal/util"
	"github.com/multica-ai/multica/server/pkg/db"
	"github.com/jackc/pgx/v5/pgtype"
)

// IssueWorkflowTreeResponse is returned by GET
// /api/daemon/issues/{issue}/workflow-tree?descendants=true. It lists the issue
// (and optionally its descendants) with each one's workflow run + node run
// status tree, so an agent can read the whole chain's progress by issue.
type IssueWorkflowTreeResponse struct {
	Issues []IssueWorkflowTreeNode `json:"issues"`
}

type IssueWorkflowTreeNode struct {
	IssueID     string              `json:"issue_id"`
	Number      int32               `json:"number"`
	Title       string              `json:"title"`
	Depth       int                 `json:"depth"`
	Status      string              `json:"status"`
	WorkflowRun *WorkflowRunSummary `json:"workflow_run"`
}

type WorkflowRunSummary struct {
	ID       string           `json:"id"`
	Status   string           `json:"status"`
	NodeRuns []NodeRunSummary `json:"node_runs"`
}

type NodeRunSummary struct {
	NodeID        string                  `json:"node_id"`
	Title         string                  `json:"title"`
	Status        string                  `json:"status"`
	RetryCount    int32                   `json:"retry_count"`
	WorkerID      string                  `json:"worker_id"`
	CriticID      string                  `json:"critic_id"`
	FailureReason string                  `json:"failure_reason"`
	Deliverables  []NodeDeliverableStatus `json:"deliverables"`
}

type NodeDeliverableStatus struct {
	DeliverableID    string `json:"deliverable_id"`
	Title            string `json:"title"`
	SubmissionStatus string `json:"submission_status"` // "" when not yet submitted
}

// HandleGetIssueWorkflowTree returns the workflow run + node run status tree for
// an issue, optionally recursively for all descendant issues. Mirrors
// HandleGetIssueGiteaDeliverables for auth, issue resolution and descendant
// iteration.
func (h *Handler) HandleGetIssueWorkflowTree(w http.ResponseWriter, r *http.Request) {
	workspaceIDStr := middleware.DaemonWorkspaceIDFromContext(r.Context())
	if workspaceIDStr == "" {
		workspaceIDStr = r.Header.Get("X-Workspace-ID")
	}
	if !h.requireDaemonWorkspaceAccess(w, r, workspaceIDStr) {
		return
	}
	workspaceID, err := util.ParseUUID(workspaceIDStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "daemon workspace not resolved")
		return
	}
	root, err := h.resolveIssueInWorkspace(r.Context(), workspaceID, chi.URLParam(r, "issue"))
	if err != nil {
		writeError(w, http.StatusNotFound, "issue not found: "+err.Error())
		return
	}

	type target struct {
		id    pgtype.UUID
		depth int
	}
	targets := []target{{root.ID, 0}}
	if r.URL.Query().Get("descendants") == "true" || r.URL.Query().Get("descendants") == "1" {
		desc, err := h.Queries.ListIssueDescendants(r.Context(), db.ListIssueDescendantsParams{
			ParentIssueID: root.ID,
			WorkspaceID:   workspaceID,
		})
		if err == nil {
			for _, d := range desc {
				targets = append(targets, target{d.ID, int(d.Depth) + 1})
			}
		}
	}

	out := make([]IssueWorkflowTreeNode, 0, len(targets))
	for _, t := range targets {
		iss, err := h.Queries.GetIssue(r.Context(), t.id)
		if err != nil {
			continue
		}
		entry := IssueWorkflowTreeNode{
			IssueID: util.UUIDToString(iss.ID),
			Number:  iss.Number,
			Title:   iss.Title,
			Depth:   t.depth,
			Status:  iss.Status,
		}
		if iss.WorkflowRunID.Valid {
			entry.WorkflowRun = h.workflowRunSummary(r.Context(), iss.WorkflowRunID)
		}
		// Skip child issues that never got a workflow run (single-issue case
		// always includes the root even without a run, so the agent can see it).
		if !iss.WorkflowRunID.Valid && len(targets) > 1 {
			continue
		}
		out = append(out, entry)
	}

	writeJSON(w, http.StatusOK, IssueWorkflowTreeResponse{Issues: out})
}

// workflowRunSummary assembles a run's status + its node runs (each with its
// deliverable definitions joined to the latest submission status). Field
// conversions mirror workflowNodeRunToResponse in workflow_run.go.
func (h *Handler) workflowRunSummary(ctx context.Context, runID pgtype.UUID) *WorkflowRunSummary {
	run, err := h.Queries.GetWorkflowRun(ctx, runID)
	if err != nil {
		return nil
	}
	nodeRuns, err := h.Queries.ListWorkflowNodeRunsByRun(ctx, runID)
	if err != nil {
		nodeRuns = nil
	}
	summaries := make([]NodeRunSummary, 0, len(nodeRuns))
	for _, nr := range nodeRuns {
		subs, _ := h.Queries.ListNodeRunDeliverableSubmissions(ctx, nr.ID)
		subByDeliv := make(map[string]string, len(subs))
		for _, s := range subs {
			subByDeliv[util.UUIDToString(s.DeliverableID)] = s.Status
		}
		defs, _ := h.Queries.ListWorkflowNodeDeliverables(ctx, nr.WorkflowNodeID)
		dels := make([]NodeDeliverableStatus, 0, len(defs))
		for _, d := range defs {
			dels = append(dels, NodeDeliverableStatus{
				DeliverableID:    util.UUIDToString(d.ID),
				Title:            d.Title,
				SubmissionStatus: subByDeliv[util.UUIDToString(d.ID)],
			})
		}
		summaries = append(summaries, NodeRunSummary{
			NodeID:        util.UUIDToString(nr.ID),
			Title:         nr.NodeTitle,
			Status:        nr.Status,
			RetryCount:    nr.RetryCount,
			WorkerID:      util.UUIDToString(nr.WorkerID),
			CriticID:      util.UUIDToString(nr.CriticID),
			FailureReason: pgText(nr.FailureReason),
			Deliverables:  dels,
		})
	}
	return &WorkflowRunSummary{
		ID:       util.UUIDToString(run.ID),
		Status:   run.Status,
		NodeRuns: summaries,
	}
}
```

**Important — verify field types before finalizing:** open `server/internal/handler/workflow_run.go` and read `workflowNodeRunToResponse` (~line 927). It already converts `nr.WorkerID` / `nr.CriticID` (pgtype.UUID) and `nr.FailureReason` (pgtype.Text) to the response exactly as the compiler wants. Mirror that conversion. If `util.UUIDToString` is not the helper used there, use whatever `workflowNodeRunToResponse` uses. Add a tiny `pgText` helper at the bottom of the new file only if one does not already exist in the package:

```go
// pgText returns the string value of a nullable text column, "" when NULL.
func pgText(v pgtype.Text) string {
	if !v.Valid {
		return ""
	}
	return v.String
}
```

If `pgText` (or equivalent) already exists in the package, do not re-add it (duplicate symbol). Run `go build` to catch this.

- [ ] **Step 4: Register the route**

In `server/cmd/server/router.go`, inside the `r.Route("/api/daemon", …)` block, immediately after the `gitea-deliverables` route (~line 430), add:

```go
		// Workflow run + node run status tree by issue (agent-facing read path).
		// Resolve an issue by UUID or <PREFIX>-<number> and return its workflow
		// chain — optionally recursively for all descendant issues
		// (?descendants=true). Lets an agent read any issue's / child / grandchild
		// workflow progress without node-run-ids.
		r.Get("/issues/{issue}/workflow-tree", h.HandleGetIssueWorkflowTree)
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd server && go test ./internal/handler/ -run TestHandleGetIssueWorkflowTree`
Expected: PASS. If the daemon-test helpers have different names, adapt the test to the real names in `issue_gitea_deliverables_test.go`.

- [ ] **Step 6: Commit**

```bash
git add server/internal/handler/issue_workflow_tree.go server/internal/handler/issue_workflow_tree_test.go server/cmd/server/router.go
git commit -m "feat(handler): workflow-tree endpoint for agent chain reads

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: cs-workflow `issue workflow` command

**Files:**
- Create: `server/cmd/cs-workflow/cmd_issue_workflow.go`
- Test: `server/cmd/cs-workflow/cmd_issue_workflow_test.go`

The logic is split into a thin cobra wrapper (`runIssueWorkflow`) and a testable core (`fetchIssueWorkflow` + `printWorkflowTree`), mirroring how `cmd_repo_submit.go` separates `submitDeliverable(cfg)` from `runRepoSubmit`. Tests drive the core against an httptest-backed `cli.APIClient`, no cobra/flag machinery needed.

- [ ] **Step 1: Write the failing test**

Create `server/cmd/cs-workflow/cmd_issue_workflow_test.go`:

```go
package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/cli"
)

func TestFetchIssueWorkflow_PrintsTree(t *testing.T) {
	body := `{"issues":[{"issue_id":"u1","number":123,"title":"Root","depth":0,"status":"in_progress","workflow_run":{"id":"r1","status":"running","node_runs":[{"node_id":"n1","title":"Design spec","status":"awaiting_critic","retry_count":0,"worker_id":"w","critic_id":"c","failure_reason":"","deliverables":[{"deliverable_id":"d1","title":"spec.md","submission_status":"submitted"}]}]}}]}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/daemon/issues/MUL-123/workflow-tree" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, body)
	}))
	defer srv.Close()

	client := cli.NewAPIClient(srv.URL, "ws", "t")
	resp, err := fetchIssueWorkflow(client, "MUL-123", false)
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	var b strings.Builder
	printWorkflowTree(&b, resp.Issues)
	out := b.String()
	for _, want := range []string{"#123", "Design spec", "submitted"} {
		if !strings.Contains(out, want) {
			t.Errorf("output missing %q:\n%s", want, out)
		}
	}
}

func TestFetchIssueWorkflow_DescendantsFlag(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.String()
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"issues":[]}`)
	}))
	defer srv.Close()

	client := cli.NewAPIClient(srv.URL, "ws", "t")
	if _, err := fetchIssueWorkflow(client, "MUL-1", true); err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if !strings.Contains(gotPath, "descendants=true") {
		t.Errorf("descendants flag not forwarded, path=%s", gotPath)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && go test ./cmd/cs-workflow/ -run TestFetchIssueWorkflow`
Expected: build failure (`fetchIssueWorkflow` / `printWorkflowTree` undefined).

- [ ] **Step 3: Implement the command**

Create `server/cmd/cs-workflow/cmd_issue_workflow.go`:

```go
package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/spf13/cobra"

	"github.com/multica-ai/multica/server/internal/cli"
)

var issueWorkflowCmd = &cobra.Command{
	Use:   "workflow <issue-id>",
	Short: "Show the workflow run + node run status tree for an issue (and its descendants)",
	Args:  exactArgs(1),
	RunE:  runIssueWorkflow,
}

func init() {
	issueCmd.AddCommand(issueWorkflowCmd)
	issueWorkflowCmd.Flags().Bool("descendants", false, "Include child/grandchild issues")
	issueWorkflowCmd.Flags().BoolP("json", "j", false, "Output raw JSON")
}

// issueWorkflowResponse mirrors server handler IssueWorkflowTreeResponse.
type issueWorkflowResponse struct {
	Issues []issueWorkflowNode `json:"issues"`
}

type issueWorkflowNode struct {
	IssueID     string             `json:"issue_id"`
	Number      int32              `json:"number"`
	Title       string             `json:"title"`
	Depth       int                `json:"depth"`
	Status      string             `json:"status"`
	WorkflowRun *issueWorkflowRun  `json:"workflow_run"`
}

type issueWorkflowRun struct {
	ID       string                `json:"id"`
	Status   string                `json:"status"`
	NodeRuns []issueWorkflowNodeRun `json:"node_runs"`
}

type issueWorkflowNodeRun struct {
	NodeID        string             `json:"node_id"`
	Title         string             `json:"title"`
	Status        string             `json:"status"`
	RetryCount    int32              `json:"retry_count"`
	WorkerID      string             `json:"worker_id"`
	CriticID      string             `json:"critic_id"`
	FailureReason string             `json:"failure_reason"`
	Deliverables  []issueDeliverableState `json:"deliverables"`
}

type issueDeliverableState struct {
	DeliverableID    string `json:"deliverable_id"`
	Title            string `json:"title"`
	SubmissionStatus string `json:"submission_status"`
}

func runIssueWorkflow(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	descendants, _ := cmd.Flags().GetBool("descendants")
	asJSON, _ := cmd.Flags().GetBool("json")

	resp, err := fetchIssueWorkflow(client, args[0], descendants)
	if err != nil {
		return err
	}
	if asJSON {
		return cli.PrintJSON(os.Stdout, resp)
	}
	printWorkflowTree(os.Stdout, resp.Issues)
	return nil
}

// fetchIssueWorkflow calls the daemon workflow-tree endpoint and decodes it.
func fetchIssueWorkflow(client *cli.APIClient, issueID string, descendants bool) (issueWorkflowResponse, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	path := "/api/daemon/issues/" + issueID + "/workflow-tree"
	if descendants {
		path += "?descendants=true"
	}
	var resp issueWorkflowResponse
	if err := client.GetJSON(ctx, path, &resp); err != nil {
		return resp, fmt.Errorf("get workflow tree: %w", err)
	}
	return resp, nil
}

func printWorkflowTree(w io.Writer, issues []issueWorkflowNode) {
	for _, iss := range issues {
		fmt.Fprintf(w, "%s (depth %d) [%s] %s\n", issueKey(iss.Number), iss.Depth, iss.Status, iss.Title)
		if iss.WorkflowRun == nil {
			fmt.Fprintln(w, "  (no workflow run)")
			continue
		}
		fmt.Fprintf(w, "  workflow run: %s\n", iss.WorkflowRun.Status)
		for i, nr := range iss.WorkflowRun.NodeRuns {
			line := fmt.Sprintf("  node %d %q [%s]", i+1, nr.Title, nr.Status)
			if nr.FailureReason != "" {
				line += " failure: " + nr.FailureReason
			}
			fmt.Fprintln(w, line)
			for _, d := range nr.Deliverables {
				st := d.SubmissionStatus
				if st == "" {
					st = "pending"
				}
				fmt.Fprintf(w, "    deliverable: %s [%s]\n", d.Title, st)
			}
		}
	}
}

// issueKey renders an issue number for display. The daemon endpoint does not
// return the project prefix, so use the bare number prefixed with '#'.
func issueKey(number int32) string {
	return fmt.Sprintf("#%d", number)
}
```

`newAPIClient(cmd)` is the existing helper used by `runIssueGet`; `cli.PrintJSON` is the existing helper. After this task the package compiles — `issueDeliverablesCmd` is added in Task 3.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && go test ./cmd/cs-workflow/ -run TestFetchIssueWorkflow`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/cmd/cs-workflow/cmd_issue_workflow.go server/cmd/cs-workflow/cmd_issue_workflow_test.go
git commit -m "feat(cli): cs-workflow issue workflow command

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: cs-workflow `issue deliverables` command

**Files:**
- Modify: `server/cmd/cs-workflow/cmd_issue_workflow.go` (append `issueDeliverablesCmd` + core + render in a second `init()`)
- Test: `server/cmd/cs-workflow/cmd_issue_workflow_test.go` (append)

Same testable-core split as Task 2.

- [ ] **Step 1: Write the failing test**

Append to `cmd_issue_workflow_test.go`:

```go
func TestFetchIssueDeliverables_PrintsList(t *testing.T) {
	body := `{"issues":[{"issue_id":"u1","number":123,"title":"Root","depth":0,"gitea":{"owner":"o","repo":"r","clone_url":"https://g/o/r.git","inst_branch":"inst-r","deliverables":[{"node_title":"Design spec","deliverable_id":"d1","title":"spec.md","path":"docs/spec.md"}]}}]}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/daemon/issues/MUL-123/gitea-deliverables" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, body)
	}))
	defer srv.Close()

	client := cli.NewAPIClient(srv.URL, "ws", "t")
	resp, err := fetchIssueDeliverables(client, "MUL-123", false)
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	var b strings.Builder
	printIssueDeliverables(&b, resp.Issues)
	out := b.String()
	for _, want := range []string{"#123", "o/r", "docs/spec.md"} {
		if !strings.Contains(out, want) {
			t.Errorf("output missing %q:\n%s", want, out)
		}
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && go test ./cmd/cs-workflow/ -run TestFetchIssueDeliverables`
Expected: build failure (`fetchIssueDeliverables` / `printIssueDeliverables` undefined).

- [ ] **Step 3: Implement the command**

Append to `cmd_issue_workflow.go` (a second `init()` in the same file is legal in Go):

```go
var issueDeliverablesCmd = &cobra.Command{
	Use:   "deliverables <issue-id>",
	Short: "Show the deliverable repository address + deliverable list for an issue (and its descendants)",
	Args:  exactArgs(1),
	RunE:  runIssueDeliverables,
}

func init() {
	issueCmd.AddCommand(issueDeliverablesCmd)
	issueDeliverablesCmd.Flags().Bool("descendants", false, "Include child/grandchild issues")
	issueDeliverablesCmd.Flags().BoolP("json", "j", false, "Output raw JSON")
}

// issueDeliverablesResponse mirrors server handler IssueGiteaDeliverablesResponse.
type issueDeliverablesResponse struct {
	Issues []issueDeliverableNode `json:"issues"`
}

type issueDeliverableNode struct {
	IssueID string               `json:"issue_id"`
	Number  int32                `json:"number"`
	Title   string               `json:"title"`
	Depth   int                  `json:"depth"`
	Gitea   *issueDeliverableCtx `json:"gitea"`
}

type issueDeliverableCtx struct {
	Owner        string                `json:"owner"`
	Repo         string                `json:"repo"`
	CloneURL     string                `json:"clone_url"`
	InstBranch   string                `json:"inst_branch"`
	Deliverables []issueDeliverableRef `json:"deliverables"`
}

type issueDeliverableRef struct {
	NodeTitle     string `json:"node_title"`
	DeliverableID string `json:"deliverable_id"`
	Title         string `json:"title"`
	Path          string `json:"path"`
}

func runIssueDeliverables(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	descendants, _ := cmd.Flags().GetBool("descendants")
	asJSON, _ := cmd.Flags().GetBool("json")

	resp, err := fetchIssueDeliverables(client, args[0], descendants)
	if err != nil {
		return err
	}
	if asJSON {
		return cli.PrintJSON(os.Stdout, resp)
	}
	printIssueDeliverables(os.Stdout, resp.Issues)
	return nil
}

func fetchIssueDeliverables(client *cli.APIClient, issueID string, descendants bool) (issueDeliverablesResponse, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	path := "/api/daemon/issues/" + issueID + "/gitea-deliverables"
	if descendants {
		path += "?descendants=true"
	}
	var resp issueDeliverablesResponse
	if err := client.GetJSON(ctx, path, &resp); err != nil {
		return resp, fmt.Errorf("get issue deliverables: %w", err)
	}
	return resp, nil
}

func printIssueDeliverables(w io.Writer, issues []issueDeliverableNode) {
	for _, iss := range issues {
		fmt.Fprintf(w, "%s (depth %d) %s\n", issueKey(iss.Number), iss.Depth, iss.Title)
		if iss.Gitea == nil {
			fmt.Fprintln(w, "  (no deliverable repository)")
			continue
		}
		fmt.Fprintf(w, "  repo:   %s/%s\n", iss.Gitea.Owner, iss.Gitea.Repo)
		fmt.Fprintf(w, "  inst:   %s\n", iss.Gitea.InstBranch)
		fmt.Fprintf(w, "  clone:  %s\n", iss.Gitea.CloneURL)
		if len(iss.Gitea.Deliverables) > 0 {
			fmt.Fprintln(w, "  deliverables:")
			for _, d := range iss.Gitea.Deliverables {
				fmt.Fprintf(w, "    %s %q  path: %s\n", d.DeliverableID, d.Title, d.Path)
			}
		}
	}
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && go test ./cmd/cs-workflow/ -run TestFetchIssueDeliverables`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/cmd/cs-workflow/cmd_issue_workflow.go server/cmd/cs-workflow/cmd_issue_workflow_test.go
git commit -m "feat(cli): cs-workflow issue deliverables command

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Update the worker prompt to point agents at the new read commands

**Files:**
- Modify: `server/internal/service/task_cscloud_push.go` (`appendDeliverablePrompt`, ~line 223-245)
- Test: `server/internal/service/task_cscloud_push_test.go`

- [ ] **Step 1: Write/adjust the failing test**

In `task_cscloud_push_test.go`, find the test asserting `appendDeliverablePrompt` output (it currently asserts the prompt contains `git clone` and does NOT contain `deliverable fetch`). Add an assertion that the prompt mentions the new self-service read commands and does NOT tell the agent to ask the user:

```go
	require.Contains(t, prompt, "cs-workflow issue deliverables")
	require.NotContains(t, prompt, "ask the user")
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && go test ./internal/service/ -run TestAppendDeliverablePrompt`
Expected: FAIL (prompt still says "ask the user").

- [ ] **Step 3: Edit `appendDeliverablePrompt`**

In `server/internal/service/task_cscloud_push.go`, replace the "### Reading the deliverable repository" paragraph (the one ending with `ask the user rather than guessing the URL.\n`) with:

```go
	b.WriteString("### Reading the deliverable repository\n\n")
	b.WriteString("Use plain git to read or explore: `git clone $MULTICA_REPO_CLONE_URL_AUTHED` then `git checkout $MULTICA_REPO_INST_BRANCH` to see the current run's tree (this node's deliverables live under its node directory).\n\n")
	b.WriteString("To inspect the rest of the workflow chain — other issues' progress and their deliverable repositories — use the read commands instead of guessing URLs:\n")
	b.WriteString("- `cs-workflow issue workflow <issue-id> --descendants` — workflow run + node run status for this issue and its children.\n")
	b.WriteString("- `cs-workflow issue deliverables <issue-id> --descendants` — the Gitea repository address and deliverable list for this issue and its children; clone the inst branch to read another issue's documents.\n")
```

Also fix the stale function doc comment that says the submit goes through `cs-cloud workflow deliverable submit` — it goes through `cs-workflow repo submit`. Change that comment line to reference `cs-workflow repo submit`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && go test ./internal/service/ -run TestAppendDeliverablePrompt`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/internal/service/task_cscloud_push.go server/internal/service/task_cscloud_push_test.go
git commit -m "feat(workflow): point agent at deliverable/workflow read commands

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: Remove the `issue comment` subcommands (multica)

**Files:**
- Modify: `server/cmd/cs-workflow/cmd_issue.go`
- Modify: `server/cmd/cs-workflow/cmd_issue_test.go`

- [ ] **Step 1: Delete the comment command code**

In `server/cmd/cs-workflow/cmd_issue.go` delete, by line region (re-confirm line numbers before deleting — the file may have shifted):
- The `issueCommentCmd`, `issueCommentListCmd`, `issueCommentAddCmd`, `issueCommentDeleteCmd` cobra declarations (~lines 133-157).
- In `init()`: the line `issueCmd.AddCommand(issueCommentCmd)` (~238) and the three `issueCommentCmd.AddCommand(...)` lines (~246-248).
- The flag-registration blocks for the comment commands (~310-317 and ~333-339).
- The run functions `runIssueCommentList`, `runIssueCommentAdd`, `runIssueCommentDelete` and the `// Comment commands` section header (~919-1144).

- [ ] **Step 2: Delete comment tests**

In `server/cmd/cs-workflow/cmd_issue_test.go`, remove every test whose name references comments (e.g. `TestRunIssueCommentAdd`, `TestRunIssueCommentList`, `TestRunIssueCommentDelete`) and any helper only they used. The earlier grep confirmed this file references `comment`/`UploadFile`.

- [ ] **Step 3: Build + run the package tests**

Run: `cd server && go build ./cmd/cs-workflow/... && go test ./cmd/cs-workflow/`
Expected: build OK, tests PASS, no remaining references to `runIssueComment*` / `issueCommentCmd`.

- [ ] **Step 4: Commit**

```bash
git add server/cmd/cs-workflow/cmd_issue.go server/cmd/cs-workflow/cmd_issue_test.go
git commit -m "refactor(cli): remove issue comment subcommands from cs-workflow

The agent no longer reports via comments; the deliverable channel is the
sole reporting path.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: Remove the `attachment` command (multica)

**Files:**
- Delete: `server/cmd/cs-workflow/cmd_attachment.go`
- Modify: `server/cmd/cs-workflow/main.go`
- Modify: `server/cmd/cs-workflow/cmd_issue_test.go` (if any attachment-only test remains after Task 5)

- [ ] **Step 1: Delete the command file**

```bash
git rm server/cmd/cs-workflow/cmd_attachment.go
```

- [ ] **Step 2: Remove its registration from main.go**

In `server/cmd/cs-workflow/main.go` delete:
- The line `attachmentCmd.GroupID = groupAdditional` (~62).
- The line `rootCmd.AddCommand(attachmentCmd)` (~85).

- [ ] **Step 3: Remove any leftover attachment test**

Grep the cs-workflow test files for `attachment`/`AttachmentResponse`/`DownloadFile` and remove tests that exercised the deleted command. (The `UploadFile`/`DownloadFile` methods on `APIClient` in `server/internal/cli/client.go` are methods on a shared type — Go does not flag unused methods, so leave them; they are out of scope and may be used elsewhere.)

Run: `cd server && go build ./cmd/cs-workflow/... && go test ./cmd/cs-workflow/`
Expected: build OK, tests PASS.

- [ ] **Step 4: Commit**

```bash
git add server/cmd/cs-workflow/main.go server/cmd/cs-workflow/cmd_issue_test.go
git commit -m "refactor(cli): remove attachment command from cs-workflow

Co-Authored-By: Claude <noreply@anthropic.com>"
```

(`git rm` already staged the deletion.)

---

## Task 7: Remove cs-cloud daemon `workflow issue/*` + `deliverable submit` (cs-cloud repo)

**Repo:** `e:\Projects\cs-cloud`
**Files:**
- Delete: `internal/cli/workflow_issue.go`, `internal/cli/gitea.go`, `internal/cli/gitea_test.go`
- Modify: `internal/cli/workflow.go`, `internal/cli/workflow_test.go`

- [ ] **Step 1: Delete the dead files**

```bash
cd e:/Projects/cs-cloud
git rm internal/cli/workflow_issue.go internal/cli/gitea.go internal/cli/gitea_test.go
```

- [ ] **Step 2: Edit the dispatcher**

In `internal/cli/workflow.go`:
- In the `workflowCmd` switch (~lines 20-36), delete the two cases:
  - `case "issue":` + `return workflowIssueCmd(a, args[1:])` (~23-24)
  - `case "deliverable":` + `return deliverableCmd(a, args[1:])` (~27-28)
- In `printWorkflowUsage` (~43-49), delete the two `cmds` entries:
  - `{"issue", "List/create/update issues"},` (~45)
  - `{"deliverable", "Submit/fetch document deliverables"},` (~47)
- Keep `workspace` and `project`. Do NOT touch the `workflowrunner` import (still used by `workflowProjectList`).

- [ ] **Step 3: Fix the usage test**

In `internal/cli/workflow_test.go`, `TestPrintWorkflowUsageListsImplementedResources` (~25-50), the assertion at ~44-46 checks for `"deliverable:"`. Change it to assert the remaining resources are present and the removed ones are absent:

```go
	if !strings.Contains(out, "workspace:") {
		t.Fatalf("workflow usage missing workspace resource:\n%s", out)
	}
	if !strings.Contains(out, "project:") {
		t.Fatalf("workflow usage missing project resource:\n%s", out)
	}
	if strings.Contains(out, "issue:") {
		t.Fatalf("workflow usage should not list removed issue resource:\n%s", out)
	}
	if strings.Contains(out, "deliverable:") {
		t.Fatalf("workflow usage should not list removed deliverable resource:\n%s", out)
	}
```

- [ ] **Step 4: Build + test**

Run: `cd e:/Projects/cs-cloud && go build ./... && go test ./internal/cli/`
Expected: build OK, tests PASS.

- [ ] **Step 5: Commit**

```bash
cd e:/Projects/cs-cloud
git add internal/cli/workflow.go internal/cli/workflow_test.go
git commit -m "refactor(cli): remove dead workflow issue and deliverable submit

These duplicated cs-workflow (multica) and the issue family hit routes that
no longer exist. cs-workflow is the sole agent surface now.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: Remove dead client methods / protocol constants / models (cs-cloud repo)

**Repo:** `e:\Projects\cs-cloud`
**Files:**
- Modify: `internal/workflowrunner/client.go`, `internal/workflow/protocol.go`, `internal/workflow/models.go`
- Check: `internal/workflow/models_test.go`

- [ ] **Step 1: Delete the three client methods**

In `internal/workflowrunner/client.go` delete `CreateIssueComment` (~175-179), `ListIssueComments` (~181-189), `GetAttachment` (~191-197). Cross-check confirmed these have no callers outside the files deleted in Task 7.

- [ ] **Step 2: Delete the two protocol constants**

In `internal/workflow/protocol.go` delete `MulticaIssueCommentsEndpoint` (~20) and `MulticaAttachmentEndpoint` (~23). Mind the `const (...)` grouping — leave valid syntax (no dangling comma).

- [ ] **Step 3: Delete the two model structs**

In `internal/workflow/models.go` delete the `Comment` struct (~159-165) and the `Attachment` struct (~167-173). Open `internal/workflow/models_test.go`; if it asserts fields of `Comment` or `Attachment`, delete those assertions/tests.

- [ ] **Step 4: Build + test**

Run: `cd e:/Projects/cs-cloud && go build ./... && go test ./...`
Expected: build OK, all tests PASS, no remaining references.

- [ ] **Step 5: Commit**

```bash
cd e:/Projects/cs-cloud
git add internal/workflowrunner/client.go internal/workflow/protocol.go internal/workflow/models.go internal/workflow/models_test.go
git commit -m "refactor: remove dead comment/attachment client surface

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9: Full verification

- [ ] **Step 1: multica checks**

Run:
```bash
cd e:/Projects/multica && make test      # Go tests
cd e:/Projects/multica && pnpm typecheck # if any TS touches (none expected)
```
Expected: green.

- [ ] **Step 2: cs-cloud checks**

Run:
```bash
cd e:/Projects/cs-cloud && go build ./... && go test ./...
```
Expected: green.

- [ ] **Step 3: `make check` (multica, only if requested)**

Per CLAUDE.md run `make check` only when the user asks. If asked, ensure green.

- [ ] **Step 4: Manual smoke (optional, if a local stack is up)**

- `cs-workflow issue workflow <root-issue> --descendants` prints the chain.
- `cs-workflow issue deliverables <root-issue> --descendants` prints repo addresses.
- `cs-workflow issue comment …` and `cs-workflow attachment …` → `unknown command`.
- In the cs-cloud repo: `cs-cloud workflow issue …` and `cs-cloud workflow deliverable …` → unknown command / usage without those resources.

---

## Notes / Deferred

- **`display_status`** is not included in the workflow-tree node summary (it is a derived field computed in the canvas-summary handler). The raw `status` + `failure_reason` are included; the agent can infer progress. Adding `display_status` would require extracting the canvas derivation — deferred (YAGNI).
- **Shared descendant-target helper** (spec Part 6): the new handler intentionally inlines the ~12-line target loop (mirroring `HandleGetIssueGiteaDeliverables`) rather than refactoring the existing tested endpoint. The duplication is small and localized; extracting a helper is a safe future cleanup but is not required for correctness.
- **`UploadFile` / `UploadFileWithURL` / `DownloadFile`** in `server/internal/cli/client.go` are kept (shared package methods; not flagged unused by Go; may be used by other consumers).
