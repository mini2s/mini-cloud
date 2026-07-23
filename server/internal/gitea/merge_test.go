package gitea

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParsePullRequestIndex(t *testing.T) {
	cases := []struct {
		url   string
		index int
	}{
		{"https://gitea.example.com/t-7f3c9a1e/wf-11111111/pulls/42", 42},
		{"http://gitea.local/t-abcd1234/wf-abcd1234/pulls/7", 7},
		{"https://gitea.example.com/t-7f3c9a1e/wf-11111111/pulls/42/files", 42},
	}
	for _, c := range cases {
		got, err := ParsePullRequestIndex(c.url)
		if err != nil {
			t.Errorf("ParsePullRequestIndex(%q): %v", c.url, err)
			continue
		}
		if got != c.index {
			t.Errorf("ParsePullRequestIndex(%q) = %d, want %d", c.url, got, c.index)
		}
	}
}

func TestParsePullRequestIndex_Invalid(t *testing.T) {
	for _, bad := range []string{
		"", "not-a-url",
		"https://gitea.example.com/t-x/wf-y",       // no pulls segment
		"https://gitea.example.com/t-x/wf-y/pulls", // pulls as last segment
		"https://gitea.example.com/t-x/wf-y/pulls/notanumber",
		"https://gitea.example.com/t-x/wf-y/pulls/0",  // zero
		"https://gitea.example.com/t-x/wf-y/pulls/-5", // negative
	} {
		if _, err := ParsePullRequestIndex(bad); err == nil {
			t.Errorf("ParsePullRequestIndex(%q): expected error", bad)
		}
	}
}

func TestClient_MergePR_NotConfigured(t *testing.T) {
	c := NewClient(Config{})
	if err := c.MergePR(context.Background(), "t-7f3c9a1e", "wf-11111111", 1); err != ErrNotConfigured {
		t.Fatalf("got err %v, want ErrNotConfigured", err)
	}
}

func TestClient_MergePR(t *testing.T) {
	var got recordedReq
	srv := newTestServer(t, http.StatusOK, `{}`, &got)
	defer srv.Close()
	c := NewClient(Config{BaseURL: srv.URL, Token: "admin-tok"})
	c.httpClient = srv.Client()

	if err := c.MergePR(context.Background(), "t-7f3c9a1e", "wf-11111111", 42); err != nil {
		t.Fatalf("MergePR: %v", err)
	}
	if got.method != http.MethodPost || !strings.HasSuffix(got.path, "/repos/t-7f3c9a1e/wf-11111111/pulls/42/merge") {
		t.Errorf("unexpected request: %s %s", got.method, got.path)
	}
	if got.body["Do"] != "merge" {
		t.Errorf("body Do = %v, want \"merge\"", got.body["Do"])
	}
}

func TestClient_MergePR_ConflictReturnsSentinel(t *testing.T) {
	var got recordedReq
	srv := newTestServer(t, http.StatusConflict, `{"message":"conflict"}`, &got)
	defer srv.Close()
	c := NewClient(Config{BaseURL: srv.URL, Token: "admin-tok"})
	c.httpClient = srv.Client()

	err := c.MergePR(context.Background(), "t-7f3c9a1e", "wf-11111111", 42)
	if err == nil {
		t.Fatal("MergePR(409): expected error, got nil")
	}
	if !errors.Is(err, ErrMergeConflict) {
		t.Errorf("MergePR(409): err = %v, want errors.Is ErrMergeConflict", err)
	}
}

func TestClient_OpenPR_NotConfigured(t *testing.T) {
	c := NewClient(Config{})
	if _, err := c.OpenPR(context.Background(), "t-x", "wf-y", "node/a", "inst-b", "t"); err != ErrNotConfigured {
		t.Fatalf("got err %v, want ErrNotConfigured", err)
	}
}

func TestClient_OpenPR(t *testing.T) {
	var got recordedReq
	srv := newTestServer(t, http.StatusCreated,
		`{"html_url":"http://gitea.local/t-x/wf-y/pulls/9","number":9}`, &got)
	defer srv.Close()
	c := NewClient(Config{BaseURL: srv.URL, Token: "admin-tok"})
	c.httpClient = srv.Client()

	url, err := c.OpenPR(context.Background(), "t-x", "wf-y", "node/aaa", "inst-bbb", "doc deliverable")
	if err != nil {
		t.Fatalf("OpenPR: %v", err)
	}
	if want := "http://gitea.local/t-x/wf-y/pulls/9"; url != want {
		t.Fatalf("html_url = %q, want %q", url, want)
	}
	if got.method != http.MethodPost || !strings.HasSuffix(got.path, "/repos/t-x/wf-y/pulls") {
		t.Errorf("unexpected request: %s %s", got.method, got.path)
	}
	if got.body["head"] != "node/aaa" || got.body["base"] != "inst-bbb" {
		t.Errorf("body = %v, want head=node/aaa base=inst-bbb", got.body)
	}
}

func TestClient_OpenPR_ReusesExistingPRForSameHeadAndBase(t *testing.T) {
	var methods []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		methods = append(methods, r.Method+" "+r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		switch r.Method {
		case http.MethodPost:
			w.WriteHeader(http.StatusConflict)
			w.Write([]byte(`{"message":"pull request already exists for these targets"}`))
		case http.MethodGet:
			_ = json.NewEncoder(w).Encode([]map[string]any{
				{
					"html_url": "http://gitea.local/t-x/wf-y/pulls/7",
					"head":     map[string]any{"ref": "node/aaa"},
					"base":     map[string]any{"ref": "inst-bbb"},
				},
			})
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}))
	defer srv.Close()
	c := NewClient(Config{BaseURL: srv.URL, Token: "admin-tok"})
	c.httpClient = srv.Client()

	url, err := c.OpenPR(context.Background(), "t-x", "wf-y", "node/aaa", "inst-bbb", "doc deliverable")
	if err != nil {
		t.Fatalf("OpenPR duplicate: %v", err)
	}
	if url != "http://gitea.local/t-x/wf-y/pulls/7" {
		t.Fatalf("html_url = %q, want existing PR URL", url)
	}
	if len(methods) != 2 || methods[0] != "POST /api/v1/repos/t-x/wf-y/pulls" || methods[1] != "GET /api/v1/repos/t-x/wf-y/pulls" {
		t.Fatalf("methods = %+v, want POST then GET pulls", methods)
	}
}

func TestClient_OpenPR_ErrorStatus(t *testing.T) {
	var got recordedReq
	srv := newTestServer(t, http.StatusInternalServerError, `{"message":"boom"}`, &got)
	defer srv.Close()
	c := NewClient(Config{BaseURL: srv.URL, Token: "admin-tok"})
	c.httpClient = srv.Client()

	if _, err := c.OpenPR(context.Background(), "t-x", "wf-y", "node/a", "inst-b", "t"); err == nil {
		t.Fatal("OpenPR(500): expected error, got nil")
	}
}
