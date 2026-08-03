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
