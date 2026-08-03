package handler

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/multica-ai/multica/server/internal/platformadmin"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// insertWorkflowAdminTestUser creates a user and returns its UUID string.
func insertWorkflowAdminTestUser(t *testing.T, suffix string, canManage bool) string {
	t.Helper()
	var id string
	err := testPool.QueryRow(context.Background(), `
		INSERT INTO multica_user (name, email, can_manage_workflows)
		VALUES ($1, $2, $3) RETURNING id
	`, "WFA Test "+suffix, "wfa-test-"+suffix+"@multica.ai", canManage).Scan(&id)
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}
	t.Cleanup(func() {
		if _, err := testPool.Exec(context.Background(), `DELETE FROM multica_user WHERE id = $1`, id); err != nil {
			t.Errorf("cleanup user: %v", err)
		}
	})
	return id
}

func inviteRequest(userID string) *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/api/workflow-admins/invite",
		strings.NewReader(`{"email":"x@multica.ai"}`))
	req.Header.Set("X-User-ID", userID)
	return req
}

// Regression: InviteWorkflowAdmin previously granted the permission without
// checking the caller at all.
func TestInviteWorkflowAdminRequiresAdmin(t *testing.T) {
	suffix := fmt.Sprintf("%d-%d", os.Getpid(), time.Now().UnixNano())
	caller := insertWorkflowAdminTestUser(t, suffix+"-caller", false)

	h := &Handler{Queries: db.New(testPool)} // nil AdminChecker -> local fallback
	w := httptest.NewRecorder()
	h.InviteWorkflowAdmin(w, inviteRequest(caller))
	if w.Code != http.StatusForbidden {
		t.Fatalf("non-admin caller: got %d, want 403", w.Code)
	}
}

func TestWorkflowAdminsManagedExternallyInPlatformMode(t *testing.T) {
	ctx := context.Background()
	suffix := fmt.Sprintf("%d-%d", os.Getpid(), time.Now().UnixNano())
	caller := insertWorkflowAdminTestUser(t, suffix+"-caller", false)

	if _, err := testPool.Exec(ctx, `DROP TABLE IF EXISTS user_system_roles`); err != nil {
		t.Fatalf("drop table: %v", err)
	}
	if _, err := testPool.Exec(ctx, `
		CREATE TABLE user_system_roles (
			id text PRIMARY KEY, user_id text NOT NULL, role text NOT NULL,
			granted_by text, created_at timestamptz, updated_at timestamptz,
			deleted_at timestamptz
		)`); err != nil {
		t.Fatalf("create table: %v", err)
	}
	t.Cleanup(func() {
		if _, err := testPool.Exec(context.Background(), `DROP TABLE IF EXISTS user_system_roles`); err != nil {
			t.Errorf("cleanup drop table: %v", err)
		}
	})
	// The caller is NOT in user_system_roles -> even the gate denies.
	checker := platformadmin.NewChecker(ctx, db.New(testPool))
	h := &Handler{Queries: db.New(testPool), AdminChecker: checker}

	w := httptest.NewRecorder()
	h.UpdateWorkflowAdmins(w, inviteRequest(caller)) // method/body irrelevant; gate fires first
	if w.Code != http.StatusForbidden {
		t.Fatalf("platform mode, non-platform-admin caller: got %d, want 403", w.Code)
	}
}
