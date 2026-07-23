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
