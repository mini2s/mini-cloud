# Platform-Admin Workflow Permission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace multica's self-managed `can_manage_workflows` flag with costrict-web's `platform_admin` role (read directly from the shared `user_system_roles` table) in costrict-integrated deployments, keeping the flag as fallback for standalone deployments.

**Architecture:** A new `platformadmin.Checker` in the Go server probes at startup whether the `user_system_roles` table exists in the shared database. If present, all workflow-admin gates check `platform_admin` role by `subject_id`; otherwise they fall back to `multica_user.can_manage_workflows`. `/api/me` exposes the effective permission + source so the frontend gates UI without the admins list.

**Tech Stack:** Go (Chi, sqlc/pgx), TypeScript (React, zod, TanStack Query, Vitest).

**Spec:** `docs/superpowers/specs/2026-08-03-platform-admin-workflow-permission-design.md`

**Branch:** `feat/platform-admin-workflow-perm` (already created, never push to main).

## Global Constraints

- `user_system_roles` is owned by costrict-web (GORM AutoMigrate). multica only ever **reads** it, and only the columns `user_id`, `role`, `deleted_at`. Never write to it.
- Role check MUST include `deleted_at IS NULL` (revocation is a soft delete).
- Effective permission in platform mode: `user_system_roles.user_id = multica_user.subject_id AND role = 'platform_admin' AND deleted_at IS NULL`. A user without `subject_id` has no platform permission.
- Platform-mode query errors fail **closed** (deny + error log). Table-probe failure at startup falls back to local mode + warn log.
- Keep code comments in English only.
- Database-backed Go tests must run against the isolated Docker test DB (`make test` handles this); never point `DATABASE_URL` at the dev database.
- Follow CLAUDE.md API Response Compatibility rules for `/api/me` schema changes: zod `.default(...)` on new fields, `=== true` checks downstream.
- Commit format: `feat(server): ...` / `feat(core): ...` / `feat(views): ...`, one commit per task.

## Pre-flight: verify the subject_id assumption (manual, with the user)

The whole design rests on `multica_user.subject_id` values being the same identifiers stored in `user_system_roles.user_id`. Before writing code, run against the zgsmtest deployment database (ask the user for access or have them run it):

```sql
SELECT user_id FROM user_system_roles WHERE role = 'platform_admin' AND deleted_at IS NULL;
SELECT id, email, subject_id FROM multica_user WHERE subject_id IS NOT NULL LIMIT 20;
```

Expected: every `user_id` from the first query appears as a `subject_id` in `multica_user`. If not, STOP and go back to the spec (fallback: join costrict's `users` table on email).

---

### Task 1: sqlc stub + queries for user_system_roles

**Files:**
- Modify: `server/pkg/db/schema_external.sql`
- Create: `server/pkg/db/queries/platform_admin.sql`
- Modify: `server/migrations/scripts/set-first-workflow-admin.sql` (drive-by table-name fix)
- Generated: `server/pkg/db/generated/platform_admin.sql.go` (via `make sqlc`)

**Interfaces:**
- Produces: `Queries.PlatformAdminTableExists(ctx) (bool, error)` and `Queries.IsPlatformAdminBySubjectID(ctx, userID string) (bool, error)` — consumed by Task 2's Checker.

- [ ] **Step 1: Add the external table stub**

Append to `server/pkg/db/schema_external.sql` (keep the existing `user_auth_identities` stub untouched):

```sql
-- user_system_roles is owned by the costrict-web main server (GORM-managed)
-- and exists in the same database in costrict-integrated deployments. The
-- DDL below is a column subset so sqlc can type-check read-only queries.
CREATE TABLE user_system_roles (
    id         text PRIMARY KEY,
    user_id    text NOT NULL,
    role       text NOT NULL,
    granted_by text,
    created_at timestamptz,
    updated_at timestamptz,
    deleted_at timestamptz
);
```

Also update the file-header comment: `user_auth_identities is created and maintained by` → mention both tables. Change line 4-5 area to: `These tables are NOT owned by multica's migrations and this file must never be applied to a database. They are created and maintained by external services (cs-user, costrict-web) in deployments where multica shares its database;`

- [ ] **Step 2: Create the queries file**

Create `server/pkg/db/queries/platform_admin.sql`:

```sql
-- Read-only queries against costrict-web's user_system_roles table (external,
-- see pkg/db/schema_external.sql). Present only in costrict-integrated
-- deployments; the platformadmin.Checker probes existence at startup.

-- name: PlatformAdminTableExists :one
SELECT to_regclass('public.user_system_roles') IS NOT NULL AS exists;

-- name: IsPlatformAdminBySubjectID :one
SELECT EXISTS (
    SELECT 1 FROM user_system_roles
    WHERE user_id = $1::text
      AND role = 'platform_admin'
      AND deleted_at IS NULL
) AS is_platform_admin;
```

- [ ] **Step 3: Regenerate sqlc code**

Run: `make sqlc`
Expected: no errors; `server/pkg/db/generated/platform_admin.sql.go` created containing `PlatformAdminTableExists` and `IsPlatformAdminBySubjectID`.

Verify: `cd server && go build ./...` — compiles clean.

- [ ] **Step 4: Fix the stale table name in the bootstrap script**

`server/migrations/scripts/set-first-workflow-admin.sql` references `"user"`, but migration 114 renamed the table to `multica_user`. Replace the UPDATE line:

```sql
-- Set the first global workflow administrator (standalone/fallback deployments
-- only — costrict-integrated deployments use the platform_admin role instead).
UPDATE multica_user SET can_manage_workflows = TRUE WHERE email = 'admin@example.com';
```

- [ ] **Step 5: Commit**

```bash
git add server/pkg/db/schema_external.sql server/pkg/db/queries/platform_admin.sql server/pkg/db/generated/ server/migrations/scripts/set-first-workflow-admin.sql
git commit -m "feat(server): add read-only sqlc queries for costrict user_system_roles"
```

---

### Task 2: platformadmin.Checker

**Files:**
- Create: `server/internal/platformadmin/checker.go`
- Test: `server/internal/platformadmin/checker_test.go`

**Interfaces:**
- Consumes: `Queries.PlatformAdminTableExists`, `Queries.IsPlatformAdminBySubjectID` (Task 1).
- Produces (used by Tasks 3-4):
  - `platformadmin.NewChecker(ctx context.Context, queries *db.Queries) *Checker` — probes table existence.
  - `(*Checker).CanManageWorkflows(ctx context.Context, user db.MulticaUser) bool` — nil-receiver safe (nil → local flag).
  - `(*Checker).Source() platformadmin.Source` — nil-receiver safe (nil → `SourceLocal`).
  - `platformadmin.SourcePlatform` (`"platform"`), `platformadmin.SourceLocal` (`"local"`).

- [ ] **Step 1: Write the failing test**

Create `server/internal/platformadmin/checker_test.go`. DB-backed, self-skipping when no DB is reachable (same pattern as `openTestPool` in `server/internal/service/workflow_template_test.go`). Note `db.New(pool)` wraps a pool into `*db.Queries`.

```go
package platformadmin

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func openTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://multica:multica@localhost:5432/multica?sslmode=disable"
	}
	pool, err := pgxpool.New(context.Background(), dbURL)
	if err != nil {
		t.Skipf("skipping: could not connect to database: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("skipping: database not reachable: %v", err)
	}
	return pool
}

func userWith(subjectID string, localFlag bool) db.MulticaUser {
	u := db.MulticaUser{CanManageWorkflows: localFlag}
	if subjectID != "" {
		u.SubjectID = pgtype.Text{String: subjectID, Valid: true}
	}
	return u
}

func TestCheckerLocalModeWithoutTable(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `DROP TABLE IF EXISTS user_system_roles`); err != nil {
		t.Fatalf("drop table: %v", err)
	}

	c := NewChecker(ctx, db.New(pool))
	if c.Source() != SourceLocal {
		t.Fatalf("expected SourceLocal, got %q", c.Source())
	}
	if !c.CanManageWorkflows(ctx, userWith("usr_any", true)) {
		t.Fatal("local mode must honor can_manage_workflows=true")
	}
	if c.CanManageWorkflows(ctx, userWith("usr_any", false)) {
		t.Fatal("local mode must honor can_manage_workflows=false")
	}
}

func TestCheckerPlatformMode(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()
	ctx := context.Background()

	if _, err := pool.Exec(ctx, `DROP TABLE IF EXISTS user_system_roles`); err != nil {
		t.Fatalf("drop table: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		CREATE TABLE user_system_roles (
			id text PRIMARY KEY, user_id text NOT NULL, role text NOT NULL,
			granted_by text, created_at timestamptz, updated_at timestamptz,
			deleted_at timestamptz
		)`); err != nil {
		t.Fatalf("create table: %v", err)
	}
	t.Cleanup(func() {
		if _, err := pool.Exec(context.Background(), `DROP TABLE IF EXISTS user_system_roles`); err != nil {
			t.Errorf("cleanup drop table: %v", err)
		}
	})

	if _, err := pool.Exec(ctx, `
		INSERT INTO user_system_roles (id, user_id, role) VALUES
		('r1', 'usr_admin', 'platform_admin'),
		('r2', 'usr_revoked', 'platform_admin'),
		('r3', 'usr_business', 'business_admin')`); err != nil {
		t.Fatalf("seed roles: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		UPDATE user_system_roles SET deleted_at = now() WHERE id = 'r2'`); err != nil {
		t.Fatalf("soft-delete r2: %v", err)
	}

	c := NewChecker(ctx, db.New(pool))
	if c.Source() != SourcePlatform {
		t.Fatalf("expected SourcePlatform, got %q", c.Source())
	}

	cases := []struct {
		name string
		user db.MulticaUser
		want bool
	}{
		{"platform admin", userWith("usr_admin", false), true},
		{"soft-deleted row denied", userWith("usr_revoked", false), false},
		{"business_admin is not platform_admin", userWith("usr_business", false), false},
		{"no role row", userWith("usr_nobody", false), false},
		{"missing subject_id", userWith("", true), false},
		{"local flag ignored in platform mode", userWith("usr_nobody", true), false},
	}
	for _, tc := range cases {
		if got := c.CanManageWorkflows(ctx, tc.user); got != tc.want {
			t.Errorf("%s: got %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestCheckerNilSafe(t *testing.T) {
	var c *Checker
	if c.Source() != SourceLocal {
		t.Fatal("nil checker must report SourceLocal")
	}
	if !c.CanManageWorkflows(context.Background(), userWith("usr_x", true)) {
		t.Fatal("nil checker must fall back to the local flag")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && go test ./internal/platformadmin/ -run TestChecker -v`
Expected: FAIL — package does not exist / `NewChecker` undefined.

- [ ] **Step 3: Implement the checker**

Create `server/internal/platformadmin/checker.go`:

```go
// Package platformadmin resolves the effective workflow-admin permission.
// In costrict-integrated deployments the costrict-web main server shares
// multica's database and its user_system_roles table is the source of truth
// (role 'platform_admin'). Standalone deployments lack that table and fall
// back to multica_user.can_manage_workflows.
package platformadmin

import (
	"context"
	"log/slog"

	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// Source identifies which permission backend is active.
type Source string

const (
	// SourcePlatform: the shared user_system_roles table exists; platform_admin
	// role membership decides. SourceLocal: legacy multica_user flag.
	SourcePlatform Source = "platform"
	SourceLocal    Source = "local"
)

type Checker struct {
	queries *db.Queries
	source  Source
}

// NewChecker probes the database once for the user_system_roles table and
// returns a Checker pinned to the detected mode. Probe errors fall back to
// local mode (with a warning) so a transient startup failure never widens
// or narrows permissions unexpectedly.
func NewChecker(ctx context.Context, queries *db.Queries) *Checker {
	exists, err := queries.PlatformAdminTableExists(ctx)
	if err != nil {
		slog.Warn("platform admin table probe failed; using local workflow-admin fallback", "error", err)
		return &Checker{queries: queries, source: SourceLocal}
	}
	if exists {
		return &Checker{queries: queries, source: SourcePlatform}
	}
	return &Checker{queries: queries, source: SourceLocal}
}

// Source reports the active permission backend. Nil-safe: a nil Checker
// (unit tests that build Handler via struct literal) reports SourceLocal.
func (c *Checker) Source() Source {
	if c == nil {
		return SourceLocal
	}
	return c.source
}

// CanManageWorkflows reports the effective workflow-admin permission.
// Platform mode checks role membership by subject_id and ignores the local
// flag entirely; a user without subject_id can never be a platform admin.
// Check errors fail closed. Nil receiver falls back to the local flag.
func (c *Checker) CanManageWorkflows(ctx context.Context, user db.MulticaUser) bool {
	if c == nil || c.source == SourceLocal {
		return user.CanManageWorkflows
	}
	if !user.SubjectID.Valid || user.SubjectID.String == "" {
		return false
	}
	ok, err := c.queries.IsPlatformAdminBySubjectID(ctx, user.SubjectID.String)
	if err != nil {
		slog.Error("platform admin check failed; denying", "error", err)
		return false
	}
	return ok
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && go test ./internal/platformadmin/ -v`
Expected: PASS (3 tests; they skip only if no DB — confirm they actually ran with `-v`).

Note: database-backed tests need the isolated test DB. If tests skip, load the worktree env and set `DATABASE_URL` per CLAUDE.md ("Database-backed Go tests"), or run `make test`.

- [ ] **Step 5: Commit**

```bash
git add server/internal/platformadmin/
git commit -m "feat(server): add platformadmin checker with local fallback"
```

---

### Task 3: Handler wiring — replace all can_manage_workflows gates

**Files:**
- Modify: `server/internal/handler/handler.go` (struct field + constructor + helper)
- Modify: `server/internal/handler/workflow.go:1823-1839, 1914-1923, 1970-2001`
- Modify: `server/internal/handler/agent.go:563-574, 889-916, 1444-1459, 1488-1503`
- Test: `server/internal/handler/workflow_admin_test.go` (new)

**Interfaces:**
- Consumes: `platformadmin.NewChecker`, `(*Checker).CanManageWorkflows`, `(*Checker).Source`, `platformadmin.SourcePlatform` (Task 2).
- Produces: `(*Handler).effectiveCanManageWorkflows(ctx context.Context, user db.MulticaUser) bool` — used in Task 4.

- [ ] **Step 1: Add the AdminChecker field, constructor wiring, and helper**

In `server/internal/handler/handler.go`, add to the `Handler` struct (after `WorkflowService` is fine):

```go
	AdminChecker           *platformadmin.Checker
```

In `New`, add to the `h := &Handler{...}` literal:

```go
		AdminChecker:           platformadmin.NewChecker(context.Background(), queries),
```

(Ensure `context` and `github.com/multica-ai/multica/server/internal/platformadmin` imports exist.)

Add the helper (near `requestUserID` in handler.go):

```go
// effectiveCanManageWorkflows reports whether the user holds this deployment's
// workflow-admin permission: the costrict platform_admin role when the shared
// user_system_roles table exists, otherwise multica_user.can_manage_workflows.
func (h *Handler) effectiveCanManageWorkflows(ctx context.Context, user db.MulticaUser) bool {
	return h.AdminChecker.CanManageWorkflows(ctx, user)
}
```

- [ ] **Step 2: Write the failing handler tests**

Create `server/internal/handler/workflow_admin_test.go`. Follow the existing handler-package DB-test pattern (`agent_cloud_skill_test.go` uses the package-level `testPool`; mirror its fixture style — insert users with SQL, build `&Handler{Queries: db.New(testPool)}`, drive handlers with `httptest`).

```go
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

	h := &Handler{Queries: db.New(testPool)} // nil AdminChecker → local fallback
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
	// The caller is NOT in user_system_roles → even the gate denies.
	checker := platformadmin.NewChecker(ctx, db.New(testPool))
	h := &Handler{Queries: db.New(testPool), AdminChecker: checker}

	w := httptest.NewRecorder()
	h.UpdateWorkflowAdmins(w, inviteRequest(caller)) // method/body irrelevant; gate fires first
	if w.Code != http.StatusForbidden {
		t.Fatalf("platform mode, non-platform-admin caller: got %d, want 403", w.Code)
	}
}
```

(If `testPool` is not initialized in the handler package without a TestMain setup, follow exactly what `agent_cloud_skill_test.go` does to obtain the pool — copy its setup helper.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd server && go test ./internal/handler/ -run 'TestInviteWorkflowAdminRequiresAdmin|TestWorkflowAdminsManagedExternallyInPlatformMode' -v`
Expected: `TestInviteWorkflowAdminRequiresAdmin` FAILS (current code returns 404 "user not found" instead of 403 — the missing caller check is the bug being fixed). `TestWorkflowAdminsManagedExternallyInPlatformMode` may already pass at this point (current code denies via the local flag) — that's fine, it locks the behavior in.

- [ ] **Step 4: Replace the gates**

**`workflow.go` `ToggleWorkflowTemplate`** — replace the permission block (currently lines ~1834-1839):

```go
	// Effective workflow-admin permission: platform_admin role in
	// costrict-integrated deployments, local flag otherwise.
	currentUser, err := h.Queries.GetUser(r.Context(), userUUID)
	if err != nil || !h.effectiveCanManageWorkflows(r.Context(), currentUser) {
		writeError(w, http.StatusForbidden, "only platform admins can manage templates")
		return
	}
```

**`workflow.go` `UpdateWorkflowAdmins`** — replace the gate (~1918-1923) and add the platform-mode short-circuit:

```go
	currentUser, err := h.Queries.GetUser(r.Context(), userUUID)
	if err != nil || !h.effectiveCanManageWorkflows(r.Context(), currentUser) {
		writeError(w, http.StatusForbidden, "only platform admins can manage workflow admins")
		return
	}
	if h.AdminChecker.Source() == platformadmin.SourcePlatform {
		writeError(w, http.StatusForbidden, "workflow admins are managed by the costrict platform admin role")
		return
	}
```

**`workflow.go` `InviteWorkflowAdmin`** — add the missing caller gate + platform-mode short-circuit at the top of the function (this is also the security fix):

```go
	userID, _ := requireUserID(w, r)
	currentUser, err := h.Queries.GetUser(r.Context(), parseUUID(userID))
	if err != nil || !h.effectiveCanManageWorkflows(r.Context(), currentUser) {
		writeError(w, http.StatusForbidden, "only platform admins can manage workflow admins")
		return
	}
	if h.AdminChecker.Source() == platformadmin.SourcePlatform {
		writeError(w, http.StatusForbidden, "workflow admins are managed by the costrict platform admin role")
		return
	}
```

**`agent.go` `canManageAgent`** — builtin branch (~894-902):

```go
		currentUser, err := h.Queries.GetUser(r.Context(), userUUID)
		if err != nil || !h.effectiveCanManageWorkflows(r.Context(), currentUser) {
			writeError(w, http.StatusForbidden, "only platform admins can manage built-in agents")
			return false
		}
```

**`agent.go` `PromoteAgentToBuiltin`** (~1454-1459) and **`DemoteAgentFromBuiltin`** (~1498-1503) — same replacement, message `"only platform admins can manage built-in agents"`.

**`agent.go` `GetAgent`** redact branch (~569-574) — only the condition changes:

```go
		currentUser, err := h.Queries.GetUser(r.Context(), parseUUID(userID))
		if err != nil || !h.effectiveCanManageWorkflows(r.Context(), currentUser) {
			redactEnv(&resp)
			redactMcpConfig(&resp)
			resp.CustomEnvRedactedReason = "role"
		}
```

Also update the stale comments mentioning "can_manage_workflows permission" above `ToggleWorkflowTemplate`, `PromoteAgentToBuiltin`, `DemoteAgentFromBuiltin`, `canManageAgent` to reference the platform_admin role + fallback.

Add the `platformadmin` import to `workflow.go`.

- [ ] **Step 5: Run Go tests**

Run: `cd server && go build ./... && go test ./internal/handler/ -run 'WorkflowAdmin|AgentCloudSkill' -v`
Expected: PASS. Existing `agent_cloud_skill_test.go` cases (local flag) keep passing via the nil-checker fallback.

- [ ] **Step 6: Commit**

```bash
git add server/internal/handler/
git commit -m "feat(server): gate workflow-admin operations on costrict platform_admin role"
```

---

### Task 4: /api/me exposes effective permission + source; remove dead service helper

**Files:**
- Modify: `server/internal/handler/auth.go:51-65, 420, 436, 614, 722`
- Modify: `server/internal/handler/onboarding.go:125, 263, 325`
- Modify: `server/internal/service/workflow.go:2470-2478` (delete `CanManageWorkflows`)
- Modify: `server/internal/service/workflow_template_test.go:486-540` (delete `TestCanManageWorkflows`)
- Test: extend `server/internal/handler/workflow_admin_test.go`

**Interfaces:**
- Consumes: `(*Handler).effectiveCanManageWorkflows` (Task 3).
- Produces: `/api/me` response gains `can_manage_workflows: boolean` and `workflow_admin_source: "platform" | "local"` — consumed by Tasks 5-6 frontend work.

- [ ] **Step 1: Write the failing test**

Append to `server/internal/handler/workflow_admin_test.go`:

```go
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
```

Run: `cd server && go test ./internal/handler/ -run TestGetMeWorkflowAdminFields -v`
Expected: FAIL — response lacks both fields.

- [ ] **Step 2: Extend UserResponse and add the enrichment helper**

In `server/internal/handler/auth.go`, add to `UserResponse`:

```go
	CanManageWorkflows      bool            `json:"can_manage_workflows"`
	WorkflowAdminSource     string          `json:"workflow_admin_source"`
```

Add the helper (next to `userToResponse`):

```go
// userResponseWithAdmin enriches the response with the effective
// workflow-admin permission and its source so clients can gate admin UI
// without fetching the admins list.
func (h *Handler) userResponseWithAdmin(ctx context.Context, u db.MulticaUser) UserResponse {
	resp := userToResponse(u)
	resp.CanManageWorkflows = h.effectiveCanManageWorkflows(ctx, u)
	resp.WorkflowAdminSource = string(h.AdminChecker.Source())
	return resp
}
```

Replace every `userToResponse(` call site with `h.userResponseWithAdmin(r.Context(), `:
- `auth.go:420` (VerifyCode login response), `auth.go:436` (GetMe), `auth.go:614` (Google login), `auth.go:722` (UpdateMe)
- `onboarding.go:125, 263, 325`

- [ ] **Step 3: Delete the dead service helper**

Delete `CanManageWorkflows` from `server/internal/service/workflow.go` (~2470-2478) and `TestCanManageWorkflows` from `server/internal/service/workflow_template_test.go` (~486-540). The handler layer no longer reads the raw flag outside the checker; keeping a second accessor invites divergent semantics.

- [ ] **Step 4: Run tests**

Run: `cd server && go build ./... && go test ./internal/handler/ -run 'WorkflowAdmin|GetMe' -v && go test ./internal/service/ -run TestCanManageWorkflows -v`
Expected: handler tests PASS; service test reports "no tests to run" (deleted).

- [ ] **Step 5: Commit**

```bash
git add server/internal/handler/ server/internal/service/
git commit -m "feat(server): expose effective workflow-admin permission on /api/me"
```

---

### Task 5: Frontend core — User type, /api/me schema, permission copy

**Files:**
- Modify: `packages/core/types/workspace.ts` (`User` interface, ~line 28)
- Modify: `packages/core/api/schemas.ts` (`UserSchema` ~717, `EMPTY_USER` ~733)
- Modify: `packages/core/permissions/rules.ts:265-286` (message copy)
- Test: `packages/core/api/schemas.test.ts` (extend)

**Interfaces:**
- Produces: `User.can_manage_workflows: boolean` and `User.workflow_admin_source: string` — consumed by Task 6 views.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/api/schemas.test.ts` (follow the existing `parseWithFallback` test style in that file):

```ts
import { UserSchema } from "./schemas";

describe("UserSchema workflow-admin fields", () => {
  const baseUser = {
    id: "u1",
    name: "A",
    email: "a@x.ai",
    created_at: "",
    updated_at: "",
  };

  it("defaults workflow-admin fields when the backend omits them (old server)", () => {
    const parsed = UserSchema.parse(baseUser);
    expect(parsed.can_manage_workflows).toBe(false);
    expect(parsed.workflow_admin_source).toBe("local");
  });

  it("passes through platform source and granted permission", () => {
    const parsed = UserSchema.parse({
      ...baseUser,
      can_manage_workflows: true,
      workflow_admin_source: "platform",
    });
    expect(parsed.can_manage_workflows).toBe(true);
    expect(parsed.workflow_admin_source).toBe("platform");
  });

  it("fails closed on a wrong-typed can_manage_workflows", () => {
    const result = UserSchema.safeParse({ ...baseUser, can_manage_workflows: "yes" });
    expect(result.success).toBe(false);
  });
});
```

Run: `pnpm --filter @multica/core exec vitest run api/schemas.test.ts`
Expected: FAIL — `can_manage_workflows` is `undefined` (schema lacks the fields).

- [ ] **Step 2: Extend the schema, EMPTY_USER, and User type**

In `packages/core/api/schemas.ts`, add to `UserSchema` (before `.loose()`):

```ts
  can_manage_workflows: z.boolean().default(false),
  workflow_admin_source: z.string().default("local"),
```

Add to `EMPTY_USER`:

```ts
  can_manage_workflows: false,
  workflow_admin_source: "local",
```

In `packages/core/types/workspace.ts`, add to the `User` interface:

```ts
  /**
   * Effective workflow-admin permission, resolved server-side: the costrict
   * platform_admin role in integrated deployments, the legacy local flag
   * otherwise. Defaults to false against older backends (fail closed).
   */
  can_manage_workflows: boolean;
  /** "platform" = costrict user_system_roles; "local" = multica fallback. */
  workflow_admin_source: string;
```

- [ ] **Step 3: Update permission-rule copy**

In `packages/core/permissions/rules.ts`, change the deny message in `canPromoteAgent`:

```ts
      "Only platform admins can promote agents to built-in.",
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @multica/core exec vitest run api/schemas.test.ts && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/
git commit -m "feat(core): add workflow-admin fields to /api/me user schema"
```

---

### Task 6: Frontend views — gate on /api/me instead of the admins list

**Files:**
- Modify: `packages/views/settings/components/settings-page.tsx:105-107`
- Modify: `packages/views/settings/components/workflow-admins-tab.tsx` (~line 97)
- Modify: `packages/views/agents/components/agent-detail-page.tsx` (~111-118)
- Test: `packages/views/settings/components/settings-page.test.tsx`

**Interfaces:**
- Consumes: `User.can_manage_workflows`, `User.workflow_admin_source` (Task 5).
- `useWorkflowAdmins()` stays: `workflow-admins-tab.tsx` still needs the admins list for the management UI itself (local mode only).

- [ ] **Step 1: Update the failing-path test first**

In `packages/views/settings/components/settings-page.test.tsx`:

1. Delete the `vi.mock("@multica/core/workflows/queries", ...)` block entirely (the page no longer calls `useWorkflowAdmins`).
2. Change the `@multica/core/auth` mock so the user is hoisted and rewritable per test:

```ts
const authRef = vi.hoisted(() => ({
  user: {
    id: "user-1",
    can_manage_workflows: false,
    workflow_admin_source: "local",
  } as { id: string; can_manage_workflows: boolean; workflow_admin_source: string },
}));

vi.mock("@multica/core/auth", () => {
  const useAuthStore = Object.assign(
    (sel?: (s: { user: typeof authRef.user }) => unknown) =>
      sel ? sel({ user: authRef.user }) : { user: authRef.user },
    { getState: () => ({ user: authRef.user }) },
  );
  return { useAuthStore };
});
```

3. Add tests (find the existing tab-visibility describe block and extend it):

```ts
it("shows the workflow-admins tab for local workflow admins", async () => {
  authRef.user = { id: "user-1", can_manage_workflows: true, workflow_admin_source: "local" };
  render(/* existing render helper */);
  expect(await screen.findByRole("tab", { name: /workflow admin/i })).toBeInTheDocument();
});

it("hides the workflow-admins tab in platform mode even for platform admins", () => {
  authRef.user = { id: "user-1", can_manage_workflows: true, workflow_admin_source: "platform" };
  render(/* existing render helper */);
  expect(screen.queryByRole("tab", { name: /workflow admin/i })).not.toBeInTheDocument();
});
```

(Reset `authRef.user` in `beforeEach` to the non-admin default. Match the exact tab label from `en/settings.json` — adjust the regex if the copy differs.)

Run: `pnpm --filter @multica/views exec vitest run settings/components/settings-page.test.tsx`
Expected: new tests FAIL (page still derives from `useWorkflowAdmins`, and the removed mock breaks the module mock graph).

- [ ] **Step 2: Update settings-page.tsx**

Remove the `useWorkflowAdmins` import and replace lines 105-107:

```ts
  const user = useAuthStore((s) => s.user);
  // The admins-management tab only exists in standalone deployments; in
  // costrict-integrated deployments admin membership lives in costrict's
  // console, so the tab is hidden even for platform admins.
  const isWorkflowAdmin =
    user?.can_manage_workflows === true && user?.workflow_admin_source !== "platform";
```

- [ ] **Step 3: Update workflow-admins-tab.tsx**

Replace the `isWorkflowAdmin` derivation (~line 97):

```ts
  // The tab itself only renders in local mode (see settings-page); here we
  // only need the effective permission for the permission_denied empty state.
  const isWorkflowAdmin = user?.can_manage_workflows === true;
```

Keep `useWorkflowAdmins()` — it feeds the admin list UI.

- [ ] **Step 4: Update agent-detail-page.tsx**

Remove the `useWorkflowAdmins` import and replace the `canManageWorkflows` useMemo (~lines 111-118):

```ts
  const canManageWorkflows = currentUser?.can_manage_workflows === true;
```

Remove the now-unused `useMemo` import if nothing else uses it (check the file).

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @multica/views exec vitest run settings/components/settings-page.test.tsx && pnpm --filter @multica/views exec vitest run agents && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/views/ packages/core/
git commit -m "feat(views): gate workflow-admin UI on /api/me effective permission"
```

---

### Task 7: Full verification

- [ ] **Step 1: TypeScript**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 2: Go**

Run: `make test`
Expected: PASS — confirm with `-v`-level output (or the summary) that the new `platformadmin` and `workflow_admin` tests actually ran rather than skipped. If they skipped, the test DB wasn't configured; load the worktree env per CLAUDE.md and re-run the targeted packages.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 4: Report**

Summarize the change set and remind the user: deployment to zgsmtest needs **no config change** (the checker auto-detects `user_system_roles` in the shared `costrict_web` DB), and the pre-flight SQL check (top of this plan) should be confirmed against the real database before merge.

---

## Self-Review Notes

- Spec coverage: Tasks 1-4 cover spec sections 后端 1-7; Task 5-6 cover 前端 8-11; the script fix (spec 数据库迁移 bullet) is in Task 1 Step 4; pre-flight covers the 风险 subject_id assumption. No DB migration (spec: 无新迁移) — honored.
- Type consistency: `effectiveCanManageWorkflows` (Task 3) is the single handler helper; Task 4 consumes it. `Source`/`SourceLocal`/`SourcePlatform` names identical across Tasks 2-4. Frontend field names `can_manage_workflows` / `workflow_admin_source` identical across Tasks 4-6.
- `ListWorkflowAdmins` (GET) intentionally left ungated and unchanged (spec section 6: still callable; frontend simply stops using it outside the tab).
