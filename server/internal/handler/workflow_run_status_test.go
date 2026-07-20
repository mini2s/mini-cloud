package handler

import "testing"

func TestWorkflowDisplayStatusMapsSplitLifecycleStatuses(t *testing.T) {
	cases := map[string]string{
		"splitting":             "in_progress",
		"awaiting_split_review": "reviewing",
		"split_active":          "in_progress",
	}

	for status, want := range cases {
		if got := workflowDisplayStatus(status); got != want {
			t.Fatalf("workflowDisplayStatus(%q) = %q, want %q", status, got, want)
		}
	}
}
