package handler

import (
	"errors"
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/multica-ai/multica/server/internal/service"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestCanManageWorkflowRoleAssignments(t *testing.T) {
	tests := []struct {
		name   string
		member db.MulticaMember
		want   bool
	}{
		{
			name:   "active regular member",
			member: db.MulticaMember{Role: "member", Status: "active"},
			want:   true,
		},
		{
			name:   "inactive owner",
			member: db.MulticaMember{Role: "owner", Status: "inactive"},
			want:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := canManageWorkflowRoleAssignments(tt.member); got != tt.want {
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
