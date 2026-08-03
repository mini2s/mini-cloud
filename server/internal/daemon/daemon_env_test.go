package daemon

import (
	"strings"
	"testing"
)

// TestBuildAgentEnv_GiteaContext pins the repository plumbing: when a task
// carries document deliverable git-storage context, the env map handed to the
// spawned agent CLI must surface provider-neutral MULTICA_REPO_* vars plus the
// legacy MULTICA_GITEA_* aliases.
func TestBuildAgentEnv_GiteaContext(t *testing.T) {
	t.Parallel()

	task := Task{
		ID:                "task-1",
		WorkspaceID:       "ws-1",
		WorkflowNodeRunID: "nr-1",
		GiteaDeliverables: &GiteaDeliverableContext{
			Owner:      "t-aaa",
			Repo:       "wf-bbb",
			InstBranch: "inst-cccc",
			NodeBranch: "node/dddd",
			Deliverables: []GiteaDeliverableRef{
				{ID: "d1", Title: "Doc", Path: "nodes/dddd/d1.md"},
			},
		},
	}
	d := newTestDaemon(t)
	env := d.buildAgentEnv(task, "agent-name", "7")

	if env["MULTICA_NODE_RUN_ID"] != "nr-1" {
		t.Errorf("MULTICA_NODE_RUN_ID = %q, want nr-1", env["MULTICA_NODE_RUN_ID"])
	}
	if env["MULTICA_REPO_PROVIDER"] != "gitea" {
		t.Errorf("MULTICA_REPO_PROVIDER = %q", env["MULTICA_REPO_PROVIDER"])
	}
	if env["MULTICA_REPO_OWNER"] != "t-aaa" {
		t.Errorf("MULTICA_REPO_OWNER = %q", env["MULTICA_REPO_OWNER"])
	}
	if env["MULTICA_REPO_NAME"] != "wf-bbb" {
		t.Errorf("MULTICA_REPO_NAME = %q", env["MULTICA_REPO_NAME"])
	}
	if env["MULTICA_REPO_INST_BRANCH"] != "inst-cccc" {
		t.Errorf("MULTICA_REPO_INST_BRANCH = %q", env["MULTICA_REPO_INST_BRANCH"])
	}
	if env["MULTICA_REPO_NODE_BRANCH"] != "node/dddd" {
		t.Errorf("MULTICA_REPO_NODE_BRANCH = %q", env["MULTICA_REPO_NODE_BRANCH"])
	}
	if env["MULTICA_REPO_DELIVERABLES"] == "" {
		t.Error("MULTICA_REPO_DELIVERABLES not set")
	}
	if env["MULTICA_GITEA_OWNER"] != "t-aaa" {
		t.Errorf("MULTICA_GITEA_OWNER = %q", env["MULTICA_GITEA_OWNER"])
	}
	if env["MULTICA_GITEA_REPO"] != "wf-bbb" {
		t.Errorf("MULTICA_GITEA_REPO = %q", env["MULTICA_GITEA_REPO"])
	}
	if env["MULTICA_GITEA_INST_BRANCH"] != "inst-cccc" {
		t.Errorf("MULTICA_GITEA_INST_BRANCH = %q", env["MULTICA_GITEA_INST_BRANCH"])
	}
	if env["MULTICA_GITEA_NODE_BRANCH"] != "node/dddd" {
		t.Errorf("MULTICA_GITEA_NODE_BRANCH = %q", env["MULTICA_GITEA_NODE_BRANCH"])
	}
	if env["MULTICA_GITEA_DELIVERABLES"] == "" {
		t.Error("MULTICA_GITEA_DELIVERABLES not set")
	}
	// spot-check it's valid JSON with the expected ref
	if !strings.Contains(env["MULTICA_GITEA_DELIVERABLES"], `"deliverable_id":"d1"`) {
		t.Errorf("MULTICA_GITEA_DELIVERABLES = %q, want JSON containing deliverable_id d1", env["MULTICA_GITEA_DELIVERABLES"])
	}
	// baseline keys still present
	if env["MULTICA_TASK_ID"] != "task-1" || env["MULTICA_WORKSPACE_ID"] != "ws-1" {
		t.Errorf("baseline env missing: %+v", env)
	}
	// pin the slot-string contract: buildAgentEnv receives the slot as a
	// pre-stringified value and must pass it through unchanged. A future
	// refactor that drops strconv.Itoa at the call site breaks this.
	if env["MULTICA_TASK_SLOT"] != "7" {
		t.Errorf("MULTICA_TASK_SLOT = %q, want 7", env["MULTICA_TASK_SLOT"])
	}
}

// TestBuildAgentEnv_OmitsGiteaWhenAbsent ensures repository + node-run env vars
// stay absent for tasks that have no document deliverable context.
func TestBuildAgentEnv_OmitsGiteaWhenAbsent(t *testing.T) {
	t.Parallel()

	d := newTestDaemon(t)
	env := d.buildAgentEnv(Task{ID: "t", WorkspaceID: "ws"}, "agent-name", "1")
	for _, k := range []string{
		"MULTICA_GITEA_OWNER",
		"MULTICA_GITEA_REPO",
		"MULTICA_GITEA_INST_BRANCH",
		"MULTICA_GITEA_NODE_BRANCH",
		"MULTICA_GITEA_DELIVERABLES",
		"MULTICA_REPO_PROVIDER",
		"MULTICA_REPO_OWNER",
		"MULTICA_REPO_NAME",
		"MULTICA_REPO_INST_BRANCH",
		"MULTICA_REPO_NODE_BRANCH",
		"MULTICA_REPO_DELIVERABLES",
		"MULTICA_NODE_RUN_ID",
	} {
		if _, ok := env[k]; ok {
			t.Errorf("Gitea env %q must be absent when task has no GiteaDeliverables / node-run", k)
		}
	}
}
