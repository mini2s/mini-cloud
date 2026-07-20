package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/multica-ai/multica/server/internal/deptsync"
)

func TestWorkflowRoleResolutionRuntimeDoesNotProbeLLMAtStartup(t *testing.T) {
	var requests atomic.Int32
	llm := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{}"}}]}`))
	}))
	defer llm.Close()

	t.Setenv("WORKFLOW_ROLE_RESOLUTION_ENABLED", "true")
	t.Setenv("WORKFLOW_ROLE_LLM_PROVIDER", "openai")
	t.Setenv("WORKFLOW_ROLE_LLM_BASE_URL", llm.URL)
	t.Setenv("WORKFLOW_ROLE_LLM_API_KEY", "test-key")
	t.Setenv("WORKFLOW_ROLE_LLM_MODEL", "test-model")

	deptClient := deptsync.NewClient(deptsync.Config{
		BaseURL:  "http://dept.invalid",
		QueryKey: "test-key",
		Timeout:  time.Second,
	})
	runtime := workflowRoleResolutionRuntimeFromEnv(deptClient)
	if !runtime.AutoResolutionConfigured() {
		t.Fatal("expected automatic resolution to be configured")
	}
	if got := requests.Load(); got != 0 {
		t.Fatalf("startup sent %d LLM requests, want 0", got)
	}
}

func TestDeptWorkflowRoleOrganizationProviderUsesHTTPClient(t *testing.T) {
	dept := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/user/ext-1/departments" {
			http.Error(w, "unexpected path", http.StatusNotFound)
			return
		}
		if r.URL.Query().Get("type") != "universal" {
			http.Error(w, "missing universal type", http.StatusBadRequest)
			return
		}
		if r.Header.Get("X-Query-Key") != "test-key" {
			http.Error(w, "missing query key", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"success":true,"data":[{"username":"Alice","universal_id":"ext-1","position":"Developer","dept_path":"Engineering/Platform","is_main":1,"status":1}]}`)
	}))
	defer dept.Close()

	provider := &deptWorkflowRoleOrganizationProvider{client: deptsync.NewClient(deptsync.Config{
		BaseURL:  dept.URL,
		QueryKey: "test-key",
		Timeout:  time.Second,
	})}
	snapshot, err := provider.ResolveMembers(context.Background(), []string{"ext-1"})
	if err != nil {
		t.Fatalf("ResolveMembers: %v", err)
	}
	if len(snapshot.Profiles) != 1 {
		t.Fatalf("profile count = %d, want 1", len(snapshot.Profiles))
	}
	profile := snapshot.Profiles[0]
	if profile.ExternalIdentity != "ext-1" || profile.DisplayName != "Alice" || profile.Position != "Developer" {
		t.Fatalf("unexpected profile: %+v", profile)
	}
	if snapshot.Version == "" || snapshot.FetchedAt.IsZero() {
		t.Fatalf("missing organization snapshot metadata: %+v", snapshot)
	}
}
