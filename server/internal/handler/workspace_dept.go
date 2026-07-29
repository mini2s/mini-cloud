package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/deptsync"
	"github.com/multica-ai/multica/server/internal/service"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

type batchAddDeptMembersRequest struct {
	Users []batchAddDeptMemberRef `json:"users"`
}

type batchAddDeptMemberRef struct {
	SubjectID string `json:"subject_id"`
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
	if h.CsUser == nil {
		writeError(w, http.StatusServiceUnavailable, "cs-user is not configured")
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

	type resolved struct {
		SubjectID string
		Name      string
		Email     string
		UnivID    string
	}
	resolvedRefs := make([]resolved, 0, len(req.Users))
	seen := map[string]struct{}{}
	for _, ref := range req.Users {
		sid := strings.TrimSpace(ref.SubjectID)
		if sid == "" {
			continue
		}
		if _, ok := seen[sid]; ok {
			continue
		}
		u, err := h.CsUser.GetUser(r.Context(), sid)
		if err != nil {
			writeError(w, http.StatusBadGateway, "failed to resolve cs-user")
			return
		}
		seen[sid] = struct{}{}
		resolvedRefs = append(resolvedRefs, resolved{SubjectID: sid, Name: u.Name(), Email: u.EmailOrEmpty(), UnivID: u.UniversalID()})
	}

	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to add dept members")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := h.Queries.WithTx(tx)

	added := 0
	skipped := 0
	for _, rr := range resolvedRefs {
		if _, err := qtx.GetMemberByWorkspaceAndSubject(r.Context(), db.GetMemberByWorkspaceAndSubjectParams{
			WorkspaceID: requester.WorkspaceID, SubjectID: pgtype.Text{String: rr.SubjectID, Valid: true},
		}); err == nil {
			skipped++
			continue
		} else if err != pgx.ErrNoRows {
			writeError(w, http.StatusInternalServerError, "failed to load member")
			return
		}

		userID, uerr := h.resolveOrCreateUserBySubjectID(r.Context(), qtx, rr.SubjectID, rr.Name, rr.Email)
		if uerr != nil {
			writeError(w, http.StatusInternalServerError, "failed to resolve user")
			return
		}
		if _, err := qtx.GetMemberByUserAndWorkspace(r.Context(), db.GetMemberByUserAndWorkspaceParams{
			UserID: userID, WorkspaceID: requester.WorkspaceID,
		}); err == nil {
			skipped++
			continue
		} else if err != pgx.ErrNoRows {
			writeError(w, http.StatusInternalServerError, "failed to load member")
			return
		}

		org := h.resolveDeptOrgSnapshot(r.Context(), rr.UnivID)
		if _, err := qtx.UpsertDeptMember(r.Context(), db.UpsertDeptMemberParams{
			WorkspaceID:      requester.WorkspaceID,
			UserID:           userID,
			Status:           service.MemberStatusActive,
			SubjectID:        pgtype.Text{String: rr.SubjectID, Valid: true},
			EmployeeID:       pgtype.Text{String: org.EmployeeID, Valid: org.EmployeeID != ""},
			OrgDisplayName:   pgtype.Text{String: firstNonEmpty(org.Name, rr.Name), Valid: true},
			DeptID:           pgtype.Text{String: org.DepartmentID, Valid: org.DepartmentID != ""},
			DeptName:         pgtype.Text{String: org.DepartmentName, Valid: org.DepartmentName != ""},
			DeptPath:         pgtype.Text{String: org.DepartmentPath, Valid: org.DepartmentPath != ""},
			Position:         pgtype.Text{String: org.Position, Valid: org.Position != ""},
			IsMainDepartment: org.IsMainDepartment,
			DeptUserStatus:   pgtype.Int4{Int32: int32(org.DeptUserStatus), Valid: org.DeptUserStatus != 0},
		}); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to add dept member")
			return
		}
		added++
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

// resolveOrCreateUserBySubjectID returns the multica user id for a cs-user
// subject_id, creating the account (linked by subject_id) if it doesn't exist.
func (h *Handler) resolveOrCreateUserBySubjectID(ctx context.Context, qtx *db.Queries, subjectID, name, email string) (pgtype.UUID, error) {
	user, err := qtx.GetUserBySubjectID(ctx, pgtype.Text{String: subjectID, Valid: true})
	if err == nil {
		return user.ID, nil
	}
	if err != pgx.ErrNoRows {
		return pgtype.UUID{}, err
	}
	if strings.TrimSpace(name) == "" {
		name = "csuser-" + subjectID
	}
	if strings.TrimSpace(email) == "" {
		email = subjectID + "@csuser.local"
	}
	created, err := qtx.CreateUser(ctx, db.CreateUserParams{Name: name, Email: email, AvatarUrl: pgtype.Text{}})
	if err != nil {
		if util.IsUniqueViolation(err) { // email belongs to an existing account — adopt it
			existing, findErr := qtx.GetUserByEmail(ctx, email)
			if findErr == nil {
				if !existing.SubjectID.Valid {
					if setErr := qtx.SetUserSubjectID(ctx, db.SetUserSubjectIDParams{ID: existing.ID, SubjectID: pgtype.Text{String: subjectID, Valid: true}}); setErr != nil {
						return pgtype.UUID{}, setErr
					}
				}
				return existing.ID, nil
			}
		}
		return pgtype.UUID{}, err
	}
	if setErr := qtx.SetUserSubjectID(ctx, db.SetUserSubjectIDParams{ID: created.ID, SubjectID: pgtype.Text{String: subjectID, Valid: true}}); setErr != nil {
		return pgtype.UUID{}, setErr
	}
	return created.ID, nil
}

type deptOrgSnapshot struct {
	EmployeeID       string
	Name             string
	DepartmentID     string
	DepartmentName   string
	DepartmentPath   string
	Position         string
	IsMainDepartment bool
	DeptUserStatus   int
}

// resolveDeptOrgSnapshot fetches org identity from dept-sync using the transient
// universal_id. Best-effort: returns a zero snapshot if dept-sync is unavailable
// or the user has no active department. universal_id is NEVER persisted.
func (h *Handler) resolveDeptOrgSnapshot(ctx context.Context, universalID string) deptOrgSnapshot {
	var snap deptOrgSnapshot
	if h.DeptSync == nil || !h.DeptSync.Configured() || strings.TrimSpace(universalID) == "" {
		return snap
	}
	depts, err := h.DeptSync.GetUserDepartmentsByUniversalID(ctx, universalID)
	if err != nil {
		return snap
	}
	var picked deptsync.User
	found := false
	for _, d := range depts {
		if d.Status != 1 {
			continue
		}
		if d.IsMain == 1 {
			picked = d
			found = true
			break
		}
		if !found {
			picked, found = d, true
		}
	}
	if !found {
		return snap
	}
	snap.EmployeeID = strings.TrimSpace(picked.UserID)
	snap.Name = strings.TrimSpace(picked.Username)
	snap.DepartmentID = strings.TrimSpace(picked.DeptID)
	snap.DepartmentName = strings.TrimSpace(picked.DeptName)
	snap.DepartmentPath = strings.TrimSpace(picked.DeptPath)
	snap.Position = strings.TrimSpace(picked.Position)
	snap.IsMainDepartment = picked.IsMain == 1
	snap.DeptUserStatus = picked.Status
	return snap
}

func firstNonEmpty(a, b string) string {
	if strings.TrimSpace(a) != "" {
		return a
	}
	return b
}
