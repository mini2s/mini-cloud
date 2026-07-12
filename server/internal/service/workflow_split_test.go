package service

import (
	"reflect"
	"strings"
	"testing"
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
