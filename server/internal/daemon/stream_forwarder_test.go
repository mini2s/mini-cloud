package daemon

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/multica-ai/multica/server/pkg/agent"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

func TestStreamForwarder_Send(t *testing.T) {
	var captured []byte
	send := func(b []byte) bool {
		captured = append([]byte(nil), b...)
		return true
	}
	fwd := NewStreamForwarder(send, nil)

	fwd.Send(context.Background(), "task-1", "issue-1", "ws-1", agent.Message{
		Type:    agent.MessageText,
		Content: "hello",
	})

	if captured == nil {
		t.Fatal("expected frame")
	}
	var msg protocol.Message
	if err := json.Unmarshal(captured, &msg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if msg.Type != protocol.EventTaskStream {
		t.Fatalf("type = %q, want %q", msg.Type, protocol.EventTaskStream)
	}
	var payload protocol.TaskStreamPayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if payload.TaskID != "task-1" || payload.IssueID != "issue-1" || payload.WorkspaceID != "ws-1" {
		t.Fatalf("unexpected ids: %+v", payload)
	}
	if payload.Content != "hello" {
		t.Fatalf("content = %q, want %q", payload.Content, "hello")
	}
	if payload.Seq != 1 {
		t.Fatalf("seq = %d, want 1", payload.Seq)
	}
	if payload.Type != string(agent.MessageText) {
		t.Fatalf("type = %q, want %q", payload.Type, agent.MessageText)
	}
}

func TestStreamForwarder_SendSeqMonotonic(t *testing.T) {
	var captured [][]byte
	send := func(b []byte) bool {
		captured = append(captured, append([]byte(nil), b...))
		return true
	}
	fwd := NewStreamForwarder(send, nil)

	ctx := context.Background()
	fwd.Send(ctx, "task-1", "issue-1", "ws-1", agent.Message{Type: agent.MessageText, Content: "a"})
	fwd.Send(ctx, "task-1", "issue-1", "ws-1", agent.Message{Type: agent.MessageText, Content: "b"})
	fwd.Send(ctx, "task-2", "issue-1", "ws-1", agent.Message{Type: agent.MessageText, Content: "c"})

	if len(captured) != 3 {
		t.Fatalf("expected 3 frames, got %d", len(captured))
	}

	seqOf := func(idx int) int {
		var msg protocol.Message
		if err := json.Unmarshal(captured[idx], &msg); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		var payload protocol.TaskStreamPayload
		if err := json.Unmarshal(msg.Payload, &payload); err != nil {
			t.Fatalf("unmarshal payload: %v", err)
		}
		return payload.Seq
	}

	if s := seqOf(0); s != 1 {
		t.Fatalf("frame 0 seq = %d, want 1", s)
	}
	if s := seqOf(1); s != 2 {
		t.Fatalf("frame 1 seq = %d, want 2", s)
	}
	if s := seqOf(2); s != 1 {
		t.Fatalf("frame 2 seq = %d, want 1", s)
	}
}

func TestStreamForwarder_SendDropWhenSendFails(t *testing.T) {
	send := func([]byte) bool { return false }
	fwd := NewStreamForwarder(send, nil)

	// Should not panic and should not block.
	fwd.Send(context.Background(), "task-1", "issue-1", "ws-1", agent.Message{
		Type:    agent.MessageText,
		Content: "hello",
	})
}

func TestStreamForwarder_SendNoOpWhenTaskIDEmpty(t *testing.T) {
	called := false
	send := func([]byte) bool { called = true; return true }
	fwd := NewStreamForwarder(send, nil)

	fwd.Send(context.Background(), "", "issue-1", "ws-1", agent.Message{
		Type:    agent.MessageText,
		Content: "hello",
	})

	if called {
		t.Fatal("send should not be called when taskID is empty")
	}
}
