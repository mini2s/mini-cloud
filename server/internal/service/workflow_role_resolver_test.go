package service

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func TestValidateWorkflowRoleResolverResults(t *testing.T) {
	request := WorkflowRoleResolverRequest{
		Slots:      []WorkflowRoleResolutionSlot{{ID: "slot-1"}, {ID: "slot-2"}},
		Candidates: []WorkflowRoleResolutionCandidate{{ID: "candidate-1"}},
	}
	results := validateWorkflowRoleResolverResults(request, []WorkflowRoleResolverResult{
		{SlotID: "slot-1", Status: "resolved", CandidateID: "candidate-1"},
		{SlotID: "slot-1", Status: "resolved", CandidateID: "candidate-1"},
		{SlotID: "slot-2", Status: "resolved", CandidateID: "unknown"},
		{SlotID: "unknown", Status: "needs_human"},
	})
	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %#v", results)
	}
	if results[1].Status != "needs_human" || results[1].ReasonCode != "invalid_model_output" {
		t.Fatalf("unexpected downgraded result: %#v", results[1])
	}
}

func TestValidateWorkflowRoleResolverResultsTruncatesReasonByRunes(t *testing.T) {
	request := WorkflowRoleResolverRequest{Slots: []WorkflowRoleResolutionSlot{{ID: "slot-1"}}}
	results := validateWorkflowRoleResolverResults(request, []WorkflowRoleResolverResult{{
		SlotID: "slot-1", Status: "needs_human", ReasonDetail: strings.Repeat("测", 501),
	}})
	if len(results) != 1 || utf8.RuneCountInString(results[0].ReasonDetail) != 500 || !utf8.ValidString(results[0].ReasonDetail) {
		t.Fatalf("reason detail was not truncated safely: %#v", results)
	}
}

func newWorkflowRoleResolverForTest(t *testing.T, handler http.HandlerFunc) (*OpenAIWorkflowRoleResolver, func()) {
	t.Helper()
	server := httptest.NewServer(handler)
	resolver, err := NewOpenAIWorkflowRoleResolver(OpenAIWorkflowRoleResolverConfig{
		BaseURL: server.URL, APIKey: "secret", Model: "test", Timeout: time.Second,
	}, nil)
	if err != nil {
		server.Close()
		t.Fatal(err)
	}
	return resolver, server.Close
}

func TestOpenAIWorkflowRoleResolverSuccessAndUsage(t *testing.T) {
	resolver, closeServer := newWorkflowRoleResolverForTest(t, func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer secret" {
			t.Errorf("unexpected authorization header: %q", got)
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"results\":[{\"slot_id\":\"slot-1\",\"status\":\"resolved\",\"candidate_id\":\"candidate-1\",\"reason_code\":\"matched_position\"}]}"}}],"usage":{"prompt_tokens":11,"completion_tokens":7,"total_tokens":18}}`))
	})
	defer closeServer()
	response, err := resolver.Resolve(context.Background(), WorkflowRoleResolverRequest{
		Slots:      []WorkflowRoleResolutionSlot{{ID: "slot-1"}},
		Candidates: []WorkflowRoleResolutionCandidate{{ID: "candidate-1"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Results) != 1 || response.Results[0].CandidateID != "candidate-1" {
		t.Fatalf("unexpected results: %#v", response.Results)
	}
	if response.Usage.InputTokens != 11 || response.Usage.OutputTokens != 7 || response.Usage.TotalTokens != 18 {
		t.Fatalf("unexpected usage: %#v", response.Usage)
	}
}

func TestOpenAIWorkflowRoleResolverClassifiesHTTPFailures(t *testing.T) {
	tests := []struct {
		name      string
		status    int
		retryable bool
	}{{"rate limited", http.StatusTooManyRequests, true}, {"server error", http.StatusBadGateway, true}, {"client error", http.StatusBadRequest, false}}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resolver, closeServer := newWorkflowRoleResolverForTest(t, func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tt.status)
				_, _ = w.Write([]byte("sensitive upstream response"))
			})
			defer closeServer()
			_, err := resolver.Resolve(context.Background(), WorkflowRoleResolverRequest{})
			var resolverErr *WorkflowRoleResolverError
			if !errors.As(err, &resolverErr) || resolverErr.Code != "resolver_http_error" || resolverErr.Retryable != tt.retryable {
				t.Fatalf("unexpected error: %#v", err)
			}
			if strings.Contains(err.Error(), "sensitive upstream response") {
				t.Fatalf("upstream response leaked in error: %v", err)
			}
		})
	}
}

func TestOpenAIWorkflowRoleResolverRejectsOversizedResponse(t *testing.T) {
	resolver, closeServer := newWorkflowRoleResolverForTest(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(strings.Repeat("x", maxWorkflowRoleResolverResponseBytes+1)))
	})
	defer closeServer()
	_, err := resolver.Resolve(context.Background(), WorkflowRoleResolverRequest{})
	var resolverErr *WorkflowRoleResolverError
	if !errors.As(err, &resolverErr) || resolverErr.Code != "resolver_response_too_large" || resolverErr.Retryable {
		t.Fatalf("unexpected error: %#v", err)
	}
}

func TestOpenAIWorkflowRoleResolverRejectsMalformedOutputs(t *testing.T) {
	tests := []struct{ name, body string }{
		{"empty choices", `{"choices":[]}`},
		{"invalid envelope json", `{not-json`},
		{"invalid result json", `{"choices":[{"message":{"content":"not-json"}}]}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resolver, closeServer := newWorkflowRoleResolverForTest(t, func(w http.ResponseWriter, _ *http.Request) {
				_, _ = w.Write([]byte(tt.body))
			})
			defer closeServer()
			_, err := resolver.Resolve(context.Background(), WorkflowRoleResolverRequest{})
			var resolverErr *WorkflowRoleResolverError
			if !errors.As(err, &resolverErr) || resolverErr.Code != "invalid_model_output" || resolverErr.Retryable {
				t.Fatalf("unexpected error: %#v", err)
			}
		})
	}
}

func TestOpenAIWorkflowRoleResolverHonorsContextCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	defer server.Close()
	resolver, err := NewOpenAIWorkflowRoleResolver(OpenAIWorkflowRoleResolverConfig{BaseURL: server.URL, APIKey: "secret", Model: "test", Timeout: time.Minute}, nil)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = resolver.Resolve(ctx, WorkflowRoleResolverRequest{})
	if err == nil {
		t.Fatal("expected cancellation error")
	}
	resolverErr, ok := err.(*WorkflowRoleResolverError)
	if !ok || !resolverErr.Retryable {
		t.Fatalf("unexpected error: %#v", err)
	}
}
