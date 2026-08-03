package integration

import (
	"context"

	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// Store adapts db.Queries to RecipientStore. It is scoped to one workspace,
// which matches how the listener constructs it per event.
type Store struct {
	Queries     *db.Queries
	WorkspaceID string
}

func (s *Store) ListCommentBodies(ctx context.Context, issueID string) ([]string, error) {
	issueUUID, err := util.ParseUUID(issueID)
	if err != nil {
		return nil, err
	}
	wsUUID, err := util.ParseUUID(s.WorkspaceID)
	if err != nil {
		return nil, err
	}
	comments, err := s.Queries.ListCommentsForIssue(ctx, db.ListCommentsForIssueParams{
		IssueID:     issueUUID,
		WorkspaceID: wsUUID,
		Limit:       2000,
	})
	if err != nil {
		return nil, err
	}
	bodies := make([]string, 0, len(comments))
	for _, c := range comments {
		bodies = append(bodies, c.Content)
	}
	return bodies, nil
}

func (s *Store) GetUserEmail(ctx context.Context, userID string) (string, error) {
	userUUID, err := util.ParseUUID(userID)
	if err != nil {
		return "", err
	}
	user, err := s.Queries.GetUser(ctx, userUUID)
	if err != nil {
		// A deleted user must not fail the whole notification — treat as no email.
		return "", nil
	}
	return user.Email, nil
}
