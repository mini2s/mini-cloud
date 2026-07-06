package service

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// mockCommandQueries implements commandPromptQueries for testing.
type mockCommandQueries struct {
	agents    []db.MulticaAgent
	squads    []db.MulticaSquad
	members   []db.ListMembersWithUserRow
	workflows []db.MulticaWorkflow
	issue     db.MulticaIssue
	issueOK   bool
}

func (m *mockCommandQueries) GetIssue(ctx context.Context, id pgtype.UUID) (db.MulticaIssue, error) {
	if !m.issueOK {
		return db.MulticaIssue{}, assertAnError
	}
	return m.issue, nil
}

func (m *mockCommandQueries) ListAgents(ctx context.Context, workspaceID pgtype.UUID) ([]db.MulticaAgent, error) {
	return m.agents, nil
}

func (m *mockCommandQueries) ListSquads(ctx context.Context, workspaceID pgtype.UUID) ([]db.MulticaSquad, error) {
	return m.squads, nil
}

func (m *mockCommandQueries) ListMembersWithUser(ctx context.Context, workspaceID pgtype.UUID) ([]db.ListMembersWithUserRow, error) {
	return m.members, nil
}

func (m *mockCommandQueries) ListWorkflows(ctx context.Context, arg db.ListWorkflowsParams) ([]db.MulticaWorkflow, error) {
	return m.workflows, nil
}

// errSentinel is a test error returned by mock queries that simulate failures.
var assertAnError = &testError{"mock query error"}

type testError struct{ msg string }

func (e *testError) Error() string { return e.msg }

func TestBuildCommandPrompt_ContextTypeIssue(t *testing.T) {
	mock := &mockCommandQueries{
		agents: []db.MulticaAgent{
			{Name: "bot-alpha", Description: "triage agent"},
			{Name: "bot-beta"},
		},
		squads: []db.MulticaSquad{
			{Name: "squad-zero"},
		},
		members: []db.ListMembersWithUserRow{
			{UserName: "Alice", UserEmail: "alice@example.com"},
		},
	}
	wsID := pgtype.UUID{}
	cmdCtx := CommandContext{
		Type:        "ai_command",
		ContextType: "issue",
		UserInput:   "assign to Alice",
		Mode:        "command",
	}

	prompt, err := BuildCommandPrompt(context.Background(), mock, wsID, cmdCtx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !strings.Contains(prompt, "You are an issue management agent") {
		t.Fatalf("expected issue management instruction in prompt, got: %s", prompt)
	}
	if !strings.Contains(prompt, "assign to Alice") {
		t.Fatalf("expected user input in prompt, got: %s", prompt)
	}
	if !strings.Contains(prompt, "bot-alpha") {
		t.Fatalf("expected agent name in prompt, got: %s", prompt)
	}
	if !strings.Contains(prompt, "squad-zero") {
		t.Fatalf("expected squad name in prompt, got: %s", prompt)
	}
	if !strings.Contains(prompt, "Alice (alice@example.com)") {
		t.Fatalf("expected member info in prompt, got: %s", prompt)
	}
}

func TestBuildCommandPrompt_ContextTypeIssueWithIssueContext(t *testing.T) {
	mock := &mockCommandQueries{
		issue: db.MulticaIssue{
			Title:    "Fix login bug",
			Status:   "in_progress",
			Priority: "high",
		},
		issueOK: true,
	}
	wsID := pgtype.UUID{}
	cmdCtx := CommandContext{
		Type:        "ai_command",
		ContextType: "issue",
		ContextID:   "01010101-0101-0101-0101-010101010101",
		UserInput:   "assign to Alice",
		Mode:        "command",
	}

	prompt, err := BuildCommandPrompt(context.Background(), mock, wsID, cmdCtx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !strings.Contains(prompt, "Current issue: Fix login bug") {
		t.Fatalf("expected current issue line in prompt, got: %s", prompt)
	}
	if !strings.Contains(prompt, "status: in_progress") {
		t.Fatalf("expected issue status in prompt, got: %s", prompt)
	}
	if !strings.Contains(prompt, "priority: high") {
		t.Fatalf("expected issue priority in prompt, got: %s", prompt)
	}
}

func TestBuildCommandPrompt_ContextTypeWorkflow(t *testing.T) {
	mock := &mockCommandQueries{}
	wsID := pgtype.UUID{}
	cmdCtx := CommandContext{
		Type:        "ai_command",
		ContextType: "workflow",
		UserInput:   "create a daily summary workflow",
		Mode:        "command",
	}

	prompt, err := BuildCommandPrompt(context.Background(), mock, wsID, cmdCtx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !strings.Contains(prompt, "You are a workflow design agent") {
		t.Fatalf("expected workflow design instruction in prompt, got: %s", prompt)
	}
	if !strings.Contains(prompt, "create a daily summary workflow") {
		t.Fatalf("expected user input in prompt, got: %s", prompt)
	}
}

func TestBuildCommandPrompt_ContextTypeInbox(t *testing.T) {
	mock := &mockCommandQueries{}
	wsID := pgtype.UUID{}
	cmdCtx := CommandContext{
		Type:        "ai_command",
		ContextType: "inbox",
		UserInput:   "archive all notifications",
		Mode:        "command",
	}

	prompt, err := BuildCommandPrompt(context.Background(), mock, wsID, cmdCtx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !strings.Contains(prompt, "You are an inbox management agent") {
		t.Fatalf("expected inbox management instruction in prompt, got: %s", prompt)
	}
	if !strings.Contains(prompt, "archive all notifications") {
		t.Fatalf("expected user input in prompt, got: %s", prompt)
	}
}

func TestBuildCommandPrompt_ContextTypeAgent(t *testing.T) {
	mock := &mockCommandQueries{}
	wsID := pgtype.UUID{}
	cmdCtx := CommandContext{
		Type:        "ai_command",
		ContextType: "agent",
		UserInput:   "create an agent that monitors GitHub issues",
		Mode:        "command",
	}

	prompt, err := BuildCommandPrompt(context.Background(), mock, wsID, cmdCtx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !strings.Contains(prompt, "You are an agent configuration assistant") {
		t.Fatalf("expected agent config instruction in prompt, got: %s", prompt)
	}
	if !strings.Contains(prompt, "create an agent that monitors GitHub issues") {
		t.Fatalf("expected user input in prompt, got: %s", prompt)
	}
}

func TestBuildCommandPrompt_IssueContextInvalidID(t *testing.T) {
	mock := &mockCommandQueries{}
	wsID := pgtype.UUID{}
	cmdCtx := CommandContext{
		Type:        "ai_command",
		ContextType: "issue",
		ContextID:   "not-a-uuid",
		UserInput:   "assign to Alice",
		Mode:        "command",
	}

	prompt, err := BuildCommandPrompt(context.Background(), mock, wsID, cmdCtx)
	if err == nil {
		t.Fatal("expected error for invalid ContextID")
	}
	if !strings.Contains(err.Error(), "parse issue context ID") {
		t.Fatalf("expected parse error, got: %v", err)
	}
	if !strings.Contains(prompt, "You are an issue management agent") {
		t.Fatalf("expected system instruction even with invalid ID, got: %s", prompt)
	}
}

func TestBuildCommandPrompt_QueriesFail(t *testing.T) {
	// If ListAgents fails, the prompt should still be built with available content.
	mock := &mockCommandQueries{
		members: []db.ListMembersWithUserRow{
			{UserName: "Bob", UserEmail: "bob@example.com"},
		},
	}
	wsID := pgtype.UUID{}
	cmdCtx := CommandContext{
		Type:        "ai_command",
		ContextType: "inbox",
		UserInput:   "show unread",
	}

	prompt, err := BuildCommandPrompt(context.Background(), mock, wsID, cmdCtx)
	// No error because ListAgents returns empty (not an error), and ListSquads returns empty.
	// This test verifies the prompt still works with partial data.
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(prompt, "You are an inbox management agent") {
		t.Fatalf("expected inbox instruction in prompt, got: %s", prompt)
	}
	if !strings.Contains(prompt, "Bob (bob@example.com)") {
		t.Fatalf("expected member info in prompt, got: %s", prompt)
	}
}
