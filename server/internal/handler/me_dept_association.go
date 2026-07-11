package handler

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

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
