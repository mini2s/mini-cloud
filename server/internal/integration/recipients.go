// Package integration implements the outbound notification bridge to
// costrict-web: it resolves recipients for issue events and pushes signed
// envelopes to the configured endpoint. The in-app inbox pipeline is
// untouched — this is an additive, optional channel that is disabled unless
// MULTICA_INTEGRATION_ENDPOINT and MULTICA_INTEGRATION_SECRET are set.
package integration

import (
	"context"
	"fmt"

	"github.com/multica-ai/multica/server/internal/util"
)

// RecipientStore abstracts the DB lookups the resolver needs, so the
// resolution rules can be unit-tested without a database.
type RecipientStore interface {
	// ListCommentBodies returns the markdown bodies of all comments on an issue.
	ListCommentBodies(ctx context.Context, issueID string) ([]string, error)
	// GetUserEmail returns the email for a user ID, or "" when the user has
	// no usable email.
	GetUserEmail(ctx context.Context, userID string) (string, error)
}

// ResolveInput carries everything the resolver needs about the issue event.
type ResolveInput struct {
	IssueID     string
	Description string // issue description markdown
	CreatorType string // "member" | "agent" | ...
	CreatorID   string // user ID when CreatorType == "member"
	ActorType   string // "member" | "agent" | "system"
	ActorID     string // user ID when ActorType == "member"
}

// ResolveRecipients returns the email addresses the outbound channel should
// notify for an issue event. Rules (see
// docs/costrict-notification-integration-plan.md §3):
//
//  1. Member mentions in the issue description and comments win.
//  2. With no member mentions (none at all, or only agent/squad mentions),
//     fall back to the issue creator when the creator is a member.
//  3. The actor is excluded (people don't get notified about their own
//     action). A system actor excludes nobody.
//  4. Users without a usable email are skipped; an empty result means "skip
//     this notification".
func ResolveRecipients(ctx context.Context, store RecipientStore, in ResolveInput) ([]string, error) {
	mentioned := map[string]bool{}
	for _, m := range util.ParseMentions(in.Description) {
		if m.Type == "member" {
			mentioned[m.ID] = true
		}
	}
	bodies, err := store.ListCommentBodies(ctx, in.IssueID)
	if err != nil {
		return nil, fmt.Errorf("list comment bodies: %w", err)
	}
	for _, body := range bodies {
		for _, m := range util.ParseMentions(body) {
			if m.Type == "member" {
				mentioned[m.ID] = true
			}
		}
	}

	userIDs := make([]string, 0, len(mentioned))
	if len(mentioned) > 0 {
		for id := range mentioned {
			userIDs = append(userIDs, id)
		}
	} else if in.CreatorType == "member" && in.CreatorID != "" {
		userIDs = append(userIDs, in.CreatorID)
	}

	var emails []string
	for _, id := range userIDs {
		if in.ActorType == "member" && id == in.ActorID {
			continue
		}
		email, err := store.GetUserEmail(ctx, id)
		if err != nil {
			return nil, fmt.Errorf("get user email for %s: %w", id, err)
		}
		if email == "" {
			continue
		}
		emails = append(emails, email)
	}
	return emails, nil
}
