package service

import (
	"reflect"
	"strings"
	"testing"

	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestSplitTaskGraphRejectsUnknownDependency(t *testing.T) {
	tasks := []splitTaskPlan{
		{ID: "a", Status: SplitTaskStatusCreated},
		{ID: "b", Status: SplitTaskStatusCreated, DependsOn: []string{"missing"}},
	}
	err := validateSplitTaskGraph(tasks)
	if err == nil || !strings.Contains(err.Error(), "unknown dependency") {
		t.Fatalf("validateSplitTaskGraph error = %v, want unknown dependency", err)
	}
}

func TestSplitTaskGraphRejectsCycle(t *testing.T) {
	tasks := []splitTaskPlan{
		{ID: "a", Status: SplitTaskStatusCreated, DependsOn: []string{"c"}},
		{ID: "b", Status: SplitTaskStatusCreated, DependsOn: []string{"a"}},
		{ID: "c", Status: SplitTaskStatusCreated, DependsOn: []string{"b"}},
	}
	err := validateSplitTaskGraph(tasks)
	if err == nil || !strings.Contains(err.Error(), "cycle") {
		t.Fatalf("validateSplitTaskGraph error = %v, want cycle", err)
	}
}

func TestTopologicalSplitTaskOrderHonorsDependenciesAndSortOrder(t *testing.T) {
	tasks := []splitTaskPlan{
		{ID: "c", SortOrder: 3, Status: SplitTaskStatusCreated, DependsOn: []string{"b"}},
		{ID: "a", SortOrder: 1, Status: SplitTaskStatusCreated},
		{ID: "b", SortOrder: 2, Status: SplitTaskStatusCreated, DependsOn: []string{"a"}},
		{ID: "d", SortOrder: 0, Status: SplitTaskStatusCreated},
	}
	got, err := topologicalSplitTaskIDs(tasks)
	if err != nil {
		t.Fatalf("topologicalSplitTaskIDs: %v", err)
	}
	want := []string{"d", "a", "b", "c"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("topologicalSplitTaskIDs = %v, want %v", got, want)
	}
}

func TestReadySplitTasksRespectDependenciesAndConcurrency(t *testing.T) {
	tasks := []splitTaskPlan{
		{ID: "a", SortOrder: 1, Status: SplitTaskStatusDone},
		{ID: "b", SortOrder: 2, Status: SplitTaskStatusCreated, DependsOn: []string{"a"}},
		{ID: "c", SortOrder: 3, Status: SplitTaskStatusCreated, DependsOn: []string{"a"}},
		{ID: "d", SortOrder: 4, Status: SplitTaskStatusCreated, DependsOn: []string{"b"}},
		{ID: "e", SortOrder: 5, Status: SplitTaskStatusRunning},
	}
	got, err := readySplitTaskIDs(tasks, 2)
	if err != nil {
		t.Fatalf("readySplitTaskIDs: %v", err)
	}
	want := []string{"b"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("readySplitTaskIDs = %v, want %v", got, want)
	}
}

func TestMarkSkippedSplitTasksAfterFailedDependency(t *testing.T) {
	tasks := []splitTaskPlan{
		{ID: "a", Status: SplitTaskStatusFailed},
		{ID: "b", Status: SplitTaskStatusCreated, DependsOn: []string{"a"}},
		{ID: "c", Status: SplitTaskStatusCreated, DependsOn: []string{"b"}},
		{ID: "d", Status: SplitTaskStatusDone},
	}
	got := markBlockedSplitTasksSkipped(tasks)
	statuses := map[string]string{}
	for _, task := range got {
		statuses[task.ID] = task.Status
	}
	if statuses["b"] != SplitTaskStatusSkipped || statuses["c"] != SplitTaskStatusSkipped {
		t.Fatalf("statuses after skip = %v, want b/c skipped", statuses)
	}
	if statuses["d"] != SplitTaskStatusDone {
		t.Fatalf("done task changed to %s", statuses["d"])
	}
}

func TestResolveSplitPipelineCompletesAfterMaterialization(t *testing.T) {
	tasks := []splitTaskPlan{
		{ID: "a", Status: SplitTaskStatusCreated},
		{ID: "b", Status: SplitTaskStatusRunning},
	}
	got := resolveSplitStatus(SplitModePipeline, 0, tasks)
	if got != NodeRunStatusCompleted {
		t.Fatalf("resolveSplitStatus pipeline = %s, want %s", got, NodeRunStatusCompleted)
	}
}

func TestResolveSplitBarrierFailureThreshold(t *testing.T) {
	tasks := []splitTaskPlan{
		{ID: "a", Status: SplitTaskStatusDone},
		{ID: "b", Status: SplitTaskStatusFailed},
		{ID: "c", Status: SplitTaskStatusSkipped},
	}
	if got := resolveSplitStatus(SplitModeBarrier, 1, tasks); got != NodeRunStatusCompleted {
		t.Fatalf("resolveSplitStatus threshold=1 = %s, want completed", got)
	}
	if got := resolveSplitStatus(SplitModeBarrier, 0, tasks); got != NodeRunStatusFailed {
		t.Fatalf("resolveSplitStatus threshold=0 = %s, want failed", got)
	}
}

func TestBuildSplitDependencyContextIncludesDependencyOutputs(t *testing.T) {
	context := buildSplitDependencyContext([]splitTaskDependencyContext{
		{
			TaskTitle: "API contract",
			NodeRuns: []db.MulticaWorkflowNodeRun{
				{
					NodeTitle:    "Draft API",
					WorkerOutput: []byte(`{"output":"Spec ready"}`),
				},
				{
					NodeTitle:    "Review",
					WorkerOutput: []byte(`{"output":"Approved by critic"}`),
				},
				{
					NodeTitle:    "Ignored",
					WorkerOutput: []byte(`{"foo":"bar"}`),
				},
			},
		},
		{
			TaskTitle: "Backfill tests",
			NodeRuns: []db.MulticaWorkflowNodeRun{
				{
					NodeTitle:    "Plan coverage",
					WorkerOutput: []byte(`{"output":"Need integration coverage"}`),
				},
				{
					NodeTitle:    "Broken payload",
					WorkerOutput: []byte(`not-json`),
				},
			},
		},
	})

	want := "\n\n---\n\n## API contract Output\n\n### Draft API\n\nSpec ready\n\n### Review\n\nApproved by critic\n\n---\n\n## Backfill tests Output\n\n### Plan coverage\n\nNeed integration coverage"
	if context != want {
		t.Fatalf("buildSplitDependencyContext = %q, want %q", context, want)
	}
}

func TestBuildSplitChildIssueDescriptionAppendsDependencyContext(t *testing.T) {
	got := buildSplitChildIssueDescription("Existing child issue description", "\n\n---\n\n## API contract Output\n\nSpec ready")
	want := "Existing child issue description\n\n---\n\n## API contract Output\n\nSpec ready"
	if got != want {
		t.Fatalf("buildSplitChildIssueDescription = %q, want %q", got, want)
	}

	got = buildSplitChildIssueDescription("", "\n\n---\n\n## API contract Output\n\nSpec ready")
	want = "\n\n---\n\n## API contract Output\n\nSpec ready"
	if got != want {
		t.Fatalf("buildSplitChildIssueDescription empty = %q, want %q", got, want)
	}
}
