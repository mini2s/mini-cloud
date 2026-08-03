package main

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/handler"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// notificationTest helpers — reuse the integration test fixtures from TestMain
// (testPool, testUserID, testWorkspaceID are set in integration_test.go).

// inboxItemsForRecipient returns all non-archived inbox items for a given recipient.
func inboxItemsForRecipient(t *testing.T, queries *db.Queries, recipientID string) []db.ListInboxItemsRow {
	t.Helper()
	items, err := queries.ListInboxItems(context.Background(), db.ListInboxItemsParams{
		WorkspaceID:   util.MustParseUUID(testWorkspaceID),
		RecipientType: "member",
		RecipientID:   util.MustParseUUID(recipientID),
	})
	if err != nil {
		t.Fatalf("ListInboxItems: %v", err)
	}
	return items
}

// cleanupInboxForIssue deletes all inbox items related to a given issue.
func cleanupInboxForIssue(t *testing.T, issueID string) {
	t.Helper()
	testPool.Exec(context.Background(), `DELETE FROM multica_inbox_item WHERE issue_id = $1`, issueID)
}

func createTestMember(t *testing.T, workspaceID, userID string) string {
	t.Helper()
	ctx := context.Background()
	var memberID string
	err := testPool.QueryRow(ctx, `
		INSERT INTO multica_member (workspace_id, user_id, role)
		VALUES ($1, $2, 'member')
		RETURNING id
	`, workspaceID, userID).Scan(&memberID)
	if err != nil {
		t.Fatalf("createTestMember: %v", err)
	}
	return memberID
}

func hasInboxType(items []db.ListInboxItemsRow, itemType string) bool {
	for _, item := range items {
		if item.Type == itemType {
			return true
		}
	}
	return false
}

func muteNotificationGroup(t *testing.T, queries *db.Queries, userID, group string) {
	t.Helper()
	preferences, err := json.Marshal(map[string]string{group: "muted"})
	if err != nil {
		t.Fatalf("marshal notification preferences: %v", err)
	}
	_, err = queries.UpsertNotificationPreference(context.Background(), db.UpsertNotificationPreferenceParams{
		WorkspaceID: util.MustParseUUID(testWorkspaceID),
		UserID:      util.MustParseUUID(userID),
		Preferences: preferences,
	})
	if err != nil {
		t.Fatalf("UpsertNotificationPreference: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM multica_notification_preference WHERE workspace_id = $1 AND user_id = $2`, testWorkspaceID, userID)
	})
}

// addTestSubscriber manually inserts a subscriber for an issue.
func addTestSubscriber(t *testing.T, issueID, userType, userID, reason string) {
	t.Helper()
	_, err := testPool.Exec(context.Background(), `
		INSERT INTO multica_issue_subscriber (issue_id, user_type, user_id, reason)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (issue_id, user_type, user_id) DO NOTHING
	`, issueID, userType, userID, reason)
	if err != nil {
		t.Fatalf("addTestSubscriber: %v", err)
	}
}

// createTestSubIssue inserts an issue with parent_issue_id set and returns its UUID.
// Picks the next per-workspace number to avoid colliding with the
// uq_issue_workspace_number unique constraint (parent + sub created in the
// same test would otherwise both default to number=0).
func createTestSubIssue(t *testing.T, workspaceID, creatorID, parentIssueID string) string {
	t.Helper()
	ctx := context.Background()
	var issueID string
	err := testPool.QueryRow(ctx, `
		INSERT INTO multica_issue (workspace_id, title, status, priority, creator_type, creator_id, position, parent_issue_id, number)
		VALUES ($1, 'sub-issue test', 'todo', 'medium', 'member', $2, 0, $3,
		        (SELECT COALESCE(MAX(number), 0) + 1 FROM multica_issue WHERE workspace_id = $1))
		RETURNING id
	`, workspaceID, creatorID, parentIssueID).Scan(&issueID)
	if err != nil {
		t.Fatalf("createTestSubIssue: %v", err)
	}
	return issueID
}

// newNotificationBus creates a bus with subscriber + notification listeners registered.
func newNotificationBus(t *testing.T, queries *db.Queries) *events.Bus {
	t.Helper()
	bus := events.New()
	registerSubscriberListeners(bus, queries)
	registerNotificationListeners(bus, queries)
	return bus
}

// TestNotification_IssueCreated_AssigneeNotified verifies that when an issue is
// created with an assignee different from the creator, the assignee receives an
// "issue_assigned" inbox notification and the creator receives nothing.
func TestNotification_IssueCreated_AssigneeNotified(t *testing.T) {
	queries := db.New(testPool)
	bus := newNotificationBus(t, queries)

	assigneeEmail := "notif-assignee-created@multica.ai"
	assigneeID := createTestUser(t, assigneeEmail)
	t.Cleanup(func() { cleanupTestUser(t, assigneeEmail) })

	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		cleanupInboxForIssue(t, issueID)
		cleanupTestIssue(t, issueID)
	})

	// Track inbox:new events
	var inboxEvents []events.Event
	bus.Subscribe(protocol.EventInboxNew, func(e events.Event) {
		inboxEvents = append(inboxEvents, e)
	})

	assigneeType := "member"
	bus.Publish(events.Event{
		Type:        protocol.EventIssueCreated,
		WorkspaceID: testWorkspaceID,
		ActorType:   "member",
		ActorID:     testUserID,
		Payload: map[string]any{
			"issue": handler.IssueResponse{
				ID:           issueID,
				WorkspaceID:  testWorkspaceID,
				Title:        "notif test issue",
				Status:       "todo",
				Priority:     "medium",
				CreatorType:  "member",
				CreatorID:    testUserID,
				AssigneeType: &assigneeType,
				AssigneeID:   &assigneeID,
			},
		},
	})

	// Assignee should have an inbox item
	items := inboxItemsForRecipient(t, queries, assigneeID)
	if len(items) != 1 {
		t.Fatalf("expected 1 inbox item for assignee, got %d", len(items))
	}
	if items[0].Type != "issue_assigned" {
		t.Fatalf("expected type 'issue_assigned', got %q", items[0].Type)
	}
	if items[0].Severity != "action_required" {
		t.Fatalf("expected severity 'action_required', got %q", items[0].Severity)
	}

	// Creator (actor) should NOT have any inbox items
	creatorItems := inboxItemsForRecipient(t, queries, testUserID)
	if len(creatorItems) != 0 {
		t.Fatalf("expected 0 inbox items for creator, got %d", len(creatorItems))
	}

	// At least one inbox:new event should have been published
	if len(inboxEvents) < 1 {
		t.Fatal("expected at least 1 inbox:new event")
	}
}

func TestNotification_IssueCreated_ResponsibleAndAssigneeFromMapPayload(t *testing.T) {
	queries := db.New(testPool)
	bus := newNotificationBus(t, queries)

	responsibleEmail := "notif-map-responsible@multica.ai"
	responsibleID := createTestUser(t, responsibleEmail)
	t.Cleanup(func() { cleanupTestUser(t, responsibleEmail) })

	assigneeEmail := "notif-map-assignee@multica.ai"
	assigneeID := createTestUser(t, assigneeEmail)
	t.Cleanup(func() { cleanupTestUser(t, assigneeEmail) })

	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		cleanupInboxForIssue(t, issueID)
		cleanupTestIssue(t, issueID)
	})

	assigneeType := "member"
	bus.Publish(events.Event{
		Type:        protocol.EventIssueCreated,
		WorkspaceID: testWorkspaceID,
		ActorType:   "member",
		ActorID:     testUserID,
		Payload: map[string]any{
			"issue": map[string]any{
				"id":                  issueID,
				"workspace_id":        testWorkspaceID,
				"title":               "map payload issue",
				"status":              "todo",
				"priority":            "medium",
				"creator_type":        "member",
				"creator_id":          testUserID,
				"responsible_user_id": &responsibleID,
				"assignee_type":       &assigneeType,
				"assignee_id":         &assigneeID,
			},
		},
	})

	responsibleItems := inboxItemsForRecipient(t, queries, responsibleID)
	if len(responsibleItems) != 1 {
		t.Fatalf("expected 1 inbox item for responsible user, got %d", len(responsibleItems))
	}
	if responsibleItems[0].Type != "responsible_assigned" {
		t.Fatalf("expected type 'responsible_assigned', got %q", responsibleItems[0].Type)
	}

	assigneeItems := inboxItemsForRecipient(t, queries, assigneeID)
	if len(assigneeItems) != 1 {
		t.Fatalf("expected 1 inbox item for assignee, got %d", len(assigneeItems))
	}
	if assigneeItems[0].Type != "issue_assigned" {
		t.Fatalf("expected type 'issue_assigned', got %q", assigneeItems[0].Type)
	}
}

func TestNotification_IssueCreated_SelfResponsibleStillNotified(t *testing.T) {
	queries := db.New(testPool)
	bus := newNotificationBus(t, queries)

	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		cleanupInboxForIssue(t, issueID)
		cleanupTestIssue(t, issueID)
	})

	bus.Publish(events.Event{
		Type:        protocol.EventIssueCreated,
		WorkspaceID: testWorkspaceID,
		ActorType:   "member",
		ActorID:     testUserID,
		Payload: map[string]any{
			"issue": handler.IssueResponse{
				ID:                issueID,
				WorkspaceID:       testWorkspaceID,
				Title:             "self responsible issue",
				Status:            "todo",
				Priority:          "medium",
				CreatorType:       "member",
				CreatorID:         testUserID,
				ResponsibleUserID: &testUserID,
			},
		},
	})

	items := inboxItemsForRecipient(t, queries, testUserID)
	if len(items) != 1 {
		t.Fatalf("expected 1 inbox item for self responsible assignment, got %d", len(items))
	}
	if items[0].Type != "responsible_assigned" {
		t.Fatalf("expected type 'responsible_assigned', got %q", items[0].Type)
	}
}

func TestNotification_IssueCreated_ResponsibleAndAssigneeMutedSeparately(t *testing.T) {
	queries := db.New(testPool)
	bus := newNotificationBus(t, queries)

	responsibleEmail := "notif-muted-responsible@multica.ai"
	responsibleID := createTestUser(t, responsibleEmail)
	t.Cleanup(func() { cleanupTestUser(t, responsibleEmail) })
	muteNotificationGroup(t, queries, responsibleID, "responsible_changes")

	assigneeEmail := "notif-muted-assignee@multica.ai"
	assigneeID := createTestUser(t, assigneeEmail)
	t.Cleanup(func() { cleanupTestUser(t, assigneeEmail) })
	muteNotificationGroup(t, queries, assigneeID, "assignments")

	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		cleanupInboxForIssue(t, issueID)
		cleanupTestIssue(t, issueID)
	})

	assigneeType := "member"
	bus.Publish(events.Event{
		Type:        protocol.EventIssueCreated,
		WorkspaceID: testWorkspaceID,
		ActorType:   "member",
		ActorID:     testUserID,
		Payload: map[string]any{
			"issue": handler.IssueResponse{
				ID:                issueID,
				WorkspaceID:       testWorkspaceID,
				Title:             "muted assignment issue",
				Status:            "todo",
				Priority:          "medium",
				CreatorType:       "member",
				CreatorID:         testUserID,
				ResponsibleUserID: &responsibleID,
				AssigneeType:      &assigneeType,
				AssigneeID:        &assigneeID,
			},
		},
	})

	if items := inboxItemsForRecipient(t, queries, responsibleID); len(items) != 0 {
		t.Fatalf("expected responsible assignment to be muted, got %#v", items)
	}
	if items := inboxItemsForRecipient(t, queries, assigneeID); len(items) != 0 {
		t.Fatalf("expected assignee assignment to be muted, got %#v", items)
	}
}

// TestNotification_IssueCreated_SelfAssign verifies that assignment signals
// still land in the inbox when the creator assigns the issue to themselves.
func TestNotification_IssueCreated_SelfAssign(t *testing.T) {
	queries := db.New(testPool)
	bus := newNotificationBus(t, queries)

	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		cleanupInboxForIssue(t, issueID)
		cleanupTestIssue(t, issueID)
	})

	var inboxEvents []events.Event
	bus.Subscribe(protocol.EventInboxNew, func(e events.Event) {
		inboxEvents = append(inboxEvents, e)
	})

	assigneeType := "member"
	assigneeID := testUserID // self-assign
	bus.Publish(events.Event{
		Type:        protocol.EventIssueCreated,
		WorkspaceID: testWorkspaceID,
		ActorType:   "member",
		ActorID:     testUserID,
		Payload: map[string]any{
			"issue": handler.IssueResponse{
				ID:           issueID,
				WorkspaceID:  testWorkspaceID,
				Title:        "self-assign issue",
				Status:       "todo",
				Priority:     "medium",
				CreatorType:  "member",
				CreatorID:    testUserID,
				AssigneeType: &assigneeType,
				AssigneeID:   &assigneeID,
			},
		},
	})

	items := inboxItemsForRecipient(t, queries, testUserID)
	if len(items) != 1 {
		t.Fatalf("expected 1 inbox item for self-assign, got %d", len(items))
	}
	if items[0].Type != "issue_assigned" {
		t.Fatalf("expected type 'issue_assigned', got %q", items[0].Type)
	}
	if len(inboxEvents) != 1 {
		t.Fatalf("expected 1 inbox:new event for self-assign, got %d", len(inboxEvents))
	}
}

// TestNotification_IssueCreated_NoAssignee verifies that when an issue is
// created without an assignee, no notifications are generated.
func TestNotification_IssueCreated_NoAssignee(t *testing.T) {
	queries := db.New(testPool)
	bus := newNotificationBus(t, queries)

	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		cleanupInboxForIssue(t, issueID)
		cleanupTestIssue(t, issueID)
	})

	var inboxEvents []events.Event
	bus.Subscribe(protocol.EventInboxNew, func(e events.Event) {
		inboxEvents = append(inboxEvents, e)
	})

	bus.Publish(events.Event{
		Type:        protocol.EventIssueCreated,
		WorkspaceID: testWorkspaceID,
		ActorType:   "member",
		ActorID:     testUserID,
		Payload: map[string]any{
			"issue": handler.IssueResponse{
				ID:          issueID,
				WorkspaceID: testWorkspaceID,
				Title:       "no assignee issue",
				Status:      "todo",
				Priority:    "medium",
				CreatorType: "member",
				CreatorID:   testUserID,
			},
		},
	})

	items := inboxItemsForRecipient(t, queries, testUserID)
	if len(items) != 0 {
		t.Fatalf("expected 0 inbox items for no-assignee issue, got %d", len(items))
	}
	if len(inboxEvents) != 0 {
		t.Fatalf("expected 0 inbox:new events, got %d", len(inboxEvents))
	}
}

// TestNotification_StatusChanged verifies that all subscribers receive a
// "status_changed" notification when an issue status changes, including the
// actor when they are subscribed.
func TestNotification_StatusChanged(t *testing.T) {
	queries := db.New(testPool)
	bus := newNotificationBus(t, queries)

	// Create two extra users as subscribers
	sub1Email := "notif-sub1-status@multica.ai"
	sub1ID := createTestUser(t, sub1Email)
	t.Cleanup(func() { cleanupTestUser(t, sub1Email) })

	sub2Email := "notif-sub2-status@multica.ai"
	sub2ID := createTestUser(t, sub2Email)
	t.Cleanup(func() { cleanupTestUser(t, sub2Email) })

	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		cleanupInboxForIssue(t, issueID)
		cleanupTestIssue(t, issueID)
	})

	// Manually add subscribers before the event fires
	addTestSubscriber(t, issueID, "member", testUserID, "creator")
	addTestSubscriber(t, issueID, "member", sub1ID, "assignee")
	addTestSubscriber(t, issueID, "member", sub2ID, "commenter")

	bus.Publish(events.Event{
		Type:        protocol.EventIssueUpdated,
		WorkspaceID: testWorkspaceID,
		ActorType:   "member",
		ActorID:     testUserID, // actor is the creator
		Payload: map[string]any{
			"issue": handler.IssueResponse{
				ID:          issueID,
				WorkspaceID: testWorkspaceID,
				Title:       "status test issue",
				Status:      "in_progress",
				Priority:    "medium",
				CreatorType: "member",
				CreatorID:   testUserID,
			},
			"assignee_changed": false,
			"status_changed":   true,
			"prev_status":      "todo",
		},
	})

	// Actor (testUserID) is subscribed and should get a notification too.
	actorItems := inboxItemsForRecipient(t, queries, testUserID)
	if len(actorItems) != 1 {
		t.Fatalf("expected 1 inbox item for actor, got %d", len(actorItems))
	}
	if actorItems[0].Type != "status_changed" {
		t.Fatalf("expected type 'status_changed', got %q", actorItems[0].Type)
	}

	// sub1 should get a status_changed notification
	sub1Items := inboxItemsForRecipient(t, queries, sub1ID)
	if len(sub1Items) != 1 {
		t.Fatalf("expected 1 inbox item for sub1, got %d", len(sub1Items))
	}
	if sub1Items[0].Type != "status_changed" {
		t.Fatalf("expected type 'status_changed', got %q", sub1Items[0].Type)
	}
	if sub1Items[0].Severity != "info" {
		t.Fatalf("expected severity 'info', got %q", sub1Items[0].Severity)
	}
	// Title is now just the issue title; details contain from/to
	expectedTitle := "status test issue"
	if sub1Items[0].Title != expectedTitle {
		t.Fatalf("expected title %q, got %q", expectedTitle, sub1Items[0].Title)
	}

	// sub2 should also get a status_changed notification
	sub2Items := inboxItemsForRecipient(t, queries, sub2ID)
	if len(sub2Items) != 1 {
		t.Fatalf("expected 1 inbox item for sub2, got %d", len(sub2Items))
	}
	if sub2Items[0].Type != "status_changed" {
		t.Fatalf("expected type 'status_changed', got %q", sub2Items[0].Type)
	}
}

// TestNotification_CommentCreated verifies that all subscribers receive a
// "new_comment" notification, including the commenter when they are subscribed.
func TestNotification_CommentCreated(t *testing.T) {
	queries := db.New(testPool)
	bus := newNotificationBus(t, queries)

	commenterEmail := "notif-commenter@multica.ai"
	commenterID := createTestUser(t, commenterEmail)
	t.Cleanup(func() { cleanupTestUser(t, commenterEmail) })

	sub1Email := "notif-sub1-comment@multica.ai"
	sub1ID := createTestUser(t, sub1Email)
	t.Cleanup(func() { cleanupTestUser(t, sub1Email) })

	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		cleanupInboxForIssue(t, issueID)
		cleanupTestIssue(t, issueID)
	})

	// Pre-add subscribers: creator and sub1. The commenter will also be added
	// by subscriber_listeners when the event fires.
	addTestSubscriber(t, issueID, "member", testUserID, "creator")
	addTestSubscriber(t, issueID, "member", sub1ID, "assignee")

	bus.Publish(events.Event{
		Type:        protocol.EventCommentCreated,
		WorkspaceID: testWorkspaceID,
		ActorType:   "member",
		ActorID:     commenterID, // commenter is the actor
		Payload: map[string]any{
			"comment": handler.CommentResponse{
				ID:         "00000000-0000-0000-0000-000000000000",
				IssueID:    issueID,
				AuthorType: "member",
				AuthorID:   commenterID,
				Content:    "test comment content",
				Type:       "comment",
			},
			"issue_title":  "comment test issue",
			"issue_status": "todo",
		},
	})

	// Creator should get a new_comment notification
	creatorItems := inboxItemsForRecipient(t, queries, testUserID)
	if len(creatorItems) != 1 {
		t.Fatalf("expected 1 inbox item for creator, got %d", len(creatorItems))
	}
	if creatorItems[0].Type != "new_comment" {
		t.Fatalf("expected type 'new_comment', got %q", creatorItems[0].Type)
	}
	if creatorItems[0].Severity != "info" {
		t.Fatalf("expected severity 'info', got %q", creatorItems[0].Severity)
	}

	// sub1 should also get a new_comment notification
	sub1Items := inboxItemsForRecipient(t, queries, sub1ID)
	if len(sub1Items) != 1 {
		t.Fatalf("expected 1 inbox item for sub1, got %d", len(sub1Items))
	}
	if sub1Items[0].Type != "new_comment" {
		t.Fatalf("expected type 'new_comment', got %q", sub1Items[0].Type)
	}

	// Commenter (actor) is subscribed and should get a notification too.
	commenterItems := inboxItemsForRecipient(t, queries, commenterID)
	if len(commenterItems) != 1 {
		t.Fatalf("expected 1 inbox item for commenter, got %d", len(commenterItems))
	}
	if commenterItems[0].Type != "new_comment" {
		t.Fatalf("expected type 'new_comment', got %q", commenterItems[0].Type)
	}
}

// TestNotification_SystemCommentSkipsInboxAndMentions guards the MUL-2538
// must-fix: a comment with author_type='system' (the platform-generated
// child-done parent notify) must NOT create any inbox rows for parent
// subscribers and must NOT spawn mention-inbox rows even if the body string
// contains markdown mentions. The reviewer's concern was that a child title
// containing `mention://member/<uuid>` would silently light up that member's
// inbox once the title was transcluded into the system comment body —
// because the generic comment:created listener treated all comments
// identically. The fix is to gate at author_type='system'.
func TestNotification_SystemCommentSkipsInboxAndMentions(t *testing.T) {
	queries := db.New(testPool)
	bus := newNotificationBus(t, queries)

	// Subscriber on the issue who would normally receive new_comment.
	subEmail := "notif-system-comment-sub@multica.ai"
	subID := createTestUser(t, subEmail)
	t.Cleanup(func() { cleanupTestUser(t, subEmail) })

	// A second member whose UUID we will smuggle into the system-comment
	// body as a fake mention to prove the listener does not parse it.
	targetEmail := "notif-system-comment-target@multica.ai"
	targetID := createTestUser(t, targetEmail)
	t.Cleanup(func() { cleanupTestUser(t, targetEmail) })

	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		cleanupInboxForIssue(t, issueID)
		cleanupTestIssue(t, issueID)
	})

	addTestSubscriber(t, issueID, "member", subID, "manual")

	// Publish a system-authored comment that transcludes a member mention
	// in the body — the exact attack vector the reviewer flagged. If the
	// generic listener path runs, the new_comment row will fire for `sub`
	// and the mention path will fire for `target`.
	bus.Publish(events.Event{
		Type:        protocol.EventCommentCreated,
		WorkspaceID: testWorkspaceID,
		ActorType:   "system",
		ActorID:     "",
		Payload: map[string]any{
			"comment": handler.CommentResponse{
				ID:         "00000000-0000-0000-0000-000000000000",
				IssueID:    issueID,
				AuthorType: "system",
				AuthorID:   "00000000-0000-0000-0000-000000000000",
				Content:    "Sub-issue done — see [@Target](mention://member/" + targetID + ").",
				Type:       "system",
			},
			"issue_title":  "system comment isolation",
			"issue_status": "in_progress",
		},
	})

	if items := inboxItemsForRecipient(t, queries, subID); len(items) != 0 {
		t.Errorf("expected 0 inbox rows for issue subscriber, got %d", len(items))
	}
	if items := inboxItemsForRecipient(t, queries, targetID); len(items) != 0 {
		t.Errorf("expected 0 inbox rows for smuggled @mention target, got %d", len(items))
	}
}

// TestSubscriberSystemCommentDoesNotSubscribe guards the same boundary on
// the subscriber listener: a system-authored comment must NOT be treated as
// "a commenter joined the conversation." The CHECK constraint on
// issue_subscriber.user_type only permits ('member','agent'); without the
// author_type='system' early-return, AddIssueSubscriber would log a noisy
// constraint violation on every child-done event.
func TestSubscriberSystemCommentDoesNotSubscribe(t *testing.T) {
	queries := db.New(testPool)
	bus := events.New()
	registerSubscriberListeners(bus, queries)

	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() { cleanupTestIssue(t, issueID) })

	bus.Publish(events.Event{
		Type:        protocol.EventCommentCreated,
		WorkspaceID: testWorkspaceID,
		ActorType:   "system",
		ActorID:     "",
		Payload: map[string]any{
			"comment": handler.CommentResponse{
				ID:         "00000000-0000-0000-0000-000000000000",
				IssueID:    issueID,
				AuthorType: "system",
				AuthorID:   "00000000-0000-0000-0000-000000000000",
				Content:    "platform notify",
				Type:       "system",
			},
		},
	})

	if count := subscriberCount(t, queries, issueID); count != 0 {
		t.Fatalf("expected 0 subscribers after system comment, got %d", count)
	}
}

// TestNotification_AssigneeChanged verifies the full assignee change flow:
//   - New assignee gets "issue_assigned" (Direct)
//   - Old assignee gets "unassigned" (Direct)
//   - Other subscribers get "assignee_changed" (Subscriber), including the actor
//     when they are subscribed, while old + new assignees are deduplicated
//   - Actor gets nothing
func TestNotification_AssigneeChanged(t *testing.T) {
	queries := db.New(testPool)
	bus := newNotificationBus(t, queries)

	oldAssigneeEmail := "notif-old-assignee@multica.ai"
	oldAssigneeID := createTestUser(t, oldAssigneeEmail)
	t.Cleanup(func() { cleanupTestUser(t, oldAssigneeEmail) })

	newAssigneeEmail := "notif-new-assignee@multica.ai"
	newAssigneeID := createTestUser(t, newAssigneeEmail)
	t.Cleanup(func() { cleanupTestUser(t, newAssigneeEmail) })

	bystanderEmail := "notif-bystander@multica.ai"
	bystanderID := createTestUser(t, bystanderEmail)
	t.Cleanup(func() { cleanupTestUser(t, bystanderEmail) })

	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		cleanupInboxForIssue(t, issueID)
		cleanupTestIssue(t, issueID)
	})

	// Pre-add subscribers: creator, old assignee, bystander
	addTestSubscriber(t, issueID, "member", testUserID, "creator")
	addTestSubscriber(t, issueID, "member", oldAssigneeID, "assignee")
	addTestSubscriber(t, issueID, "member", bystanderID, "commenter")

	newAssigneeType := "member"
	oldAssigneeType := "member"
	bus.Publish(events.Event{
		Type:        protocol.EventIssueUpdated,
		WorkspaceID: testWorkspaceID,
		ActorType:   "member",
		ActorID:     testUserID, // actor is the creator
		Payload: map[string]any{
			"issue": handler.IssueResponse{
				ID:           issueID,
				WorkspaceID:  testWorkspaceID,
				Title:        "assignee change issue",
				Status:       "todo",
				Priority:     "medium",
				CreatorType:  "member",
				CreatorID:    testUserID,
				AssigneeType: &newAssigneeType,
				AssigneeID:   &newAssigneeID,
			},
			"assignee_changed":   true,
			"status_changed":     false,
			"prev_assignee_type": &oldAssigneeType,
			"prev_assignee_id":   &oldAssigneeID,
		},
	})

	// New assignee should get "issue_assigned"
	newItems := inboxItemsForRecipient(t, queries, newAssigneeID)
	if len(newItems) != 1 {
		t.Fatalf("expected 1 inbox item for new assignee, got %d", len(newItems))
	}
	if newItems[0].Type != "issue_assigned" {
		t.Fatalf("expected type 'issue_assigned', got %q", newItems[0].Type)
	}
	if newItems[0].Severity != "action_required" {
		t.Fatalf("expected severity 'action_required', got %q", newItems[0].Severity)
	}

	// Old assignee should get "unassigned"
	oldItems := inboxItemsForRecipient(t, queries, oldAssigneeID)
	if len(oldItems) != 1 {
		t.Fatalf("expected 1 inbox item for old assignee, got %d", len(oldItems))
	}
	if oldItems[0].Type != "unassigned" {
		t.Fatalf("expected type 'unassigned', got %q", oldItems[0].Type)
	}
	if oldItems[0].Severity != "info" {
		t.Fatalf("expected severity 'info', got %q", oldItems[0].Severity)
	}

	// Bystander should get "assignee_changed"
	bystanderItems := inboxItemsForRecipient(t, queries, bystanderID)
	if len(bystanderItems) != 1 {
		t.Fatalf("expected 1 inbox item for bystander, got %d", len(bystanderItems))
	}
	if bystanderItems[0].Type != "assignee_changed" {
		t.Fatalf("expected type 'assignee_changed', got %q", bystanderItems[0].Type)
	}
	if bystanderItems[0].Severity != "info" {
		t.Fatalf("expected severity 'info', got %q", bystanderItems[0].Severity)
	}

	// Actor (testUserID / creator) is subscribed and should get a notification too.
	actorItems := inboxItemsForRecipient(t, queries, testUserID)
	if len(actorItems) != 1 {
		t.Fatalf("expected 1 inbox item for actor, got %d", len(actorItems))
	}
	if actorItems[0].Type != "assignee_changed" {
		t.Fatalf("expected type 'assignee_changed', got %q", actorItems[0].Type)
	}
}

func TestNotification_WorkflowNodeAssignmentsAndStatusChanges(t *testing.T) {
	queries := db.New(testPool)
	bus := newNotificationBus(t, queries)

	workerEmail := "notif-workflow-worker@multica.ai"
	workerID := createTestUser(t, workerEmail)
	t.Cleanup(func() { cleanupTestUser(t, workerEmail) })
	workerMemberID := createTestMember(t, testWorkspaceID, workerID)

	criticEmail := "notif-workflow-critic@multica.ai"
	criticID := createTestUser(t, criticEmail)
	t.Cleanup(func() { cleanupTestUser(t, criticEmail) })
	criticMemberID := createTestMember(t, testWorkspaceID, criticID)

	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		cleanupInboxForIssue(t, issueID)
		cleanupTestIssue(t, issueID)
	})

	nodeRunID := "00000000-0000-0000-0000-00000000aa01"
	runID := "00000000-0000-0000-0000-00000000aa02"
	workerType := "human"
	criticType := "human"

	bus.Publish(events.Event{
		Type:        protocol.EventWorkflowNodeRunStarted,
		WorkspaceID: testWorkspaceID,
		ActorType:   "system",
		ActorID:     "",
		Payload: map[string]any{
			"node_run": handler.WorkflowNodeRunResponse{
				ID:            nodeRunID,
				WorkflowRunID: runID,
				NodeTitle:     "Implementation",
				Status:        "worker_assigned",
				WorkerType:    workerType,
				WorkerID:      &workerMemberID,
				CriticType:    criticType,
				CriticID:      &criticMemberID,
			},
			"run_id":   runID,
			"issue_id": issueID,
		},
	})

	workerItems := inboxItemsForRecipient(t, queries, workerID)
	if len(workerItems) != 1 {
		t.Fatalf("expected 1 inbox item for workflow worker assignment, got %d", len(workerItems))
	}
	if workerItems[0].Type != "workflow_executor_assigned" {
		t.Fatalf("expected workflow_executor_assigned, got %q", workerItems[0].Type)
	}

	bus.Publish(events.Event{
		Type:        protocol.EventWorkflowNodeRunReviewed,
		WorkspaceID: testWorkspaceID,
		ActorType:   "member",
		ActorID:     testUserID,
		Payload: map[string]any{
			"node_run": handler.WorkflowNodeRunResponse{
				ID:            nodeRunID,
				WorkflowRunID: runID,
				NodeTitle:     "Implementation",
				Status:        "critic_reviewing",
				WorkerType:    workerType,
				WorkerID:      &workerMemberID,
				CriticType:    criticType,
				CriticID:      &criticMemberID,
			},
			"run_id":   runID,
			"issue_id": issueID,
		},
	})

	criticItems := inboxItemsForRecipient(t, queries, criticID)
	if len(criticItems) != 1 {
		t.Fatalf("expected 1 inbox item for workflow reviewer assignment, got %d", len(criticItems))
	}
	if criticItems[0].Type != "workflow_reviewer_assigned" {
		t.Fatalf("expected workflow_reviewer_assigned, got %q", criticItems[0].Type)
	}

	bus.Publish(events.Event{
		Type:        protocol.EventWorkflowNodeRunCompleted,
		WorkspaceID: testWorkspaceID,
		ActorType:   "member",
		ActorID:     testUserID,
		Payload: map[string]any{
			"node_run": handler.WorkflowNodeRunResponse{
				ID:            nodeRunID,
				WorkflowRunID: runID,
				NodeTitle:     "Implementation",
				Status:        "completed",
				WorkerType:    workerType,
				WorkerID:      &workerMemberID,
				CriticType:    criticType,
				CriticID:      &criticMemberID,
			},
			"run_id":      runID,
			"issue_id":    issueID,
			"prev_status": "awaiting_critic",
		},
	})

	workerItems = inboxItemsForRecipient(t, queries, workerID)
	if !hasInboxType(workerItems, "workflow_node_status_changed") {
		t.Fatalf("expected workflow_node_status_changed for worker, got %#v", workerItems)
	}
	criticItems = inboxItemsForRecipient(t, queries, criticID)
	if !hasInboxType(criticItems, "workflow_node_status_changed") {
		t.Fatalf("expected workflow_node_status_changed for critic, got %#v", criticItems)
	}
}

func TestNotification_WorkflowNodePreferencesMuteRolesAndStatusChanges(t *testing.T) {
	queries := db.New(testPool)
	bus := newNotificationBus(t, queries)

	workerEmail := "notif-workflow-muted-worker@multica.ai"
	workerID := createTestUser(t, workerEmail)
	t.Cleanup(func() { cleanupTestUser(t, workerEmail) })
	workerMemberID := createTestMember(t, testWorkspaceID, workerID)
	muteNotificationGroup(t, queries, workerID, "workflow_executor")

	criticEmail := "notif-workflow-muted-critic@multica.ai"
	criticID := createTestUser(t, criticEmail)
	t.Cleanup(func() { cleanupTestUser(t, criticEmail) })
	criticMemberID := createTestMember(t, testWorkspaceID, criticID)
	muteNotificationGroup(t, queries, criticID, "workflow_node_status")

	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		cleanupInboxForIssue(t, issueID)
		cleanupTestIssue(t, issueID)
	})

	nodeRunID := "00000000-0000-0000-0000-00000000ab01"
	runID := "00000000-0000-0000-0000-00000000ab02"
	workerType := "human"
	criticType := "human"

	bus.Publish(events.Event{
		Type:        protocol.EventWorkflowNodeRunStarted,
		WorkspaceID: testWorkspaceID,
		ActorType:   "system",
		ActorID:     "",
		Payload: map[string]any{
			"node_run": handler.WorkflowNodeRunResponse{
				ID:            nodeRunID,
				WorkflowRunID: runID,
				NodeTitle:     "Muted worker role",
				Status:        "worker_assigned",
				WorkerType:    workerType,
				WorkerID:      &workerMemberID,
				CriticType:    criticType,
				CriticID:      &criticMemberID,
			},
			"run_id":   runID,
			"issue_id": issueID,
		},
	})

	workerItems := inboxItemsForRecipient(t, queries, workerID)
	if hasInboxType(workerItems, "workflow_executor_assigned") {
		t.Fatalf("expected workflow role assignment to be muted, got %#v", workerItems)
	}

	bus.Publish(events.Event{
		Type:        protocol.EventWorkflowNodeRunCompleted,
		WorkspaceID: testWorkspaceID,
		ActorType:   "member",
		ActorID:     testUserID,
		Payload: map[string]any{
			"node_run": handler.WorkflowNodeRunResponse{
				ID:            nodeRunID,
				WorkflowRunID: runID,
				NodeTitle:     "Muted critic status",
				Status:        "completed",
				WorkerType:    workerType,
				WorkerID:      &workerMemberID,
				CriticType:    criticType,
				CriticID:      &criticMemberID,
			},
			"run_id":      runID,
			"issue_id":    issueID,
			"prev_status": "running",
		},
	})

	criticItems := inboxItemsForRecipient(t, queries, criticID)
	if hasInboxType(criticItems, "workflow_node_status_changed") {
		t.Fatalf("expected workflow node status change to be muted, got %#v", criticItems)
	}
	workerItems = inboxItemsForRecipient(t, queries, workerID)
	if !hasInboxType(workerItems, "workflow_node_status_changed") {
		t.Fatalf("expected worker to still receive unmuted status changes, got %#v", workerItems)
	}
}

func TestNotification_WorkflowNodeAssignmentWithoutIssueID(t *testing.T) {
	queries := db.New(testPool)
	bus := newNotificationBus(t, queries)

	workerEmail := "notif-workflow-no-issue@multica.ai"
	workerID := createTestUser(t, workerEmail)
	t.Cleanup(func() { cleanupTestUser(t, workerEmail) })
	workerMemberID := createTestMember(t, testWorkspaceID, workerID)
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM multica_inbox_item WHERE workspace_id = $1 AND recipient_id = $2`, testWorkspaceID, workerID)
	})

	nodeRunID := "00000000-0000-0000-0000-00000000ac01"
	runID := "00000000-0000-0000-0000-00000000ac02"
	workerType := "human"

	bus.Publish(events.Event{
		Type:        protocol.EventWorkflowNodeRunStarted,
		WorkspaceID: testWorkspaceID,
		ActorType:   "system",
		ActorID:     "",
		Payload: map[string]any{
			"node_run": handler.WorkflowNodeRunResponse{
				ID:            nodeRunID,
				WorkflowRunID: runID,
				NodeTitle:     "No issue workflow node",
				Status:        "worker_assigned",
				WorkerType:    workerType,
				WorkerID:      &workerMemberID,
			},
			"run_id": runID,
		},
	})

	workerItems := inboxItemsForRecipient(t, queries, workerID)
	if !hasInboxType(workerItems, "workflow_executor_assigned") {
		t.Fatalf("expected workflow assignment without issue_id, got %#v", workerItems)
	}
}

// create inbox notifications (completion is visible from the status change).
func TestNotification_ParentBubble_StatusChanged(t *testing.T) {
	queries := db.New(testPool)
	bus := newNotificationBus(t, queries)

	parentSubEmail := "notif-parent-sub-status@multica.ai"
	parentSubID := createTestUser(t, parentSubEmail)
	t.Cleanup(func() { cleanupTestUser(t, parentSubEmail) })

	parentID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		cleanupInboxForIssue(t, parentID)
		cleanupTestIssue(t, parentID)
	})
	subID := createTestSubIssue(t, testWorkspaceID, testUserID, parentID)
	t.Cleanup(func() {
		cleanupInboxForIssue(t, subID)
		cleanupTestIssue(t, subID)
	})

	// Subscribe a watcher to the parent only — they should hear about
	// status changes on the sub-issue.
	addTestSubscriber(t, parentID, "member", parentSubID, "manual")

	bus.Publish(events.Event{
		Type:        protocol.EventIssueUpdated,
		WorkspaceID: testWorkspaceID,
		ActorType:   "member",
		ActorID:     testUserID,
		Payload: map[string]any{
			"issue": handler.IssueResponse{
				ID:          subID,
				WorkspaceID: testWorkspaceID,
				Title:       "sub-issue status bubble",
				Status:      "done",
				Priority:    "medium",
				CreatorType: "member",
				CreatorID:   testUserID,
			},
			"assignee_changed": false,
			"status_changed":   true,
			"prev_status":      "in_progress",
		},
	})

	items := inboxItemsForRecipient(t, queries, parentSubID)
	if len(items) != 1 {
		t.Fatalf("expected 1 inbox item bubbled to parent subscriber, got %d", len(items))
	}
	if items[0].Type != "status_changed" {
		t.Fatalf("expected type 'status_changed', got %q", items[0].Type)
	}
	// The inbox item should point to the sub-issue, not the parent.
	if util.UUIDToString(items[0].IssueID) != subID {
		t.Fatalf("expected inbox item issue_id=%s (sub-issue), got %s",
			subID, util.UUIDToString(items[0].IssueID))
	}
}

// TestNotification_ParentBubble_NewCommentSuppressed verifies that comments
// on a sub-issue do NOT bubble to subscribers of the parent issue. Comments
// are the loudest signal and we explicitly want to keep them off the parent
// watcher's inbox.
func TestNotification_ParentBubble_NewCommentSuppressed(t *testing.T) {
	queries := db.New(testPool)
	bus := newNotificationBus(t, queries)

	commenterEmail := "notif-parent-bubble-commenter@multica.ai"
	commenterID := createTestUser(t, commenterEmail)
	t.Cleanup(func() { cleanupTestUser(t, commenterEmail) })

	parentSubEmail := "notif-parent-sub-comment@multica.ai"
	parentSubID := createTestUser(t, parentSubEmail)
	t.Cleanup(func() { cleanupTestUser(t, parentSubEmail) })

	parentID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		cleanupInboxForIssue(t, parentID)
		cleanupTestIssue(t, parentID)
	})
	subID := createTestSubIssue(t, testWorkspaceID, testUserID, parentID)
	t.Cleanup(func() {
		cleanupInboxForIssue(t, subID)
		cleanupTestIssue(t, subID)
	})

	addTestSubscriber(t, parentID, "member", parentSubID, "manual")

	bus.Publish(events.Event{
		Type:        protocol.EventCommentCreated,
		WorkspaceID: testWorkspaceID,
		ActorType:   "member",
		ActorID:     commenterID,
		Payload: map[string]any{
			"comment": handler.CommentResponse{
				ID:         "00000000-0000-0000-0000-000000000000",
				IssueID:    subID,
				AuthorType: "member",
				AuthorID:   commenterID,
				Content:    "comment on sub-issue",
				Type:       "comment",
			},
			"issue_title":  "sub-issue comment bubble",
			"issue_status": "todo",
		},
	})

	items := inboxItemsForRecipient(t, queries, parentSubID)
	if len(items) != 0 {
		t.Fatalf("expected 0 inbox items bubbled to parent subscriber for new_comment, got %d", len(items))
	}
}

// priority change on a sub-issue does NOT bubble to parent subscribers.
func publishResponsibleUpdate(bus *events.Bus, issueID, newResponsibleID string, prevResponsibleID *string) {
	issue := handler.IssueResponse{
		ID:          issueID,
		WorkspaceID: testWorkspaceID,
		Title:       "responsible change test",
		Status:      "todo",
		Priority:    "medium",
		CreatorType: "member",
		CreatorID:   testUserID,
	}
	if newResponsibleID != "" {
		issue.ResponsibleUserID = &newResponsibleID
	}
	bus.Publish(events.Event{
		Type:        protocol.EventIssueUpdated,
		WorkspaceID: testWorkspaceID,
		ActorType:   "member",
		ActorID:     testUserID,
		Payload: map[string]any{
			"issue":                    issue,
			"assignee_changed":         false,
			"status_changed":           false,
			"responsible_user_changed": true,
			"prev_responsible_user_id": prevResponsibleID,
		},
	})
}

// TestNotification_IssueUpdated_ResponsibleAssigned verifies that editing an
// issue to set a responsible user (from none) notifies that user with
// "responsible_assigned" (action_required). Covers the UPDATE path; the CREATE
// path is covered by TestNotification_IssueCreated_*.
func TestNotification_IssueUpdated_ResponsibleAssigned(t *testing.T) {
	queries := db.New(testPool)
	bus := newNotificationBus(t, queries)

	responsibleEmail := "notif-update-resp-assigned@multica.ai"
	responsibleID := createTestUser(t, responsibleEmail)
	t.Cleanup(func() { cleanupTestUser(t, responsibleEmail) })

	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		cleanupInboxForIssue(t, issueID)
		cleanupTestIssue(t, issueID)
	})

	publishResponsibleUpdate(bus, issueID, responsibleID, nil)

	items := inboxItemsForRecipient(t, queries, responsibleID)
	if len(items) != 1 {
		t.Fatalf("expected 1 inbox item for responsible user, got %d", len(items))
	}
	if items[0].Type != "responsible_assigned" {
		t.Fatalf("expected type 'responsible_assigned', got %q", items[0].Type)
	}
	if items[0].Severity != "action_required" {
		t.Fatalf("expected severity 'action_required', got %q", items[0].Severity)
	}
}

// TestNotification_IssueUpdated_ResponsibleUnassigned_OnReassign verifies that
// reassigning the responsible user from A to B notifies B with
// "responsible_assigned" and A with "responsible_unassigned" (info).
func TestNotification_IssueUpdated_ResponsibleUnassigned_OnReassign(t *testing.T) {
	queries := db.New(testPool)
	bus := newNotificationBus(t, queries)

	oldResponsibleEmail := "notif-update-old-resp@multica.ai"
	oldResponsibleID := createTestUser(t, oldResponsibleEmail)
	t.Cleanup(func() { cleanupTestUser(t, oldResponsibleEmail) })

	newResponsibleEmail := "notif-update-new-resp@multica.ai"
	newResponsibleID := createTestUser(t, newResponsibleEmail)
	t.Cleanup(func() { cleanupTestUser(t, newResponsibleEmail) })

	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		cleanupInboxForIssue(t, issueID)
		cleanupTestIssue(t, issueID)
	})

	publishResponsibleUpdate(bus, issueID, newResponsibleID, &oldResponsibleID)

	newItems := inboxItemsForRecipient(t, queries, newResponsibleID)
	if len(newItems) != 1 || newItems[0].Type != "responsible_assigned" {
		t.Fatalf("expected 1 responsible_assigned for new responsible, got %#v", newItems)
	}

	oldItems := inboxItemsForRecipient(t, queries, oldResponsibleID)
	if len(oldItems) != 1 {
		t.Fatalf("expected 1 inbox item for old responsible, got %d", len(oldItems))
	}
	if oldItems[0].Type != "responsible_unassigned" {
		t.Fatalf("expected type 'responsible_unassigned', got %q", oldItems[0].Type)
	}
	if oldItems[0].Severity != "info" {
		t.Fatalf("expected severity 'info', got %q", oldItems[0].Severity)
	}
}

// TestNotification_IssueUpdated_ResponsibleUnassigned_OnClear verifies that
// clearing the responsible user (A -> none) notifies the former responsible
// user with "responsible_unassigned".
func TestNotification_IssueUpdated_ResponsibleUnassigned_OnClear(t *testing.T) {
	queries := db.New(testPool)
	bus := newNotificationBus(t, queries)

	oldResponsibleEmail := "notif-update-clear-resp@multica.ai"
	oldResponsibleID := createTestUser(t, oldResponsibleEmail)
	t.Cleanup(func() { cleanupTestUser(t, oldResponsibleEmail) })

	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		cleanupInboxForIssue(t, issueID)
		cleanupTestIssue(t, issueID)
	})

	// newResponsibleID="" -> ResponsibleUserID stays nil (cleared).
	publishResponsibleUpdate(bus, issueID, "", &oldResponsibleID)

	oldItems := inboxItemsForRecipient(t, queries, oldResponsibleID)
	if len(oldItems) != 1 {
		t.Fatalf("expected 1 inbox item for cleared responsible, got %d", len(oldItems))
	}
	if oldItems[0].Type != "responsible_unassigned" {
		t.Fatalf("expected type 'responsible_unassigned', got %q", oldItems[0].Type)
	}
}

// TestNotification_IssueUpdated_ResponsibleUnchanged verifies that when the
// responsible user does NOT change, no responsible notification is sent — even
// though other fields (status) changed.
func TestNotification_IssueUpdated_ResponsibleUnchanged(t *testing.T) {
	queries := db.New(testPool)
	bus := newNotificationBus(t, queries)

	responsibleEmail := "notif-update-resp-unchanged@multica.ai"
	responsibleID := createTestUser(t, responsibleEmail)
	t.Cleanup(func() { cleanupTestUser(t, responsibleEmail) })

	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		cleanupInboxForIssue(t, issueID)
		cleanupTestIssue(t, issueID)
	})

	sameResponsible := responsibleID
	bus.Publish(events.Event{
		Type:        protocol.EventIssueUpdated,
		WorkspaceID: testWorkspaceID,
		ActorType:   "member",
		ActorID:     testUserID,
		Payload: map[string]any{
			"issue": handler.IssueResponse{
				ID:                issueID,
				WorkspaceID:       testWorkspaceID,
				Title:             "responsible unchanged test",
				Status:            "in_progress",
				Priority:          "medium",
				CreatorType:       "member",
				CreatorID:         testUserID,
				ResponsibleUserID: &sameResponsible,
			},
			"assignee_changed":         false,
			"status_changed":           true,
			"prev_status":              "todo",
			"responsible_user_changed": false,
			"prev_responsible_user_id": &sameResponsible,
		},
	})

	// Responsible user is not a subscriber, and responsible did not change,
	// so they must receive nothing.
	items := inboxItemsForRecipient(t, queries, responsibleID)
	if len(items) != 0 {
		t.Fatalf("expected 0 inbox items when responsible unchanged, got %#v", items)
	}
}

// TestNotification_IssueUpdated_ResponsibleSelfStillNotified verifies that a
// user editing an issue to make THEMSELF the responsible user still receives
// the notification (no self-exemption), matching the CREATE-path behavior
// guarded by TestNotification_IssueCreated_SelfResponsibleStillNotified.
func TestNotification_IssueUpdated_ResponsibleSelfStillNotified(t *testing.T) {
	queries := db.New(testPool)
	bus := newNotificationBus(t, queries)

	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		cleanupInboxForIssue(t, issueID)
		cleanupTestIssue(t, issueID)
	})

	// Actor (testUserID) sets themself as responsible.
	publishResponsibleUpdate(bus, issueID, testUserID, nil)

	items := inboxItemsForRecipient(t, queries, testUserID)
	if len(items) != 1 {
		t.Fatalf("expected 1 inbox item for self responsible assignment, got %d", len(items))
	}
	if items[0].Type != "responsible_assigned" {
		t.Fatalf("expected type 'responsible_assigned', got %q", items[0].Type)
	}
}

// TestNotification_IssueUpdated_ResponsibleMutedByResponsibleChanges verifies
// that muting the "responsible_changes" preference group suppresses both the
// assign and unassign responsible notifications on the UPDATE path.
func TestNotification_IssueUpdated_ResponsibleMutedByResponsibleChanges(t *testing.T) {
	queries := db.New(testPool)
	bus := newNotificationBus(t, queries)

	oldResponsibleEmail := "notif-update-muted-old-resp@multica.ai"
	oldResponsibleID := createTestUser(t, oldResponsibleEmail)
	t.Cleanup(func() { cleanupTestUser(t, oldResponsibleEmail) })
	muteNotificationGroup(t, queries, oldResponsibleID, "responsible_changes")

	newResponsibleEmail := "notif-update-muted-new-resp@multica.ai"
	newResponsibleID := createTestUser(t, newResponsibleEmail)
	t.Cleanup(func() { cleanupTestUser(t, newResponsibleEmail) })
	muteNotificationGroup(t, queries, newResponsibleID, "responsible_changes")

	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		cleanupInboxForIssue(t, issueID)
		cleanupTestIssue(t, issueID)
	})

	publishResponsibleUpdate(bus, issueID, newResponsibleID, &oldResponsibleID)

	if items := inboxItemsForRecipient(t, queries, newResponsibleID); len(items) != 0 {
		t.Fatalf("expected responsible_assigned muted for new responsible, got %#v", items)
	}
	if items := inboxItemsForRecipient(t, queries, oldResponsibleID); len(items) != 0 {
		t.Fatalf("expected responsible_unassigned muted for old responsible, got %#v", items)
	}
}

// TestNotification_IssueUpdated_AssigneeClearedNotifiesOldMember verifies that
// clearing an issue's assignee (member A -> none) notifies the former assignee
// with "unassigned". This is the "removed as handler" half of the assignments
// notification pair; TestNotification_AssigneeChanged covers the reassign case.
func TestNotification_IssueUpdated_AssigneeClearedNotifiesOldMember(t *testing.T) {
	queries := db.New(testPool)
	bus := newNotificationBus(t, queries)

	oldAssigneeEmail := "notif-clear-assignee@multica.ai"
	oldAssigneeID := createTestUser(t, oldAssigneeEmail)
	t.Cleanup(func() { cleanupTestUser(t, oldAssigneeEmail) })

	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		cleanupInboxForIssue(t, issueID)
		cleanupTestIssue(t, issueID)
	})

	// Assignee cleared: new issue has no AssigneeType/AssigneeID.
	oldAssigneeType := "member"
	bus.Publish(events.Event{
		Type:        protocol.EventIssueUpdated,
		WorkspaceID: testWorkspaceID,
		ActorType:   "member",
		ActorID:     testUserID,
		Payload: map[string]any{
			"issue": handler.IssueResponse{
				ID:          issueID,
				WorkspaceID: testWorkspaceID,
				Title:       "cleared assignee issue",
				Status:      "todo",
				Priority:    "medium",
				CreatorType: "member",
				CreatorID:   testUserID,
			},
			"assignee_changed":   true,
			"status_changed":     false,
			"prev_assignee_type": &oldAssigneeType,
			"prev_assignee_id":   &oldAssigneeID,
		},
	})

	oldItems := inboxItemsForRecipient(t, queries, oldAssigneeID)
	if len(oldItems) != 1 {
		t.Fatalf("expected 1 inbox item for cleared assignee, got %d", len(oldItems))
	}
	if oldItems[0].Type != "unassigned" {
		t.Fatalf("expected type 'unassigned', got %q", oldItems[0].Type)
	}
	if oldItems[0].Severity != "info" {
		t.Fatalf("expected severity 'info', got %q", oldItems[0].Severity)
	}
}

// TestNotification_WorkflowNodeExecutorAndReviewerMutedSeparately guards the
// workflow_roles split: muting the "workflow_executor" group must suppress
// workflow_executor_assigned but leave workflow_reviewer_assigned alone (and
// vice versa). Before the split both types shared the workflow_roles group, so
// a single mute toggled both.
func TestNotification_WorkflowNodeExecutorAndReviewerMutedSeparately(t *testing.T) {
	queries := db.New(testPool)
	bus := newNotificationBus(t, queries)

	// A mutes only the executor group — reviewer notifications must still arrive.
	aEmail := "notif-wf-split@multica.ai"
	aID := createTestUser(t, aEmail)
	t.Cleanup(func() { cleanupTestUser(t, aEmail) })
	aMemberID := createTestMember(t, testWorkspaceID, aID)
	muteNotificationGroup(t, queries, aID, "workflow_executor")

	// B mutes only the reviewer group — executor notifications must still arrive.
	bEmail := "notif-wf-split-b@multica.ai"
	bID := createTestUser(t, bEmail)
	t.Cleanup(func() { cleanupTestUser(t, bEmail) })
	bMemberID := createTestMember(t, testWorkspaceID, bID)
	muteNotificationGroup(t, queries, bID, "workflow_reviewer")

	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		cleanupInboxForIssue(t, issueID)
		cleanupTestIssue(t, issueID)
	})

	nodeRunID := "00000000-0000-0000-0000-00000000ad01"
	runID := "00000000-0000-0000-0000-00000000ad02"
	humanType := "human"

	// A assigned as executor -> suppressed by workflow_executor mute.
	bus.Publish(events.Event{
		Type:        protocol.EventWorkflowNodeRunStarted,
		WorkspaceID: testWorkspaceID,
		ActorType:   "system",
		ActorID:     "",
		Payload: map[string]any{
			"node_run": handler.WorkflowNodeRunResponse{
				ID:            nodeRunID,
				WorkflowRunID: runID,
				NodeTitle:     "split executor muted",
				Status:        "worker_assigned",
				WorkerType:    humanType,
				WorkerID:      &aMemberID,
			},
			"run_id":   runID,
			"issue_id": issueID,
		},
	})
	if hasInboxType(inboxItemsForRecipient(t, queries, aID), "workflow_executor_assigned") {
		t.Fatalf("expected executor assignment muted for A (workflow_executor muted)")
	}

	// A assigned as reviewer -> must still arrive (only executor group muted).
	bus.Publish(events.Event{
		Type:        protocol.EventWorkflowNodeRunReviewed,
		WorkspaceID: testWorkspaceID,
		ActorType:   "member",
		ActorID:     testUserID,
		Payload: map[string]any{
			"node_run": handler.WorkflowNodeRunResponse{
				ID:            nodeRunID,
				WorkflowRunID: runID,
				NodeTitle:     "split reviewer reaches A",
				Status:        "critic_reviewing",
				CriticType:    humanType,
				CriticID:      &aMemberID,
			},
			"run_id":   runID,
			"issue_id": issueID,
		},
	})
	if !hasInboxType(inboxItemsForRecipient(t, queries, aID), "workflow_reviewer_assigned") {
		t.Fatalf("expected reviewer assignment to still reach A (only executor group muted)")
	}

	// B assigned as executor -> must still arrive (only reviewer group muted).
	bus.Publish(events.Event{
		Type:        protocol.EventWorkflowNodeRunStarted,
		WorkspaceID: testWorkspaceID,
		ActorType:   "system",
		ActorID:     "",
		Payload: map[string]any{
			"node_run": handler.WorkflowNodeRunResponse{
				ID:            nodeRunID,
				WorkflowRunID: runID,
				NodeTitle:     "split executor reaches B",
				Status:        "worker_assigned",
				WorkerType:    humanType,
				WorkerID:      &bMemberID,
			},
			"run_id":   runID,
			"issue_id": issueID,
		},
	})
	if !hasInboxType(inboxItemsForRecipient(t, queries, bID), "workflow_executor_assigned") {
		t.Fatalf("expected executor assignment to still reach B (only reviewer group muted)")
	}
}

// TestNotification_StatusChanged_NotifiesReassignedResponsible guards the
// "own" half of the task-status-change notification: after an issue's
// responsible user is reassigned via update, the new responsible must receive
// subsequent status_changed notifications. The subscriber listener must
// subscribe the new responsible on responsible_user_changed (it already does
// for assignee on assignee_changed), otherwise the new owner is invisible to
// notifySubscribers and never learns about status transitions.
func TestNotification_StatusChanged_NotifiesReassignedResponsible(t *testing.T) {
	queries := db.New(testPool)
	bus := newNotificationBus(t, queries)

	responsibleEmail := "notif-status-resp@multica.ai"
	responsibleID := createTestUser(t, responsibleEmail)
	t.Cleanup(func() { cleanupTestUser(t, responsibleEmail) })

	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		cleanupInboxForIssue(t, issueID)
		cleanupTestIssue(t, issueID)
	})

	// Step 1: reassign responsible — subscriber listener should subscribe them.
	publishResponsibleUpdate(bus, issueID, responsibleID, nil)

	// Step 2: status change — notifySubscribers should now reach the responsible.
	bus.Publish(events.Event{
		Type:        protocol.EventIssueUpdated,
		WorkspaceID: testWorkspaceID,
		ActorType:   "member",
		ActorID:     testUserID,
		Payload: map[string]any{
			"issue": handler.IssueResponse{
				ID:          issueID,
				WorkspaceID: testWorkspaceID,
				Title:       "status change after responsible reassign",
				Status:      "in_progress",
				Priority:    "medium",
				CreatorType: "member",
				CreatorID:   testUserID,
			},
			"assignee_changed": false,
			"status_changed":   true,
			"prev_status":      "todo",
		},
	})

	items := inboxItemsForRecipient(t, queries, responsibleID)
	if !hasInboxType(items, "status_changed") {
		t.Fatalf("expected reassigned responsible to receive status_changed, got %#v", items)
	}
}
