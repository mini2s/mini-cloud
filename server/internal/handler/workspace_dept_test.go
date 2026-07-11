package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/deptsync"
)

type fakeWorkspaceDeptClient struct {
	users       []deptsync.User
	departments []deptsync.Department
}

func (f fakeWorkspaceDeptClient) Configured() bool { return true }

func (f fakeWorkspaceDeptClient) ListDepartmentUsers(ctx context.Context, deptID string, includeChildren bool) ([]deptsync.User, error) {
	return f.users, nil
}

func (f fakeWorkspaceDeptClient) SearchUsers(ctx context.Context, query string, limit int) ([]deptsync.User, error) {
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

func TestSearchDeptUsersReturnsNameAndEmployeeMatches(t *testing.T) {
	prev := testHandler.DeptSync
	testHandler.DeptSync = fakeWorkspaceDeptClient{users: []deptsync.User{
		{UserID: "E001", Username: "Active Dept User", UniversalID: "uni-active", DeptID: "D100", DeptName: "Platform", Position: "Engineer", Status: 1},
		{UserID: "29219", Username: "Universal Only User", UniversalID: "bcdce73f-0f2c-4699-ad21-501a4bc13245", DeptID: "D100", DeptName: "Costrict", Position: "Engineer", Status: 1},
	}}
	t.Cleanup(func() { testHandler.DeptSync = prev })

	w := httptest.NewRecorder()
	req := newRequest(http.MethodGet, "/api/dept/users/search?q=E001", nil)
	testHandler.SearchDeptUsers(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("SearchDeptUsers: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "Active Dept User") || !strings.Contains(w.Body.String(), "E001") {
		t.Fatalf("expected dept user result, got %s", w.Body.String())
	}

	w = httptest.NewRecorder()
	req = newRequest(http.MethodGet, "/api/dept/users/search?q=Dept", nil)
	testHandler.SearchDeptUsers(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("SearchDeptUsers by partial name: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "Active Dept User") {
		t.Fatalf("expected partial name match, got %s", w.Body.String())
	}

	w = httptest.NewRecorder()
	req = newRequest(http.MethodGet, "/api/dept/users/search?q=001", nil)
	testHandler.SearchDeptUsers(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("SearchDeptUsers by partial employee id: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "E001") {
		t.Fatalf("expected partial employee id match, got %s", w.Body.String())
	}

	w = httptest.NewRecorder()
	req = newRequest(http.MethodGet, "/api/dept/users/search?q=c", nil)
	testHandler.SearchDeptUsers(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("SearchDeptUsers by universal id character: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "Universal Only User") {
		t.Fatalf("did not expect universal id-only match, got %s", w.Body.String())
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

func TestAssociateDeptIdentityActivatesExistingPendingMembers(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	ctx := context.Background()
	const email = "associate-dept-user@example.test"
	const slug = "handler-associate-dept-identity"
	const universalID = "uni-associate-current"
	_, _ = testPool.Exec(ctx, `DELETE FROM multica_workspace WHERE slug = $1`, slug)
	_, _ = testPool.Exec(ctx, `DELETE FROM multica_user WHERE email = $1`, email)
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM multica_workspace WHERE slug = $1`, slug)
		_, _ = testPool.Exec(context.Background(), `DELETE FROM multica_user WHERE email = $1`, email)
	})

	var userID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_user (name, email)
		VALUES ('Associate Dept User', $1)
		RETURNING id
	`, email).Scan(&userID); err != nil {
		t.Fatalf("create user: %v", err)
	}

	var workspaceID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workspace (name, slug, description, issue_prefix)
		VALUES ('Associate Dept Workspace', $1, '', 'ADW')
		RETURNING id
	`, slug).Scan(&workspaceID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	var memberID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_member (
			workspace_id, role, source, status, external_user_id, external_universal_id,
			employee_id, org_display_name, dept_id, dept_name, dept_path, position
		)
		VALUES ($1, 'member', 'dept', 'pending_activation', 'E020', $2,
			'E020', 'Associate Dept User', 'D200', 'Platform', 'R&D/Platform', 'Engineer')
		RETURNING id
	`, workspaceID, universalID).Scan(&memberID); err != nil {
		t.Fatalf("create pending member: %v", err)
	}

	prev := testHandler.DeptSync
	testHandler.DeptSync = fakeWorkspaceDeptClient{users: []deptsync.User{
		{UserID: "E020", Username: "Associate Dept User", UniversalID: universalID, DeptID: "D200", DeptName: "Platform", DeptPath: "R&D/Platform", Position: "Engineer", Status: 1, IsMain: 1},
	}}
	t.Cleanup(func() { testHandler.DeptSync = prev })

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/me/dept-association", map[string]string{
		"casdoor_universal_id": universalID,
	})
	req.Header.Set("X-User-ID", userID)
	testHandler.AssociateDeptIdentity(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("AssociateDeptIdentity: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"associated":true`) || !strings.Contains(w.Body.String(), `"associated_count":1`) {
		t.Fatalf("expected associated response, got %s", w.Body.String())
	}

	var gotUserID, gotStatus, gotUniversalID string
	if err := testPool.QueryRow(ctx, `
		SELECT user_id, status, external_universal_id
		FROM multica_member
		WHERE id = $1
	`, memberID).Scan(&gotUserID, &gotStatus, &gotUniversalID); err != nil {
		t.Fatalf("load member: %v", err)
	}
	if gotUserID != userID || gotStatus != "active" || gotUniversalID != universalID {
		t.Fatalf("member mismatch: user_id=%q status=%q universal=%q", gotUserID, gotStatus, gotUniversalID)
	}

	var storedUniversalID string
	if err := testPool.QueryRow(ctx, `SELECT casdoor_universal_id FROM multica_user WHERE id = $1`, userID).Scan(&storedUniversalID); err != nil {
		t.Fatalf("load user universal id: %v", err)
	}
	if storedUniversalID != universalID {
		t.Fatalf("user universal id = %q, want %q", storedUniversalID, universalID)
	}
}

func TestAssociateDeptIdentityDoesNotBindWhenCurrentUserHasDifferentUniversalID(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	ctx := context.Background()
	const email = "associate-dept-conflict@example.test"
	const slug = "handler-associate-dept-conflict"
	const requestedUniversalID = "uni-associate-requested"
	const existingUniversalID = "uni-associate-existing"
	_, _ = testPool.Exec(ctx, `DELETE FROM multica_workspace WHERE slug = $1`, slug)
	_, _ = testPool.Exec(ctx, `DELETE FROM multica_user WHERE email = $1`, email)
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM multica_workspace WHERE slug = $1`, slug)
		_, _ = testPool.Exec(context.Background(), `DELETE FROM multica_user WHERE email = $1`, email)
	})

	var userID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_user (name, email, casdoor_universal_id)
		VALUES ('Associate Dept Conflict', $1, $2)
		RETURNING id
	`, email, existingUniversalID).Scan(&userID); err != nil {
		t.Fatalf("create user: %v", err)
	}

	var workspaceID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workspace (name, slug, description, issue_prefix)
		VALUES ('Associate Dept Conflict Workspace', $1, '', 'ADC')
		RETURNING id
	`, slug).Scan(&workspaceID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	var memberID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_member (
			workspace_id, role, source, status, external_user_id, external_universal_id,
			employee_id, org_display_name, dept_id, dept_name, dept_path, position
		)
		VALUES ($1, 'member', 'dept', 'pending_activation', 'E021', $2,
			'E021', 'Associate Dept Conflict', 'D200', 'Platform', 'R&D/Platform', 'Engineer')
		RETURNING id
	`, workspaceID, requestedUniversalID).Scan(&memberID); err != nil {
		t.Fatalf("create pending member: %v", err)
	}

	prev := testHandler.DeptSync
	testHandler.DeptSync = fakeWorkspaceDeptClient{users: []deptsync.User{
		{UserID: "E021", Username: "Associate Dept Conflict", UniversalID: requestedUniversalID, DeptID: "D200", DeptName: "Platform", DeptPath: "R&D/Platform", Position: "Engineer", Status: 1, IsMain: 1},
	}}
	t.Cleanup(func() { testHandler.DeptSync = prev })

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/me/dept-association", map[string]string{
		"casdoor_universal_id": requestedUniversalID,
	})
	req.Header.Set("X-User-ID", userID)
	testHandler.AssociateDeptIdentity(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("AssociateDeptIdentity: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"associated":false`) || !strings.Contains(w.Body.String(), `"reason":"universal_id_conflict"`) {
		t.Fatalf("expected conflict response, got %s", w.Body.String())
	}

	var gotUserID *string
	var gotStatus string
	if err := testPool.QueryRow(ctx, `
		SELECT user_id, status
		FROM multica_member
		WHERE id = $1
	`, memberID).Scan(&gotUserID, &gotStatus); err != nil {
		t.Fatalf("load member: %v", err)
	}
	if gotUserID != nil || gotStatus != "pending_activation" {
		t.Fatalf("member should remain pending and unbound, got user_id=%v status=%q", gotUserID, gotStatus)
	}
}

func TestAssociateDeptIdentityDoesNotPersistUniversalIDWithoutPendingMember(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	ctx := context.Background()
	const email = "associate-dept-no-pending@example.test"
	const universalID = "uni-associate-no-pending"
	_, _ = testPool.Exec(ctx, `DELETE FROM multica_user WHERE email = $1`, email)
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM multica_user WHERE email = $1`, email)
	})

	var userID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_user (name, email)
		VALUES ('Associate Dept No Pending', $1)
		RETURNING id
	`, email).Scan(&userID); err != nil {
		t.Fatalf("create user: %v", err)
	}

	prev := testHandler.DeptSync
	testHandler.DeptSync = fakeWorkspaceDeptClient{users: []deptsync.User{
		{UserID: "E022", Username: "Associate Dept No Pending", UniversalID: universalID, DeptID: "D200", DeptName: "Platform", DeptPath: "R&D/Platform", Position: "Engineer", Status: 1, IsMain: 1},
	}}
	t.Cleanup(func() { testHandler.DeptSync = prev })

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/me/dept-association", map[string]string{
		"casdoor_universal_id": universalID,
	})
	req.Header.Set("X-User-ID", userID)
	testHandler.AssociateDeptIdentity(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("AssociateDeptIdentity: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"associated":false`) || !strings.Contains(w.Body.String(), `"reason":"no_pending_member"`) {
		t.Fatalf("expected no pending member response, got %s", w.Body.String())
	}

	var storedUniversalID pgtype.Text
	if err := testPool.QueryRow(ctx, `SELECT casdoor_universal_id FROM multica_user WHERE id = $1`, userID).Scan(&storedUniversalID); err != nil {
		t.Fatalf("load user universal id: %v", err)
	}
	if storedUniversalID.Valid {
		t.Fatalf("user universal id should remain empty, got %q", storedUniversalID.String)
	}
}
