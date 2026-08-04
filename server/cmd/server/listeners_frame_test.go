package main

import (
	"encoding/json"
	"testing"

	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// TestRegisterListeners_FrameContainsActorType asserts that every WS frame
// produced by registerListeners includes the top-level "actor_type" field.
// This is a regression guard for the bug where agent operations appeared as
// human in the web UI because the broadcast frame lacked actor_type.
func TestRegisterListeners_FrameContainsActorType(t *testing.T) {
	cases := []struct {
		name      string
		event     events.Event
		checkUser bool // true = check SendToUser, false = check BroadcastToWorkspace
		userID    string
	}{
		{
			name: "workspace broadcast carries actor_type",
			event: events.Event{
				Type:        protocol.EventIssueCreated,
				WorkspaceID: "ws-1",
				ActorID:     "agent-abc",
				ActorType:   "agent",
				Payload:     map[string]any{"id": "issue-1"},
			},
		},
		{
			name: "personal event (inbox:new) carries actor_type",
			event: events.Event{
				Type:        protocol.EventInboxNew,
				WorkspaceID: "ws-1",
				ActorID:     "member-xyz",
				ActorType:   "member",
				Payload: map[string]any{
					"item": map[string]any{"recipient_id": "user-1"},
				},
			},
			checkUser: true,
			userID:    "user-1",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			bus := events.New()
			fb := &fakeBroadcaster{}
			registerListeners(bus, fb)

			bus.Publish(tc.event)

			var raw []byte
			if tc.checkUser {
				if len(fb.userCalls) == 0 {
					t.Fatal("expected SendToUser call, got none")
				}
				raw = fb.userCalls[0].msg
			} else {
				if len(fb.workspaceCalls) == 0 {
					t.Fatal("expected BroadcastToWorkspace call, got none")
				}
				raw = fb.workspaceCalls[0].msg
			}

			var frame map[string]any
			if err := json.Unmarshal(raw, &frame); err != nil {
				t.Fatalf("failed to unmarshal frame: %v", err)
			}

			actorType, ok := frame["actor_type"]
			if !ok {
				t.Fatal("frame missing actor_type field")
			}
			if actorType != tc.event.ActorType {
				t.Fatalf("actor_type = %q, want %q", actorType, tc.event.ActorType)
			}
		})
	}
}

// TestRegisterListeners_InboxNewRoutesPointerRecipient is a regression test
// for the bug where inbox:new was silently dropped in real time. Producers
// (inboxItemToResponse, publishQuickCreateInbox) set recipient_id via
// util.UUIDToPtr, i.e. *string. The old `item["recipient_id"].(string)`
// assertion failed on *string → "" → sendToRecipient returned early, so no
// recipient ever received inbox:new over WebSocket (the row was still
// written to the DB, so a manual page refresh showed it). Both the string
// and *string shapes produced by different code paths must route correctly.
func TestRegisterListeners_InboxNewRoutesPointerRecipient(t *testing.T) {
	cases := []struct {
		name string
		val  any
	}{
		{"string", "user-str"},
		{"pointer", func() *string { s := "user-ptr"; return &s }()},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			bus := events.New()
			fb := &fakeBroadcaster{}
			registerListeners(bus, fb)

			bus.Publish(events.Event{
				Type:        protocol.EventInboxNew,
				WorkspaceID: "ws-1",
				ActorType:   "member",
				ActorID:     "member-x",
				Payload: map[string]any{
					"item": map[string]any{"recipient_id": tc.val},
				},
			})

			if len(fb.userCalls) == 0 {
				t.Fatalf("expected SendToUser for %s recipient_id, got none — type-shape regression", tc.name)
			}
			want := ""
			switch v := tc.val.(type) {
			case string:
				want = v
			case *string:
				want = *v
			}
			if got := fb.userCalls[0].userID; got != want {
				t.Fatalf("SendToUser userID = %q, want %q", got, want)
			}
		})
	}
}
