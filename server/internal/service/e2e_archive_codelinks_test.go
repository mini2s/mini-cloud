//go:build e2eauth

// e2eauth-tagged test: runs the changed code against the REAL local Gitea +
// multica dev DB. Asserts the new code-deliverable flow: code-MR links are
// archived DIRECTLY to the inst branch (no node→inst PR for code), while a
// document upload opens its own single node→inst PR. The two stay independent —
// code never creates or shares a PR.
//
//	DATABASE_URL="postgres://root@localhost:5432/multica?sslmode=disable" \
//	GITEA_ADMIN_TOKEN=... GITEA_PUBLIC_BASE_URL=http://localhost:23000 \
//	go test -tags=e2eauth -run TestE2ECodeAuditOnInstAndDocPR -v ./internal/service/
package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/multica-ai/multica/server/internal/gitea"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestE2ECodeAuditOnInstAndDocPR(t *testing.T) {
	if os.Getenv("DATABASE_URL") == "" {
		t.Skip("DATABASE_URL not set")
	}
	giteaBase := os.Getenv("GITEA_PUBLIC_BASE_URL")
	if giteaBase == "" {
		giteaBase = "http://localhost:23000"
	}
	token := os.Getenv("GITEA_ADMIN_TOKEN")
	if token == "" {
		t.Skip("GITEA_ADMIN_TOKEN not set")
	}
	if os.Getenv("GITEA_BASE_URL") == "" {
		os.Setenv("GITEA_BASE_URL", giteaBase) // for isArchiveGiteaURL host match
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		t.Fatalf("connect db: %v", err)
	}
	defer pool.Close()

	// node-run 0d443a30 in a Gitea-provisioned workspace (77d05c12);
	// inst-2257356c + node/01-0d443a30 already exist on Gitea.
	const (
		nodeRunID  = "0d443a30-4f6e-449c-b60c-9bb465f1907d"
		issueID    = "9db598a7-1d52-4ab5-a757-1b1e4afbac1e"
		memberUser = "ac5cef3e-9fc3-4df0-a168-a498cc497dff"
		owner      = "t-77d05c12"
		repo       = "wf-deliverable-archive"
		headBranch = "node/01-0d443a30"
		baseBranch = "inst-2257356c"
		fakeMR     = "https://gitlab.example.com/g/p/-/merge_requests/9999"
	)
	nrUUID, _ := util.ParseUUID(nodeRunID)
	var docDelivID string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM multica_workflow_node_run_deliverable WHERE workflow_node_run_id=$1 LIMIT 1`, nodeRunID).Scan(&docDelivID); err != nil {
		t.Fatalf("find runtime deliverable: %v", err)
	}

	// UploadMemberDeliverable requires the node-run in worker phase. Temporarily
	// move 0d443a30 into 'working', restore the original status on exit.
	var origStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM multica_workflow_node_run WHERE id=$1`, nodeRunID).Scan(&origStatus); err != nil {
		t.Fatalf("read node-run status: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE multica_workflow_node_run SET status='working' WHERE id=$1`, nodeRunID); err != nil {
		t.Fatalf("set working: %v", err)
	}
	defer pool.Exec(ctx, `UPDATE multica_workflow_node_run SET status=$1 WHERE id=$2`, origStatus, nodeRunID)

	// Reset: drop prior submissions, seed one external code-MR link.
	if _, err := pool.Exec(ctx, `DELETE FROM multica_workflow_node_deliverable_submission WHERE workflow_node_run_id=$1`, nodeRunID); err != nil {
		t.Fatalf("clean submissions: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO multica_workflow_node_deliverable_submission (workflow_node_run_id, deliverable_id, submitted_by_type, status, content, pull_request_url) VALUES ($1,$2,'agent','submitted','code body',$3)`, nodeRunID, docDelivID, fakeMR); err != nil {
		t.Fatalf("seed code submission: %v", err)
	}
	defer pool.Exec(ctx, `DELETE FROM multica_workflow_node_deliverable_submission WHERE workflow_node_run_id=$1`, nodeRunID)

	svc := &WorkflowService{Queries: db.New(pool), Gitea: gitea.NewClient(gitea.Config{BaseURL: giteaBase, Token: token})}

	countPRs := func() int {
		u := fmt.Sprintf("%s/api/v1/repos/%s/%s/pulls?state=open", giteaBase, owner, repo)
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
		req.Header.Set("Authorization", "token "+token)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("list PRs: %v", err)
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		var prs []struct {
			Head struct {
				Ref string `json:"ref"`
			} `json:"head"`
			Base struct {
				Ref string `json:"ref"`
			} `json:"base"`
		}
		if err := json.Unmarshal(body, &prs); err != nil {
			t.Fatalf("parse PRs: %v body=%s", err, string(body))
		}
		n := 0
		for _, p := range prs {
			if p.Head.Ref == headBranch && p.Base.Ref == baseBranch {
				n++
			}
		}
		return n
	}

	before := countPRs()
	t.Logf("before: %d open PR(s) for %s→%s", before, headBranch, baseBranch)

	// STEP 1 — code-links archive goes DIRECTLY to inst (no PR opened for code).
	svc.archiveCodeLinksToInst(ctx, nrUUID)
	afterCode := countPRs()
	t.Logf("after code archive: %d open PR(s) (code must not open a PR)", afterCode)
	if afterCode != before {
		t.Errorf("code archive must NOT open a PR; PRs went %d→%d", before, afterCode)
	}

	// STEP 2 — document upload via the member path opens the node→inst PR.
	issue, err := svc.Queries.GetIssue(ctx, util.MustParseUUID(issueID))
	if err != nil {
		t.Fatalf("get issue: %v", err)
	}
	doc := []MemberDeliverableFile{{Name: "e2e.txt", Content: base64.StdEncoding.EncodeToString([]byte("e2e doc content"))}}
	if err := svc.UploadMemberDeliverable(ctx, issue, doc, docDelivID, memberUser, "e2e summary"); err != nil {
		t.Fatalf("upload document: %v", err)
	}
	afterDoc := countPRs()
	t.Logf("after doc upload: %d open PR(s)", afterDoc)

	// Expectation: the document upload opens exactly one PR; code never added one.
	if afterDoc != before+1 {
		t.Errorf("want doc upload to open exactly 1 PR (%d→%d), got %d", before, before+1, afterDoc)
	}

	// Verify the code-links audit landed on the INST branch.
	mdPath := "nodes/01-Deliverable-0d443a30/" + url.PathEscape("代码合并请求.md")
	mdU := fmt.Sprintf("%s/api/v1/repos/%s/%s/contents/%s?ref=%s", giteaBase, owner, repo, mdPath, baseBranch)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, mdU, nil)
	req.Header.Set("Authorization", "token "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("get .md on inst: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Errorf("代码合并请求.md on inst %s status=%d, want 200", baseBranch, resp.StatusCode)
	} else {
		t.Logf("代码合并请求.md present on inst %s ✓", baseBranch)
	}
}
