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
	registerWorkflowSplitDraftSubmitFlags(cmd)
	return cmd
}

func newWorkflowSplitDraftDeleteTestCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "delete <node-run-id> <draft-task-id>", Args: exactArgs(2), RunE: runWorkflowSplitDraftDelete}
	cmd.PersistentFlags().String("server-url", "", "")
	cmd.PersistentFlags().String("workspace-id", "", "")
	cmd.PersistentFlags().String("profile", "", "")
	return cmd
}

func TestRunWorkflowSplitDraftAddPostsBatchPayload(t *testing.T) {
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
	if err := cmd.Flags().Set("depends-on", "setup"); err != nil {
		t.Fatal(err)
	}

	if err := runWorkflowSplitDraftAdd(cmd, []string{"node-run-1"}); err != nil {
		t.Fatalf("runWorkflowSplitDraftAdd() error = %v", err)
	}

	if gotMethod != http.MethodPost {
		t.Fatalf("method = %s, want POST", gotMethod)
	}
	if gotPath != "/api/node-runs/node-run-1/split/draft-tasks/batch" {
		t.Fatalf("path = %s", gotPath)
	}
	if gotWorkspace != "ws-1" || gotAgent != "agent-1" || gotTask != "task-1" {
		t.Fatalf("headers workspace/agent/task = %q/%q/%q", gotWorkspace, gotAgent, gotTask)
	}
	tasks, ok := gotBody["tasks"].([]any)
	if !ok || len(tasks) != 1 {
		t.Fatalf("tasks = %#v", gotBody["tasks"])
	}
	task, ok := tasks[0].(map[string]any)
	if !ok {
		t.Fatalf("task = %#v", tasks[0])
	}
	if task["draft_key"] != "html-shell" || task["title"] != "HTML shell" || task["description"] != "Create the shell" {
		t.Fatalf("unexpected task body: %+v", task)
	}
	if _, ok := task["suggested_assignee_type"]; ok {
		t.Fatalf("unexpected suggested_assignee_type: %+v", task)
	}
	if _, ok := task["suggested_assignee_id"]; ok {
		t.Fatalf("unexpected suggested_assignee_id: %+v", task)
	}
	deps, ok := task["depends_on"].([]any)
	if !ok || len(deps) != 1 || deps[0] != "setup" {
		t.Fatalf("depends_on = %#v", task["depends_on"])
	}
}

func TestRunWorkflowSplitDraftAddOmitsSuggestedAssigneeFields(t *testing.T) {
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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

	if err := runWorkflowSplitDraftAdd(cmd, []string{"node-run-1"}); err != nil {
		t.Fatalf("runWorkflowSplitDraftAdd() error = %v", err)
	}

	tasks, ok := gotBody["tasks"].([]any)
	if !ok || len(tasks) != 1 {
		t.Fatalf("tasks = %#v", gotBody["tasks"])
	}
	task, ok := tasks[0].(map[string]any)
	if !ok {
		t.Fatalf("task = %#v", tasks[0])
	}
	if _, ok := task["suggested_assignee_type"]; ok {
		t.Fatalf("unexpected suggested_assignee_type when omitted: %+v", task)
	}
	if _, ok := task["suggested_assignee_id"]; ok {
		t.Fatalf("unexpected suggested_assignee_id when omitted: %+v", task)
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

func TestRunWorkflowSplitDraftSubmitAcceptsOutputJSON(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"tasks": []any{}})
	}))
	defer srv.Close()

	t.Setenv("MULTICA_SERVER_URL", srv.URL)
	t.Setenv("MULTICA_WORKSPACE_ID", "ws-1")
	t.Setenv("MULTICA_AGENT_ID", "agent-1")
	t.Setenv("MULTICA_TASK_ID", "task-1")

	cmd := newWorkflowSplitDraftSubmitTestCmd()
	if err := cmd.Flags().Set("output", "json"); err != nil {
		t.Fatalf("set output flag: %v", err)
	}
	if err := runWorkflowSplitDraftSubmit(cmd, []string{"node-run-1"}); err != nil {
		t.Fatalf("runWorkflowSplitDraftSubmit() error = %v", err)
	}
	if gotPath != "/api/node-runs/node-run-1/split/draft-submit" {
		t.Fatalf("path = %s", gotPath)
	}
}

func TestRunWorkflowSplitDraftDeleteDeletesDraftTask(t *testing.T) {
	var gotPath, gotMethod, gotTask string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotTask = r.Header.Get("X-Task-ID")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"status": "ok"})
	}))
	defer srv.Close()

	t.Setenv("MULTICA_SERVER_URL", srv.URL)
	t.Setenv("MULTICA_WORKSPACE_ID", "ws-1")
	t.Setenv("MULTICA_AGENT_ID", "agent-1")
	t.Setenv("MULTICA_TASK_ID", "task-1")

	cmd := newWorkflowSplitDraftDeleteTestCmd()
	if err := runWorkflowSplitDraftDelete(cmd, []string{"node-run-1", "draft-task-1"}); err != nil {
		t.Fatalf("runWorkflowSplitDraftDelete() error = %v", err)
	}

	if gotMethod != http.MethodDelete {
		t.Fatalf("method = %s, want DELETE", gotMethod)
	}
	if gotPath != "/api/node-runs/node-run-1/split/draft-tasks/draft-task-1" {
		t.Fatalf("path = %s", gotPath)
	}
	if gotTask != "task-1" {
		t.Fatalf("X-Task-ID = %q", gotTask)
	}
}
