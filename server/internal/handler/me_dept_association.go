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
	"github.com/multica-ai/multica/server/pkg/protocol"
)

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

// linkDeptMembersOnLogin binds any pending dept membership for a freshly
// logged-in user (matched by universal_id) and refreshes the member's org
// snapshot from dept-sync. It runs on every Casdoor login so workspace binding
// does not depend on the embedded iframe identity handshake, which only fires
// when multica runs inside opencode (and currently never fires at all, because
// the iframe never posts the "multica:ready" message the parent waits for).
//
// Best-effort: errors are logged and never propagated — a dept-sync outage or
// a stale snapshot must not fail a login. Membership binding itself needs no
// dept-sync call; the snapshot refresh is skipped when dept-sync is unavailable
// or the user has no active main department.
func (h *Handler) linkDeptMembersOnLogin(ctx context.Context, userID pgtype.UUID, universalID string) {
	universalID = strings.TrimSpace(universalID)
	if universalID == "" || !userID.Valid {
		return
	}

	var snapshot *deptLoginSnapshot
	if h.DeptSync != nil && h.DeptSync.Configured() {
		departments, err := h.DeptSync.GetUserDepartmentsByUniversalID(ctx, universalID)
		switch {
		case err == nil:
			if picked, ok := pickMainActiveDepartment(departments, universalID); ok {
				snapshot = buildDeptLoginSnapshot(picked)
			}
		case !errors.Is(err, deptsync.ErrNotConfigured):
			slog.Warn("casdoor: dept-sync lookup failed during login", "error", err, "universal_id", universalID)
		}
	}

	activated, err := h.Queries.ActivatePendingDeptMembersByUniversalID(ctx, db.ActivatePendingDeptMembersByUniversalIDParams{
		ExternalUniversalID: pgtype.Text{String: universalID, Valid: true},
		UserID:              userID,
	})
	if err != nil {
		slog.Warn("casdoor: failed to activate pending dept members on login", "error", err, "user_id", uuidToString(userID))
		return
	}

	// Refresh the org snapshot on every member row for this universal_id
	// (newly activated and already-active alike) so a user's name / department
	// / position stay current without an admin re-adding them.
	if snapshot != nil {
		if err := h.Queries.RefreshDeptMemberSnapshotByUniversalID(ctx, db.RefreshDeptMemberSnapshotByUniversalIDParams{
			ExternalUniversalID: pgtype.Text{String: universalID, Valid: true},
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
			slog.Warn("casdoor: failed to refresh dept member snapshot on login", "error", err, "universal_id", universalID)
		}

		// Refresh the user's display name from dept-sync (the org source of
		// truth) — repairs placeholder names such as a Casdoor login name that
		// was stored as the multica user name at provisioning. Applies even
		// when the user has no dept member row (e.g. a manual workspace owner).
		if snapshot.OrgDisplayName != "" {
			if err := h.Queries.SetUserName(ctx, db.SetUserNameParams{
				ID:   userID,
				Name: snapshot.OrgDisplayName,
			}); err != nil {
				slog.Warn("casdoor: failed to refresh user name from dept-sync on login", "error", err, "user_id", uuidToString(userID))
			}
		}
	}

	userIDStr := uuidToString(userID)
	for _, member := range activated {
		h.publish(protocol.EventMemberUpdated, uuidToString(member.WorkspaceID), "member", userIDStr, map[string]any{
			"member_id":    uuidToString(member.ID),
			"workspace_id": uuidToString(member.WorkspaceID),
		})
	}
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
