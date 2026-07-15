package handler

import (
	"context"
	"testing"

	"github.com/multica-ai/multica/server/internal/deptsync"
	"github.com/multica-ai/multica/server/internal/util"
)

// linkDeptMembersOnLogin is the server-side activation path: every Casdoor
// login binds any pending dept membership matching the user's universal_id.
// This must not depend on the embedded iframe identity handshake, which only
// fires when multica runs inside opencode.

func TestLinkDeptMembersOnLoginActivatesPendingMembers(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	ctx := context.Background()
	const email = "login-dept-user@example.test"
	const slug = "handler-login-link"
	const universalID = "uni-login-link"
	_, _ = testPool.Exec(ctx, `DELETE FROM multica_workspace WHERE slug = $1`, slug)
	_, _ = testPool.Exec(ctx, `DELETE FROM multica_user WHERE email = $1`, email)
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM multica_workspace WHERE slug = $1`, slug)
		_, _ = testPool.Exec(context.Background(), `DELETE FROM multica_user WHERE email = $1`, email)
	})

	var userID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_user (name, email)
		VALUES ('Login Dept User', $1)
		RETURNING id
	`, email).Scan(&userID); err != nil {
		t.Fatalf("create user: %v", err)
	}

	var workspaceID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workspace (name, slug, description, issue_prefix)
		VALUES ('Login Link Workspace', $1, '', 'LLW')
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
		VALUES ($1, 'member', 'dept', 'pending_activation', 'E030', $2,
			'E030', 'Login Dept User', 'D300', 'Platform', 'R&D/Platform', 'Engineer')
		RETURNING id
	`, workspaceID, universalID).Scan(&memberID); err != nil {
		t.Fatalf("create pending member: %v", err)
	}

	prev := testHandler.DeptSync
	testHandler.DeptSync = fakeWorkspaceDeptClient{users: []deptsync.User{
		{UserID: "E030", Username: "Login Dept User", UniversalID: universalID, DeptID: "D300", DeptName: "Platform", DeptPath: "R&D/Platform", Position: "Engineer", Status: 1, IsMain: 1},
	}}
	t.Cleanup(func() { testHandler.DeptSync = prev })

	testHandler.linkDeptMembersOnLogin(ctx, util.MustParseUUID(userID), universalID)

	var gotUserID *string
	var gotStatus string
	if err := testPool.QueryRow(ctx, `SELECT user_id, status FROM multica_member WHERE id = $1`, memberID).Scan(&gotUserID, &gotStatus); err != nil {
		t.Fatalf("load member: %v", err)
	}
	if gotUserID == nil || *gotUserID != userID || gotStatus != "active" {
		t.Fatalf("member should be activated: user_id=%v status=%q", gotUserID, gotStatus)
	}
}

// Even when dept-sync is unreachable at login time, a membership that already
// exists (added earlier) must still bind — otherwise a dept-sync outage would
// lock newly-arriving members out of their workspaces.
func TestLinkDeptMembersOnLoginActivatesWithoutDeptSync(t *testing.T) {
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
			workspace_id, role, source, status, external_user_id, external_universal_id,
			employee_id, org_display_name, dept_id, dept_name, dept_path, position
		)
		VALUES ($1, 'member', 'dept', 'pending_activation', 'E032', $2,
			'E032', 'Stale Name', 'D320', 'Old Dept', 'R&D/Old', 'Old Role')
		RETURNING id
	`, workspaceID, universalID).Scan(&memberID); err != nil {
		t.Fatalf("create pending member: %v", err)
	}

	prev := testHandler.DeptSync
	testHandler.DeptSync = nil // dept-sync not configured at login time
	t.Cleanup(func() { testHandler.DeptSync = prev })

	testHandler.linkDeptMembersOnLogin(ctx, util.MustParseUUID(userID), universalID)

	var gotUserID *string
	var gotStatus, gotDeptName string
	if err := testPool.QueryRow(ctx, `SELECT user_id, status, dept_name FROM multica_member WHERE id = $1`, memberID).Scan(&gotUserID, &gotStatus, &gotDeptName); err != nil {
		t.Fatalf("load member: %v", err)
	}
	if gotUserID == nil || *gotUserID != userID || gotStatus != "active" {
		t.Fatalf("member should still activate without dept-sync: user_id=%v status=%q", gotUserID, gotStatus)
	}
	// No dept-sync means no fresh data — the stale snapshot must be preserved.
	if gotDeptName != "Old Dept" {
		t.Fatalf("snapshot should be unchanged without dept-sync, got dept_name=%q", gotDeptName)
	}
}

// When dept-sync has fresher org data than the snapshot stored at add time,
// login refreshes the member row so the user's name / department / position
// stay current without an admin re-adding them.
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
			workspace_id, role, source, status, external_user_id, external_universal_id,
			employee_id, org_display_name, dept_id, dept_name, dept_path, position
		)
		VALUES ($1, 'member', 'dept', 'pending_activation', 'E031', $2,
			'E031', 'Stale Name', 'D310', 'Old Dept', 'R&D/Old', 'Old Role')
		RETURNING id
	`, workspaceID, universalID).Scan(&memberID); err != nil {
		t.Fatalf("create pending member: %v", err)
	}

	prev := testHandler.DeptSync
	testHandler.DeptSync = fakeWorkspaceDeptClient{users: []deptsync.User{
		{UserID: "E031", Username: "Fresh Name", UniversalID: universalID, DeptID: "D315", DeptName: "New Dept", DeptPath: "R&D/New", Position: "New Role", Status: 1, IsMain: 1},
	}}
	t.Cleanup(func() { testHandler.DeptSync = prev })

	testHandler.linkDeptMembersOnLogin(ctx, util.MustParseUUID(userID), universalID)

	var gotUserID *string
	var gotStatus, gotName, gotDeptName, gotDeptPath, gotPosition string
	if err := testPool.QueryRow(ctx, `
		SELECT user_id, status, org_display_name, dept_name, dept_path, position
		FROM multica_member WHERE id = $1
	`, memberID).Scan(&gotUserID, &gotStatus, &gotName, &gotDeptName, &gotDeptPath, &gotPosition); err != nil {
		t.Fatalf("load member: %v", err)
	}
	if gotUserID == nil || *gotUserID != userID || gotStatus != "active" {
		t.Fatalf("member should be activated: user_id=%v status=%q", gotUserID, gotStatus)
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
		INSERT INTO multica_user (name, email, casdoor_universal_id)
		VALUES ('c9bb0e3f-253c-4f2e-82f0-f0e50c4f40f0', $1, $2)
		RETURNING id
	`, email, universalID).Scan(&userID); err != nil {
		t.Fatalf("create user: %v", err)
	}

	prev := testHandler.DeptSync
	testHandler.DeptSync = fakeWorkspaceDeptClient{users: []deptsync.User{
		{UserID: "53613", Username: "李金榜", UniversalID: universalID, DeptID: "6571", DeptName: "开发组", DeptPath: "/研发体系/Costrict研发部/开发组", Position: "高级后台开发工程师", Status: 1, IsMain: 1},
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

// When the user already has a membership in a workspace (e.g. an email-invite
// "manual" row from before Casdoor binding), ActivatePending's no-duplicate
// guard blocks the dept row from activating. Login must still backfill the
// dept-sync org snapshot onto the existing membership (so the member list shows
// the user's department/position instead of an email fallback) and remove the
// orphaned pending dept row rather than leaving a duplicate.
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
	// Pending dept row for the same universal_id in the same workspace (stale org).
	if _, err := testPool.Exec(ctx, `
		INSERT INTO multica_member (
			workspace_id, role, source, status, external_user_id, external_universal_id,
			employee_id, org_display_name, dept_id, dept_name, dept_path, position
		)
		VALUES ($1, 'member', 'dept', 'pending_activation', 'E040', $2,
			'E040', 'Stale Name', 'D400', 'Old Dept', 'R&D/Old', 'Old Role')
	`, workspaceID, universalID); err != nil {
		t.Fatalf("create pending dept member: %v", err)
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
		SELECT dept_name, position, employee_id FROM multica_member WHERE id = $1
	`, manualMemberID).Scan(&manualDeptName, &manualPosition, &manualEmployeeID); err != nil {
		t.Fatalf("load manual member: %v", err)
	}
	if manualDeptName != "New Dept" || manualPosition != "New Role" || manualEmployeeID != "E040" {
		t.Fatalf("existing membership not backfilled: dept=%q position=%q employee=%q", manualDeptName, manualPosition, manualEmployeeID)
	}

	// The orphaned pending dept row must be gone — exactly one membership for
	// this user in the workspace (the backfilled manual one), no pending leftover.
	var userMembers, pendingOrphans int
	if err := testPool.QueryRow(ctx, `SELECT count(*) FROM multica_member WHERE workspace_id = $1 AND user_id = $2`, workspaceID, userID).Scan(&userMembers); err != nil {
		t.Fatalf("count user members: %v", err)
	}
	if err := testPool.QueryRow(ctx, `SELECT count(*) FROM multica_member WHERE workspace_id = $1 AND external_universal_id = $2 AND status = 'pending_activation'`, workspaceID, universalID).Scan(&pendingOrphans); err != nil {
		t.Fatalf("count orphan pending: %v", err)
	}
	if userMembers != 1 {
		t.Fatalf("expected exactly 1 membership for the user, got %d", userMembers)
	}
	if pendingOrphans != 0 {
		t.Fatalf("expected the orphan pending dept row to be removed, got %d", pendingOrphans)
	}
}

// Sanity: calling linkDeptMembersOnLogin on a user with no pending membership
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
