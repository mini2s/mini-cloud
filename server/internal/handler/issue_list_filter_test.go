package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

// TestListIssues_ExcludesWorkflowOriginByDefault verifies that issues with
// origin_type='workflow' are excluded from the default issue list. The parent
// issue (no origin_type) must still appear; the workflow-origin child must not.
func TestListIssues_ExcludesWorkflowOriginByDefault(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}

	ctx := context.Background()
	suffix := time.Now().UnixNano()

	// Insert parent issue (no origin_type).
	parentID := insertIssueOriginFilterFixture(t, ctx, fmt.Sprintf("parent-%d", suffix), "", "")

	// Insert child issue with origin_type='workflow'.
	childID := insertIssueOriginFilterFixture(t, ctx, fmt.Sprintf("child-%d", suffix), "workflow", parentID)

	path := fmt.Sprintf("/api/issues?workspace_id=%s&limit=500", testWorkspaceID)
	w := httptest.NewRecorder()
	testHandler.ListIssues(w, newRequest("GET", path, nil))
	if w.Code != http.StatusOK {
		t.Fatalf("ListIssues: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Issues []IssueResponse `json:"issues"`
		Total  int64           `json:"total"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode list response: %v", err)
	}

	foundParent := false
	foundChild := false
	for _, iss := range resp.Issues {
		if iss.ID == parentID {
			foundParent = true
		}
		if iss.ID == childID {
			foundChild = true
		}
	}

	if !foundParent {
		t.Fatalf("default list must include parent issue %s, but it was missing", parentID)
	}
	if foundChild {
		t.Fatalf("default list must exclude workflow-origin child %s, but it was present", childID)
	}
}

// TestListIssues_IncludeWorkflowOrigin verifies that when
// include_workflow_origin=true is passed, issues with origin_type='workflow'
// are included in the response alongside regular issues.
func TestListIssues_IncludeWorkflowOrigin(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}

	ctx := context.Background()
	suffix := time.Now().UnixNano()

	// Insert parent issue (no origin_type).
	parentID := insertIssueOriginFilterFixture(t, ctx, fmt.Sprintf("include-parent-%d", suffix), "", "")

	// Insert child issue with origin_type='workflow'.
	childID := insertIssueOriginFilterFixture(t, ctx, fmt.Sprintf("include-child-%d", suffix), "workflow", parentID)

	path := fmt.Sprintf("/api/issues?workspace_id=%s&include_workflow_origin=true&limit=500", testWorkspaceID)
	w := httptest.NewRecorder()
	testHandler.ListIssues(w, newRequest("GET", path, nil))
	if w.Code != http.StatusOK {
		t.Fatalf("ListIssues: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Issues []IssueResponse `json:"issues"`
		Total  int64           `json:"total"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode list response: %v", err)
	}

	foundParent := false
	foundChild := false
	for _, iss := range resp.Issues {
		if iss.ID == parentID {
			foundParent = true
		}
		if iss.ID == childID {
			foundChild = true
		}
	}

	if !foundParent {
		t.Fatalf("include_workflow_origin=true list must include parent issue %s, but it was missing", parentID)
	}
	if !foundChild {
		t.Fatalf("include_workflow_origin=true list must include workflow-origin child %s, but it was missing", childID)
	}
}

func TestChildIssueQueriesExcludeWorkflowOriginChildren(t *testing.T) {
	query, err := os.ReadFile("../../pkg/db/queries/issue.sql")
	if err != nil {
		t.Fatalf("read issue queries: %v", err)
	}
	sql := string(query)

	listBlock := queryBlock(t, sql, "-- name: ListChildIssues", "-- name: ListIssueDescendants")
	if !strings.Contains(listBlock, "origin_type IS NULL OR origin_type <> 'workflow'") {
		t.Fatalf("ListChildIssues must exclude workflow-origin child rows, got:\n%s", listBlock)
	}

	progressBlock := queryBlock(t, sql, "-- name: ChildIssueProgress", "-- SearchIssues:")
	if !strings.Contains(progressBlock, "origin_type IS NULL OR origin_type <> 'workflow'") {
		t.Fatalf("ChildIssueProgress must exclude workflow-origin child rows, got:\n%s", progressBlock)
	}
}

func TestListChildIssuesExcludesWorkflowOriginChildren(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}

	ctx := context.Background()
	suffix := time.Now().UnixNano()

	parentID := insertIssueOriginFilterFixture(t, ctx, fmt.Sprintf("child-list-parent-%d", suffix), "", "")
	workflowChildID := insertIssueOriginFilterFixture(t, ctx, fmt.Sprintf("child-list-workflow-%d", suffix), "workflow", parentID)
	splitChildID := insertIssueOriginFilterFixture(t, ctx, fmt.Sprintf("child-list-split-%d", suffix), "workflow_split", parentID)

	req := newRequest("GET", "/api/issues/"+parentID+"/children", nil)
	req = withURLParam(req, "id", parentID)
	w := httptest.NewRecorder()
	testHandler.ListChildIssues(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ListChildIssues: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Issues []IssueResponse `json:"issues"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode children response: %v", err)
	}

	if _, ok := findIssueResponse(resp.Issues, splitChildID); !ok {
		t.Fatalf("children response must include split child issue %s", splitChildID)
	}
	if _, ok := findIssueResponse(resp.Issues, workflowChildID); ok {
		t.Fatalf("children response must exclude workflow-origin child issue %s", workflowChildID)
	}
}

func TestChildIssueProgressExcludesWorkflowOriginChildren(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}

	ctx := context.Background()
	suffix := time.Now().UnixNano()

	parentID := insertIssueOriginFilterFixture(t, ctx, fmt.Sprintf("child-progress-parent-%d", suffix), "", "")
	insertIssueOriginFilterFixture(t, ctx, fmt.Sprintf("child-progress-workflow-%d", suffix), "workflow", parentID)
	insertIssueOriginFilterFixture(t, ctx, fmt.Sprintf("child-progress-split-%d", suffix), "workflow_split", parentID)

	path := fmt.Sprintf("/api/issues/child-progress?workspace_id=%s", testWorkspaceID)
	w := httptest.NewRecorder()
	testHandler.ChildIssueProgress(w, newRequest("GET", path, nil))
	if w.Code != http.StatusOK {
		t.Fatalf("ChildIssueProgress: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Progress []struct {
			ParentIssueID string `json:"parent_issue_id"`
			Total         int64  `json:"total"`
			Done          int64  `json:"done"`
		} `json:"progress"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode child progress response: %v", err)
	}

	for _, entry := range resp.Progress {
		if entry.ParentIssueID == parentID {
			if entry.Total != 1 {
				t.Fatalf("child progress total = %d, want 1", entry.Total)
			}
			return
		}
	}
	t.Fatalf("child progress response missing parent %s", parentID)
}

// TestListGroupedIssues_ExcludesWorkflowOriginByDefault verifies that the
// assignee-grouped issue list mirrors the default /api/issues behavior and
// keeps workflow-created child issues out of the main issue board.
func TestListGroupedIssues_ExcludesWorkflowOriginByDefault(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}

	ctx := context.Background()
	suffix := time.Now().UnixNano()

	parentID := insertIssueOriginFilterFixture(t, ctx, fmt.Sprintf("grouped-parent-%d", suffix), "", "")
	childID := insertIssueOriginFilterFixture(t, ctx, fmt.Sprintf("grouped-child-%d", suffix), "workflow_split", parentID)

	path := fmt.Sprintf("/api/issues/grouped?workspace_id=%s&group_by=assignee&statuses=todo&limit=100", testWorkspaceID)
	w := httptest.NewRecorder()
	testHandler.ListGroupedIssues(w, newRequest("GET", path, nil))
	if w.Code != http.StatusOK {
		t.Fatalf("ListGroupedIssues: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp GroupedIssuesResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode grouped response: %v", err)
	}

	foundParent := false
	foundChild := false
	for _, group := range resp.Groups {
		for _, iss := range group.Issues {
			if iss.ID == parentID {
				foundParent = true
			}
			if iss.ID == childID {
				foundChild = true
			}
		}
	}

	if !foundParent {
		t.Fatalf("grouped list must include parent issue %s, but it was missing", parentID)
	}
	if foundChild {
		t.Fatalf("grouped list must exclude workflow-origin child %s, but it was present", childID)
	}
}

func TestListGroupedIssues_IncludeWorkflowOrigin(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}

	ctx := context.Background()
	suffix := time.Now().UnixNano()

	parentID := insertIssueOriginFilterFixture(t, ctx, fmt.Sprintf("grouped-include-parent-%d", suffix), "", "")
	childID := insertIssueOriginFilterFixture(t, ctx, fmt.Sprintf("grouped-include-child-%d", suffix), "workflow_split", parentID)

	path := fmt.Sprintf("/api/issues/grouped?workspace_id=%s&group_by=assignee&statuses=todo&include_workflow_origin=true&limit=100", testWorkspaceID)
	w := httptest.NewRecorder()
	testHandler.ListGroupedIssues(w, newRequest("GET", path, nil))
	if w.Code != http.StatusOK {
		t.Fatalf("ListGroupedIssues: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp GroupedIssuesResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode grouped response: %v", err)
	}

	if _, ok := findGroupedIssueResponse(resp.Groups, parentID); !ok {
		t.Fatalf("include_workflow_origin=true grouped list must include parent issue %s", parentID)
	}
	if _, ok := findGroupedIssueResponse(resp.Groups, childID); !ok {
		t.Fatalf("include_workflow_origin=true grouped list must include workflow-origin child %s", childID)
	}
}

func TestListIssues_PreservesWorkflowAndOriginFields(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}

	ctx := context.Background()
	suffix := time.Now().UnixNano()

	issueID, workflowID, runID, stageID, originID := insertWorkflowStampedIssueFixture(t, ctx, fmt.Sprintf("workflow-stamped-%d", suffix))

	assertIssueFields := func(t *testing.T, issue IssueResponse) {
		t.Helper()
		if issue.WorkflowID == nil || *issue.WorkflowID != workflowID {
			t.Fatalf("workflow_id = %v, want %s", issue.WorkflowID, workflowID)
		}
		if issue.WorkflowRunID == nil || *issue.WorkflowRunID != runID {
			t.Fatalf("workflow_run_id = %v, want %s", issue.WorkflowRunID, runID)
		}
		if issue.StageID == nil || *issue.StageID != stageID {
			t.Fatalf("stage_id = %v, want %s", issue.StageID, stageID)
		}
		if issue.OriginType == nil || *issue.OriginType != "quick_create" {
			t.Fatalf("origin_type = %v, want quick_create", issue.OriginType)
		}
		if issue.OriginID == nil || *issue.OriginID != originID {
			t.Fatalf("origin_id = %v, want %s", issue.OriginID, originID)
		}
	}

	path := fmt.Sprintf("/api/issues?workspace_id=%s&status=todo&limit=500", testWorkspaceID)
	w := httptest.NewRecorder()
	testHandler.ListIssues(w, newRequest("GET", path, nil))
	if w.Code != http.StatusOK {
		t.Fatalf("ListIssues: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var listResp struct {
		Issues []IssueResponse `json:"issues"`
	}
	if err := json.NewDecoder(w.Body).Decode(&listResp); err != nil {
		t.Fatalf("decode list response: %v", err)
	}
	listIssue, ok := findIssueResponse(listResp.Issues, issueID)
	if !ok {
		t.Fatalf("list response missing issue %s", issueID)
	}
	assertIssueFields(t, listIssue)

	openPath := fmt.Sprintf("/api/issues?workspace_id=%s&open_only=true", testWorkspaceID)
	open := httptest.NewRecorder()
	testHandler.ListIssues(open, newRequest("GET", openPath, nil))
	if open.Code != http.StatusOK {
		t.Fatalf("ListIssues open_only: expected 200, got %d: %s", open.Code, open.Body.String())
	}
	var openResp struct {
		Issues []IssueResponse `json:"issues"`
	}
	if err := json.NewDecoder(open.Body).Decode(&openResp); err != nil {
		t.Fatalf("decode open list response: %v", err)
	}
	openIssue, ok := findIssueResponse(openResp.Issues, issueID)
	if !ok {
		t.Fatalf("open list response missing issue %s", issueID)
	}
	assertIssueFields(t, openIssue)

	groupedPath := fmt.Sprintf("/api/issues/grouped?workspace_id=%s&group_by=assignee&statuses=todo&limit=100", testWorkspaceID)
	grouped := httptest.NewRecorder()
	testHandler.ListGroupedIssues(grouped, newRequest("GET", groupedPath, nil))
	if grouped.Code != http.StatusOK {
		t.Fatalf("ListGroupedIssues: expected 200, got %d: %s", grouped.Code, grouped.Body.String())
	}
	var groupedResp GroupedIssuesResponse
	if err := json.NewDecoder(grouped.Body).Decode(&groupedResp); err != nil {
		t.Fatalf("decode grouped response: %v", err)
	}
	groupedIssue, ok := findGroupedIssueResponse(groupedResp.Groups, issueID)
	if !ok {
		t.Fatalf("grouped response missing issue %s", issueID)
	}
	assertIssueFields(t, groupedIssue)
}

// insertIssueOriginFilterFixture creates an issue in the handler test workspace
// and returns its ID. If originType is non-empty, the issue is stamped with
// that origin_type. If parentID is non-empty, parent_issue_id is set.
// The issue is registered for cleanup via t.Cleanup.
func insertIssueOriginFilterFixture(t *testing.T, ctx context.Context, title, originType, parentID string) string {
	t.Helper()

	var number int
	if err := testPool.QueryRow(ctx, `
		UPDATE multica_workspace
		SET issue_counter = GREATEST(issue_counter, (SELECT COALESCE(MAX(number), 0) FROM multica_issue WHERE workspace_id = $1)) + 1
		WHERE id = $1 RETURNING issue_counter
	`, testWorkspaceID).Scan(&number); err != nil {
		t.Fatalf("next issue number: %v", err)
	}

	var id string
	var parentArg *string
	if parentID != "" {
		parentArg = &parentID
	}
	var originArg *string
	if originType != "" {
		originArg = &originType
	}

	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_issue (workspace_id, title, status, priority, creator_type, creator_id, position, number, origin_type, parent_issue_id)
		VALUES ($1, $2, 'todo', 'none', 'member', $3, 0, $4, $5, $6) RETURNING id
	`, testWorkspaceID, title, testUserID, number, originArg, parentArg).Scan(&id); err != nil {
		t.Fatalf("create issue %q: %v", title, err)
	}

	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM multica_issue WHERE id = $1`, id)
	})

	return id
}

func findIssueResponse(issues []IssueResponse, id string) (IssueResponse, bool) {
	for _, issue := range issues {
		if issue.ID == id {
			return issue, true
		}
	}
	return IssueResponse{}, false
}

func findGroupedIssueResponse(groups []IssueAssigneeGroupResponse, id string) (IssueResponse, bool) {
	for _, group := range groups {
		if issue, ok := findIssueResponse(group.Issues, id); ok {
			return issue, true
		}
	}
	return IssueResponse{}, false
}

func queryBlock(t *testing.T, sql, startMarker, endMarker string) string {
	t.Helper()

	start := strings.Index(sql, startMarker)
	if start < 0 {
		t.Fatalf("query block start %q not found", startMarker)
	}
	end := strings.Index(sql[start:], endMarker)
	if end < 0 {
		t.Fatalf("query block end %q not found after %q", endMarker, startMarker)
	}
	return sql[start : start+end]
}

func insertWorkflowStampedIssueFixture(t *testing.T, ctx context.Context, title string) (issueID, workflowID, runID, stageID, originID string) {
	t.Helper()

	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow (workspace_id, title, description, status, created_by_type, created_by_id)
		VALUES ($1, $2, '', 'active', 'member', $3)
		RETURNING id
	`, testWorkspaceID, title+" workflow", testUserID).Scan(&workflowID); err != nil {
		t.Fatalf("create workflow: %v", err)
	}
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM multica_workflow WHERE id = $1`, workflowID)
	})

	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow_stage (workflow_id, name, description, sort_order)
		VALUES ($1, 'Stage', '', 0)
		RETURNING id
	`, workflowID).Scan(&stageID); err != nil {
		t.Fatalf("create workflow stage: %v", err)
	}

	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow_run (workflow_id, workspace_id, workflow_title, status, triggered_by_type, triggered_by_id)
		VALUES ($1, $2, $3, 'running', 'member', $4)
		RETURNING id
	`, workflowID, testWorkspaceID, title+" run", testUserID).Scan(&runID); err != nil {
		t.Fatalf("create workflow run: %v", err)
	}

	if err := testPool.QueryRow(ctx, `SELECT gen_random_uuid()`).Scan(&originID); err != nil {
		t.Fatalf("generate origin id: %v", err)
	}

	var number int
	if err := testPool.QueryRow(ctx, `
		UPDATE multica_workspace
		SET issue_counter = GREATEST(issue_counter, (SELECT COALESCE(MAX(number), 0) FROM multica_issue WHERE workspace_id = $1)) + 1
		WHERE id = $1 RETURNING issue_counter
	`, testWorkspaceID).Scan(&number); err != nil {
		t.Fatalf("next issue number: %v", err)
	}

	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_issue (
			workspace_id, title, status, priority, assignee_type, assignee_id,
			creator_type, creator_id, position, number, workflow_id, workflow_run_id,
			stage_id, origin_type, origin_id
		)
		VALUES ($1, $2, 'todo', 'none', 'workflow', $3, 'member', $4, 0, $5, $3, $6, $7, 'quick_create', $8)
		RETURNING id
	`, testWorkspaceID, title, workflowID, testUserID, number, runID, stageID, originID).Scan(&issueID); err != nil {
		t.Fatalf("create stamped issue: %v", err)
	}
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM multica_issue WHERE id = $1`, issueID)
	})

	return issueID, workflowID, runID, stageID, originID
}

// TestListIssues_ResponsibleUserFilter verifies that the responsible_user_id
// query param narrows the list to issues whose responsible owner is that user.
// The "My Issues" page's "Responsible" tab relies on this filter.
func TestListIssues_ResponsibleUserFilter(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}

	ctx := context.Background()
	suffix := time.Now().UnixNano()

	// A second real user so the "not me" issue has a valid responsible_user_id
	// (the column REFERENCES multica_user(id)).
	var otherUserID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_user (name, email)
		VALUES ($1, $2) RETURNING id
	`, fmt.Sprintf("Responsible Other %d", suffix), fmt.Sprintf("responsible-other-%d@multica.ai", suffix)).Scan(&otherUserID); err != nil {
		t.Fatalf("create other user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM multica_user WHERE id = $1`, otherUserID)
	})

	mineID := insertIssueWithResponsibleUser(t, ctx, fmt.Sprintf("responsible-mine-%d", suffix), testUserID)
	otherID := insertIssueWithResponsibleUser(t, ctx, fmt.Sprintf("responsible-other-%d", suffix), otherUserID)

	path := fmt.Sprintf("/api/issues?workspace_id=%s&responsible_user_id=%s&limit=500", testWorkspaceID, testUserID)
	w := httptest.NewRecorder()
	testHandler.ListIssues(w, newRequest("GET", path, nil))
	if w.Code != http.StatusOK {
		t.Fatalf("ListIssues: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Issues []IssueResponse `json:"issues"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode list response: %v", err)
	}

	foundMine := false
	foundOther := false
	for _, iss := range resp.Issues {
		if iss.ID == mineID {
			foundMine = true
		}
		if iss.ID == otherID {
			foundOther = true
		}
	}

	if !foundMine {
		t.Fatalf("responsible_user_id filter must include issue %s (responsible = %s)", mineID, testUserID)
	}
	if foundOther {
		t.Fatalf("responsible_user_id filter must exclude issue %s (responsible = %s, not %s)", otherID, otherUserID, testUserID)
	}
}

// insertIssueWithResponsibleUser creates an issue whose responsible_user_id is
// set explicitly, and registers it for cleanup.
func insertIssueWithResponsibleUser(t *testing.T, ctx context.Context, title, responsibleUserID string) string {
	t.Helper()

	var number int
	if err := testPool.QueryRow(ctx, `
		UPDATE multica_workspace
		SET issue_counter = GREATEST(issue_counter, (SELECT COALESCE(MAX(number), 0) FROM multica_issue WHERE workspace_id = $1)) + 1
		WHERE id = $1 RETURNING issue_counter
	`, testWorkspaceID).Scan(&number); err != nil {
		t.Fatalf("next issue number: %v", err)
	}

	var id string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_issue (workspace_id, title, status, priority, creator_type, creator_id, responsible_user_id, position, number)
		VALUES ($1, $2, 'todo', 'none', 'member', $3, $3, 0, $4) RETURNING id
	`, testWorkspaceID, title, responsibleUserID, number).Scan(&id); err != nil {
		t.Fatalf("create issue %q: %v", title, err)
	}

	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM multica_issue WHERE id = $1`, id)
	})

	return id
}
