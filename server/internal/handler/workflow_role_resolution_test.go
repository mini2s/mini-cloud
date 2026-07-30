package handler

import (
	"errors"
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/service"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestCanManageWorkflowRoleAssignments(t *testing.T) {
	starterID := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	otherID := pgtype.UUID{Bytes: [16]byte{2}, Valid: true}
	tests := []struct {
		name   string
		member db.MulticaMember
		run    db.MulticaWorkflowRun
		userID pgtype.UUID
		want   bool
	}{
		{
			name:   "active run starter",
			member: db.MulticaMember{Role: "member", Status: "active"},
			run:    db.MulticaWorkflowRun{TriggeredByID: starterID},
			userID: starterID,
			want:   true,
		},
		{
			name:   "active regular member who did not start run",
			member: db.MulticaMember{Role: "member", Status: "active"},
			run:    db.MulticaWorkflowRun{TriggeredByID: starterID},
			userID: otherID,
			want:   false,
		},
		{
			name:   "active workspace admin",
			member: db.MulticaMember{Role: "admin", Status: "active"},
			run:    db.MulticaWorkflowRun{TriggeredByID: starterID},
			userID: otherID,
			want:   true,
		},
		{
			name:   "inactive owner",
			member: db.MulticaMember{Role: "owner", Status: "inactive"},
			run:    db.MulticaWorkflowRun{TriggeredByID: starterID},
			userID: otherID,
			want:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := canManageWorkflowRoleAssignments(tt.member, tt.run, tt.userID); got != tt.want {
				t.Fatalf("canManageWorkflowRoleAssignments() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestWorkflowRoleRetryErrorResponse(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{"rate limited", service.ErrWorkflowRoleRetryRateLimited, http.StatusTooManyRequests, "workflow_role_retry_rate_limited"},
		{"workspace limit", service.ErrWorkflowRoleResolutionLimit, http.StatusTooManyRequests, "workflow_role_resolution_limit"},
		{"already active", service.ErrWorkflowRoleRetryActive, http.StatusConflict, "workflow_role_retry_active"},
		{"nothing unresolved", service.ErrWorkflowRoleNoUnresolved, http.StatusConflict, "workflow_role_no_unresolved"},
		{"resolver unavailable", service.ErrWorkflowRoleRetryUnavailable, http.StatusServiceUnavailable, "workflow_role_retry_unavailable"},
		{"stage started", service.ErrWorkflowRoleAssignmentStage, http.StatusConflict, "workflow_role_stage_started"},
		{"run missing", pgx.ErrNoRows, http.StatusNotFound, "workflow_run_not_found"},
		{"unexpected", errors.New("database unavailable"), http.StatusInternalServerError, "workflow_role_retry_failed"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status, code, _ := workflowRoleRetryErrorResponse(tt.err)
			if status != tt.wantStatus {
				t.Fatalf("status = %d, want %d", status, tt.wantStatus)
			}
			if code != tt.wantCode {
				t.Fatalf("code = %q, want %q", code, tt.wantCode)
			}
		})
	}
}
