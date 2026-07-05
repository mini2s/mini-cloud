package service

import (
	"encoding/json"
	"testing"
)

func TestCommandContextRoundTrip(t *testing.T) {
	original := CommandContext{
		Type:        "ai_command",
		ContextType: "issue",
		ContextID:   "test-issue-id",
		UserInput:   "分配给 @张三",
		Mode:        "command",
	}

	b, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var roundtripped CommandContext
	if err := json.Unmarshal(b, &roundtripped); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if roundtripped.Type != "ai_command" {
		t.Errorf("expected type 'ai_command', got %q", roundtripped.Type)
	}
	if roundtripped.ContextType != "issue" {
		t.Errorf("expected context_type 'issue', got %q", roundtripped.ContextType)
	}
	if roundtripped.UserInput != "分配给 @张三" {
		t.Errorf("expected user_input '分配给 @张三', got %q", roundtripped.UserInput)
	}
}
