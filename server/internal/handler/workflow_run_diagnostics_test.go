package handler

import (
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func nodeRunWithStatus(status string, failureReason string) db.MulticaWorkflowNodeRun {
	nr := db.MulticaWorkflowNodeRun{Status: status}
	if failureReason != "" {
		nr.FailureReason = pgtype.Text{String: failureReason, Valid: true}
	}
	return nr
}

func TestNodeLifecycleStage(t *testing.T) {
	runningTask := &NodeTaskSummary{Status: "running"}
	queuedTask := &NodeTaskSummary{Status: "queued"}
	dispatchedTask := &NodeTaskSummary{Status: "dispatched"}
	failedTask := &NodeTaskSummary{Status: "failed"}

	tests := []struct {
		name     string
		status   string
		task     *NodeTaskSummary
		expected string
	}{
		{"pending without task", "pending", nil, "pending"},
		{"worker_assigned with queued task", "worker_assigned", queuedTask, "dispatching"},
		{"working with dispatched task", "working", dispatchedTask, "dispatched"},
		{"working with running task", "working", runningTask, "running"},
		{"format_checking without task", "format_checking", nil, "pending"},
		{"splitting without agent task", "splitting", nil, "running"},
		{"split_active without agent task", "split_active", nil, "running"},
		{"awaiting_critic with running task", "awaiting_critic", runningTask, "awaiting_review"},
		{"awaiting_input", "awaiting_input", nil, "awaiting_review"},
		{"awaiting_split_review", "awaiting_split_review", nil, "awaiting_review"},
		{"completed", "completed", nil, "terminal"},
		{"failed with failed task", "failed", failedTask, "terminal"},
		{"blocked", "blocked", nil, "terminal"},
		{"format_failed", "format_failed", nil, "terminal"},
		{"cancelled", "cancelled", nil, "terminal"},
		{"skipped", "skipped", nil, "terminal"},
		// Node active but latest task already terminal (e.g. critic task done,
		// worker rework pending) — still counts as running.
		{"working with completed task", "working", &NodeTaskSummary{Status: "completed"}, "running"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := nodeLifecycleStage(nodeRunWithStatus(tt.status, ""), tt.task)
			if got != tt.expected {
				t.Fatalf("nodeLifecycleStage(%s) = %s, want %s", tt.status, got, tt.expected)
			}
		})
	}
}

func TestNodeDiagnosticsHint(t *testing.T) {
	tests := []struct {
		name     string
		nr       db.MulticaWorkflowNodeRun
		task     *NodeTaskSummary
		stage    string
		expected string
	}{
		{
			"failed node with task failure reason",
			nodeRunWithStatus("failed", ""),
			&NodeTaskSummary{Status: "failed", FailureReason: "agent_empty_output"},
			"terminal",
			"hint.failure.agent_empty_output",
		},
		{
			"failed node falls back to node failure reason",
			nodeRunWithStatus("failed", "timeout"),
			nil,
			"terminal",
			"hint.failure.timeout",
		},
		{
			"task reason wins over node reason",
			nodeRunWithStatus("failed", "timeout"),
			&NodeTaskSummary{Status: "failed", FailureReason: "runtime_offline"},
			"terminal",
			"hint.failure.runtime_offline",
		},
		{
			"completed node has no failure hint",
			nodeRunWithStatus("completed", ""),
			nil,
			"terminal",
			"hint.stage.terminal",
		},
		{
			"cancelled node ignores stale failure reason",
			nodeRunWithStatus("cancelled", "workflow_failed"),
			nil,
			"terminal",
			"hint.stage.terminal",
		},
		{
			"retry attempt running",
			nodeRunWithStatus("working", ""),
			&NodeTaskSummary{Status: "running", Attempt: 2},
			"running",
			"hint.running_retry",
		},
		{
			"first attempt running",
			nodeRunWithStatus("working", ""),
			&NodeTaskSummary{Status: "running", Attempt: 1},
			"running",
			"hint.stage.running",
		},
		{
			"dispatching",
			nodeRunWithStatus("worker_assigned", ""),
			&NodeTaskSummary{Status: "queued"},
			"dispatching",
			"hint.stage.dispatching",
		},
		{
			"pending",
			nodeRunWithStatus("pending", ""),
			nil,
			"pending",
			"hint.stage.pending",
		},
		{
			"awaiting review",
			nodeRunWithStatus("awaiting_critic", ""),
			nil,
			"awaiting_review",
			"hint.stage.awaiting_review",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := nodeDiagnosticsHint(tt.nr, tt.task, tt.stage)
			if got != tt.expected {
				t.Fatalf("nodeDiagnosticsHint() = %s, want %s", got, tt.expected)
			}
		})
	}
}
