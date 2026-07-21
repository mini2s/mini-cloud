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
		VALUES ($1, 'conv-existing', '/Users/dev/project', 'dev-existing')
	`, issueID)
	if err != nil {
		t.Fatalf("insert conversation mapping: %v", err)
	}
	defer testPool.Exec(context.Background(), `DELETE FROM multica_issue_conversation WHERE issue_id = $1`, issueID)

	_, err = testPool.Exec(context.Background(), `
		INSERT INTO multica_agent_runtime (
			workspace_id, daemon_id, name, runtime_mode, provider, status, device_info, metadata, last_seen_at
		) VALUES ($1, 'dev-existing', 'cs-cloud', 'local', 'cs-cloud', 'online', 'macbook', '{"device_id":"dev-existing"}'::jsonb, now())
	`, testWorkspaceID)
	if err != nil {
		t.Fatalf("create runtime: %v", err)
	}
	defer testPool.Exec(context.Background(), `DELETE FROM multica_agent_runtime WHERE daemon_id = 'dev-existing'`)

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
	if resp.ProxyBaseURL != "/cloud-api/cloud/device/dev-existing/proxy" {
		t.Fatalf("proxy_base_url = %q", resp.ProxyBaseURL)
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
	if resp.ProxyBaseURL != "/cloud-api/cloud/device/dev-123/proxy" {
		t.Fatalf("proxy_base_url = %q", resp.ProxyBaseURL)
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

func TestGetIssueConversationSessionWithoutLocalDirectory(t *testing.T) {
	_, err := testPool.Exec(context.Background(), `
		INSERT INTO multica_agent_runtime (
			workspace_id, daemon_id, name, runtime_mode, provider, status, device_info, metadata, last_seen_at
		) VALUES ($1, 'dev-nodir', 'cs-cloud', 'local', 'cs-cloud', 'online', 'macbook', '{"device_id":"dev-nodir"}'::jsonb, now())
	`, testWorkspaceID)
	if err != nil {
		t.Fatalf("create runtime: %v", err)
	}
	defer testPool.Exec(context.Background(), `DELETE FROM multica_agent_runtime WHERE daemon_id = 'dev-nodir'`)

	var projectID string
	err = testPool.QueryRow(context.Background(), `
		INSERT INTO multica_project (workspace_id, title, status)
		VALUES ($1, 'Test Project', 'planned')
		RETURNING id
	`, testWorkspaceID).Scan(&projectID)
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	defer testPool.Exec(context.Background(), `DELETE FROM multica_project WHERE id = $1`, projectID)

	var issueID string
	err = testPool.QueryRow(context.Background(), `
		INSERT INTO multica_issue (workspace_id, title, description, status, priority, creator_type, creator_id, number, project_id)
		VALUES ($1, 'Test Issue', 'description', 'todo', 'medium', 'member', $2, 9997, $3)
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
			Body:       []byte(`{"id":"conv-nodir"}`),
		},
	}
	useCloudRuntimeProxy(t, proxy)

	req := newRequest(http.MethodGet, "/api/workspaces/"+testWorkspaceID+"/issues/"+issueID+"/session", nil)
	req = withURLParams(req, "id", testWorkspaceID, "issueID", issueID)
	w := httptest.NewRecorder()

	testHandler.GetIssueConversationSession(w, req)

	// A project without local_directory is not an error: the conversation is
	// created with an empty directory and no directory header is sent.
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	var resp IssueConversationSessionResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.ConversationID != "conv-nodir" {
		t.Fatalf("conversation_id = %q", resp.ConversationID)
	}
	if resp.WorkspaceDirectory != "" {
		t.Fatalf("workspace_directory = %q", resp.WorkspaceDirectory)
	}
	if got := proxy.req.Headers.Get("X-Workspace-Directory"); got != "" {
		t.Fatalf("X-Workspace-Directory = %q, want empty", got)
	}
}

func TestGetIssueConversationSessionWithoutProject(t *testing.T) {
	_, err := testPool.Exec(context.Background(), `
		INSERT INTO multica_agent_runtime (
			workspace_id, daemon_id, name, runtime_mode, provider, status, device_info, metadata, last_seen_at
		) VALUES ($1, 'dev-noproj', 'cs-cloud', 'local', 'cs-cloud', 'online', 'macbook', '{"device_id":"dev-noproj"}'::jsonb, now())
	`, testWorkspaceID)
	if err != nil {
		t.Fatalf("create runtime: %v", err)
	}
	defer testPool.Exec(context.Background(), `DELETE FROM multica_agent_runtime WHERE daemon_id = 'dev-noproj'`)

	var issueID string
	err = testPool.QueryRow(context.Background(), `
		INSERT INTO multica_issue (workspace_id, title, description, status, priority, creator_type, creator_id, number)
		VALUES ($1, 'Test Issue', 'description', 'todo', 'medium', 'member', $2, 9996)
		RETURNING id
	`, testWorkspaceID, testUserID).Scan(&issueID)
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}
	defer testPool.Exec(context.Background(), `DELETE FROM multica_issue WHERE id = $1`, issueID)
	defer testPool.Exec(context.Background(), `DELETE FROM multica_issue_conversation WHERE issue_id = $1`, issueID)

	proxy := &fakeCloudRuntimeProxy{
		enabled: true,
		resp: &cloudruntime.Response{
			StatusCode: http.StatusOK,
			Body:       []byte(`{"id":"conv-noproj"}`),
		},
	}
	useCloudRuntimeProxy(t, proxy)

	req := newRequest(http.MethodGet, "/api/workspaces/"+testWorkspaceID+"/issues/"+issueID+"/session", nil)
	req = withURLParams(req, "id", testWorkspaceID, "issueID", issueID)
	w := httptest.NewRecorder()

	testHandler.GetIssueConversationSession(w, req)

	// An issue with no bound project must still get a conversation; the device
	// agent falls back to its default working directory.
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	var resp IssueConversationSessionResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.ConversationID != "conv-noproj" {
		t.Fatalf("conversation_id = %q", resp.ConversationID)
	}
	if resp.WorkspaceDirectory != "" {
		t.Fatalf("workspace_directory = %q", resp.WorkspaceDirectory)
	}
	if got := proxy.req.Headers.Get("X-Workspace-Directory"); got != "" {
		t.Fatalf("X-Workspace-Directory = %q, want empty", got)
	}
}

func TestGetIssueConversationSessionNoOnlineRuntime(t *testing.T) {
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
		VALUES ($1, 'Test Issue', 'description', 'todo', 'medium', 'member', $2, 9996, $3)
		RETURNING id
	`, testWorkspaceID, testUserID, projectID).Scan(&issueID)
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}
	defer testPool.Exec(context.Background(), `DELETE FROM multica_issue WHERE id = $1`, issueID)

	req := newRequest(http.MethodGet, "/api/workspaces/"+testWorkspaceID+"/issues/"+issueID+"/session", nil)
	req = withURLParams(req, "id", testWorkspaceID, "issueID", issueID)
	w := httptest.NewRecorder()

	testHandler.GetIssueConversationSession(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
}

func TestGetIssueConversationSessionCloudRuntimeDisabled(t *testing.T) {
	_, err := testPool.Exec(context.Background(), `
		INSERT INTO multica_agent_runtime (
			workspace_id, daemon_id, name, runtime_mode, provider, status, device_info, metadata, last_seen_at
		) VALUES ($1, 'dev-456', 'cs-cloud', 'local', 'cs-cloud', 'online', 'macbook', '{"device_id":"dev-456"}'::jsonb, now())
	`, testWorkspaceID)
	if err != nil {
		t.Fatalf("create runtime: %v", err)
	}
	defer testPool.Exec(context.Background(), `DELETE FROM multica_agent_runtime WHERE daemon_id = 'dev-456'`)

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
		VALUES ($1, 'Test Issue', 'description', 'todo', 'medium', 'member', $2, 9995, $3)
		RETURNING id
	`, testWorkspaceID, testUserID, projectID).Scan(&issueID)
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}
	defer testPool.Exec(context.Background(), `DELETE FROM multica_issue WHERE id = $1`, issueID)

	useCloudRuntimeProxy(t, &fakeCloudRuntimeProxy{enabled: false})

	req := newRequest(http.MethodGet, "/api/workspaces/"+testWorkspaceID+"/issues/"+issueID+"/session", nil)
	req = withURLParams(req, "id", testWorkspaceID, "issueID", issueID)
	w := httptest.NewRecorder()

	testHandler.GetIssueConversationSession(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
}

func TestGetIssueConversationSessionInvalidDeviceResponse(t *testing.T) {
	_, err := testPool.Exec(context.Background(), `
		INSERT INTO multica_agent_runtime (
			workspace_id, daemon_id, name, runtime_mode, provider, status, device_info, metadata, last_seen_at
		) VALUES ($1, 'dev-789', 'cs-cloud', 'local', 'cs-cloud', 'online', 'macbook', '{"device_id":"dev-789"}'::jsonb, now())
	`, testWorkspaceID)
	if err != nil {
		t.Fatalf("create runtime: %v", err)
	}
	defer testPool.Exec(context.Background(), `DELETE FROM multica_agent_runtime WHERE daemon_id = 'dev-789'`)

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
		VALUES ($1, 'Test Issue', 'description', 'todo', 'medium', 'member', $2, 9994, $3)
		RETURNING id
	`, testWorkspaceID, testUserID, projectID).Scan(&issueID)
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}
	defer testPool.Exec(context.Background(), `DELETE FROM multica_issue WHERE id = $1`, issueID)

	useCloudRuntimeProxy(t, &fakeCloudRuntimeProxy{
		enabled: true,
		resp: &cloudruntime.Response{
			StatusCode: http.StatusOK,
			Body:       []byte(`{}`),
		},
	})

	req := newRequest(http.MethodGet, "/api/workspaces/"+testWorkspaceID+"/issues/"+issueID+"/session", nil)
	req = withURLParams(req, "id", testWorkspaceID, "issueID", issueID)
	w := httptest.NewRecorder()

	testHandler.GetIssueConversationSession(w, req)

	if w.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
}

func TestGetIssueConversationSessionIssueNotFound(t *testing.T) {
	missingIssueID := "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"

	req := newRequest(http.MethodGet, "/api/workspaces/"+testWorkspaceID+"/issues/"+missingIssueID+"/session", nil)
	req = withURLParams(req, "id", testWorkspaceID, "issueID", missingIssueID)
	w := httptest.NewRecorder()

	testHandler.GetIssueConversationSession(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
}

func TestGetIssueConversationSessionNonMember(t *testing.T) {
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
		VALUES ($1, 'Test Issue', 'description', 'todo', 'medium', 'member', $2, 9993, $3)
		RETURNING id
	`, testWorkspaceID, testUserID, projectID).Scan(&issueID)
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}
	defer testPool.Exec(context.Background(), `DELETE FROM multica_issue WHERE id = $1`, issueID)

	req := newRequest(http.MethodGet, "/api/workspaces/"+testWorkspaceID+"/issues/"+issueID+"/session", nil)
	req.Header.Set("X-User-ID", "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d")
	req = withURLParams(req, "id", testWorkspaceID, "issueID", issueID)
	w := httptest.NewRecorder()

	testHandler.GetIssueConversationSession(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
}

func TestGetIssueConversationSessionRecreatesWhenDeviceOffline(t *testing.T) {
	_, err := testPool.Exec(context.Background(), `
		INSERT INTO multica_agent_runtime (
			workspace_id, daemon_id, name, runtime_mode, provider, status, device_info, metadata, last_seen_at
		) VALUES ($1, 'dev-old', 'cs-cloud', 'local', 'cs-cloud', 'online', 'macbook', '{"device_id":"dev-old"}'::jsonb, now())
	`, testWorkspaceID)
	if err != nil {
		t.Fatalf("create old runtime: %v", err)
	}
	defer testPool.Exec(context.Background(), `DELETE FROM multica_agent_runtime WHERE daemon_id = 'dev-old'`)

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
		VALUES ($1, 'Test Issue', 'description', 'todo', 'medium', 'member', $2, 9992, $3)
		RETURNING id
	`, testWorkspaceID, testUserID, projectID).Scan(&issueID)
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}
	defer testPool.Exec(context.Background(), `DELETE FROM multica_issue WHERE id = $1`, issueID)

	_, err = testPool.Exec(context.Background(), `
		INSERT INTO multica_issue_conversation (issue_id, conversation_id, workspace_directory, device_id)
		VALUES ($1, 'conv-old', '/Users/dev/project', 'dev-old')
	`, issueID)
	if err != nil {
		t.Fatalf("insert conversation mapping: %v", err)
	}
	defer testPool.Exec(context.Background(), `DELETE FROM multica_issue_conversation WHERE issue_id = $1`, issueID)

	// Mark old device offline and bring a new one online.
	_, err = testPool.Exec(context.Background(), `
		UPDATE multica_agent_runtime SET status = 'offline' WHERE daemon_id = 'dev-old'
	`)
	if err != nil {
		t.Fatalf("offline old runtime: %v", err)
	}
	_, err = testPool.Exec(context.Background(), `
		INSERT INTO multica_agent_runtime (
			workspace_id, daemon_id, name, runtime_mode, provider, status, device_info, metadata, last_seen_at
		) VALUES ($1, 'dev-new', 'cs-cloud', 'local', 'cs-cloud', 'online', 'macbook', '{"device_id":"dev-new"}'::jsonb, now())
	`, testWorkspaceID)
	if err != nil {
		t.Fatalf("create new runtime: %v", err)
	}
	defer testPool.Exec(context.Background(), `DELETE FROM multica_agent_runtime WHERE daemon_id = 'dev-new'`)

	proxy := &fakeCloudRuntimeProxy{
		enabled: true,
		resp: &cloudruntime.Response{
			StatusCode: http.StatusOK,
			Body:       []byte(`{"id":"conv-new-device"}`),
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
	if resp.ConversationID != "conv-new-device" {
		t.Fatalf("conversation_id = %q", resp.ConversationID)
	}
	if resp.ProxyBaseURL == "" {
		t.Fatal("proxy_base_url is empty")
	}
	if !proxy.called {
		t.Fatal("cloud runtime proxy was not called")
	}
}

func TestGetIssueConversationSessionInvalidJSONDeviceResponse(t *testing.T) {
	_, err := testPool.Exec(context.Background(), `
		INSERT INTO multica_agent_runtime (
			workspace_id, daemon_id, name, runtime_mode, provider, status, device_info, metadata, last_seen_at
		) VALUES ($1, 'dev-json', 'cs-cloud', 'local', 'cs-cloud', 'online', 'macbook', '{"device_id":"dev-json"}'::jsonb, now())
	`, testWorkspaceID)
	if err != nil {
		t.Fatalf("create runtime: %v", err)
	}
	defer testPool.Exec(context.Background(), `DELETE FROM multica_agent_runtime WHERE daemon_id = 'dev-json'`)

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
		VALUES ($1, 'Test Issue', 'description', 'todo', 'medium', 'member', $2, 9991, $3)
		RETURNING id
	`, testWorkspaceID, testUserID, projectID).Scan(&issueID)
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}
	defer testPool.Exec(context.Background(), `DELETE FROM multica_issue WHERE id = $1`, issueID)

	useCloudRuntimeProxy(t, &fakeCloudRuntimeProxy{
		enabled: true,
		resp: &cloudruntime.Response{
			StatusCode: http.StatusOK,
			Body:       []byte(`not json`),
		},
	})

	req := newRequest(http.MethodGet, "/api/workspaces/"+testWorkspaceID+"/issues/"+issueID+"/session", nil)
	req = withURLParams(req, "id", testWorkspaceID, "issueID", issueID)
	w := httptest.NewRecorder()

	testHandler.GetIssueConversationSession(w, req)

	if w.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
}

func TestGetIssueConversationSessionRecreatesWhenConversationMissing(t *testing.T) {
	_, err := testPool.Exec(context.Background(), `
		INSERT INTO multica_agent_runtime (
			workspace_id, daemon_id, name, runtime_mode, provider, status, device_info, metadata, last_seen_at
		) VALUES ($1, 'dev-stale', 'cs-cloud', 'local', 'cs-cloud', 'online', 'macbook', '{"device_id":"dev-stale"}'::jsonb, now())
	`, testWorkspaceID)
	if err != nil {
		t.Fatalf("create runtime: %v", err)
	}
	defer testPool.Exec(context.Background(), `DELETE FROM multica_agent_runtime WHERE daemon_id = 'dev-stale'`)

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
		VALUES ($1, 'Test Issue', 'description', 'todo', 'medium', 'member', $2, 9990, $3)
		RETURNING id
	`, testWorkspaceID, testUserID, projectID).Scan(&issueID)
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}
	defer testPool.Exec(context.Background(), `DELETE FROM multica_issue WHERE id = $1`, issueID)

	_, err = testPool.Exec(context.Background(), `
		INSERT INTO multica_issue_conversation (issue_id, conversation_id, workspace_directory, device_id)
		VALUES ($1, 'conv-stale', '/Users/dev/project', 'dev-stale')
	`, issueID)
	if err != nil {
		t.Fatalf("insert conversation mapping: %v", err)
	}
	defer testPool.Exec(context.Background(), `DELETE FROM multica_issue_conversation WHERE issue_id = $1`, issueID)

	// The device answers 404 for the stale conversation (agent restart / idle
	// eviction wiped it), then accepts the recreate POST.
	proxy := &fakeCloudRuntimeProxy{
		enabled: true,
		doFunc: func(req cloudruntime.Request) (*cloudruntime.Response, error) {
			if req.Method == http.MethodGet {
				return &cloudruntime.Response{
					StatusCode: http.StatusNotFound,
					Body:       []byte(`{"error":{"message":"session not found"}}`),
				}, nil
			}
			return &cloudruntime.Response{
				StatusCode: http.StatusOK,
				Body:       []byte(`{"id":"conv-recreated"}`),
			}, nil
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
	if resp.ConversationID != "conv-recreated" {
		t.Fatalf("conversation_id = %q", resp.ConversationID)
	}

	// Expect GET (verify) then POST (recreate).
	if len(proxy.reqs) != 2 {
		t.Fatalf("proxy calls = %d, want 2", len(proxy.reqs))
	}
	if proxy.reqs[0].Method != http.MethodGet ||
		!strings.HasSuffix(proxy.reqs[0].Path, "/device/dev-stale/proxy/api/v1/conversations/conv-stale") {
		t.Fatalf("verify call = %s %s", proxy.reqs[0].Method, proxy.reqs[0].Path)
	}
	if proxy.reqs[1].Method != http.MethodPost {
		t.Fatalf("recreate call = %s %s", proxy.reqs[1].Method, proxy.reqs[1].Path)
	}

	// The mapping must now point at the new conversation.
	var mapped string
	err = testPool.QueryRow(context.Background(),
		`SELECT conversation_id FROM multica_issue_conversation WHERE issue_id = $1`, issueID).Scan(&mapped)
	if err != nil {
		t.Fatalf("read mapping: %v", err)
	}
	if mapped != "conv-recreated" {
		t.Fatalf("mapped conversation_id = %q", mapped)
	}
}

func TestGetIssueConversationSessionKeepsMappingWhenVerifyInconclusive(t *testing.T) {
	_, err := testPool.Exec(context.Background(), `
		INSERT INTO multica_agent_runtime (
			workspace_id, daemon_id, name, runtime_mode, provider, status, device_info, metadata, last_seen_at
		) VALUES ($1, 'dev-flaky', 'cs-cloud', 'local', 'cs-cloud', 'online', 'macbook', '{"device_id":"dev-flaky"}'::jsonb, now())
	`, testWorkspaceID)
	if err != nil {
		t.Fatalf("create runtime: %v", err)
	}
	defer testPool.Exec(context.Background(), `DELETE FROM multica_agent_runtime WHERE daemon_id = 'dev-flaky'`)

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
		VALUES ($1, 'Test Issue', 'description', 'todo', 'medium', 'member', $2, 9989, $3)
		RETURNING id
	`, testWorkspaceID, testUserID, projectID).Scan(&issueID)
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}
	defer testPool.Exec(context.Background(), `DELETE FROM multica_issue WHERE id = $1`, issueID)

	_, err = testPool.Exec(context.Background(), `
		INSERT INTO multica_issue_conversation (issue_id, conversation_id, workspace_directory, device_id)
		VALUES ($1, 'conv-flaky', '/Users/dev/project', 'dev-flaky')
	`, issueID)
	if err != nil {
		t.Fatalf("insert conversation mapping: %v", err)
	}
	defer testPool.Exec(context.Background(), `DELETE FROM multica_issue_conversation WHERE issue_id = $1`, issueID)

	// A transient device error (500, timeout, ...) must not destroy the
	// mapping: the cached id is returned as before.
	proxy := &fakeCloudRuntimeProxy{
		enabled: true,
		resp: &cloudruntime.Response{
			StatusCode: http.StatusInternalServerError,
			Body:       []byte(`{"error":"boom"}`),
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
	if resp.ConversationID != "conv-flaky" {
		t.Fatalf("conversation_id = %q", resp.ConversationID)
	}

	// Only the verify GET — no recreate POST.
	if len(proxy.reqs) != 1 || proxy.reqs[0].Method != http.MethodGet {
		t.Fatalf("proxy calls = %v", proxy.reqs)
	}

	var mapped string
	err = testPool.QueryRow(context.Background(),
		`SELECT conversation_id FROM multica_issue_conversation WHERE issue_id = $1`, issueID).Scan(&mapped)
	if err != nil {
		t.Fatalf("read mapping: %v", err)
	}
	if mapped != "conv-flaky" {
		t.Fatalf("mapped conversation_id = %q", mapped)
	}
}

