package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/deptsync"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

type associateDeptIdentityRequest struct {
	CasdoorUniversalID string `json:"casdoor_universal_id"`
}

type associateDeptIdentityResponse struct {
	Associated      bool    `json:"associated"`
	AssociatedCount int     `json:"associated_count"`
	Reason          *string `json:"reason,omitempty"`
}

func associationNoop(reason string) associateDeptIdentityResponse {
	return associateDeptIdentityResponse{Associated: false, AssociatedCount: 0, Reason: &reason}
}

func (h *Handler) AssociateDeptIdentity(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	var req associateDeptIdentityRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	universalID := strings.TrimSpace(req.CasdoorUniversalID)
	if universalID == "" {
		writeError(w, http.StatusBadRequest, "casdoor_universal_id is required")
		return
	}

	userUUID, ok := parseUUIDOrBadRequest(w, userID, "user id")
	if !ok {
		return
	}
	user, err := h.Queries.GetUser(r.Context(), userUUID)
	if err != nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	if user.CasdoorUniversalID.Valid && strings.TrimSpace(user.CasdoorUniversalID.String) != universalID {
		writeJSON(w, http.StatusOK, associationNoop("universal_id_conflict"))
		return
	}
	if h.DeptSync == nil || !h.DeptSync.Configured() {
		writeJSON(w, http.StatusOK, associationNoop("dept_sync_not_configured"))
		return
	}

	departments, err := h.DeptSync.GetUserDepartmentsByUniversalID(r.Context(), universalID)
	if err != nil {
		if !errors.Is(err, deptsync.ErrNotConfigured) {
			slog.Warn("dept association lookup failed", "error", err, "user_id", userID)
		}
		writeJSON(w, http.StatusOK, associationNoop("dept_sync_unavailable"))
		return
	}
	if !hasActiveUniversalIDDepartment(departments, universalID) {
		writeJSON(w, http.StatusOK, associationNoop("dept_user_not_found"))
		return
	}

	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to associate dept identity")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := h.Queries.WithTx(tx)

	members, err := qtx.ActivatePendingDeptMembersByUniversalID(r.Context(), db.ActivatePendingDeptMembersByUniversalIDParams{
		ExternalUniversalID: pgtype.Text{String: universalID, Valid: true},
		UserID:              user.ID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to associate dept identity")
		return
	}
	if len(members) == 0 {
		writeJSON(w, http.StatusOK, associationNoop("no_pending_member"))
		return
	}

	if !user.CasdoorUniversalID.Valid {
		if err := qtx.SetUserCasdoorUniversalID(r.Context(), db.SetUserCasdoorUniversalIDParams{
			ID:                 user.ID,
			CasdoorUniversalID: pgtype.Text{String: universalID, Valid: true},
		}); err != nil {
			if isUniqueViolation(err) {
				writeJSON(w, http.StatusOK, associationNoop("universal_id_conflict"))
				return
			}
			writeError(w, http.StatusInternalServerError, "failed to associate dept identity")
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to associate dept identity")
		return
	}

	for _, member := range members {
		h.publish(protocol.EventMemberUpdated, uuidToString(member.WorkspaceID), "member", userID, map[string]any{
			"member_id":    uuidToString(member.ID),
			"workspace_id": uuidToString(member.WorkspaceID),
		})
	}

	resp := associateDeptIdentityResponse{
		Associated:      len(members) > 0,
		AssociatedCount: len(members),
	}
	writeJSON(w, http.StatusOK, resp)
}

func hasActiveUniversalIDDepartment(users []deptsync.User, universalID string) bool {
	for _, user := range users {
		if strings.TrimSpace(user.UniversalID) == universalID && user.Status == 1 {
			return true
		}
	}
	return false
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
