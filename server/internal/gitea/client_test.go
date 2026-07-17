package gitea

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// newTestServer returns a httptest server whose handler receives a function
// recording the request (method, path, auth header, decoded JSON body) into
// *got, and responds with the given status + body. It also returns the base
// URL (without /api/v1) for constructing a Client.
func newTestServer(t *testing.T, status int, respBody string, got *recordedReq) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got.method = r.Method
		got.path = r.URL.Path
		got.auth = r.Header.Get("Authorization")
		got.contentType = r.Header.Get("Content-Type")
		if r.Body != nil {
			_ = json.NewDecoder(r.Body).Decode(&got.body)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		w.Write([]byte(respBody))
	}))
}

type recordedReq struct {
	method      string
	path        string
	auth        string
	contentType string
	body        map[string]any
}

func TestClient_NotConfigured(t *testing.T) {
	c := NewClient(Config{})
	if c.Configured() {
		t.Fatal("empty client should not be configured")
	}
	if _, err := c.GetOrg(context.Background(), "t-7f3c9a1e"); err != ErrNotConfigured {
		t.Fatalf("got err %v, want ErrNotConfigured", err)
	}
}

func TestClient_AuthHeaderAndBaseURL(t *testing.T) {
	var got recordedReq
	srv := newTestServer(t, http.StatusOK, `{}`, &got)
	defer srv.Close()

	c := NewClient(Config{BaseURL: srv.URL, Token: "admin-tok"})
	c.httpClient = srv.Client()

	found, err := c.GetOrg(context.Background(), "t-7f3c9a1e")
	if err != nil {
		t.Fatalf("GetOrg: %v", err)
	}
	if !found {
		t.Fatal("expected found=true on 200")
	}
	if got.auth != "token admin-tok" {
		t.Errorf("auth header = %q, want %q", got.auth, "token admin-tok")
	}
	if got.path != "/api/v1/orgs/t-7f3c9a1e" {
		t.Errorf("path = %q", got.path)
	}
	if got.contentType != "" {
		t.Errorf("GET should not set Content-Type, got %q", got.contentType)
	}
}

func TestClient_GetOrg_NotFound(t *testing.T) {
	var got recordedReq
	srv := newTestServer(t, http.StatusNotFound, ``, &got)
	defer srv.Close()
	c := NewClient(Config{BaseURL: srv.URL, Token: "admin-tok"})
	c.httpClient = srv.Client()

	found, err := c.GetOrg(context.Background(), "t-7f3c9a1e")
	if err != nil {
		t.Fatalf("GetOrg: %v", err)
	}
	if found {
		t.Fatal("expected found=false on 404")
	}
}

func TestClient_CreateRepo_Body(t *testing.T) {
	var got recordedReq
	srv := newTestServer(t, http.StatusCreated, `{}`, &got)
	defer srv.Close()
	c := NewClient(Config{BaseURL: srv.URL, Token: "admin-tok"})
	c.httpClient = srv.Client()

	if err := c.CreateRepo(context.Background(), "t-7f3c9a1e", "wf-11111111", "Bug Fix Flow"); err != nil {
		t.Fatalf("CreateRepo: %v", err)
	}
	if got.method != http.MethodPost || !strings.Contains(got.path, "/orgs/t-7f3c9a1e/repos") {
		t.Errorf("unexpected request: %s %s", got.method, got.path)
	}
	if got.body["name"] != "wf-11111111" || got.body["auto_init"] != true {
		t.Errorf("unexpected body: %+v", got.body)
	}
}

func TestClient_CreateBranch_Body(t *testing.T) {
	var got recordedReq
	srv := newTestServer(t, http.StatusCreated, `{}`, &got)
	defer srv.Close()
	c := NewClient(Config{BaseURL: srv.URL, Token: "admin-tok"})
	c.httpClient = srv.Client()

	if err := c.CreateBranch(context.Background(), "t-7f3c9a1e", "wf-11111111", "inst-f3a8b2c1", "main"); err != nil {
		t.Fatalf("CreateBranch: %v", err)
	}
	if got.body["new_branch_name"] != "inst-f3a8b2c1" || got.body["old_ref_name"] != "main" {
		t.Errorf("unexpected body: %+v", got.body)
	}
}

func TestClient_CreateOrg_Body(t *testing.T) {
	var got recordedReq
	srv := newTestServer(t, http.StatusCreated, `{}`, &got)
	defer srv.Close()
	c := NewClient(Config{BaseURL: srv.URL, Token: "admin-tok"})
	c.httpClient = srv.Client()

	if err := c.CreateOrg(context.Background(), "t-7f3c9a1e", "Acme"); err != nil {
		t.Fatalf("CreateOrg: %v", err)
	}
	if got.method != http.MethodPost || got.path != "/api/v1/orgs" {
		t.Errorf("unexpected request: %s %s", got.method, got.path)
	}
	if got.body["username"] != "t-7f3c9a1e" || got.body["visibility"] != "private" || got.body["description"] != "Acme" {
		t.Errorf("unexpected body: %+v", got.body)
	}
}

func TestClient_GetRepo_FoundAndNotFound(t *testing.T) {
	for _, tc := range []struct {
		status int
		found  bool
	}{
		{http.StatusOK, true},
		{http.StatusNotFound, false},
	} {
		var got recordedReq
		srv := newTestServer(t, tc.status, `{}`, &got)
		c := NewClient(Config{BaseURL: srv.URL, Token: "admin-tok"})
		c.httpClient = srv.Client()

		found, err := c.GetRepo(context.Background(), "t-7f3c9a1e", "wf-11111111")
		srv.Close()
		if err != nil {
			t.Fatalf("GetRepo(%d): unexpected err %v", tc.status, err)
		}
		if found != tc.found {
			t.Errorf("GetRepo(%d): found=%v want %v", tc.status, found, tc.found)
		}
	}
}

func TestClient_GetBranch_NotFound(t *testing.T) {
	var got recordedReq
	srv := newTestServer(t, http.StatusNotFound, ``, &got)
	defer srv.Close()
	c := NewClient(Config{BaseURL: srv.URL, Token: "admin-tok"})
	c.httpClient = srv.Client()

	found, err := c.GetBranch(context.Background(), "t-7f3c9a1e", "wf-11111111", "inst-f3a8b2c1")
	if err != nil || found {
		t.Fatalf("GetBranch(404): found=%v err=%v", found, err)
	}
}

func TestClient_5xx_ReturnsError(t *testing.T) {
	// Exercises the decodeError path for both Get* and Create*.
	var got recordedReq
	srv := newTestServer(t, http.StatusInternalServerError, `{"message":"boom"}`, &got)
	defer srv.Close()
	c := NewClient(Config{BaseURL: srv.URL, Token: "admin-tok"})
	c.httpClient = srv.Client()

	if _, err := c.GetOrg(context.Background(), "t-7f3c9a1e"); err == nil {
		t.Fatal("GetOrg(500): expected error, got nil")
	}
	if err := c.CreateOrg(context.Background(), "t-7f3c9a1e", "Acme"); err == nil {
		t.Fatal("CreateOrg(500): expected error, got nil")
	}
}
