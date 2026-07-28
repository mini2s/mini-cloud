package service

import (
	"encoding/json"
	"testing"
)

func TestParseAgentCriticDecisionRejectsEmptyCompletionEnvelope(t *testing.T) {
	result := json.RawMessage(`{"output":"","pr_url":"","session_id":"","work_dir":""}`)

	if _, _, err := parseAgentCriticDecision(result); err == nil {
		t.Fatal("empty critic completion envelope was accepted")
	}
}

func TestParseAgentCriticDecisionReadsStructuredDecisionFromOutput(t *testing.T) {
	result := json.RawMessage(`{"output":"{\"approved\":false,\"comment\":\"missing tests\"}"}`)

	approved, comment, err := parseAgentCriticDecision(result)
	if err != nil {
		t.Fatalf("parseAgentCriticDecision: %v", err)
	}
	if approved {
		t.Fatal("approved = true, want false")
	}
	if comment != "missing tests" {
		t.Fatalf("comment = %q, want missing tests", comment)
	}
}
