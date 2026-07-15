package handler

import (
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// TestTaskToResponseSessionID guards that the csc/Claude session id is
// serialized onto the UI-facing task response. The execution-log "View in
// CoStrict" deep-link depends on this field being present once the daemon has
// reported a session; it must be omitted (empty) until then. taskToResponse is
// pure, so this needs no database.
func TestTaskToResponseSessionID(t *testing.T) {
	t.Run("present when set", func(t *testing.T) {
		task := db.MulticaAgentTaskQueue{
			SessionID: pgtype.Text{String: "sess-abc-123", Valid: true},
			WorkDir:   pgtype.Text{String: "/home/user/project", Valid: true},
		}
		resp := taskToResponse(task)
		if resp.SessionID != "sess-abc-123" {
			t.Fatalf("expected SessionID %q, got %q", "sess-abc-123", resp.SessionID)
		}
		if resp.WorkDir != "/home/user/project" {
			t.Fatalf("expected WorkDir %q, got %q", "/home/user/project", resp.WorkDir)
		}
	})

	t.Run("empty when unset", func(t *testing.T) {
		task := db.MulticaAgentTaskQueue{
			SessionID: pgtype.Text{Valid: false},
		}
		resp := taskToResponse(task)
		if resp.SessionID != "" {
			t.Fatalf("expected empty SessionID, got %q", resp.SessionID)
		}
	})
}

func TestTaskToResponseWorkflowPhaseFromContext(t *testing.T) {
	task := db.MulticaAgentTaskQueue{
		Context: []byte(`{"type":"workflow","phase":"split","node_run_id":"node-run-1"}`),
	}

	resp := taskToResponse(task)
	if resp.WorkflowPhase != "split" {
		t.Fatalf("expected WorkflowPhase %q, got %q", "split", resp.WorkflowPhase)
	}
}

func TestTaskToResponseSplitChatContext(t *testing.T) {
	task := db.MulticaAgentTaskQueue{
		Context: []byte(`{
			"type": "workflow",
			"phase": "split_chat",
			"chat_session_id": "chat-1",
			"parent_issue_id": "parent-1",
			"parent_issue_title": "Build a game",
			"parent_issue_description": "Use web technology",
			"current_drafts": [{"id":"draft-1","title":"Large task","draft_key":"large-task"}]
		}`),
	}

	resp := taskToResponse(task)

	if resp.WorkflowPhase != "split_chat" {
		t.Fatalf("expected WorkflowPhase %q, got %q", "split_chat", resp.WorkflowPhase)
	}
	if resp.ChatSessionID != "chat-1" {
		t.Fatalf("expected ChatSessionID from split_chat context, got %q", resp.ChatSessionID)
	}
	if resp.WorkflowSplitParentIssueID != "parent-1" {
		t.Fatalf("expected parent issue ID from split_chat context, got %q", resp.WorkflowSplitParentIssueID)
	}
	if resp.WorkflowSplitParentIssueTitle != "Build a game" {
		t.Fatalf("expected parent issue title from split_chat context, got %q", resp.WorkflowSplitParentIssueTitle)
	}
	if string(resp.WorkflowSplitCurrentDrafts) == "" {
		t.Fatal("expected current drafts to be surfaced on response")
	}
}
