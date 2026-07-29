package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/csuser"
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

type fakeCsUserClient struct {
	users map[string]csuser.User // keyed by subject_id
}

func (f fakeCsUserClient) SearchUsers(_ context.Context, _ string, _ int) ([]csuser.User, error) {
	return nil, nil
}

func (f fakeCsUserClient) GetUser(_ context.Context, subjectID string) (csuser.User, error) {
	u, ok := f.users[subjectID]
	if !ok {
		return csuser.User{}, nil // empty user means "not found" — caller should skip
	}
	return u, nil
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

func TestBatchAddDeptMembersCreatesUserAndActiveMember(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	ctx := context.Background()
	const slug = "handler-batch-add-subject-id-new"
	_, _ = testPool.Exec(ctx, `DELETE FROM multica_workspace WHERE slug = $1`, slug)
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM multica_workspace WHERE slug = $1`, slug)
		_, _ = testPool.Exec(context.Background(), `DELETE FROM multica_user WHERE email = 'batch-subject-new@example.test'`)
	})

	// Set up fakes
	prevCsUser := testHandler.CsUser
	csUserFake := fakeCsUserClient{users: map[string]csuser.User{
		"sub_new_1": {SubjectID: "sub_new_1", Username: "New User", Email: ptrStr("batch-subject-new@example.test"), CasdoorUniversalID: ptrStr("uni-new-1")},
	}}
	testHandler.CsUser = csUserFake
	t.Cleanup(func() { testHandler.CsUser = prevCsUser })

	prevDeptSync := testHandler.DeptSync
	testHandler.DeptSync = fakeWorkspaceDeptClient{users: []deptsync.User{
		{UserID: "E100", Username: "New User", UniversalID: "uni-new-1", DeptID: "D100", DeptName: "Platform", DeptPath: "/D000/D100", Position: "Engineer", Status: 1, IsMain: 1},
	}}
	t.Cleanup(func() { testHandler.DeptSync = prevDeptSync })

	// Create workspace
	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/workspaces", map[string]any{
		"name": "Subject ID New Members",
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

	// Batch add by subject_id
	w = httptest.NewRecorder()
	req = withURLParam(newRequest(http.MethodPost, "/api/workspaces/"+workspaceID+"/dept-members", map[string]any{
		"users": []map[string]string{
			{"subject_id": "sub_new_1"},
		},
	}), "id", workspaceID)
	testHandler.BatchAddDeptMembers(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("BatchAddDeptMembers: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"added":1`) {
		t.Fatalf("expected added:1, got %s", w.Body.String())
	}

	// Verify: user was created with subject_id
	var userID, userSubjectID string
	if err := testPool.QueryRow(ctx, `SELECT id, COALESCE(subject_id, '') FROM multica_user WHERE email = 'batch-subject-new@example.test'`).Scan(&userID, &userSubjectID); err != nil {
		t.Fatalf("lookup user: %v", err)
	}
	if userSubjectID != "sub_new_1" {
		t.Fatalf("expected user subject_id=sub_new_1, got %q", userSubjectID)
	}

	// Verify: member is active with subject_id, no pending_activation
	var memberStatus, memberSubjectID, deptName string
	if err := testPool.QueryRow(ctx, `
		SELECT status, COALESCE(subject_id, ''), dept_name FROM multica_member
		WHERE workspace_id = $1 AND user_id = $2
	`, workspaceID, userID).Scan(&memberStatus, &memberSubjectID, &deptName); err != nil {
		t.Fatalf("lookup member: %v", err)
	}
	if memberStatus != "active" {
		t.Fatalf("expected member status=active, got %q", memberStatus)
	}
	if memberSubjectID != "sub_new_1" {
		t.Fatalf("expected member subject_id=sub_new_1, got %q", memberSubjectID)
	}
	if deptName != "Platform" {
		t.Fatalf("expected dept_name=Platform, got %q", deptName)
	}
}

func TestBatchAddDeptMembersSkipsExistingSubjectID(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	ctx := context.Background()
	const slug = "handler-batch-add-subject-id-skip"
	_, _ = testPool.Exec(ctx, `DELETE FROM multica_workspace WHERE slug = $1`, slug)
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM multica_workspace WHERE slug = $1`, slug)
		_, _ = testPool.Exec(context.Background(), `DELETE FROM multica_user WHERE email = 'batch-subject-skip@example.test'`)
	})

	prevCsUser := testHandler.CsUser
	csUserFake := fakeCsUserClient{users: map[string]csuser.User{
		"sub_skip_1": {SubjectID: "sub_skip_1", Username: "Skip User", Email: ptrStr("batch-subject-skip@example.test"), CasdoorUniversalID: ptrStr("uni-skip-1")},
	}}
	testHandler.CsUser = csUserFake
	t.Cleanup(func() { testHandler.CsUser = prevCsUser })

	prevDeptSync := testHandler.DeptSync
	testHandler.DeptSync = fakeWorkspaceDeptClient{users: []deptsync.User{
		{UserID: "E200", Username: "Skip User", UniversalID: "uni-skip-1", DeptID: "D200", DeptName: "Platform", DeptPath: "/D000/D200", Position: "Engineer", Status: 1, IsMain: 1},
	}}
	t.Cleanup(func() { testHandler.DeptSync = prevDeptSync })

	// Create workspace
	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/workspaces", map[string]any{
		"name": "Subject ID Skip Members",
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

	// First call: should add
	w = httptest.NewRecorder()
	req = withURLParam(newRequest(http.MethodPost, "/api/workspaces/"+workspaceID+"/dept-members", map[string]any{
		"users": []map[string]string{
			{"subject_id": "sub_skip_1"},
		},
	}), "id", workspaceID)
	testHandler.BatchAddDeptMembers(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("BatchAddDeptMembers (1st): expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"added":1`) {
		t.Fatalf("1st call: expected added:1, got %s", w.Body.String())
	}

	// Second call: same subject_id → should skip
	w = httptest.NewRecorder()
	req = withURLParam(newRequest(http.MethodPost, "/api/workspaces/"+workspaceID+"/dept-members", map[string]any{
		"users": []map[string]string{
			{"subject_id": "sub_skip_1"},
		},
	}), "id", workspaceID)
	testHandler.BatchAddDeptMembers(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("BatchAddDeptMembers (2nd): expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"skipped":1`) {
		t.Fatalf("2nd call: expected skipped:1, got %s", w.Body.String())
	}

	// Verify only one member row exists
	var count int
	if err := testPool.QueryRow(ctx, `SELECT COUNT(*) FROM multica_member WHERE workspace_id = $1 AND source = 'dept'`, workspaceID).Scan(&count); err != nil {
		t.Fatalf("count members: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected 1 member row, got %d", count)
	}
}

func ptrStr(s string) *string {
	return &s
}
