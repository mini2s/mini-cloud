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

func TestClient_CreateBranch_TreatsConcurrentAlreadyExistsAsIdempotent(t *testing.T) {
	var got recordedReq
	body := `{"message":"PushRejected Error: remote: error: cannot lock ref 'refs/heads/inst-f3a8b2c1': reference already exists"}`
	srv := newTestServer(t, http.StatusInternalServerError, body, &got)
	defer srv.Close()
	c := NewClient(Config{BaseURL: srv.URL, Token: "admin-tok"})
	c.httpClient = srv.Client()

	if err := c.CreateBranch(context.Background(), "t-7f3c9a1e", "wf-11111111", "inst-f3a8b2c1", "main"); err != nil {
		t.Fatalf("CreateBranch concurrent already-exists response: %v", err)
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
	if got.body["username"] != "t-7f3c9a1e" || got.body["visibility"] != "private" || got.body["description"] != "Acme" || got.body["members_can_create_repos"] != false {
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

func TestClient_SeedMainFile_Body(t *testing.T) {
	var got recordedReq
	srv := newTestServer(t, http.StatusCreated, `{}`, &got)
	defer srv.Close()
	c := NewClient(Config{BaseURL: srv.URL, Token: "admin-tok"})
	c.httpClient = srv.Client()

	if err := c.CreateFile(context.Background(), "t-7f3c9a1e", "wf-11111111", "main", "definition.yaml", "name: flow\n", "seed"); err != nil {
		t.Fatalf("CreateFile: %v", err)
	}
	if !strings.Contains(got.path, "/contents/definition.yaml") {
		t.Errorf("path = %q", got.path)
	}
	if got.body["branch"] != "main" || got.body["message"] != "seed" {
		t.Errorf("unexpected body: %+v", got.body)
	}
	// content must be base64 of the input
	if got.body["content"] != "bmFtZTogZmxvdwo=" {
		t.Errorf("content = %v", got.body["content"])
	}
}

func TestClient_UpsertFileUpdatesWhenCreateFindsExisting(t *testing.T) {
	var requests []recordedReq
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec := recordedReq{
			method:      r.Method,
			path:        r.URL.Path,
			auth:        r.Header.Get("Authorization"),
			contentType: r.Header.Get("Content-Type"),
		}
		if r.Body != nil {
			_ = json.NewDecoder(r.Body).Decode(&rec.body)
		}
		requests = append(requests, rec)
		w.Header().Set("Content-Type", "application/json")

		switch r.Method {
		case http.MethodPost:
			w.WriteHeader(http.StatusUnprocessableEntity)
			w.Write([]byte(`{"message":"repository file already exists"}`))
		case http.MethodGet:
			if r.URL.Query().Get("ref") != "node/abcd1234" {
				t.Errorf("GET ref = %q, want node/abcd1234", r.URL.Query().Get("ref"))
			}
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"sha":"existing-sha"}`))
		case http.MethodPut:
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{}`))
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}))
	defer srv.Close()
	c := NewClient(Config{BaseURL: srv.URL, Token: "admin-tok"})
	c.httpClient = srv.Client()

	if err := c.UpsertFile(context.Background(), "t-7f3c9a1e", "deliverable-archive", "node/abcd1234", "nodes/abcd1234/doc.md", "# v2\n", "deliverable upload"); err != nil {
		t.Fatalf("UpsertFile: %v", err)
	}

	if len(requests) != 3 {
		t.Fatalf("requests = %d, want POST + GET + PUT: %+v", len(requests), requests)
	}
	if requests[0].method != http.MethodPost || requests[1].method != http.MethodGet || requests[2].method != http.MethodPut {
		t.Fatalf("request methods = %s, %s, %s; want POST, GET, PUT", requests[0].method, requests[1].method, requests[2].method)
	}
	if requests[2].body["branch"] != "node/abcd1234" || requests[2].body["sha"] != "existing-sha" || requests[2].body["content"] != "IyB2Mgo=" {
		t.Fatalf("PUT body = %+v, want branch + sha + base64 content", requests[2].body)
	}
}

func TestClient_CreateUserToken(t *testing.T) {
	var got recordedReq
	srv := newTestServer(t, http.StatusCreated, `{"sha1":"pat-secret"}`, &got)
	defer srv.Close()
	c := NewClient(Config{BaseURL: srv.URL, Token: "admin-tok"})
	c.httpClient = srv.Client()

	tok, err := c.CreateUserToken(context.Background(), "bot-t-7f3c9a1e", "costrict-team-bot-default")
	if err != nil {
		t.Fatalf("CreateUserToken: %v", err)
	}
	if tok != "pat-secret" {
		t.Errorf("token = %q, want pat-secret", tok)
	}
	if got.body["name"] != "costrict-team-bot-default" {
		t.Errorf("body = %+v", got.body)
	}
	scopes, ok := got.body["scopes"].([]any)
	if !ok || len(scopes) != 2 || scopes[0] != "write:repository" || scopes[1] != "read:user" {
		t.Errorf("scopes = %#v, want write:repository + read:user", got.body["scopes"])
	}
	// Gitea's /users/{name}/tokens rejects token auth (401); it requires basic
	// auth with the configured token as the password.
	if !strings.HasPrefix(got.auth, "Basic ") {
		t.Errorf("auth = %q, want Basic (token endpoint requires basic-auth)", got.auth)
	}
}

func TestClient_AdminCreateUser_Idempotent(t *testing.T) {
	// 201 = created; 422 = already exists. Both must return nil (idempotent).
	for _, status := range []int{http.StatusCreated, http.StatusUnprocessableEntity} {
		var got recordedReq
		srv := newTestServer(t, status, `{}`, &got)
		c := NewClient(Config{BaseURL: srv.URL, Token: "admin-tok"})
		c.httpClient = srv.Client()

		err := c.AdminCreateUser(context.Background(), "bot-t-7f3c9a1e", "bot+7f3c9a1e@costrict.internal")
		srv.Close()
		if err != nil {
			t.Errorf("AdminCreateUser(%d): expected nil (idempotent), got %v", status, err)
		}
		if got.body["username"] != "bot-t-7f3c9a1e" {
			t.Errorf("AdminCreateUser(%d): body username = %v", status, got.body["username"])
		}
	}
}

func TestClient_AdminCreateUser_5xx(t *testing.T) {
	var got recordedReq
	srv := newTestServer(t, http.StatusInternalServerError, `{"message":"boom"}`, &got)
	defer srv.Close()
	c := NewClient(Config{BaseURL: srv.URL, Token: "admin-tok"})
	c.httpClient = srv.Client()

	if err := c.AdminCreateUser(context.Background(), "bot-t-7f3c9a1e", "x@costrict.internal"); err == nil {
		t.Fatal("AdminCreateUser(500): expected error, got nil")
	}
}

func TestClient_ProtectBranch_Idempotent(t *testing.T) {
	for _, status := range []int{http.StatusCreated, http.StatusUnprocessableEntity} {
		var got recordedReq
		srv := newTestServer(t, status, `{}`, &got)
		c := NewClient(Config{BaseURL: srv.URL, Token: "admin-tok"})
		c.httpClient = srv.Client()

		if err := c.ProtectBranch(context.Background(), "t-7f3c9a1e", "wf-11111111", "main"); err != nil {
			t.Errorf("ProtectBranch(%d): expected nil (idempotent), got %v", status, err)
		}
		srv.Close()
	}
}

func TestClient_AddOrgMember(t *testing.T) {
	// AddOrgMember is TWO calls against real Gitea: GET /orgs/{org}/teams, then
	// PUT /teams/{id}/members/{u} — there is NO PUT /orgs/{org}/members/{u}
	// (it 405s). The fake serves both endpoints and records each.
	var gotTeam, gotMember recordedReq
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/teams") && !strings.Contains(r.URL.Path, "/members/"):
			gotTeam.method, gotTeam.path, gotTeam.auth = r.Method, r.URL.Path, r.Header.Get("Authorization")
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`[{"id":7,"name":"Owners"}]`))
		case strings.Contains(r.URL.Path, "/members/"):
			gotMember.method, gotMember.path, gotMember.auth = r.Method, r.URL.Path, r.Header.Get("Authorization")
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	c := NewClient(Config{BaseURL: srv.URL, Token: "admin-tok"})
	c.httpClient = srv.Client()

	if err := c.AddOrgMember(context.Background(), "t-7f3c9a1e", "bot-t-7f3c9a1e"); err != nil {
		t.Fatalf("AddOrgMember: %v", err)
	}
	if gotTeam.method != http.MethodGet || !strings.HasSuffix(gotTeam.path, "/orgs/t-7f3c9a1e/teams") {
		t.Errorf("list teams request: %s %s", gotTeam.method, gotTeam.path)
	}
	if gotTeam.auth != "token admin-tok" {
		t.Errorf("teams auth = %q, want token admin-tok", gotTeam.auth)
	}
	if gotMember.method != http.MethodPut || !strings.HasSuffix(gotMember.path, "/teams/7/members/bot-t-7f3c9a1e") {
		t.Errorf("add member request: %s %s", gotMember.method, gotMember.path)
	}
}

func TestClient_ListOrgTeams(t *testing.T) {
	var got recordedReq
	srv := newTestServer(t, http.StatusOK, `[{"id":3,"name":"Owners"},{"id":4,"name":"Devs"}]`, &got)
	defer srv.Close()
	c := NewClient(Config{BaseURL: srv.URL, Token: "admin-tok"})
	c.httpClient = srv.Client()

	teams, err := c.ListOrgTeams(context.Background(), "t-7f3c9a1e")
	if err != nil {
		t.Fatalf("ListOrgTeams: %v", err)
	}
	if len(teams) != 2 || teams[0].ID != 3 || teams[0].Name != "Owners" {
		t.Errorf("teams = %+v", teams)
	}
	if got.method != http.MethodGet || !strings.HasSuffix(got.path, "/orgs/t-7f3c9a1e/teams") {
		t.Errorf("request: %s %s", got.method, got.path)
	}
}
