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
