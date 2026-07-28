package main

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/handler"
	"github.com/multica-ai/multica/server/internal/integration"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// registerIntegrationListener wires the outbound costrict-web bridge. It
// subscribes to the same issue:updated events the inbox listeners consume,
// but resolves recipients by the integration rules (mentions first, creator
// fallback — see docs/costrict-notification-integration-plan.md §3) and
// pushes a signed envelope instead of writing inbox rows. The in-app inbox
// pipeline is untouched.
//
// Delivery is asynchronous (integration.Notifier queue), but recipient
// resolution runs inline in the synchronous bus dispatch, same as the
// notification listeners' subscriber lookups — a few indexed queries.
func registerIntegrationListener(bus *events.Bus, queries *db.Queries, notifier *integration.Notifier, appURL string) {
	ctx := context.Background()

	bus.Subscribe(protocol.EventIssueUpdated, func(e events.Event) {
		payload, ok := e.Payload.(map[string]any)
		if !ok {
			return
		}
		if sc, _ := payload["status_changed"].(bool); !sc {
			return
		}
		issue, ok := payload["issue"].(handler.IssueResponse)
		if !ok {
			return
		}

		description := ""
		if issue.Description != nil {
			description = *issue.Description
		}
		recipients, err := integration.ResolveRecipients(ctx, &integration.Store{
			Queries:     queries,
			WorkspaceID: e.WorkspaceID,
		}, integration.ResolveInput{
			IssueID:     issue.ID,
			Description: description,
			CreatorType: issue.CreatorType,
			CreatorID:   issue.CreatorID,
			ActorType:   e.ActorType,
			ActorID:     e.ActorID,
		})
		if err != nil {
			slog.Error("integration: recipient resolution failed", "issue_id", issue.ID, "error", err)
			return
		}
		if len(recipients) == 0 {
			return
		}

		wsName, wsSlug := workspaceNameAndSlug(ctx, queries, e.WorkspaceID)
		prevStatus, _ := payload["prev_status"].(string)

		env := integration.Envelope{
			Version:    1,
			EventID:    uuid.NewString(),
			Type:       integration.EventIssueStatusChanged,
			OccurredAt: time.Now().UTC(),
			Workspace:  integration.WorkspaceRef{ID: e.WorkspaceID, Name: wsName},
			Actor:      integration.ActorRef{Type: e.ActorType, Name: actorNameFor(ctx, queries, e)},
			Issue: integration.IssueRef{
				ID:         issue.ID,
				Identifier: issue.Identifier,
				Title:      issue.Title,
				PrevStatus: prevStatus,
				Status:     issue.Status,
				URL:        issueURL(appURL, wsSlug, issue.Identifier),
			},
			Recipients: recipients,
		}
		notifier.Enqueue(env)
	})
}

// workspaceNameAndSlug resolves the workspace display name and slug; failures
// degrade to empty strings (the envelope still carries the workspace ID).
func workspaceNameAndSlug(ctx context.Context, queries *db.Queries, workspaceID string) (name, slug string) {
	wsUUID, err := util.ParseUUID(workspaceID)
	if err != nil {
		return "", ""
	}
	ws, err := queries.GetWorkspace(ctx, wsUUID)
	if err != nil {
		return "", ""
	}
	return ws.Name, ws.Slug
}

// actorNameFor resolves a human actor's display name for the notification
// text; agents/system degrade to an empty name (the receiver renders by type).
func actorNameFor(ctx context.Context, queries *db.Queries, e events.Event) string {
	if e.ActorType != "member" {
		return ""
	}
	userUUID, err := util.ParseUUID(e.ActorID)
	if err != nil {
		return ""
	}
	user, err := queries.GetUser(ctx, userUUID)
	if err != nil {
		return ""
	}
	return user.Name
}

// issueURL builds the deep link opened from the external notification. Empty
// when the app URL or workspace slug is missing — the receiver must tolerate
// a missing link.
func issueURL(appURL, slug, identifier string) string {
	if appURL == "" || slug == "" {
		return ""
	}
	return fmt.Sprintf("%s/%s/issues/%s", appURL, slug, identifier)
}
