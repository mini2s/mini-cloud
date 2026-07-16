package handler

import (
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// validateWorkflowRuntimePreference validates an optional manual preference at
// the request boundary. Runtime health is deliberately checked again when each
// node dispatches so a preference may safely fall back after it goes offline.
func (h *Handler) validateWorkflowRuntimePreference(
	w http.ResponseWriter,
	r *http.Request,
	raw *string,
	workspaceID pgtype.UUID,
) (pgtype.UUID, bool) {
	if raw == nil || *raw == "" {
		return pgtype.UUID{}, true
	}
	runtimeID, ok := parseUUIDOrBadRequest(w, *raw, "runtime_id")
	if !ok {
		return pgtype.UUID{}, false
	}
	runtime, err := h.Queries.GetAgentRuntimeForWorkspace(r.Context(), db.GetAgentRuntimeForWorkspaceParams{
		ID:          runtimeID,
		WorkspaceID: workspaceID,
	})
	if err != nil {
		writeError(w, http.StatusBadRequest, "runtime_id does not belong to this workspace")
		return pgtype.UUID{}, false
	}

	userID, ok := requireUserID(w, r)
	if !ok {
		return pgtype.UUID{}, false
	}
	userUUID, ok := parseUUIDOrBadRequest(w, userID, "user_id")
	if !ok {
		return pgtype.UUID{}, false
	}
	member, err := h.Queries.GetMemberByUserAndWorkspace(r.Context(), db.GetMemberByUserAndWorkspaceParams{
		UserID:      userUUID,
		WorkspaceID: workspaceID,
	})
	if err != nil {
		writeError(w, http.StatusForbidden, "workspace membership required")
		return pgtype.UUID{}, false
	}
	if runtime.Visibility == "public" ||
		roleAllowed(member.Role, "owner", "admin") ||
		(runtime.OwnerID.Valid && runtime.OwnerID == userUUID) {
		return runtimeID, true
	}
	permission, err := h.Queries.GetRuntimePermission(r.Context(), db.GetRuntimePermissionParams{
		RuntimeID: runtimeID,
		UserID:    userUUID,
	})
	if err == nil && (permission.Role == "admin" || permission.Role == "operator") {
		return runtimeID, true
	}

	writeError(w, http.StatusForbidden, "runtime permission required")
	return pgtype.UUID{}, false
}
