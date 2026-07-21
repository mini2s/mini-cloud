package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

type CreateWorkflowRoleRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}
type UpdateWorkflowRoleRequest struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
}
type WorkflowRoleResponse struct {
	ID               string  `json:"id"`
	WorkspaceID      string  `json:"workspace_id"`
	Name             string  `json:"name"`
	Description      string  `json:"description"`
	IsBuiltin        bool    `json:"is_builtin"`
	NeedsDescription bool    `json:"needs_description"`
	IsReferenced     bool    `json:"is_referenced"`
	CreatedBy        *string `json:"created_by"`
	CreatedAt        string  `json:"created_at"`
	UpdatedAt        string  `json:"updated_at"`
}

func workflowRoleToResponse(role db.MulticaWorkflowRole, references int64) WorkflowRoleResponse {
	return WorkflowRoleResponse{ID: uuidToString(role.ID), WorkspaceID: uuidToString(role.WorkspaceID), Name: role.Name,
		Description: role.Description, IsBuiltin: role.IsBuiltin, NeedsDescription: role.NeedsDescription,
		IsReferenced: references > 0, CreatedBy: uuidToPtr(role.CreatedBy),
		CreatedAt: timestampToString(role.CreatedAt), UpdatedAt: timestampToString(role.UpdatedAt)}
}
func normalizeWorkflowRoleInput(name, description string) (string, string, error) {
	name, description = strings.TrimSpace(name), strings.TrimSpace(description)
	if name == "" {
		return "", "", errors.New("name is required")
	}
	if utf8.RuneCountInString(name) > 100 {
		return "", "", errors.New("name must be at most 100 characters")
	}
	if description == "" {
		return "", "", errors.New("description is required")
	}
	if utf8.RuneCountInString(description) > 2000 {
		return "", "", errors.New("description must be at most 2000 characters")
	}
	return name, description, nil
}

func (h *Handler) ListWorkflowRoles(w http.ResponseWriter, r *http.Request) {
	member, ok := h.requireWorkspaceRole(w, r, workspaceIDFromURL(r, "id"), "workspace not found", "owner", "admin", "member")
	if !ok {
		return
	}
	roles, err := h.Queries.ListWorkflowRoles(r.Context(), member.WorkspaceID)
	if err != nil {
		writeError(w, 500, "failed to list workflow roles")
		return
	}
	response := make([]WorkflowRoleResponse, 0, len(roles))
	for _, role := range roles {
		references, err := h.Queries.CountWorkflowRoleReferences(r.Context(), role.ID)
		if err != nil {
			writeError(w, 500, "failed to inspect workflow role")
			return
		}
		response = append(response, workflowRoleToResponse(role, references))
	}
	writeJSON(w, http.StatusOK, map[string]any{"roles": response})
}
func (h *Handler) CreateWorkflowRole(w http.ResponseWriter, r *http.Request) {
	member, ok := h.requireWorkspaceRole(w, r, workspaceIDFromURL(r, "id"), "workspace not found", "owner", "admin")
	if !ok {
		return
	}
	var request CreateWorkflowRoleRequest
	if json.NewDecoder(r.Body).Decode(&request) != nil {
		writeError(w, 400, "invalid request body")
		return
	}
	name, description, err := normalizeWorkflowRoleInput(request.Name, request.Description)
	if err != nil {
		writeError(w, 400, err.Error())
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	role, err := h.Queries.CreateWorkflowRole(r.Context(), db.CreateWorkflowRoleParams{WorkspaceID: member.WorkspaceID, Name: name, NormalizedName: strings.ToLower(name), Description: description, CreatedBy: parseUUID(userID)})
	if isUniqueViolation(err) {
		writeError(w, 409, "a workflow role with this name already exists")
		return
	}
	if err != nil {
		writeError(w, 500, "failed to create workflow role")
		return
	}
	writeJSON(w, http.StatusCreated, workflowRoleToResponse(role, 0))
}
func (h *Handler) UpdateWorkflowRole(w http.ResponseWriter, r *http.Request) {
	member, ok := h.requireWorkspaceRole(w, r, workspaceIDFromURL(r, "id"), "workspace not found", "owner", "admin")
	if !ok {
		return
	}
	roleID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "roleId"), "role_id")
	if !ok {
		return
	}
	current, err := h.Queries.GetWorkflowRoleInWorkspace(r.Context(), db.GetWorkflowRoleInWorkspaceParams{ID: roleID, WorkspaceID: member.WorkspaceID})
	if err == pgx.ErrNoRows {
		writeError(w, 404, "workflow role not found")
		return
	}
	if err != nil {
		writeError(w, 500, "failed to load workflow role")
		return
	}
	if current.IsBuiltin {
		writeError(w, 403, "built-in workflow roles are read-only")
		return
	}
	var request UpdateWorkflowRoleRequest
	if json.NewDecoder(r.Body).Decode(&request) != nil {
		writeError(w, 400, "invalid request body")
		return
	}
	name, description := current.Name, current.Description
	if request.Name != nil {
		name = *request.Name
	}
	if request.Description != nil {
		description = *request.Description
	}
	name, description, err = normalizeWorkflowRoleInput(name, description)
	if err != nil {
		writeError(w, 400, err.Error())
		return
	}
	role, err := h.Queries.UpdateWorkflowRole(r.Context(), db.UpdateWorkflowRoleParams{ID: roleID, WorkspaceID: member.WorkspaceID, Name: pgtype.Text{String: name, Valid: true}, NormalizedName: pgtype.Text{String: strings.ToLower(name), Valid: true}, Description: pgtype.Text{String: description, Valid: true}})
	if isUniqueViolation(err) {
		writeError(w, 409, "a workflow role with this name already exists")
		return
	}
	if err != nil {
		writeError(w, 500, "failed to update workflow role")
		return
	}
	references, _ := h.Queries.CountWorkflowRoleReferences(r.Context(), role.ID)
	writeJSON(w, 200, workflowRoleToResponse(role, references))
}
func (h *Handler) DeleteWorkflowRole(w http.ResponseWriter, r *http.Request) {
	member, ok := h.requireWorkspaceRole(w, r, workspaceIDFromURL(r, "id"), "workspace not found", "owner", "admin")
	if !ok {
		return
	}
	roleID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "roleId"), "role_id")
	if !ok {
		return
	}
	role, err := h.Queries.GetWorkflowRoleInWorkspace(r.Context(), db.GetWorkflowRoleInWorkspaceParams{ID: roleID, WorkspaceID: member.WorkspaceID})
	if err == pgx.ErrNoRows {
		writeError(w, 404, "workflow role not found")
		return
	}
	if err != nil {
		writeError(w, 500, "failed to load workflow role")
		return
	}
	if role.IsBuiltin {
		writeError(w, 403, "built-in workflow roles cannot be deleted")
		return
	}
	references, err := h.Queries.CountWorkflowRoleReferences(r.Context(), roleID)
	if err != nil {
		writeError(w, 500, "failed to inspect workflow role")
		return
	}
	if references > 0 {
		writeError(w, 409, "workflow role is used by one or more workflows")
		return
	}
	deleted, err := h.Queries.DeleteWorkflowRole(r.Context(), db.DeleteWorkflowRoleParams{ID: roleID, WorkspaceID: member.WorkspaceID})
	if err != nil {
		writeError(w, 500, "failed to delete workflow role")
		return
	}
	if deleted == 0 {
		writeError(w, 404, "workflow role not found")
		return
	}
	w.WriteHeader(204)
}
