package main

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/handler"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

type workflowNodeRunNotificationFields struct {
	ID            string
	WorkflowRunID string
	NodeTitle     string
	Status        string
	WorkerType    string
	WorkerID      *string
	CriticType    string
	CriticID      *string
}

func registerWorkflowNodeNotificationListeners(bus *events.Bus, queries *db.Queries) {
	ctx := context.Background()
	handler := func(e events.Event) {
		payload, ok := e.Payload.(map[string]any)
		if !ok {
			return
		}
		nodeRun, ok := extractWorkflowNodeRunFields(ctx, queries, payload)
		if !ok {
			return
		}
		issueID, _ := payload["issue_id"].(string)
		runID, _ := payload["run_id"].(string)
		if runID == "" {
			runID = nodeRun.WorkflowRunID
		}
		if issueID == "" {
			issueID = workflowRunSourceIssueID(ctx, queries, runID)
		}
		title := nodeRun.NodeTitle
		if title == "" {
			title = "Workflow node"
		}

		details := map[string]string{
			"node_run_id": nodeRun.ID,
			"run_id":      runID,
			"status":      nodeRun.Status,
			"to":          nodeRun.Status,
		}
		if prevStatus, _ := payload["prev_status"].(string); prevStatus != "" {
			details["from"] = prevStatus
		}

		switch nodeRun.Status {
		case "worker_assigned":
			notifyWorkflowNodeRole(ctx, queries, bus, e, nodeRun, issueID, "worker", "workflow_executor_assigned", title, details)
			return
		case "awaiting_critic", "critic_reviewing":
			notifyWorkflowNodeRole(ctx, queries, bus, e, nodeRun, issueID, "critic", "workflow_reviewer_assigned", title, details)
			return
		}

		notifyWorkflowNodeStatus(ctx, queries, bus, e, nodeRun, issueID, title, details)
	}

	for _, eventType := range []string{
		protocol.EventWorkflowNodeRunStarted,
		protocol.EventWorkflowNodeRunCompleted,
		protocol.EventWorkflowNodeRunFailed,
		protocol.EventWorkflowNodeRunBlocked,
		protocol.EventWorkflowNodeRunReviewed,
		protocol.EventWorkflowNodeRunResumed,
		"workflow:node_run_updated",
	} {
		bus.Subscribe(eventType, handler)
	}
}

func extractWorkflowNodeRunFields(ctx context.Context, queries *db.Queries, payload map[string]any) (workflowNodeRunNotificationFields, bool) {
	switch nr := payload["node_run"].(type) {
	case handler.WorkflowNodeRunResponse:
		return workflowNodeRunNotificationFields{
			ID:            nr.ID,
			WorkflowRunID: nr.WorkflowRunID,
			NodeTitle:     nr.NodeTitle,
			Status:        nr.Status,
			WorkerType:    nr.WorkerType,
			WorkerID:      nr.WorkerID,
			CriticType:    nr.CriticType,
			CriticID:      nr.CriticID,
		}, nr.ID != ""
	case map[string]any:
		return workflowNodeRunNotificationFields{
			ID:            stringValue(nr, "id"),
			WorkflowRunID: stringValue(nr, "workflow_run_id"),
			NodeTitle:     stringValue(nr, "node_title"),
			Status:        stringValue(nr, "status"),
			WorkerType:    stringValue(nr, "worker_type"),
			WorkerID:      optionalString(nr["worker_id"]),
			CriticType:    stringValue(nr, "critic_type"),
			CriticID:      optionalString(nr["critic_id"]),
		}, stringValue(nr, "id") != ""
	}

	nodeRunID, _ := payload["node_run_id"].(string)
	if nodeRunID == "" {
		return workflowNodeRunNotificationFields{}, false
	}
	nr, err := queries.GetWorkflowNodeRun(ctx, parseUUID(nodeRunID))
	if err != nil {
		slog.Error("workflow node notification: failed to load node run", "node_run_id", nodeRunID, "error", err)
		return workflowNodeRunNotificationFields{}, false
	}
	return workflowNodeRunNotificationFields{
		ID:            util.UUIDToString(nr.ID),
		WorkflowRunID: util.UUIDToString(nr.WorkflowRunID),
		NodeTitle:     nr.NodeTitle,
		Status:        nr.Status,
		WorkerType:    nr.WorkerType,
		WorkerID:      util.UUIDToPtr(nr.WorkerID),
		CriticType:    nr.CriticType,
		CriticID:      util.UUIDToPtr(nr.CriticID),
	}, true
}

func workflowRunSourceIssueID(ctx context.Context, queries *db.Queries, runID string) string {
	if runID == "" {
		return ""
	}
	run, err := queries.GetWorkflowRun(ctx, parseUUID(runID))
	if err != nil || !run.SourceIssueID.Valid {
		return ""
	}
	return util.UUIDToString(run.SourceIssueID)
}

func notifyWorkflowNodeRole(
	ctx context.Context,
	queries *db.Queries,
	bus *events.Bus,
	e events.Event,
	nodeRun workflowNodeRunNotificationFields,
	issueID string,
	role string,
	notifType string,
	title string,
	details map[string]string,
) {
	recipientID, ok := workflowNodeRoleRecipient(ctx, queries, nodeRun, role)
	if !ok {
		return
	}
	notifyDirect(ctx, queries, bus,
		"member", recipientID,
		e.WorkspaceID, e, issueID, nodeRun.Status,
		notifType, "action_required",
		title, "",
		workflowNodeDetails(details, role),
	)
}

func notifyWorkflowNodeStatus(
	ctx context.Context,
	queries *db.Queries,
	bus *events.Bus,
	e events.Event,
	nodeRun workflowNodeRunNotificationFields,
	issueID string,
	title string,
	details map[string]string,
) {
	recipients := map[string]string{}
	if id, ok := workflowNodeRoleRecipient(ctx, queries, nodeRun, "worker"); ok {
		recipients[id] = "worker"
	}
	if id, ok := workflowNodeRoleRecipient(ctx, queries, nodeRun, "critic"); ok {
		recipients[id] = "critic"
	}
	for recipientID, role := range recipients {
		notifyDirect(ctx, queries, bus,
			"member", recipientID,
			e.WorkspaceID, e, issueID, nodeRun.Status,
			"workflow_node_status_changed", "info",
			title, "",
			workflowNodeDetails(details, role),
		)
	}
}

func workflowNodeRoleRecipient(ctx context.Context, queries *db.Queries, nodeRun workflowNodeRunNotificationFields, role string) (string, bool) {
	var roleType string
	var roleID *string
	switch role {
	case "worker":
		roleType = nodeRun.WorkerType
		roleID = nodeRun.WorkerID
	case "critic":
		roleType = nodeRun.CriticType
		roleID = nodeRun.CriticID
	default:
		return "", false
	}
	if roleType != "human" || roleID == nil || *roleID == "" {
		return "", false
	}
	member, err := queries.GetMember(ctx, parseUUID(*roleID))
	if err == nil && member.UserID.Valid {
		return util.UUIDToString(member.UserID), true
	}
	return *roleID, true
}

func workflowNodeDetails(base map[string]string, role string) []byte {
	details := make(map[string]string, len(base)+1)
	for k, v := range base {
		details[k] = v
	}
	details["role"] = role
	raw, _ := json.Marshal(details)
	return raw
}

func stringValue(m map[string]any, key string) string {
	value, _ := m[key].(string)
	return value
}
