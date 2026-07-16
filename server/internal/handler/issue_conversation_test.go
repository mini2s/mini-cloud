package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/cloudruntime"
)

func TestGetIssueConversationSessionReturnsExisting(t *testing.T) {
	var projectID string
	err := testPool.QueryRow(context.Background(), `
		INSERT INTO multica_project (workspace_id, title, status, local_directory)
		VALUES ($1, 'Test Project', 'planned', '/Users/dev/project')
		RETURNING id
	`, testWorkspaceID).Scan(&projectID)
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	defer testPool.Exec(context.Background(), `DELETE FROM multica_project WHERE id = $1`, projectID)

	var issueID string
	err = testPool.QueryRow(context.Background(), `
		INSERT INTO multica_issue (workspace_id, title, description, status, priority, creator_type, creator_id, number, project_id)
		VALUES ($1, 'Test Issue', 'description', 'todo', 'medium', 'member', $2, 9999, $3)
		RETURNING id
	`, testWorkspaceID, testUserID, projectID).Scan(&issueID)
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}
	defer testPool.Exec(context.Background(), `DELETE FROM multica_issue WHERE id = $1`, issueID)

	_, err = testPool.Exec(context.Background(), `
		INSERT INTO multica_issue_conversation (issue_id, conversation_id, workspace_directory, device_id)
		VALUES ($1, 'conv-existing', '/Users/dev/project', 'dev-1')
	`, issueID)
	if err != nil {
		t.Fatalf("insert conversation mapping: %v", err)
	}
	defer testPool.Exec(context.Background(), `DELETE FROM multica_issue_conversation WHERE issue_id = $1`, issueID)

	req := newRequest(http.MethodGet, "/api/workspaces/"+testWorkspaceID+"/issues/"+issueID+"/session", nil)
	req = withURLParams(req, "id", testWorkspaceID, "issueID", issueID)
	w := httptest.NewRecorder()

	testHandler.GetIssueConversationSession(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	var resp IssueConversationSessionResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.ConversationID != "conv-existing" {
		t.Fatalf("conversation_id = %q", resp.ConversationID)
	}
	if !strings.Contains(resp.EventsURL, "conversation_id=conv-existing") {
		t.Fatalf("events_url = %q", resp.EventsURL)
	}
}

func TestGetIssueConversationSessionCreatesNew(t *testing.T) {
	_, err := testPool.Exec(context.Background(), `
		INSERT INTO multica_agent_runtime (
			workspace_id, daemon_id, name, runtime_mode, provider, status, device_info, metadata, last_seen_at
		) VALUES ($1, 'dev-123', 'cs-cloud', 'local', 'cs-cloud', 'online', 'macbook', '{"device_id":"dev-123"}'::jsonb, now())
	`, testWorkspaceID)
	if err != nil {
		t.Fatalf("create runtime: %v", err)
	}
	defer testPool.Exec(context.Background(), `DELETE FROM multica_agent_runtime WHERE daemon_id = 'dev-123'`)

	var projectID string
	err = testPool.QueryRow(context.Background(), `
		INSERT INTO multica_project (workspace_id, title, status, local_directory)
		VALUES ($1, 'Test Project', 'planned', '/Users/dev/project')
		RETURNING id
	`, testWorkspaceID).Scan(&projectID)
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	defer testPool.Exec(context.Background(), `DELETE FROM multica_project WHERE id = $1`, projectID)

	var issueID string
	err = testPool.QueryRow(context.Background(), `
		INSERT INTO multica_issue (workspace_id, title, description, status, priority, creator_type, creator_id, number, project_id)
		VALUES ($1, 'Test Issue', 'description', 'todo', 'medium', 'member', $2, 9998, $3)
		RETURNING id
	`, testWorkspaceID, testUserID, projectID).Scan(&issueID)
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}
	defer testPool.Exec(context.Background(), `DELETE FROM multica_issue WHERE id = $1`, issueID)
	defer testPool.Exec(context.Background(), `DELETE FROM multica_issue_conversation WHERE issue_id = $1`, issueID)

	proxy := &fakeCloudRuntimeProxy{
		enabled: true,
		resp: &cloudruntime.Response{
			StatusCode: http.StatusOK,
			Body:       []byte(`{"id":"conv-new"}`),
		},
	}
	useCloudRuntimeProxy(t, proxy)

	req := newRequest(http.MethodGet, "/api/workspaces/"+testWorkspaceID+"/issues/"+issueID+"/session", nil)
	req = withURLParams(req, "id", testWorkspaceID, "issueID", issueID)
	w := httptest.NewRecorder()

	testHandler.GetIssueConversationSession(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	var resp IssueConversationSessionResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.ConversationID != "conv-new" {
		t.Fatalf("conversation_id = %q", resp.ConversationID)
	}
	if !strings.Contains(resp.EventsURL, "conversation_id=conv-new") {
		t.Fatalf("events_url = %q", resp.EventsURL)
	}
	if !proxy.called {
		t.Fatal("cloud runtime proxy was not called")
	}
	if proxy.req.Method != http.MethodPost {
		t.Fatalf("method = %q", proxy.req.Method)
	}
	if !strings.Contains(proxy.req.Path, "/device/dev-123/proxy/api/v1/conversations") {
		t.Fatalf("path = %q", proxy.req.Path)
	}
}
