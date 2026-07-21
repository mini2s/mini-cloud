package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/multica-ai/multica/server/internal/cloudruntime"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

const (
	csCloudProvider             = "cs-cloud"
	failureReasonDispatchFailed = "dispatch_failed"
	csCloudPushTimeout          = 25 * time.Second
	csCloudAbortTimeout         = 10 * time.Second

	// promptMaxRunes limits the total prompt size sent to a cs-cloud device.
	// The gateway proxy body limit is not explicitly documented for the
	// internal route, so we stay conservative.
	promptMaxRunes = 64 * 1024
	// promptItemMaxRunes caps a single source (issue description, comment).
	promptItemMaxRunes = 32 * 1024
)

// csCloudTaskRunPayload is the JSON body posted to a cs-cloud device when a
// task is pushed. Fields are named to match cs-cloud's
// internal/workflow.TaskRunPayload with an additive kind field.
type csCloudTaskRunPayload struct {
	TaskID      string            `json:"task_id"`
	WorkspaceID string            `json:"workspace_id"`
	IssueID     string            `json:"issue_id,omitempty"`
	ProjectID   string            `json:"project_id,omitempty"`
	NodeRunID   string            `json:"node_run_id,omitempty"`
	AgentID     string            `json:"agent_id,omitempty"`
	Agent       string            `json:"agent"`
	Prompt      string            `json:"prompt"`
	Env         map[string]string `json:"env,omitempty"`
	Kind        string            `json:"kind,omitempty"`
}

// maybePushToCSCloud is called synchronously from notifyTaskAvailable. It
// spawns the actual push in a detached goroutine so the enqueueing HTTP
// request is not blocked by network IO.
func (s *TaskService) maybePushToCSCloud(task db.MulticaAgentTaskQueue) {
	if s.CSCloudPush == nil || !s.CSCloudPush.Enabled() {
		return
	}
	if !task.RuntimeID.Valid {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), csCloudPushTimeout)
		defer cancel()
		if err := s.dispatchTaskToCSCloud(ctx, task); err != nil {
			slog.Warn("cs-cloud push failed",
				"task_id", util.UUIDToString(task.ID),
				"error", err,
			)
		}
	}()
}

func (s *TaskService) dispatchTaskToCSCloud(ctx context.Context, task db.MulticaAgentTaskQueue) error {
	runtime, err := s.Queries.GetAgentRuntime(ctx, task.RuntimeID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil // runtime gone; task will age out of queued
		}
		return fmt.Errorf("get runtime: %w", err)
	}
	if runtime.Provider != csCloudProvider {
		return nil
	}

	deviceID, err := csCloudDeviceID(runtime)
	if err != nil {
		return err
	}

	// Mark the task dispatched. If it left 'queued' (cancelled or claimed),
	// no row is returned and we abort the push.
	dispatched, err := s.Queries.MarkAgentTaskDispatched(ctx, task.ID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return fmt.Errorf("mark dispatched: %w", err)
	}

	// Mirror the side effects of ClaimTask so UI/analytics see the same
	// task:dispatch flow as pull-based daemons.
	s.captureTaskDispatched(ctx, dispatched)
	s.ReconcileAgentStatus(ctx, dispatched.AgentID)
	s.broadcastTaskDispatch(ctx, dispatched)

	payload, err := s.buildCSCloudPayload(ctx, dispatched, runtime)
	if err != nil {
		// payload building is best-effort; if it fails we still failed
		// dispatch and should let auto-retry kick in.
		_, _ = s.FailTask(ctx, task.ID, "failed to build task payload: "+err.Error(), "", "", failureReasonDispatchFailed)
		return fmt.Errorf("build payload: %w", err)
	}

	body, err := json.Marshal(payload)
	if err != nil {
		_, _ = s.FailTask(ctx, task.ID, "failed to marshal task payload", "", "", failureReasonDispatchFailed)
		return fmt.Errorf("marshal payload: %w", err)
	}

	req := cloudruntime.Request{
		Method: http.MethodPost,
		Path:   fmt.Sprintf("/device/%s/proxy/api/v1/workflow/tasks/%s/run", deviceID, util.UUIDToString(task.ID)),
		Body:   body,
	}
	if secret := os.Getenv("COSTRICT_INTERNAL_SECRET"); secret != "" {
		req.Headers = http.Header{}
		req.Headers.Set("X-Internal-Secret", secret)
	}

	resp, err := s.CSCloudPush.Do(ctx, req)
	if err != nil {
		_, _ = s.FailTask(ctx, task.ID, "push to device failed: "+err.Error(), "", "", failureReasonDispatchFailed)
		return fmt.Errorf("push request: %w", err)
	}
	if resp.StatusCode >= 300 {
		bodySnippet := strings.TrimSpace(string(resp.Body))
		if len(bodySnippet) > 200 {
			bodySnippet = bodySnippet[:200] + "..."
		}
		_, _ = s.FailTask(ctx, task.ID, fmt.Sprintf("device returned %d: %s", resp.StatusCode, bodySnippet), "", "", failureReasonDispatchFailed)
		return fmt.Errorf("device returned %d", resp.StatusCode)
	}
	return nil
}

func (s *TaskService) buildCSCloudPayload(ctx context.Context, task db.MulticaAgentTaskQueue, runtime db.MulticaAgentRuntime) (csCloudTaskRunPayload, error) {
	kind := computeCSCloudTaskKind(task)
	prompt, err := s.buildCSCloudPrompt(ctx, task, kind)
	if err != nil {
		return csCloudTaskRunPayload{}, err
	}

	env := map[string]string{}
	if task.AgentID.Valid {
		agent, err := s.Queries.GetAgent(ctx, task.AgentID)
		if err == nil && len(agent.CustomEnv) > 0 {
			_ = json.Unmarshal(agent.CustomEnv, &env)
		}
	}

	return csCloudTaskRunPayload{
		TaskID:      util.UUIDToString(task.ID),
		WorkspaceID: util.UUIDToString(runtime.WorkspaceID),
		IssueID:     util.UUIDToString(task.IssueID),
		ProjectID:   "",
		NodeRunID:   util.UUIDToString(task.WorkflowNodeRunID),
		AgentID:     util.UUIDToString(task.AgentID),
		Agent:       "csc",
		Prompt:      prompt,
		Env:         env,
		Kind:        kind,
	}, nil
}

func computeCSCloudTaskKind(task db.MulticaAgentTaskQueue) string {
	if util.UUIDToString(task.ChatSessionID) != "" {
		return "chat"
	}
	if util.UUIDToString(task.AutopilotRunID) != "" {
		return "autopilot"
	}
	if util.UUIDToString(task.IssueID) == "" {
		return "quick_create"
	}
	if util.UUIDToString(task.TriggerCommentID) != "" {
		return "comment"
	}
	return "direct"
}

func (s *TaskService) buildCSCloudPrompt(ctx context.Context, task db.MulticaAgentTaskQueue, kind string) (string, error) {
	switch kind {
	case "chat":
		return s.buildChatPrompt(ctx, task)
	case "quick_create":
		if qc, ok := s.parseQuickCreateContext(task); ok {
			return qc.Prompt, nil
		}
		return "", nil
	case "autopilot":
		return s.buildAutopilotPrompt(ctx, task)
	case "comment":
		return s.buildIssueCommentPrompt(ctx, task)
	default:
		// direct / fallback
		return s.buildIssuePrompt(ctx, task)
	}
}

func (s *TaskService) buildIssuePrompt(ctx context.Context, task db.MulticaAgentTaskQueue) (string, error) {
	if !task.IssueID.Valid {
		return "", nil
	}
	issue, err := s.Queries.GetIssue(ctx, task.IssueID)
	if err != nil {
		return "", fmt.Errorf("get issue: %w", err)
	}
	var b strings.Builder
	fmt.Fprintf(&b, "Issue: %s\n", issue.Title)
	if issue.Description.Valid {
		b.WriteString("\n")
		b.WriteString(truncatePromptItem(issue.Description.String))
		b.WriteString("\n")
	}
	return truncatePrompt(b.String()), nil
}

func (s *TaskService) buildIssueCommentPrompt(ctx context.Context, task db.MulticaAgentTaskQueue) (string, error) {
	issuePrompt, err := s.buildIssuePrompt(ctx, task)
	if err != nil {
		return "", err
	}
	if !task.TriggerCommentID.Valid {
		return issuePrompt, nil
	}
	comment, err := s.Queries.GetComment(ctx, task.TriggerCommentID)
	if err != nil {
		// Comment missing/deleted is not fatal; fall back to the issue prompt.
		return issuePrompt, nil
	}
	var b strings.Builder
	b.WriteString(issuePrompt)
	if b.Len() > 0 {
		b.WriteString("\n")
	}
	fmt.Fprintln(&b, "New comment:")
	b.WriteString(truncatePromptItem(comment.Content))
	b.WriteString("\n")
	return truncatePrompt(b.String()), nil
}

func (s *TaskService) buildChatPrompt(ctx context.Context, task db.MulticaAgentTaskQueue) (string, error) {
	if !task.ChatSessionID.Valid {
		return "", nil
	}
	msgs, err := s.Queries.ListChatMessages(ctx, task.ChatSessionID)
	if err != nil {
		return "", fmt.Errorf("list chat messages: %w", err)
	}
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].Role == "user" {
			return truncatePrompt(fmt.Sprintf("You are a coding assistant in a Multica chat session.\n\n%s", msgs[i].Content)), nil
		}
	}
	return "", nil
}

func (s *TaskService) buildAutopilotPrompt(ctx context.Context, task db.MulticaAgentTaskQueue) (string, error) {
	if !task.AutopilotRunID.Valid {
		return "", nil
	}
	run, err := s.Queries.GetAutopilotRun(ctx, task.AutopilotRunID)
	if err != nil {
		return "", fmt.Errorf("get autopilot run: %w", err)
	}
	var b strings.Builder
	if run.IssueID.Valid {
		issue, err := s.Queries.GetIssue(ctx, run.IssueID)
		if err == nil {
			fmt.Fprintf(&b, "Issue: %s\n", issue.Title)
			if issue.Description.Valid {
				b.WriteString("\n")
				b.WriteString(truncatePromptItem(issue.Description.String))
				b.WriteString("\n")
			}
		}
	}
	if run.TriggerPayload != nil {
		var payload map[string]any
		if err := json.Unmarshal(run.TriggerPayload, &payload); err == nil {
			b.WriteString("\nTrigger: ")
			enc := json.NewEncoder(&b)
			enc.SetEscapeHTML(false)
			_ = enc.Encode(payload)
		}
	}
	return truncatePrompt(b.String()), nil
}

func csCloudDeviceID(runtime db.MulticaAgentRuntime) (string, error) {
	if len(runtime.Metadata) > 0 {
		var meta map[string]any
		if err := json.Unmarshal(runtime.Metadata, &meta); err == nil {
			if id, _ := meta["device_id"].(string); id != "" {
				return id, nil
			}
		}
	}
	if runtime.DaemonID.Valid && runtime.DaemonID.String != "" {
		return runtime.DaemonID.String, nil
	}
	return "", fmt.Errorf("cs-cloud runtime %s has no device_id", util.UUIDToString(runtime.ID))
}

// truncatePromptItem caps a single prompt source, keeping the head.
func truncatePromptItem(s string) string {
	if len(s) <= promptItemMaxRunes {
		return s
	}
	return string([]rune(s)[:promptItemMaxRunes]) + "\n... (truncated)"
}

// truncatePrompt caps the total prompt size, keeping the head and marking
// truncation clearly.
func truncatePrompt(s string) string {
	runes := []rune(s)
	if len(runes) <= promptMaxRunes {
		return s
	}
	return string(runes[:promptMaxRunes]) + "\n... (truncated)"
}

// maybeAbortOnDevice pushes an abort request to a cs-cloud device when a
// dispatched or running task is cancelled. It is best-effort: a missed abort
// leaves the agent running at most until its own timeout, and its completion
// callback will be ignored by an already-finalized task.
func (s *TaskService) maybeAbortOnDevice(task db.MulticaAgentTaskQueue) {
	if s.CSCloudPush == nil || !s.CSCloudPush.Enabled() {
		return
	}
	if task.Status != "dispatched" && task.Status != "running" {
		return
	}
	if !task.RuntimeID.Valid {
		return
	}

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), csCloudAbortTimeout)
		defer cancel()

		runtime, err := s.Queries.GetAgentRuntime(ctx, task.RuntimeID)
		if err != nil || runtime.Provider != csCloudProvider {
			return
		}
		deviceID, err := csCloudDeviceID(runtime)
		if err != nil {
			slog.Warn("cs-cloud abort: no device id",
				"task_id", util.UUIDToString(task.ID),
				"error", err,
			)
			return
		}

		req := cloudruntime.Request{
			Method: http.MethodPost,
			Path:   fmt.Sprintf("/device/%s/proxy/api/v1/workflow/tasks/%s/abort", deviceID, util.UUIDToString(task.ID)),
		}
		if secret := os.Getenv("COSTRICT_INTERNAL_SECRET"); secret != "" {
			req.Headers = http.Header{}
			req.Headers.Set("X-Internal-Secret", secret)
		}
		if _, err := s.CSCloudPush.Do(ctx, req); err != nil {
			slog.Warn("cs-cloud abort failed",
				"task_id", util.UUIDToString(task.ID),
				"error", err,
			)
		}
	}()
}

