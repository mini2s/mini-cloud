package splitprompt

import (
	"strings"
	"testing"
)

func TestBuildUsesTaskMarkdownDeliverableContract(t *testing.T) {
	got := Build(Input{
		IssueID: "issue-1", NodeRunID: "node-1", Generation: 2,
		DeliverableID: "delivery-1", DeliverablePath: "nodes/01/task.md",
		Members:       []Member{{DisplayName: "Ada", Email: "ada@example.com"}},
		ReviewComment: "Use fewer tasks", ReviewedContent: "## Task: Old",
		ReviewHeadCommitSHA: "abc123", ReviewTaskPath: "nodes/01/task.md",
	})
	for _, want := range []string{
		"Split plan generation: 2", "## Task: <title>\nkey:", "\nassignee:",
		"ada@example.com", "Use fewer tasks", "Previous fixed task.md excerpt",
		"git show abc123:nodes/01/task.md",
		"cs-cloud workflow deliverable submit --deliverable delivery-1 --file task.md",
		"nodes/01/task.md", "Do not use the retired split draft CLI",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("prompt missing %q:\n%s", want, got)
		}
	}
	for _, forbidden := range []string{"workflow split draft add", "workflow split draft submit", "\n- key:", "\n- assignee:", "\n- depends-on:"} {
		if strings.Contains(got, forbidden) {
			t.Fatalf("prompt contains retired command %q", forbidden)
		}
	}
}

func TestBuildEndsWithRuntimeFinishInstruction(t *testing.T) {
	got := Build(Input{
		DeliverableID:     "delivery-1",
		FinishInstruction: "Run `cs-cloud workflow task complete task-1` and then stop.",
	})
	if !strings.HasSuffix(got, "Run `cs-cloud workflow task complete task-1` and then stop.\n") {
		t.Fatalf("prompt must end with the runtime finish instruction:\n%s", got)
	}
	if strings.Contains(got, "After the deliverable submit command succeeds, stop.") {
		t.Fatal("prompt contains a finish instruction that conflicts with the runtime contract")
	}
}
