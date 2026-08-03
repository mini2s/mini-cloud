package gitea

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientReadsPullRequestAndFileAtFixedCommit(t *testing.T) {
	const content = "## task: Ship\nkey: ship\nassignee: alex@example.com\n\nShip it.\n"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/repos/acme/work/pulls/7":
			fmt.Fprint(w, `{"number":7,"state":"open","merged":false,"html_url":"https://gitea.test/acme/work/pulls/7","head":{"ref":"node/01-a","sha":"commit-123","repo":{"name":"work","owner":{"login":"acme"}}},"base":{"ref":"inst-b","repo":{"name":"work","owner":{"login":"acme"}}}}`)
		case "/api/v1/repos/acme/work/contents/nodes/01/task.md":
			if r.URL.Query().Get("ref") != "commit-123" {
				t.Fatalf("ref = %q, want fixed commit", r.URL.Query().Get("ref"))
			}
			fmt.Fprintf(w, `{"content":%q,"encoding":"base64","sha":"blob-456"}`, base64.StdEncoding.EncodeToString([]byte(content)))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client := NewClient(Config{BaseURL: server.URL, Token: "token"})

	metadata, err := client.GetPullRequest(context.Background(), "acme", "work", 7)
	if err != nil {
		t.Fatal(err)
	}
	if metadata.HeadCommitSHA != "commit-123" || metadata.HeadRef != "node/01-a" || metadata.BaseRef != "inst-b" {
		t.Fatalf("metadata = %+v", metadata)
	}
	got, blobSHA, err := client.ReadFileAtCommit(context.Background(), "acme", "work", "nodes/01/task.md", metadata.HeadCommitSHA)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != content || blobSHA != "blob-456" {
		t.Fatalf("content/blob = %q/%q", got, blobSHA)
	}
}
