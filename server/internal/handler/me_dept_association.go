package handler

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/deptsync"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// DeptIdentityResolver is the dept-sync surface used to link a logged-in user
// to their dept membership and org snapshot.
type DeptIdentityResolver interface {
	Configured() bool
	GetUserDepartmentsByUniversalID(ctx context.Context, universalID string) ([]deptsync.User, error)
}

// deptLoginSnapshot is the org fields rewritten onto a member row during a
// login-time refresh, sourced from dept-sync.
type deptLoginSnapshot struct {
	OrgDisplayName   string
	EmployeeID       string
	DeptID           string
	DeptName         string
	DeptPath         string
	Position         string
	IsMainDepartment bool
	DeptUserStatus   int
}

// LinkDeptIdentity refreshes the member org snapshot and the user's display
// name from dept-sync, using universalID as a transient lookup token.
//
// It is the single implementation shared by every auth path:
//   - the standalone Casdoor OAuth callback (CasdoorCallback), and
//   - the SubjectResolver, which is the embedded SSO path costrict actually
//     uses (it resolves the user from the zgsmAdminToken cookie on each
//     request — there is no callback there).
//
// Best-effort: errors are logged and never propagated — a dept-sync outage or
// a stale snapshot must not fail auth. The snapshot/name refresh is skipped
// when dept-sync is unavailable or the user has no active main department.
func LinkDeptIdentity(ctx context.Context, queries *db.Queries, deptSync DeptIdentityResolver, userID pgtype.UUID, universalID string) {
	universalID = strings.TrimSpace(universalID)
	if universalID == "" || !userID.Valid {
		return
	}

	var snapshot *deptLoginSnapshot
	if deptSync != nil && deptSync.Configured() {
		departments, err := deptSync.GetUserDepartmentsByUniversalID(ctx, universalID)
		switch {
		case err == nil:
			if picked, ok := pickMainActiveDepartment(departments, universalID); ok {
				snapshot = buildDeptLoginSnapshot(picked)
			}
		case !errors.Is(err, deptsync.ErrNotConfigured):
			slog.Warn("casdoor: dept-sync lookup failed during login", "error", err, "universal_id", universalID)
		}
	}

	if snapshot != nil {
		// Refresh the org snapshot on every membership bound to this user.
		if err := queries.RefreshUserMembershipDeptOrg(ctx, db.RefreshUserMembershipDeptOrgParams{
			UserID:           userID,
			OrgDisplayName:   pgtype.Text{String: snapshot.OrgDisplayName, Valid: snapshot.OrgDisplayName != ""},
			EmployeeID:       pgtype.Text{String: snapshot.EmployeeID, Valid: snapshot.EmployeeID != ""},
			DeptID:           pgtype.Text{String: snapshot.DeptID, Valid: snapshot.DeptID != ""},
			DeptName:         pgtype.Text{String: snapshot.DeptName, Valid: snapshot.DeptName != ""},
			DeptPath:         pgtype.Text{String: snapshot.DeptPath, Valid: snapshot.DeptPath != ""},
			Position:         pgtype.Text{String: snapshot.Position, Valid: snapshot.Position != ""},
			IsMainDepartment: snapshot.IsMainDepartment,
			DeptUserStatus:   pgtype.Int4{Int32: int32(snapshot.DeptUserStatus), Valid: true},
			LastSyncedAt:     pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
		}); err != nil {
			slog.Warn("casdoor: failed to refresh user membership org snapshot on login", "error", err, "user_id", uuidToString(userID))
		}

		// Refresh the user's display name from dept-sync (the org source of
		// truth) — repairs placeholder names such as a Casdoor login name that
		// was stored as the multica user name at provisioning.
		if snapshot.OrgDisplayName != "" {
			if err := queries.SetUserName(ctx, db.SetUserNameParams{
				ID:   userID,
				Name: snapshot.OrgDisplayName,
			}); err != nil {
				slog.Warn("casdoor: failed to refresh user name from dept-sync on login", "error", err, "user_id", uuidToString(userID))
			}
		}
	}
}

// linkDeptMembersOnLogin routes the standalone Casdoor callback through the
// shared LinkDeptIdentity logic. Kept as a method so existing callers/tests
// stay unchanged.
func (h *Handler) linkDeptMembersOnLogin(ctx context.Context, userID pgtype.UUID, universalID string) {
	LinkDeptIdentity(ctx, h.Queries, h.DeptSync, userID, universalID)
}

// pickMainActiveDepartment selects the user's main active department from a
// dept-sync listing, preferring IsMain == 1 and falling back to the first
// active entry. Mirrors resolveDeptUserRef's selection logic.
func pickMainActiveDepartment(departments []deptsync.User, universalID string) (deptsync.User, bool) {
	var fallback deptsync.User
	found := false
	for _, d := range departments {
		if strings.TrimSpace(d.UniversalID) != universalID || d.Status != 1 {
			continue
		}
		if d.IsMain == 1 {
			return d, true
		}
		if !found {
			fallback, found = d, true
		}
	}
	return fallback, found
}

func buildDeptLoginSnapshot(d deptsync.User) *deptLoginSnapshot {
	return &deptLoginSnapshot{
		OrgDisplayName:   strings.TrimSpace(d.Username),
		EmployeeID:       strings.TrimSpace(d.UserID),
		DeptID:           strings.TrimSpace(d.DeptID),
		DeptName:         strings.TrimSpace(d.DeptName),
		DeptPath:         strings.TrimSpace(d.DeptPath),
		Position:         strings.TrimSpace(d.Position),
		IsMainDepartment: d.IsMain == 1,
		DeptUserStatus:   d.Status,
	}
}
