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
		pool.Close()
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
