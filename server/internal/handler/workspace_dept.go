package handler

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/deptsync"
	"github.com/multica-ai/multica/server/internal/service"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

type batchAddDeptMembersRequest struct {
	Users []batchAddDeptMemberRef `json:"users"`
}

type batchAddDeptMemberRef struct {
	ExternalUserID      string `json:"external_user_id"`
	ExternalUniversalID string `json:"external_universal_id"`
}

type BatchAddDeptMembersResponse struct {
	Added   int `json:"added"`
	Skipped int `json:"skipped"`
}

func (h *Handler) BatchAddDeptMembers(w http.ResponseWriter, r *http.Request) {
	workspaceID := workspaceIDFromURL(r, "id")
	requester, ok := h.requireWorkspaceRole(w, r, workspaceID, "workspace not found", "owner", "admin")
	if !ok {
		return
	}
	if h.DeptSync == nil || !h.DeptSync.Configured() {
		writeError(w, http.StatusServiceUnavailable, "dept sync is not configured")
		return
	}

	var req batchAddDeptMembersRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(req.Users) == 0 {
		writeError(w, http.StatusBadRequest, "users are required")
		return
	}
	if len(req.Users) > 100 {
		writeError(w, http.StatusBadRequest, "too many users")
		return
	}

	selected := make([]service.WorkspaceDeptMemberSnapshot, 0, len(req.Users))
	seenInput := map[string]struct{}{}
	for _, ref := range req.Users {
		user, found, err := h.resolveDeptUserRef(r, ref)
		if err != nil {
			writeError(w, http.StatusBadGateway, "failed to resolve dept user")
			return
		}
		if !found {
			writeError(w, http.StatusBadRequest, "dept user not found")
			return
		}
		key := strings.TrimSpace(user.UniversalID)
		if key == "" {
			key = strings.TrimSpace(user.UserID)
		}
		if key == "" {
			continue
		}
		if _, ok := seenInput[key]; ok {
			continue
		}
		seenInput[key] = struct{}{}
		status := service.MemberStatusActive
		if user.Status != 1 {
			status = service.MemberStatusInactive
		}
		selected = append(selected, service.WorkspaceDeptMemberSnapshot{
			Source:              service.MemberSourceDept,
			Status:              status,
			ExternalUserID:      strings.TrimSpace(user.UserID),
			ExternalUniversalID: strings.TrimSpace(user.UniversalID),
			Name:                strings.TrimSpace(user.Username),
			EmployeeID:          strings.TrimSpace(user.UserID),
			DepartmentID:        strings.TrimSpace(user.DeptID),
			DepartmentName:      strings.TrimSpace(user.DeptName),
			DepartmentPath:      strings.TrimSpace(user.DeptPath),
			Position:            strings.TrimSpace(user.Position),
			IsMainDepartment:    user.IsMain == 1,
			DeptUserStatus:      user.Status,
			LastSyncedAt:        time.Now().UTC(),
		})
	}

	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to add dept members")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := h.Queries.WithTx(tx)

	existingRows, err := qtx.ListDeptMemberSnapshots(r.Context(), requester.WorkspaceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load members")
		return
	}
	existingByExternal := make(map[string]struct{}, len(existingRows))
	for _, row := range existingRows {
		key := strings.TrimSpace(row.ExternalUniversalID.String)
		if key == "" {
			key = strings.TrimSpace(row.ExternalUserID.String)
		}
		if key != "" {
			existingByExternal[key] = struct{}{}
		}
	}

	now := time.Now().UTC()
	added := 0
	skipped := 0
	for _, member := range selected {
		key := member.ExternalUniversalID
		if key == "" {
			key = member.ExternalUserID
		}
		if _, exists := existingByExternal[key]; exists {
			skipped++
			continue
		}

		userID := pgtype.UUID{}
		status := member.Status
		if member.ExternalUniversalID != "" {
			user, uerr := qtx.GetUserByCasdoorUniversalID(r.Context(), pgtype.Text{String: member.ExternalUniversalID, Valid: true})
			if uerr == nil {
				userID = user.ID
			} else if uerr != pgx.ErrNoRows {
				writeError(w, http.StatusInternalServerError, "failed to resolve dept user")
				return
			}
		}
		if userID.Valid {
			if _, merr := qtx.GetMemberByUserAndWorkspace(r.Context(), db.GetMemberByUserAndWorkspaceParams{
				UserID:      userID,
				WorkspaceID: requester.WorkspaceID,
			}); merr == nil {
				skipped++
				continue
			} else if merr != pgx.ErrNoRows {
				writeError(w, http.StatusInternalServerError, "failed to load member")
				return
			}
		}
		if !userID.Valid && status == service.MemberStatusActive {
			status = service.MemberStatusPendingActivation
		}
		if _, err := qtx.UpsertDeptMember(r.Context(), db.UpsertDeptMemberParams{
			WorkspaceID:         requester.WorkspaceID,
			UserID:              userID,
			Status:              status,
			ExternalUserID:      pgtype.Text{String: member.ExternalUserID, Valid: member.ExternalUserID != ""},
			ExternalUniversalID: pgtype.Text{String: member.ExternalUniversalID, Valid: member.ExternalUniversalID != ""},
			EmployeeID:          pgtype.Text{String: member.EmployeeID, Valid: member.EmployeeID != ""},
			OrgDisplayName:      pgtype.Text{String: member.Name, Valid: member.Name != ""},
			DeptID:              pgtype.Text{String: member.DepartmentID, Valid: member.DepartmentID != ""},
			DeptName:            pgtype.Text{String: member.DepartmentName, Valid: member.DepartmentName != ""},
			DeptPath:            pgtype.Text{String: member.DepartmentPath, Valid: member.DepartmentPath != ""},
			Position:            pgtype.Text{String: member.Position, Valid: member.Position != ""},
			IsMainDepartment:    member.IsMainDepartment,
			DeptUserStatus:      pgtype.Int4{Int32: int32(member.DeptUserStatus), Valid: true},
			LastSyncedAt:        pgtype.Timestamptz{Time: now, Valid: true},
		}); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to add dept member")
			return
		}
		added++
		existingByExternal[key] = struct{}{}
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to add dept members")
		return
	}

	if added > 0 {
		h.publish(protocol.EventMemberUpdated, uuidToString(requester.WorkspaceID), "member", requestUserID(r), map[string]any{
			"workspace_id": uuidToString(requester.WorkspaceID),
		})
	}
	writeJSON(w, http.StatusOK, BatchAddDeptMembersResponse{Added: added, Skipped: skipped})
}

func (h *Handler) resolveDeptUserRef(r *http.Request, ref batchAddDeptMemberRef) (deptsync.User, bool, error) {
	universalID := strings.TrimSpace(ref.ExternalUniversalID)
	if universalID != "" {
		// dept-sync's /users/search does not index universal_id, so a caller
		// that only knows the universal_id must be resolved via the direct
		// GetUserDepartmentsByUniversalID lookup, not SearchUsers.
		departments, err := h.DeptSync.GetUserDepartmentsByUniversalID(r.Context(), universalID)
		if err != nil {
			return deptsync.User{}, false, err
		}
		var fallback deptsync.User
		found := false
		for _, d := range departments {
			if strings.TrimSpace(d.UniversalID) != universalID || d.Status != 1 {
				continue
			}
			if d.IsMain == 1 {
				return d, true, nil
			}
			if !found {
				fallback, found = d, true
			}
		}
		if found {
			return fallback, true, nil
		}
		return deptsync.User{}, false, nil
	}

	userID := strings.TrimSpace(ref.ExternalUserID)
	if userID == "" {
		return deptsync.User{}, false, nil
	}
	users, err := h.DeptSync.SearchUsers(r.Context(), userID, 50)
	if err != nil {
		return deptsync.User{}, false, err
	}
	for _, user := range users {
		if strings.TrimSpace(user.UserID) == userID {
			return user, true, nil
		}
	}
	return deptsync.User{}, false, nil
}
