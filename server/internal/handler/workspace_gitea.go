package handler

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"
)

func (h *Handler) syncWorkspaceGiteaMembers(workspaceID pgtype.UUID) {
	if h.WorkflowService == nil {
		return
	}
	go h.WorkflowService.ProvisionWorkspaceGitea(context.Background(), workspaceID)
}
