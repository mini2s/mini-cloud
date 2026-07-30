package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/service"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

type WorkflowRoleResolutionResponse struct {
	ID                 string  `json:"id"`
	WorkflowRunID      string  `json:"workflow_run_id"`
	WorkflowNodeRunID  string  `json:"workflow_node_run_id"`
	SlotType           string  `json:"slot_type"`
	RoleID             *string `json:"role_id"`
	RoleName           string  `json:"role_name"`
	RoleDescription    string  `json:"role_description"`
	Status             string  `json:"status"`
	ResolvedUserID     *string `json:"resolved_user_id"`
	Source             *string `json:"source"`
	ReasonCode         string  `json:"reason_code"`
	ReasonDetail       string  `json:"reason_detail"`
	Version            int32   `json:"version"`
	ResolvedBy         *string `json:"resolved_by"`
	ResolvedAt         *string `json:"resolved_at"`
	CreatedAt          string  `json:"created_at"`
	UpdatedAt          string  `json:"updated_at"`
	NotificationStatus *string `json:"notification_status,omitempty"`
}

type assignWorkflowRolesRequest struct {
	Assignments []struct {
		ResolutionID string `json:"resolution_id"`
		UserID       string `json:"user_id"`
		Version      int32  `json:"version"`
	} `json:"assignments"`
}

func canManageWorkflowRoleAssignments(member db.MulticaMember) bool {
	return isActiveMember(member)
}

func workflowRoleResolutionToResponse(row db.MulticaWorkflowRoleResolution) WorkflowRoleResolutionResponse {
	return WorkflowRoleResolutionResponse{
		ID: uuidToString(row.ID), WorkflowRunID: uuidToString(row.WorkflowRunID),
		WorkflowNodeRunID: uuidToString(row.WorkflowNodeRunID), SlotType: row.SlotType,
		RoleID: uuidToPtr(row.RoleID), RoleName: row.RoleNameSnapshot,
		RoleDescription: row.RoleDescriptionSnapshot, Status: row.Status,
		ResolvedUserID: uuidToPtr(row.ResolvedUserID), Source: textToPtr(row.Source),
		ReasonCode: row.ReasonCode, ReasonDetail: row.ReasonDetail, Version: row.Version,
		ResolvedBy: uuidToPtr(row.ResolvedBy), ResolvedAt: timestampToPtr(row.ResolvedAt),
		CreatedAt: timestampToString(row.CreatedAt), UpdatedAt: timestampToString(row.UpdatedAt),
	}
}

func (h *Handler) authorizeWorkflowRoleResolution(w http.ResponseWriter, r *http.Request, requireManage bool) (db.MulticaWorkflowRun, pgtype.UUID, bool, bool) {
	wf, ok := h.loadWorkflowInWorkspace(w, r, chi.URLParam(r, "id"))
	if !ok {
		return db.MulticaWorkflowRun{}, pgtype.UUID{}, false, false
	}
	runID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "runId"), "run id")
	if !ok {
		return db.MulticaWorkflowRun{}, pgtype.UUID{}, false, false
	}
	run, err := h.Queries.GetWorkflowRun(r.Context(), runID)
	if err != nil || run.WorkflowID != wf.ID {
		writeError(w, http.StatusNotFound, "run not found")
		return db.MulticaWorkflowRun{}, pgtype.UUID{}, false, false
	}
	member, ok := h.requireWorkspaceRole(w, r, uuidToString(wf.WorkspaceID), "workspace not found", "owner", "admin", "member")
	if !ok {
		return db.MulticaWorkflowRun{}, pgtype.UUID{}, false, false
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return db.MulticaWorkflowRun{}, pgtype.UUID{}, false, false
	}
	userUUID, err := parseUUIDString(userID)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid user")
		return db.MulticaWorkflowRun{}, pgtype.UUID{}, false, false
	}
	canManage := canManageWorkflowRoleAssignments(member)
	canViewReasons := roleAllowed(member.Role, "owner", "admin") || (run.TriggeredByID.Valid && run.TriggeredByID == userUUID)
	if requireManage && !canManage {
		writeError(w, http.StatusForbidden, "insufficient permissions")
		return db.MulticaWorkflowRun{}, pgtype.UUID{}, false, false
	}
	return run, userUUID, canViewReasons, true
}

func parseUUIDString(value string) (pgtype.UUID, error) {
	var id pgtype.UUID
	err := id.Scan(value)
	return id, err
}

func (h *Handler) workflowRoleResolutionResponses(ctx context.Context, runID pgtype.UUID, rows []db.MulticaWorkflowRoleResolution) []WorkflowRoleResolutionResponse {
	response := make([]WorkflowRoleResolutionResponse, len(rows))
	statuses := map[string]string{}
	notifications, _ := h.Queries.ListWorkflowRoleNotificationsByRun(ctx, runID)
	for _, notification := range notifications {
		if notification.NotificationType == "manual_required" {
			continue
		}
		key := uuidToString(notification.WorkflowNodeRunID) + ":" + notification.SlotType + ":" + uuidToString(notification.RecipientUserID)
		statuses[key] = notification.Status
	}
	for i, row := range rows {
		response[i] = workflowRoleResolutionToResponse(row)
		if row.ResolvedUserID.Valid {
			key := uuidToString(row.WorkflowNodeRunID) + ":" + row.SlotType + ":" + uuidToString(row.ResolvedUserID)
			if status, ok := statuses[key]; ok {
				response[i].NotificationStatus = &status
			}
		}
	}
	return response
}

func (h *Handler) ListWorkflowRoleResolutions(w http.ResponseWriter, r *http.Request) {
	run, _, canViewReasons, ok := h.authorizeWorkflowRoleResolution(w, r, false)
	if !ok {
		return
	}
	rows, err := h.Queries.ListWorkflowRoleResolutions(r.Context(), run.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list workflow role resolutions")
		return
	}
	response := h.workflowRoleResolutionResponses(r.Context(), run.ID, rows)
	if !canViewReasons {
		for i := range response {
			response[i].ReasonDetail = ""
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"resolutions": response})
}

func (h *Handler) AssignWorkflowRoleResolutions(w http.ResponseWriter, r *http.Request) {
	run, actorID, _, ok := h.authorizeWorkflowRoleResolution(w, r, true)
	if !ok {
		return
	}
	var request assignWorkflowRolesRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil || len(request.Assignments) == 0 {
		writeError(w, http.StatusBadRequest, "assignments are required")
		return
	}
	assignments := make([]service.WorkflowRoleManualAssignment, len(request.Assignments))
	for i, item := range request.Assignments {
		resolutionID, err := parseUUIDString(item.ResolutionID)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid resolution_id")
			return
		}
		userID, err := parseUUIDString(item.UserID)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid user_id")
			return
		}
		if item.Version <= 0 {
			writeError(w, http.StatusBadRequest, "version must be positive")
			return
		}
		assignments[i] = service.WorkflowRoleManualAssignment{ResolutionID: resolutionID, UserID: userID, Version: item.Version}
	}
	rows, err := h.WorkflowService.AssignWorkflowRoles(r.Context(), run.ID, actorID, assignments)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrWorkflowRoleAssignmentConflict):
			writeError(w, http.StatusConflict, "workflow role assignment changed; refresh and retry")
		case errors.Is(err, service.ErrWorkflowRoleAssignmentStage):
			writeError(w, http.StatusConflict, "workflow role stage has already started")
		default:
			writeError(w, http.StatusBadRequest, err.Error())
		}
		return
	}
	response := h.workflowRoleResolutionResponses(r.Context(), run.ID, rows)
	h.publish("workflow_role_resolution_updated", uuidToString(run.WorkspaceID), "member", uuidToString(actorID), map[string]any{"run_id": uuidToString(run.ID)})
	h.publish("workflow_run_updated", uuidToString(run.WorkspaceID), "member", uuidToString(actorID), map[string]any{"run_id": uuidToString(run.ID)})
	writeJSON(w, http.StatusOK, map[string]any{"resolutions": response})
}

func (h *Handler) RetryWorkflowRoleResolutions(w http.ResponseWriter, r *http.Request) {
	run, actorID, _, ok := h.authorizeWorkflowRoleResolution(w, r, true)
	if !ok {
		return
	}
	job, err := h.WorkflowService.RetryWorkflowRoleResolution(r.Context(), run.ID)
	if err != nil {
		status, code, message := workflowRoleRetryErrorResponse(err)
		writeCodeError(w, status, code, message)
		return
	}
	h.publish("workflow_role_resolution_updated", uuidToString(run.WorkspaceID), "member", uuidToString(actorID), map[string]any{"run_id": uuidToString(run.ID)})
	h.publish("workflow_run_updated", uuidToString(run.WorkspaceID), "member", uuidToString(actorID), map[string]any{"run_id": uuidToString(run.ID)})
	writeJSON(w, http.StatusAccepted, map[string]any{"job_id": uuidToString(job.ID), "status": job.Status})
}

func workflowRoleRetryErrorResponse(err error) (int, string, string) {
	switch {
	case errors.Is(err, service.ErrWorkflowRoleRetryRateLimited):
		return http.StatusTooManyRequests, "workflow_role_retry_rate_limited", err.Error()
	case errors.Is(err, service.ErrWorkflowRoleResolutionLimit):
		return http.StatusTooManyRequests, "workflow_role_resolution_limit", err.Error()
	case errors.Is(err, service.ErrWorkflowRoleRetryActive):
		return http.StatusConflict, "workflow_role_retry_active", err.Error()
	case errors.Is(err, service.ErrWorkflowRoleNoUnresolved):
		return http.StatusConflict, "workflow_role_no_unresolved", err.Error()
	case errors.Is(err, service.ErrWorkflowRoleRetryUnavailable):
		return http.StatusServiceUnavailable, "workflow_role_retry_unavailable", err.Error()
	case errors.Is(err, service.ErrWorkflowRoleAssignmentStage):
		return http.StatusConflict, "workflow_role_stage_started", err.Error()
	case errors.Is(err, pgx.ErrNoRows):
		return http.StatusNotFound, "workflow_run_not_found", "run not found"
	default:
		return http.StatusInternalServerError, "workflow_role_retry_failed", "failed to retry workflow role resolution"
	}
}
