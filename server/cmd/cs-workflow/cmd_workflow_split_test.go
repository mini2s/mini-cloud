package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/spf13/cobra"
)

func newWorkflowSplitDraftAddTestCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "add <node-run-id>", Args: exactArgs(1), RunE: runWorkflowSplitDraftAdd}
	cmd.PersistentFlags().String("server-url", "", "")
	cmd.PersistentFlags().String("workspace-id", "", "")
	cmd.PersistentFlags().String("profile", "", "")
	registerWorkflowSplitDraftAddFlags(cmd)
	return cmd
}

func newWorkflowSplitDraftSubmitTestCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "submit <node-run-id>", Args: exactArgs(1), RunE: runWorkflowSplitDraftSubmit}
	cmd.PersistentFlags().String("server-url", "", "")
	cmd.PersistentFlags().String("workspace-id", "", "")
	cmd.PersistentFlags().String("profile", "", "")
	return cmd
}

func TestRunWorkflowSplitDraftAddPostsPayload(t *testing.T) {
	var gotPath, gotMethod, gotWorkspace, gotAgent, gotTask string
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotWorkspace = r.Header.Get("X-Workspace-ID")
		gotAgent = r.Header.Get("X-Agent-ID")
		gotTask = r.Header.Get("X-Task-ID")
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"tasks": []any{}})
	}))
	defer srv.Close()

	t.Setenv("MULTICA_SERVER_URL", srv.URL)
	t.Setenv("MULTICA_WORKSPACE_ID", "ws-1")
	t.Setenv("MULTICA_AGENT_ID", "agent-1")
	t.Setenv("MULTICA_TASK_ID", "task-1")

	cmd := newWorkflowSplitDraftAddTestCmd()
	if err := cmd.Flags().Set("key", "html-shell"); err != nil {
		t.Fatal(err)
	}
	if err := cmd.Flags().Set("title", "HTML shell"); err != nil {
		t.Fatal(err)
	}
	if err := cmd.Flags().Set("description", "Create the shell"); err != nil {
		t.Fatal(err)
	}
	if err := cmd.Flags().Set("assignee", "agent:00000000-0000-0000-0000-000000000001"); err != nil {
		t.Fatal(err)
	}
	if err := cmd.Flags().Set("depends-on", "setup"); err != nil {
		t.Fatal(err)
	}

	if err := runWorkflowSplitDraftAdd(cmd, []string{"node-run-1"}); err != nil {
		t.Fatalf("runWorkflowSplitDraftAdd() error = %v", err)
	}

	if gotMethod != http.MethodPost {
		t.Fatalf("method = %s, want POST", gotMethod)
	}
	if gotPath != "/api/node-runs/node-run-1/split/draft-tasks" {
		t.Fatalf("path = %s", gotPath)
	}
	if gotWorkspace != "ws-1" || gotAgent != "agent-1" || gotTask != "task-1" {
		t.Fatalf("headers workspace/agent/task = %q/%q/%q", gotWorkspace, gotAgent, gotTask)
	}
	if gotBody["key"] != "html-shell" || gotBody["title"] != "HTML shell" || gotBody["description"] != "Create the shell" {
		t.Fatalf("unexpected body: %+v", gotBody)
	}
	if gotBody["suggested_assignee_type"] != "agent" || gotBody["suggested_assignee_id"] != "00000000-0000-0000-0000-000000000001" {
		t.Fatalf("unexpected assignee body: %+v", gotBody)
	}
	deps, ok := gotBody["depends_on_keys"].([]any)
	if !ok || len(deps) != 1 || deps[0] != "setup" {
		t.Fatalf("depends_on_keys = %#v", gotBody["depends_on_keys"])
	}
}

func TestRunWorkflowSplitDraftSubmitPostsToSubmitEndpoint(t *testing.T) {
	var gotPath, gotTask string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotTask = r.Header.Get("X-Task-ID")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"tasks": []any{}})
	}))
	defer srv.Close()

	t.Setenv("MULTICA_SERVER_URL", srv.URL)
	t.Setenv("MULTICA_WORKSPACE_ID", "ws-1")
	t.Setenv("MULTICA_AGENT_ID", "agent-1")
	t.Setenv("MULTICA_TASK_ID", "task-1")

	cmd := newWorkflowSplitDraftSubmitTestCmd()
	if err := runWorkflowSplitDraftSubmit(cmd, []string{"node-run-1"}); err != nil {
		t.Fatalf("runWorkflowSplitDraftSubmit() error = %v", err)
	}

	if gotPath != "/api/node-runs/node-run-1/split/draft-submit" {
		t.Fatalf("path = %s", gotPath)
	}
	if gotTask != "task-1" {
		t.Fatalf("X-Task-ID = %q", gotTask)
	}
}
