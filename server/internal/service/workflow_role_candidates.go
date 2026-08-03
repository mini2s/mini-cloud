package service

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// WorkflowRoleMemberCandidate is a workspace member that may be enriched with
// organization data before being sent to a role resolver. ExternalIdentity is
// deliberately opaque to the resolution layer and must never be sent to the
// model.
type WorkflowRoleMemberCandidate struct {
	MemberID         string
	UserID           string
	ExternalIdentity string
	DisplayName      string
}

// WorkflowRoleOrganizationProfile contains the minimal real-time organization
// attributes used for role resolution. The provider must return at most one
// profile for each requested external identity.
type WorkflowRoleOrganizationProfile struct {
	ExternalIdentity string
	DisplayName      string
	Position         string
	DepartmentPath   string
	IsMainDepartment bool
}

// WorkflowRoleOrganizationSnapshot identifies the organization data used by a
// resolution attempt without requiring the full candidate snapshot to persist.
type WorkflowRoleOrganizationSnapshot struct {
	Profiles  []WorkflowRoleOrganizationProfile
	Version   string
	FetchedAt time.Time
}

// WorkflowRoleOrganizationProvider is the adapter boundary between workflow
// role resolution and the workspace's organization service.
type WorkflowRoleOrganizationProvider interface {
	Configured() bool
	ResolveMembers(ctx context.Context, externalIdentities []string) (WorkflowRoleOrganizationSnapshot, error)
}

type workflowRoleCandidateQueries interface {
	ListActiveWorkflowRoleCandidateMembers(ctx context.Context, workspaceID pgtype.UUID) ([]db.ListActiveWorkflowRoleCandidateMembersRow, error)
}

// ListWorkflowRoleMemberCandidates returns only active, linked members in the
// workspace. Missing or duplicate organization identities are excluded because
// automatic resolution must not guess which organization user is intended.
func ListWorkflowRoleMemberCandidates(
	ctx context.Context,
	queries workflowRoleCandidateQueries,
	workspaceID pgtype.UUID,
) ([]WorkflowRoleMemberCandidate, error) {
	rows, err := queries.ListActiveWorkflowRoleCandidateMembers(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	return normalizeWorkflowRoleMemberCandidates(rows), nil
}

func normalizeWorkflowRoleMemberCandidates(rows []db.ListActiveWorkflowRoleCandidateMembersRow) []WorkflowRoleMemberCandidate {
	identities := make([]string, len(rows))
	identityCounts := make(map[string]int, len(rows))
	for i, row := range rows {
		identity := strings.TrimSpace(row.SubjectID.String)
		identities[i] = identity
		if identity != "" {
			identityCounts[identity]++
		}
	}

	candidates := make([]WorkflowRoleMemberCandidate, 0, len(rows))
	for i, row := range rows {
		identity := identities[i]
		if identity == "" || identityCounts[identity] != 1 {
			continue
		}
		candidates = append(candidates, WorkflowRoleMemberCandidate{
			MemberID:         util.UUIDToString(row.MemberID),
			UserID:           util.UUIDToString(row.UserID),
			ExternalIdentity: identity,
			DisplayName:      strings.TrimSpace(row.DisplayName),
		})
	}
	return candidates
}
