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

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/multica-ai/multica/server/internal/platformadmin"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

const workflowAdminTableLockKey int64 = 872341

// acquireWorkflowAdminTableLock serializes tests that mutate the shared
// user_system_roles table across packages. The caller must release the returned
// connection after any final DROP/unlock via t.Cleanup.
func acquireWorkflowAdminTableLock(t *testing.T) *pgxpool.Conn {
	t.Helper()
	ctx := context.Background()
	conn, err := testPool.Acquire(ctx)
	if err != nil {
		t.Fatalf("acquire connection: %v", err)
	}
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, workflowAdminTableLockKey); err != nil {
		conn.Release()
		t.Fatalf("advisory lock: %v", err)
	}
	return conn
}

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

	conn := acquireWorkflowAdminTableLock(t)
	if _, err := conn.Exec(ctx, `DROP TABLE IF EXISTS user_system_roles`); err != nil {
		t.Fatalf("drop table: %v", err)
	}
	if _, err := conn.Exec(ctx, `
		CREATE TABLE user_system_roles (
			id text PRIMARY KEY, user_id text NOT NULL, role text NOT NULL,
			granted_by text, created_at timestamptz, updated_at timestamptz,
			deleted_at timestamptz
		)`); err != nil {
		t.Fatalf("create table: %v", err)
	}
	t.Cleanup(func() {
		if _, err := conn.Exec(context.Background(), `DROP TABLE IF EXISTS user_system_roles`); err != nil {
			t.Errorf("cleanup drop table: %v", err)
		}
		conn.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, workflowAdminTableLockKey)
		conn.Release()
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

func TestGetMeWorkflowAdminFields(t *testing.T) {
	suffix := fmt.Sprintf("%d-%d", os.Getpid(), time.Now().UnixNano())
	userID := insertWorkflowAdminTestUser(t, suffix+"-me", true)

	h := &Handler{Queries: db.New(testPool)} // local fallback mode
	req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	req.Header.Set("X-User-ID", userID)
	w := httptest.NewRecorder()
	h.GetMe(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("got %d, want 200", w.Code)
	}
	body := w.Body.String()
	if !strings.Contains(body, `"can_manage_workflows":true`) {
		t.Fatalf("expected can_manage_workflows:true, body: %s", body)
	}
	if !strings.Contains(body, `"workflow_admin_source":"local"`) {
		t.Fatalf("expected workflow_admin_source:local, body: %s", body)
	}
}
