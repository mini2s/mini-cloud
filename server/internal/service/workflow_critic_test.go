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

func TestCriticDecisionFromResultPrefersExplicitDecision(t *testing.T) {
	// Explicit decision wins even when the parsed output would disagree.
	result := json.RawMessage(`{"output":"{\"approved\":false,\"comment\":\"looks bad\"}","decision":"approve","reason":"all good"}`)

	approved, comment, err := criticDecisionFromResult(result)
	if err != nil {
		t.Fatalf("criticDecisionFromResult: %v", err)
	}
	if !approved {
		t.Fatal("explicit approve ignored; want approved=true")
	}
	if comment != "all good" {
		t.Fatalf("comment = %q, want explicit reason %q", comment, "all good")
	}
}

func TestCriticDecisionFromResultExplicitReject(t *testing.T) {
	result := json.RawMessage(`{"decision":"reject","reason":"missing tests"}`)

	approved, comment, err := criticDecisionFromResult(result)
	if err != nil {
		t.Fatalf("criticDecisionFromResult: %v", err)
	}
	if approved {
		t.Fatal("explicit reject ignored; want approved=false")
	}
	if comment != "missing tests" {
		t.Fatalf("comment = %q, want %q", comment, "missing tests")
	}
}

func TestCriticDecisionFromResultFallsBackToParsedOutput(t *testing.T) {
	// No explicit decision → parse the free-text output as before.
	result := json.RawMessage(`{"output":"{\"approved\":false,\"comment\":\"missing tests\"}"}`)

	approved, comment, err := criticDecisionFromResult(result)
	if err != nil {
		t.Fatalf("criticDecisionFromResult: %v", err)
	}
	if approved {
		t.Fatal("approved = true, want false (parsed)")
	}
	if comment != "missing tests" {
		t.Fatalf("comment = %q, want missing tests", comment)
	}
}
