package gitea

import (
	"context"
	"errors"
	"net/http"
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
