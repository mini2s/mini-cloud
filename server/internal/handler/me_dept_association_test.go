package handler

import (
	"context"
	"testing"

	"github.com/multica-ai/multica/server/internal/deptsync"
	"github.com/multica-ai/multica/server/internal/util"
)

// linkDeptMembersOnLogin refreshes the member org snapshot and user display
// name from dept-sync on every login. It no longer performs activation
// (BatchAddDeptMembers now creates members as active).

// When dept-sync is available, login refreshes the org snapshot on every
// membership bound to the user and updates the user's display name.
func TestLinkDeptMembersOnLoginRefreshesSnapshot(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	ctx := context.Background()
	const email = "login-dept-refresh@example.test"
	const slug = "handler-login-refresh"
	const universalID = "uni-login-refresh"
	_, _ = testPool.Exec(ctx, `DELETE FROM multica_workspace WHERE slug = $1`, slug)
	_, _ = testPool.Exec(ctx, `DELETE FROM multica_user WHERE email = $1`, email)
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM multica_workspace WHERE slug = $1`, slug)
		_, _ = testPool.Exec(context.Background(), `DELETE FROM multica_user WHERE email = $1`, email)
	})

	var userID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_user (name, email)
		VALUES ('Login Refresh User', $1)
		RETURNING id
	`, email).Scan(&userID); err != nil {
		t.Fatalf("create user: %v", err)
	}
	var workspaceID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workspace (name, slug, description, issue_prefix)
		VALUES ('Login Refresh Workspace', $1, '', 'LRF')
		RETURNING id
	`, slug).Scan(&workspaceID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	var memberID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_member (
			workspace_id, user_id, role, source, status,
			employee_id, org_display_name, dept_id, dept_name, dept_path, position
		)
		VALUES ($1, $2, 'member', 'dept', 'active',
			'E031', 'Stale Name', 'D310', 'Old Dept', 'R&D/Old', 'Old Role')
		RETURNING id
	`, workspaceID, userID).Scan(&memberID); err != nil {
		t.Fatalf("create member: %v", err)
	}

	prev := testHandler.DeptSync
	testHandler.DeptSync = fakeWorkspaceDeptClient{users: []deptsync.User{
		{UserID: "E031", Username: "Fresh Name", UniversalID: universalID, DeptID: "D315", DeptName: "New Dept", DeptPath: "R&D/New", Position: "New Role", Status: 1, IsMain: 1},
	}}
	t.Cleanup(func() { testHandler.DeptSync = prev })

	testHandler.linkDeptMembersOnLogin(ctx, util.MustParseUUID(userID), universalID)

	var gotStatus, gotName, gotDeptName, gotDeptPath, gotPosition string
	if err := testPool.QueryRow(ctx, `
		SELECT status, org_display_name, dept_name, dept_path, position
		FROM multica_member WHERE id = $1
	`, memberID).Scan(&gotStatus, &gotName, &gotDeptName, &gotDeptPath, &gotPosition); err != nil {
		t.Fatalf("load member: %v", err)
	}
	if gotStatus != "active" {
		t.Fatalf("member should be active: status=%q", gotStatus)
	}
	if gotName != "Fresh Name" || gotDeptName != "New Dept" || gotDeptPath != "R&D/New" || gotPosition != "New Role" {
		t.Fatalf("snapshot not refreshed: name=%q dept=%q path=%q position=%q", gotName, gotDeptName, gotDeptPath, gotPosition)
	}
}

// On login, the user's display name is refreshed from dept-sync (the org
// source of truth), repairing placeholder names — e.g. a Casdoor login name
// (a UUID) that was stored as the multica user name at provisioning. This
// runs even when the user has no dept member row (e.g. a manual workspace
// owner), as long as dept-sync knows the universal_id.
func TestLinkDeptMembersOnLogin_RefreshesUserNameFromDeptSync(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	ctx := context.Background()
	const email = "login-dept-namerefresh@example.test"
	const universalID = "uni-login-namerefresh"
	_, _ = testPool.Exec(ctx, `DELETE FROM multica_user WHERE email = $1`, email)
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM multica_user WHERE email = $1`, email)
	})

	var userID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_user (name, email)
		VALUES ('c9bb0e3f-253c-4f2e-82f0-f0e50c4f40f0', $1)
		RETURNING id
	`, email).Scan(&userID); err != nil {
		t.Fatalf("create user: %v", err)
	}

	prev := testHandler.DeptSync
	testHandler.DeptSync = fakeWorkspaceDeptClient{users: []deptsync.User{
		{UserID: "53613", Username: "李金榜", UniversalID: universalID, DeptID: "6571", DeptName: "开发组", DeptPath: "/研发体系/Costrict研发部/开发组", Position: "高级后端开发工程师", Status: 1, IsMain: 1},
	}}
	t.Cleanup(func() { testHandler.DeptSync = prev })

	testHandler.linkDeptMembersOnLogin(ctx, util.MustParseUUID(userID), universalID)

	var gotName string
	if err := testPool.QueryRow(ctx, `SELECT name FROM multica_user WHERE id = $1`, userID).Scan(&gotName); err != nil {
		t.Fatalf("load user: %v", err)
	}
	if gotName != "李金榜" {
		t.Fatalf("user name should be refreshed from dept-sync to %q, got %q", "李金榜", gotName)
	}
}

// Login backfills the dept-sync org snapshot onto an existing membership
// (e.g. a manual/email-invite row from before Casdoor binding).
func TestLinkDeptMembersOnLoginBackfillsOrgOnExistingMembership(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	ctx := context.Background()
	const email = "login-dept-backfill@example.test"
	const slug = "handler-login-backfill"
	const universalID = "uni-login-backfill"
	_, _ = testPool.Exec(ctx, `DELETE FROM multica_workspace WHERE slug = $1`, slug)
	_, _ = testPool.Exec(ctx, `DELETE FROM multica_user WHERE email = $1`, email)
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM multica_workspace WHERE slug = $1`, slug)
		_, _ = testPool.Exec(context.Background(), `DELETE FROM multica_user WHERE email = $1`, email)
	})

	var userID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_user (name, email)
		VALUES ('Backfill User', $1)
		RETURNING id
	`, email).Scan(&userID); err != nil {
		t.Fatalf("create user: %v", err)
	}
	var workspaceID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workspace (name, slug, description, issue_prefix)
		VALUES ('Backfill Workspace', $1, '', 'LBF')
		RETURNING id
	`, slug).Scan(&workspaceID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}

	// Existing email-invite membership: manual, active, no org snapshot.
	var manualMemberID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_member (workspace_id, user_id, role, source, status)
		VALUES ($1, $2, 'member', 'manual', 'active')
		RETURNING id
	`, workspaceID, userID).Scan(&manualMemberID); err != nil {
		t.Fatalf("create manual member: %v", err)
	}

	prev := testHandler.DeptSync
	testHandler.DeptSync = fakeWorkspaceDeptClient{users: []deptsync.User{
		{UserID: "E040", Username: "Fresh User", UniversalID: universalID, DeptID: "D410", DeptName: "New Dept", DeptPath: "R&D/New", Position: "New Role", Status: 1, IsMain: 1},
	}}
	t.Cleanup(func() { testHandler.DeptSync = prev })

	testHandler.linkDeptMembersOnLogin(ctx, util.MustParseUUID(userID), universalID)

	// The existing manual membership must now carry the fresh org snapshot.
	var manualDeptName, manualPosition, manualEmployeeID string
	if err := testPool.QueryRow(ctx, `
		SELECT dept_name, position, employee_id
		FROM multica_member WHERE id = $1
	`, manualMemberID).Scan(&manualDeptName, &manualPosition, &manualEmployeeID); err != nil {
		t.Fatalf("load manual member: %v", err)
	}
	if manualDeptName != "New Dept" || manualPosition != "New Role" || manualEmployeeID != "E040" {
		t.Fatalf("existing membership not backfilled: dept=%q position=%q employee=%q", manualDeptName, manualPosition, manualEmployeeID)
	}

	// Exactly one membership for the user in the workspace.
	var userMembers int
	if err := testPool.QueryRow(ctx, `SELECT count(*) FROM multica_member WHERE workspace_id = $1 AND user_id = $2`, workspaceID, userID).Scan(&userMembers); err != nil {
		t.Fatalf("count user members: %v", err)
	}
	if userMembers != 1 {
		t.Fatalf("expected exactly 1 membership for the user, got %d", userMembers)
	}
}

// Sanity: calling linkDeptMembersOnLogin on a user with no membership
// and no matching dept-sync entry must be a silent no-op (login never fails).
func TestLinkDeptMembersOnLoginNoopWithoutMembership(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	ctx := context.Background()
	const email = "login-dept-noop@example.test"
	const universalID = "uni-login-noop"
	_, _ = testPool.Exec(ctx, `DELETE FROM multica_user WHERE email = $1`, email)
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM multica_user WHERE email = $1`, email)
	})

	var userID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_user (name, email)
		VALUES ('Login Noop User', $1)
		RETURNING id
	`, email).Scan(&userID); err != nil {
		t.Fatalf("create user: %v", err)
	}

	prev := testHandler.DeptSync
	testHandler.DeptSync = fakeWorkspaceDeptClient{users: nil}
	t.Cleanup(func() { testHandler.DeptSync = prev })

	// Must not panic; no member should be bound to this user.
	testHandler.linkDeptMembersOnLogin(ctx, util.MustParseUUID(userID), universalID)

	var bound int
	if err := testPool.QueryRow(ctx, `SELECT count(*) FROM multica_member WHERE user_id = $1`, userID).Scan(&bound); err != nil {
		t.Fatalf("count members: %v", err)
	}
	if bound != 0 {
		t.Fatalf("expected no bound members, got %d", bound)
	}
}

// When dept-sync is unavailable, login must not fail — the org snapshot is
// simply not refreshed.
func TestLinkDeptMembersOnLoginSkipsRefreshWithoutDeptSync(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	ctx := context.Background()
	const email = "login-dept-nosync@example.test"
	const slug = "handler-login-nosync"
	const universalID = "uni-login-nosync"
	_, _ = testPool.Exec(ctx, `DELETE FROM multica_workspace WHERE slug = $1`, slug)
	_, _ = testPool.Exec(ctx, `DELETE FROM multica_user WHERE email = $1`, email)
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM multica_workspace WHERE slug = $1`, slug)
		_, _ = testPool.Exec(context.Background(), `DELETE FROM multica_user WHERE email = $1`, email)
	})

	var userID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_user (name, email)
		VALUES ('Login NoSync User', $1)
		RETURNING id
	`, email).Scan(&userID); err != nil {
		t.Fatalf("create user: %v", err)
	}
	var workspaceID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workspace (name, slug, description, issue_prefix)
		VALUES ('Login NoSync Workspace', $1, '', 'LNS')
		RETURNING id
	`, slug).Scan(&workspaceID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	var memberID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_member (
			workspace_id, user_id, role, source, status,
			employee_id, org_display_name, dept_id, dept_name, dept_path, position
		)
		VALUES ($1, $2, 'member', 'dept', 'active',
			'E032', 'Stale Name', 'D320', 'Old Dept', 'R&D/Old', 'Old Role')
		RETURNING id
	`, workspaceID, userID).Scan(&memberID); err != nil {
		t.Fatalf("create member: %v", err)
	}

	prev := testHandler.DeptSync
	testHandler.DeptSync = nil // dept-sync not configured
	t.Cleanup(func() { testHandler.DeptSync = prev })

	testHandler.linkDeptMembersOnLogin(ctx, util.MustParseUUID(userID), universalID)

	var gotDeptName string
	if err := testPool.QueryRow(ctx, `SELECT dept_name FROM multica_member WHERE id = $1`, memberID).Scan(&gotDeptName); err != nil {
		t.Fatalf("load member: %v", err)
	}
	// No dept-sync means no fresh data — the stale snapshot must be preserved.
	if gotDeptName != "Old Dept" {
		t.Fatalf("snapshot should be unchanged without dept-sync, got dept_name=%q", gotDeptName)
	}
}
