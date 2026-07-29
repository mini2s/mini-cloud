package teamnamespace

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientSyncMembersUsesInternalServiceTokenAndTenant(t *testing.T) {
	var gotPath, gotToken, gotTenant string
	var got SyncMembersRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotToken = r.Header.Get("X-Internal-Service-Token")
		gotTenant = r.Header.Get("X-Tenant-Id")
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		_ = json.NewEncoder(w).Encode(SyncMembersResponse{
			TeamNSOrg:           "t-6efed44f",
			MembersRemovedCount: 1,
		})
	}))
	defer srv.Close()

	c := NewClient(Config{BaseURL: srv.URL + "/", Token: "svc-token", Tenant: "default"})
	out, err := c.SyncMembers(context.Background(), "6efed44f-6d57-4bfd-ac0a-908b7e1b297b", SyncMembersRequest{
		Mode: "delta",
		RemoveMembers: []UserRef{{
			UserID:    "usr_29219",
		}},
	})
	if err != nil {
		t.Fatalf("SyncMembers: %v", err)
	}
	if gotPath != "/api/internal/teams/6efed44f-6d57-4bfd-ac0a-908b7e1b297b/members:sync" {
		t.Fatalf("path = %q", gotPath)
	}
	if gotToken != "svc-token" {
		t.Fatalf("token header = %q", gotToken)
	}
	if gotTenant != "default" {
		t.Fatalf("tenant header = %q", gotTenant)
	}
	if got.Mode != "delta" || len(got.RemoveMembers) != 1 || got.RemoveMembers[0].UserID != "usr_29219" {
		t.Fatalf("request body = %+v", got)
	}
	if out.MembersRemovedCount != 1 {
		t.Fatalf("removed count = %d", out.MembersRemovedCount)
	}
}

func TestClientInitWorkflow(t *testing.T) {
	var got WorkflowInitRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/internal/workflow/init" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		_ = json.NewEncoder(w).Encode(WorkflowInitResponse{
			WFRepoPath:     "t-6efed44f/wf-32ed6f5f",
			InstanceBranch: "inst-664368d4",
			TeamNSExists:   true,
		})
	}))
	defer srv.Close()

	c := NewClient(Config{BaseURL: srv.URL, Token: "svc-token"})
	out, err := c.InitWorkflow(context.Background(), WorkflowInitRequest{
		WorkflowDefSlug: "32ed6f5f",
		InstanceID:      "664368d4-6a1a-4161-ad5c-24dd73060d88",
		TeamID:          "6efed44f-6d57-4bfd-ac0a-908b7e1b297b",
	})
	if err != nil {
		t.Fatalf("InitWorkflow: %v", err)
	}
	if got.TeamID != "6efed44f-6d57-4bfd-ac0a-908b7e1b297b" || got.WorkflowDefSlug != "32ed6f5f" {
		t.Fatalf("request body = %+v", got)
	}
	if out.WFRepoPath != "t-6efed44f/wf-32ed6f5f" || out.InstanceBranch != "inst-664368d4" {
		t.Fatalf("response = %+v", out)
	}
}
