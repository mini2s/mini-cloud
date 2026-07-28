package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/handler"
	"github.com/multica-ai/multica/server/internal/integration"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// integrationListenerTest helpers — reuse the integration test fixtures from
// TestMain (testPool, testUserID, testWorkspaceID are set in
// integration_test.go) and the createTestIssue/createTestUser helpers from
// subscriber_listeners_test.go.

// newIntegrationBus starts a capture receiver for the outbound endpoint,
// wires a Notifier + listener onto a fresh bus, and returns the bus plus the
// channel of received envelopes.
func newIntegrationBus(t *testing.T) (*events.Bus, chan integration.Envelope) {
	t.Helper()
	received := make(chan integration.Envelope, 10)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Multica-Signature") == "" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var env integration.Envelope
		if err := json.NewDecoder(r.Body).Decode(&env); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		received <- env
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)

	notifier := integration.NewNotifier(srv.URL, "test-secret")
	notifier.Run(context.Background())

	bus := events.New()
	registerIntegrationListener(bus, db.New(testPool), notifier, "https://app.example.com")
	return bus, received
}

// publishIntegrationStatusChanged publishes the same event shape the
// UpdateIssue handler and the workflow sync path emit for a status transition.
func publishIntegrationStatusChanged(bus *events.Bus, issue handler.IssueResponse, prevStatus string) {
	bus.Publish(events.Event{
		Type:        protocol.EventIssueUpdated,
		WorkspaceID: issue.WorkspaceID,
		ActorType:   "system",
		ActorID:     "",
		Payload: map[string]any{
			"issue":          issue,
			"status_changed": true,
			"prev_status":    prevStatus,
		},
	})
}

// awaitEnvelope fails the test when no envelope arrives within the timeout.
func awaitEnvelope(t *testing.T, received chan integration.Envelope) integration.Envelope {
	t.Helper()
	select {
	case env := <-received:
		return env
	case <-time.After(3 * time.Second):
		t.Fatal("no envelope delivered within timeout")
		return integration.Envelope{}
	}
}

// expectNoEnvelope fails the test when an envelope arrives within the window.
func expectNoEnvelope(t *testing.T, received chan integration.Envelope) {
	t.Helper()
	select {
	case env := <-received:
		t.Fatalf("unexpected envelope delivered: %+v", env)
	case <-time.After(500 * time.Millisecond):
	}
}

// issueResponseFor builds the payload issue shape from a DB-created issue.
func issueResponseFor(issueID, description string) handler.IssueResponse {
	return handler.IssueResponse{
		ID:          issueID,
		WorkspaceID: testWorkspaceID,
		Identifier:  "MUL-999",
		Title:       "integration listener test",
		Description: &description,
		Status:      "done",
		CreatorType: "member",
		CreatorID:   testUserID,
	}
}

func TestIntegrationListenerPushesStatusChangeToMentionedMember(t *testing.T) {
	bus, received := newIntegrationBus(t)

	// Unique email per run: users are never cleaned up, and a fixed email
	// would collide on the second run of the suite.
	mentionedEmail := fmt.Sprintf("mentioned-%d@example.com", time.Now().UnixNano())
	mentionedID := createTestUser(t, mentionedEmail)
	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	defer cleanupTestIssue(t, issueID)

	desc := fmt.Sprintf("please take a look [@Mentioned](mention://member/%s)", mentionedID)
	publishIntegrationStatusChanged(bus, issueResponseFor(issueID, desc), "in_progress")

	env := awaitEnvelope(t, received)
	if env.Type != integration.EventIssueStatusChanged {
		t.Fatalf("envelope type = %q", env.Type)
	}
	if len(env.Recipients) != 1 || env.Recipients[0] != mentionedEmail {
		t.Fatalf("recipients = %v, want [%s]", env.Recipients, mentionedEmail)
	}
	if env.Issue.Identifier != "MUL-999" || env.Issue.PrevStatus != "in_progress" || env.Issue.Status != "done" {
		t.Fatalf("unexpected issue payload: %+v", env.Issue)
	}
	wantURL := "https://app.example.com/" + integrationTestWorkspaceSlug + "/issues/MUL-999"
	if env.Issue.URL != wantURL {
		t.Fatalf("issue url = %q, want %q", env.Issue.URL, wantURL)
	}
	if env.Actor.Type != "system" {
		t.Fatalf("actor type = %q", env.Actor.Type)
	}
}

func TestIntegrationListenerFallsBackToCreatorWhenOnlyAgentMentioned(t *testing.T) {
	bus, received := newIntegrationBus(t)

	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	defer cleanupTestIssue(t, issueID)

	// An agent mention is not a human recipient — fall back to the creator
	// (testUserID, whose email is integrationTestEmail).
	desc := "[@Bot](mention://agent/33333333-3333-3333-3333-333333333333)"
	publishIntegrationStatusChanged(bus, issueResponseFor(issueID, desc), "todo")

	env := awaitEnvelope(t, received)
	if len(env.Recipients) != 1 || env.Recipients[0] != integrationTestEmail {
		t.Fatalf("recipients = %v, want [%s]", env.Recipients, integrationTestEmail)
	}
}

func TestIntegrationListenerCollectsMentionsFromComments(t *testing.T) {
	bus, received := newIntegrationBus(t)

	commenterEmail := fmt.Sprintf("commenter-%d@example.com", time.Now().UnixNano())
	commenterID := createTestUser(t, commenterEmail)
	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	defer cleanupTestIssue(t, issueID)

	// No mentions in the description; one member mention in a comment.
	if _, err := testPool.Exec(context.Background(), `
		INSERT INTO multica_comment (issue_id, workspace_id, author_type, author_id, content, type)
		VALUES ($1, $2, 'member', $3, $4, 'comment')
	`, issueID, testWorkspaceID, testUserID,
		fmt.Sprintf("cc [@Commenter](mention://member/%s)", commenterID)); err != nil {
		t.Fatalf("insert comment: %v", err)
	}

	publishIntegrationStatusChanged(bus, issueResponseFor(issueID, "plain description"), "in_review")

	env := awaitEnvelope(t, received)
	if len(env.Recipients) != 1 || env.Recipients[0] != commenterEmail {
		t.Fatalf("recipients = %v, want [%s]", env.Recipients, commenterEmail)
	}
}

func TestIntegrationListenerSkipsNonStatusEvents(t *testing.T) {
	bus, received := newIntegrationBus(t)

	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	defer cleanupTestIssue(t, issueID)

	// A plain issue:updated without status_changed must not trigger the bridge.
	bus.Publish(events.Event{
		Type:        protocol.EventIssueUpdated,
		WorkspaceID: testWorkspaceID,
		ActorType:   "member",
		ActorID:     testUserID,
		Payload:     map[string]any{"issue": issueResponseFor(issueID, "plain")},
	})

	expectNoEnvelope(t, received)
}
