package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/deptsync"
)

type fakeWorkspaceDeptClient struct {
	users                                []deptsync.User
	departments                          []deptsync.Department
	searchUsersCalls                     *int
	getUserDepartmentsByUniversalIDCalls *int
}

func (f fakeWorkspaceDeptClient) Configured() bool { return true }

func (f fakeWorkspaceDeptClient) ListDepartmentUsers(ctx context.Context, deptID string, includeChildren bool) ([]deptsync.User, error) {
	return f.users, nil
}

func (f fakeWorkspaceDeptClient) SearchUsers(ctx context.Context, query string, limit int) ([]deptsync.User, error) {
	if f.searchUsersCalls != nil {
		(*f.searchUsersCalls)++
	}
	query = strings.ToLower(strings.TrimSpace(query))
	out := make([]deptsync.User, 0, len(f.users))
	for _, user := range f.users {
		if query == "" ||
			strings.Contains(strings.ToLower(user.Username), query) ||
			strings.Contains(strings.ToLower(user.UserID), query) {
			out = append(out, user)
		}
	}
	return out, nil
}

func (f fakeWorkspaceDeptClient) GetUserDepartmentsByUniversalID(ctx context.Context, universalID string) ([]deptsync.User, error) {
	if f.getUserDepartmentsByUniversalIDCalls != nil {
		(*f.getUserDepartmentsByUniversalIDCalls)++
	}
	universalID = strings.TrimSpace(universalID)
	out := make([]deptsync.User, 0, len(f.users))
	for _, user := range f.users {
		if strings.TrimSpace(user.UniversalID) == universalID {
			out = append(out, user)
		}
	}
	return out, nil
}

func (f fakeWorkspaceDeptClient) SearchDepartments(ctx context.Context, query string, limit int) ([]deptsync.Department, error) {
	query = strings.ToLower(strings.TrimSpace(query))
	out := make([]deptsync.Department, 0, len(f.departments))
	for _, department := range f.departments {
		if query == "" ||
			strings.Contains(strings.ToLower(department.DeptName), query) ||
			strings.Contains(strings.ToLower(department.DeptPath), query) {
			out = append(out, department)
		}
	}
	return out, nil
}

func TestSearchDeptDepartmentsReturnsRealDepartmentResults(t *testing.T) {
	prev := testHandler.DeptSync
	testHandler.DeptSync = fakeWorkspaceDeptClient{departments: []deptsync.Department{
		{DeptID: "D100", DeptName: "Platform Dept", DeptPath: "研发体系/Platform Dept"},
		{DeptID: "D200", DeptName: "Customer Success", DeptPath: "研发体系/Costrict研发部/客户成功组"},
	}}
	t.Cleanup(func() { testHandler.DeptSync = prev })

	w := httptest.NewRecorder()
	req := newRequest(http.MethodGet, "/api/dept/departments/search?q=platform", nil)
	testHandler.SearchDeptDepartments(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("SearchDeptDepartments: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "Platform Dept") || !strings.Contains(w.Body.String(), "D100") {
		t.Fatalf("expected canonical department result, got %s", w.Body.String())
	}

	w = httptest.NewRecorder()
	req = newRequest(http.MethodGet, "/api/dept/departments/search?q=Costrict研发部", nil)
	testHandler.SearchDeptDepartments(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("SearchDeptDepartments by path: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "Customer Success") || !strings.Contains(w.Body.String(), "D200") {
		t.Fatalf("expected department path match, got %s", w.Body.String())
	}

	w = httptest.NewRecorder()
	req = newRequest(http.MethodGet, "/api/dept/departments/search?q=D200", nil)
	testHandler.SearchDeptDepartments(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("SearchDeptDepartments by id: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "Customer Success") {
		t.Fatalf("did not expect department id-only match, got %s", w.Body.String())
	}
}

func TestSearchDeptDepartmentsReturnsInitialDepartmentsForEmptyQuery(t *testing.T) {
	prev := testHandler.DeptSync
	testHandler.DeptSync = fakeWorkspaceDeptClient{departments: []deptsync.Department{
		{DeptID: "D100", DeptName: "Platform Dept", DeptPath: "/D000/D100"},
	}}
	t.Cleanup(func() { testHandler.DeptSync = prev })

	w := httptest.NewRecorder()
	req := newRequest(http.MethodGet, "/api/dept/departments/search", nil)
	testHandler.SearchDeptDepartments(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("SearchDeptDepartments: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "Platform Dept") {
		t.Fatalf("expected initial department result, got %s", w.Body.String())
	}
}

func TestListDeptDepartmentUsersReturnsRecursiveMembers(t *testing.T) {
	prev := testHandler.DeptSync
	testHandler.DeptSync = fakeWorkspaceDeptClient{users: []deptsync.User{
		{UserID: "E004", Username: "Runtime Dept User", UniversalID: "uni-runtime", DeptID: "D110", DeptName: "Platform Runtime", Position: "SRE", Status: 1},
	}}
	t.Cleanup(func() { testHandler.DeptSync = prev })

	w := httptest.NewRecorder()
	req := withURLParam(newRequest(http.MethodGet, "/api/dept/departments/D100/users", nil), "id", "D100")
	testHandler.ListDeptDepartmentUsers(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ListDeptDepartmentUsers: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "Runtime Dept User") || !strings.Contains(w.Body.String(), "Platform Runtime") {
		t.Fatalf("expected recursive department user result, got %s", w.Body.String())
	}
}

func TestBatchAddDeptMembersAddsResolvedAndPendingUsers(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	ctx := context.Background()
	const slug = "handler-batch-add-dept-members"
	_, _ = testPool.Exec(ctx, `DELETE FROM multica_workspace WHERE slug = $1`, slug)
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM multica_workspace WHERE slug = $1`, slug)
		_, _ = testPool.Exec(context.Background(), `DELETE FROM multica_user WHERE email = 'batch-dept-resolved@example.test'`)
	})

	var resolvedUserID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_user (name, email, casdoor_universal_id)
		VALUES ('Resolved Batch Dept User', 'batch-dept-resolved@example.test', 'uni-batch-resolved')
		RETURNING id
	`).Scan(&resolvedUserID); err != nil {
		t.Fatalf("create resolved user: %v", err)
	}

	prev := testHandler.DeptSync
	testHandler.DeptSync = fakeWorkspaceDeptClient{users: []deptsync.User{
		{UserID: "E010", Username: "Resolved Batch Dept User", UniversalID: "uni-batch-resolved", DeptID: "D100", DeptName: "Platform", DeptPath: "/D000/D100", Position: "Engineer", Status: 1, IsMain: 1},
		{UserID: "E011", Username: "Pending Batch Dept User", UniversalID: "uni-batch-pending", DeptID: "D100", DeptName: "Platform", DeptPath: "/D000/D100", Position: "Designer", Status: 1, IsMain: 1},
	}}
	t.Cleanup(func() { testHandler.DeptSync = prev })

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/workspaces", map[string]any{
		"name": "Batch Dept Members",
		"slug": slug,
	})
	testHandler.CreateWorkspace(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateWorkspace: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var workspaceID string
	if err := testPool.QueryRow(ctx, `SELECT id FROM multica_workspace WHERE slug = $1`, slug).Scan(&workspaceID); err != nil {
		t.Fatalf("lookup workspace: %v", err)
	}

	w = httptest.NewRecorder()
	req = withURLParam(newRequest(http.MethodPost, "/api/workspaces/"+workspaceID+"/dept-members", map[string]any{
		"users": []map[string]string{
			{"external_user_id": "E010", "external_universal_id": "uni-batch-resolved"},
			{"external_user_id": "E011", "external_universal_id": "uni-batch-pending"},
		},
	}), "id", workspaceID)
	testHandler.BatchAddDeptMembers(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("BatchAddDeptMembers: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"added":2`) {
		t.Fatalf("expected added count, got %s", w.Body.String())
	}

	var resolvedStatus, pendingStatus, pendingDept, pendingEmployee string
	var resolvedMemberUserID, pendingMemberUserID *string
	if err := testPool.QueryRow(ctx, `
		SELECT status, user_id FROM multica_member
		WHERE workspace_id = $1 AND external_universal_id = 'uni-batch-resolved'
	`, workspaceID).Scan(&resolvedStatus, &resolvedMemberUserID); err != nil {
		t.Fatalf("lookup resolved member: %v", err)
	}
	if resolvedStatus != "active" || resolvedMemberUserID == nil || *resolvedMemberUserID != resolvedUserID {
		t.Fatalf("resolved member mismatch: status=%q user_id=%v want active %s", resolvedStatus, resolvedMemberUserID, resolvedUserID)
	}
	if err := testPool.QueryRow(ctx, `
		SELECT status, user_id, dept_name, employee_id FROM multica_member
		WHERE workspace_id = $1 AND external_universal_id = 'uni-batch-pending'
	`, workspaceID).Scan(&pendingStatus, &pendingMemberUserID, &pendingDept, &pendingEmployee); err != nil {
		t.Fatalf("lookup pending member: %v", err)
	}
	if pendingStatus != "pending_activation" || pendingMemberUserID != nil || pendingDept != "Platform" || pendingEmployee != "E011" {
		t.Fatalf("pending member mismatch: status=%q user_id=%v dept=%q employee=%q", pendingStatus, pendingMemberUserID, pendingDept, pendingEmployee)
	}
}

// dept-sync's /users/search does not index universal_id, so a caller that only
// knows the universal_id (no external_user_id) must be resolved via the direct
// GetUserDepartmentsByUniversalID lookup, not SearchUsers. Regression test for
// the "dept user not found" failure when batch-adding by universal_id only.
func TestBatchAddDeptMembersResolvesByUniversalIDOnly(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	ctx := context.Background()
	const slug = "handler-batch-add-universal-only"
	_, _ = testPool.Exec(ctx, `DELETE FROM multica_workspace WHERE slug = $1`, slug)
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM multica_workspace WHERE slug = $1`, slug)
		_, _ = testPool.Exec(context.Background(), `DELETE FROM multica_member WHERE external_universal_id = 'uni-universal-only'`)
	})

	prev := testHandler.DeptSync
	testHandler.DeptSync = fakeWorkspaceDeptClient{users: []deptsync.User{
		{UserID: "E020", Username: "Universal Only User", UniversalID: "uni-universal-only", DeptID: "D200", DeptName: "Platform", DeptPath: "/D000/D200", Position: "Engineer", Status: 1, IsMain: 1},
	}}
	t.Cleanup(func() { testHandler.DeptSync = prev })

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/workspaces", map[string]any{
		"name": "Universal Only Members",
		"slug": slug,
	})
	testHandler.CreateWorkspace(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateWorkspace: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var workspaceID string
	if err := testPool.QueryRow(ctx, `SELECT id FROM multica_workspace WHERE slug = $1`, slug).Scan(&workspaceID); err != nil {
		t.Fatalf("lookup workspace: %v", err)
	}

	// Resolve by universal_id ONLY (no external_user_id).
	w = httptest.NewRecorder()
	req = withURLParam(newRequest(http.MethodPost, "/api/workspaces/"+workspaceID+"/dept-members", map[string]any{
		"users": []map[string]string{
			{"external_universal_id": "uni-universal-only"},
		},
	}), "id", workspaceID)
	testHandler.BatchAddDeptMembers(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("BatchAddDeptMembers: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"added":1`) {
		t.Fatalf("expected added:1, got %s", w.Body.String())
	}

	var deptPath, deptName, status string
	if err := testPool.QueryRow(ctx, `
		SELECT dept_path, dept_name, status FROM multica_member
		WHERE workspace_id = $1 AND external_universal_id = 'uni-universal-only'
	`, workspaceID).Scan(&deptPath, &deptName, &status); err != nil {
		t.Fatalf("lookup member: %v", err)
	}
	if deptPath != "/D000/D200" || deptName != "Platform" || status != "pending_activation" {
		t.Fatalf("member mismatch: dept_path=%q dept_name=%q status=%q", deptPath, deptName, status)
	}
}

func TestBatchAddDeptMembersUsesSubmittedSnapshotsWithoutRemoteResolve(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	ctx := context.Background()
	const slug = "handler-batch-add-snapshot-only"
	_, _ = testPool.Exec(ctx, `DELETE FROM multica_workspace WHERE slug = $1`, slug)
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM multica_workspace WHERE slug = $1`, slug)
		_, _ = testPool.Exec(context.Background(), `DELETE FROM multica_member WHERE external_universal_id = 'uni-snapshot-only'`)
	})

	searchUsersCalls := 0
	getUserDepartmentsCalls := 0
	prev := testHandler.DeptSync
	testHandler.DeptSync = fakeWorkspaceDeptClient{
		searchUsersCalls:                     &searchUsersCalls,
		getUserDepartmentsByUniversalIDCalls: &getUserDepartmentsCalls,
	}
	t.Cleanup(func() { testHandler.DeptSync = prev })

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/workspaces", map[string]any{
		"name": "Snapshot Dept Members",
		"slug": slug,
	})
	testHandler.CreateWorkspace(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateWorkspace: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var workspaceID string
	if err := testPool.QueryRow(ctx, `SELECT id FROM multica_workspace WHERE slug = $1`, slug).Scan(&workspaceID); err != nil {
		t.Fatalf("lookup workspace: %v", err)
	}

	w = httptest.NewRecorder()
	req = withURLParam(newRequest(http.MethodPost, "/api/workspaces/"+workspaceID+"/dept-members", map[string]any{
		"users": []map[string]any{
			{
				"external_user_id":      "E030",
				"external_universal_id": "uni-snapshot-only",
				"name":                  "Snapshot Only User",
				"employee_id":           "EMP030",
				"department_id":         "D300",
				"department_name":       "Snapshot Platform",
				"department_path":       "/D000/D300",
				"position":              "Engineer",
				"is_main_department":    true,
				"dept_user_status":      1,
			},
		},
	}), "id", workspaceID)
	testHandler.BatchAddDeptMembers(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("BatchAddDeptMembers: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"added":1`) {
		t.Fatalf("expected added:1, got %s", w.Body.String())
	}
	if searchUsersCalls != 0 || getUserDepartmentsCalls != 0 {
		t.Fatalf("expected no remote resolve calls, SearchUsers=%d GetUserDepartmentsByUniversalID=%d", searchUsersCalls, getUserDepartmentsCalls)
	}

	var name, employeeID, deptName, status string
	if err := testPool.QueryRow(ctx, `
		SELECT org_display_name, employee_id, dept_name, status FROM multica_member
		WHERE workspace_id = $1 AND external_universal_id = 'uni-snapshot-only'
	`, workspaceID).Scan(&name, &employeeID, &deptName, &status); err != nil {
		t.Fatalf("lookup member: %v", err)
	}
	if name != "Snapshot Only User" || employeeID != "EMP030" || deptName != "Snapshot Platform" || status != "pending_activation" {
		t.Fatalf("member mismatch: name=%q employee=%q dept=%q status=%q", name, employeeID, deptName, status)
	}
}
