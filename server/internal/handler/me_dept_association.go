package handler

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/deptsync"
	"github.com/multica-ai/multica/server/internal/events"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
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

// LinkDeptIdentity binds any pending dept membership for the user (matched by
// universal_id) and refreshes the member org snapshot + the user's display name
// from dept-sync.
//
// It is the single implementation shared by every auth path:
//   - the standalone Casdoor OAuth callback (CasdoorCallback), and
//   - the SubjectResolver, which is the embedded SSO path costrict actually
//     uses (it resolves the user from the zgsmAdminToken cookie on each
//     request — there is no callback there).
//
// Best-effort: errors are logged and never propagated — a dept-sync outage or
// a stale snapshot must not fail auth. Membership binding itself needs no
// dept-sync call; the snapshot/name refresh is skipped when dept-sync is
// unavailable or the user has no active main department.
func LinkDeptIdentity(ctx context.Context, queries *db.Queries, deptSync DeptIdentityResolver, bus *events.Bus, userID pgtype.UUID, universalID string) {
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

	activated, err := queries.ActivatePendingDeptMembersByUniversalID(ctx, db.ActivatePendingDeptMembersByUniversalIDParams{
		ExternalUniversalID: pgtype.Text{String: universalID, Valid: true},
		UserID:              userID,
	})
	if err != nil {
		slog.Warn("casdoor: failed to activate pending dept members on login", "error", err, "user_id", uuidToString(userID))
		return
	}

	// Refresh the org snapshot on every membership bound to this user —
	// dept-sourced rows and pre-existing manual / email-invite rows alike — so
	// the member list shows the user's org info even where ActivatePending's
	// no-duplicate guard blocked a separate dept row from activating (e.g. an
	// email-registered account that predates Casdoor binding).
	if snapshot != nil {
		// Drop pending_activation dept rows that ActivatePending could not bind
		// (the user already held a membership in that workspace) FIRST: they
		// share the universal_id the refresh is about to link onto the user's
		// existing memberships, and the (workspace_id, external_universal_id)
		// unique index would reject the refresh in any workspace where such an
		// orphan lingers.
		if _, err := queries.DeleteOrphanPendingDeptMembers(ctx, pgtype.Text{String: universalID, Valid: true}); err != nil {
			slog.Warn("casdoor: failed to delete orphan pending dept members on login", "error", err, "universal_id", universalID)
		}
		// Refresh the org snapshot on every membership bound to this user —
		// dept-sourced rows and pre-existing manual / email-invite rows alike —
		// AND link each to the dept identity (external_universal_id /
		// external_user_id). Linking the identity onto a pre-binding membership
		// is what lets the member-picker recognise it as already-added (matches
		// dept-sync results by universal_id) instead of offering to re-add.
		if err := queries.RefreshUserMembershipDeptOrg(ctx, db.RefreshUserMembershipDeptOrgParams{
			UserID:              userID,
			ExternalUniversalID: pgtype.Text{String: universalID, Valid: universalID != ""},
			ExternalUserID:      pgtype.Text{String: snapshot.EmployeeID, Valid: snapshot.EmployeeID != ""},
			OrgDisplayName:      pgtype.Text{String: snapshot.OrgDisplayName, Valid: snapshot.OrgDisplayName != ""},
			EmployeeID:          pgtype.Text{String: snapshot.EmployeeID, Valid: snapshot.EmployeeID != ""},
			DeptID:              pgtype.Text{String: snapshot.DeptID, Valid: snapshot.DeptID != ""},
			DeptName:            pgtype.Text{String: snapshot.DeptName, Valid: snapshot.DeptName != ""},
			DeptPath:            pgtype.Text{String: snapshot.DeptPath, Valid: snapshot.DeptPath != ""},
			Position:            pgtype.Text{String: snapshot.Position, Valid: snapshot.Position != ""},
			IsMainDepartment:    snapshot.IsMainDepartment,
			DeptUserStatus:      pgtype.Int4{Int32: int32(snapshot.DeptUserStatus), Valid: true},
			LastSyncedAt:        pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
		}); err != nil {
			slog.Warn("casdoor: failed to refresh user membership org snapshot on login", "error", err, "user_id", uuidToString(userID))
		}

		// Refresh the user's display name from dept-sync (the org source of
		// truth) — repairs placeholder names such as a Casdoor login name that
		// was stored as the multica user name at provisioning. Applies even
		// when the user has no dept member row (e.g. a manual workspace owner).
		if snapshot.OrgDisplayName != "" {
			if err := queries.SetUserName(ctx, db.SetUserNameParams{
				ID:   userID,
				Name: snapshot.OrgDisplayName,
			}); err != nil {
				slog.Warn("casdoor: failed to refresh user name from dept-sync on login", "error", err, "user_id", uuidToString(userID))
			}
		}
	}

	if bus == nil {
		return
	}
	userIDStr := uuidToString(userID)
	for _, member := range activated {
		bus.Publish(events.Event{
			Type:        protocol.EventMemberUpdated,
			WorkspaceID: uuidToString(member.WorkspaceID),
			ActorType:   "member",
			ActorID:     userIDStr,
			Payload: map[string]any{
				"member_id":    uuidToString(member.ID),
				"workspace_id": uuidToString(member.WorkspaceID),
			},
		})
	}
}

// linkDeptMembersOnLogin routes the standalone Casdoor callback through the
// shared LinkDeptIdentity logic. Kept as a method so existing callers/tests
// stay unchanged.
func (h *Handler) linkDeptMembersOnLogin(ctx context.Context, userID pgtype.UUID, universalID string) {
	LinkDeptIdentity(ctx, h.Queries, h.DeptSync, h.Bus, userID, universalID)
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
