package service

import (
	"fmt"
	"sort"
)

const (
	NodeRunStatusSplitting           = "splitting"
	NodeRunStatusAwaitingSplitReview = "awaiting_split_review"
	NodeRunStatusSplitActive         = "split_active"

	SplitModeBarrier  = "barrier"
	SplitModePipeline = "pipeline"

	SplitTaskStatusDraft     = "draft"
	SplitTaskStatusApproved  = "approved"
	SplitTaskStatusDiscarded = "discarded"
	SplitTaskStatusCreated   = "created"
	SplitTaskStatusRunning   = "running"
	SplitTaskStatusDone      = "done"
	SplitTaskStatusFailed    = "failed"
	SplitTaskStatusCancelled = "cancelled"
	SplitTaskStatusSkipped   = "skipped"
)

type splitTaskPlan struct {
	ID        string
	DependsOn []string
	SortOrder int
	Status    string
}

func validateSplitTaskGraph(tasks []splitTaskPlan) error {
	byID := make(map[string]splitTaskPlan, len(tasks))
	for _, task := range tasks {
		if task.ID == "" {
			return fmt.Errorf("split task has empty id")
		}
		if _, ok := byID[task.ID]; ok {
			return fmt.Errorf("duplicate split task id: %s", task.ID)
		}
		byID[task.ID] = task
	}

	for _, task := range tasks {
		for _, depID := range task.DependsOn {
			if depID == task.ID {
				return fmt.Errorf("cycle detected at split task %s", task.ID)
			}
			if _, ok := byID[depID]; !ok {
				return fmt.Errorf("unknown dependency %s for split task %s", depID, task.ID)
			}
		}
	}

	color := make(map[string]int, len(tasks))
	var visit func(string) error
	visit = func(id string) error {
		switch color[id] {
		case 1:
			return fmt.Errorf("cycle detected at split task %s", id)
		case 2:
			return nil
		}
		color[id] = 1
		for _, depID := range byID[id].DependsOn {
			if err := visit(depID); err != nil {
				return err
			}
		}
		color[id] = 2
		return nil
	}
	for _, task := range tasks {
		if err := visit(task.ID); err != nil {
			return err
		}
	}
	return nil
}

func topologicalSplitTaskIDs(tasks []splitTaskPlan) ([]string, error) {
	if err := validateSplitTaskGraph(tasks); err != nil {
		return nil, err
	}

	byID := make(map[string]splitTaskPlan, len(tasks))
	dependents := make(map[string][]string, len(tasks))
	indegree := make(map[string]int, len(tasks))
	for _, task := range tasks {
		byID[task.ID] = task
		indegree[task.ID] = len(task.DependsOn)
		for _, depID := range task.DependsOn {
			dependents[depID] = append(dependents[depID], task.ID)
		}
	}

	ready := make([]string, 0, len(tasks))
	for _, task := range tasks {
		if indegree[task.ID] == 0 {
			ready = append(ready, task.ID)
		}
	}

	ordered := make([]string, 0, len(tasks))
	for len(ready) > 0 {
		sortSplitTaskIDs(ready, byID)
		id := ready[0]
		ready = ready[1:]
		ordered = append(ordered, id)

		for _, childID := range dependents[id] {
			indegree[childID]--
			if indegree[childID] == 0 {
				ready = append(ready, childID)
			}
		}
	}

	if len(ordered) != len(tasks) {
		return nil, fmt.Errorf("cycle detected in split task graph")
	}
	return ordered, nil
}

func readySplitTaskIDs(tasks []splitTaskPlan, maxConcurrency int) ([]string, error) {
	if maxConcurrency < 1 {
		maxConcurrency = 1
	}
	if err := validateSplitTaskGraph(tasks); err != nil {
		return nil, err
	}

	byID := make(map[string]splitTaskPlan, len(tasks))
	running := 0
	for _, task := range tasks {
		byID[task.ID] = task
		if task.Status == SplitTaskStatusRunning {
			running++
		}
	}
	remainingSlots := maxConcurrency - running
	if remainingSlots <= 0 {
		return []string{}, nil
	}

	ordered, err := topologicalSplitTaskIDs(tasks)
	if err != nil {
		return nil, err
	}
	ready := make([]string, 0, remainingSlots)
	for _, id := range ordered {
		task := byID[id]
		if task.Status != SplitTaskStatusCreated {
			continue
		}
		allDone := true
		for _, depID := range task.DependsOn {
			if byID[depID].Status != SplitTaskStatusDone {
				allDone = false
				break
			}
		}
		if !allDone {
			continue
		}
		ready = append(ready, id)
		if len(ready) == remainingSlots {
			break
		}
	}
	return ready, nil
}

func markBlockedSplitTasksSkipped(tasks []splitTaskPlan) []splitTaskPlan {
	next := make([]splitTaskPlan, len(tasks))
	copy(next, tasks)

	for {
		changed := false
		byID := make(map[string]splitTaskPlan, len(next))
		for _, task := range next {
			byID[task.ID] = task
		}
		for i, task := range next {
			if task.Status != SplitTaskStatusCreated {
				continue
			}
			for _, depID := range task.DependsOn {
				switch byID[depID].Status {
				case SplitTaskStatusFailed, SplitTaskStatusCancelled, SplitTaskStatusSkipped:
					next[i].Status = SplitTaskStatusSkipped
					changed = true
				}
			}
		}
		if !changed {
			return next
		}
	}
}

func resolveSplitStatus(mode string, maxFailures int, tasks []splitTaskPlan) string {
	switch mode {
	case SplitModePipeline:
		for _, task := range tasks {
			if task.Status == SplitTaskStatusDraft || task.Status == SplitTaskStatusApproved {
				return NodeRunStatusSplitActive
			}
		}
		return NodeRunStatusCompleted
	default:
		failures := 0
		for _, task := range tasks {
			switch task.Status {
			case SplitTaskStatusFailed:
				failures++
			case SplitTaskStatusDone, SplitTaskStatusCancelled, SplitTaskStatusSkipped, SplitTaskStatusDiscarded:
				continue
			default:
				return NodeRunStatusSplitActive
			}
		}
		if failures > maxFailures {
			return NodeRunStatusFailed
		}
		return NodeRunStatusCompleted
	}
}

func sortSplitTaskIDs(ids []string, byID map[string]splitTaskPlan) {
	sort.SliceStable(ids, func(i, j int) bool {
		left := byID[ids[i]]
		right := byID[ids[j]]
		if left.SortOrder != right.SortOrder {
			return left.SortOrder < right.SortOrder
		}
		return left.ID < right.ID
	})
}
