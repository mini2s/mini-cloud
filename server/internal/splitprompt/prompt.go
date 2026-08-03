package splitprompt

import (
	"fmt"
	"strings"
)

type Member struct {
	DisplayName string `json:"display_name"`
	Email       string `json:"email"`
}

type Input struct {
	IssueID             string
	NodeRunID           string
	Generation          int32
	DeliverableID       string
	DeliverablePath     string
	ParentTitle         string
	ParentDescription   string
	Members             []Member
	MembersTruncated    bool
	ReviewComment       string
	ReviewedContent     string
	ReviewHeadCommitSHA string
	ReviewTaskPath      string
	FinishInstruction   string
}

// Build returns the single prompt contract used by local-daemon and cs-cloud
// split planners. The planner owns task.md only; issue creation is a server
// materialization concern.
func Build(in Input) string {
	var b strings.Builder
	b.WriteString("You are the split-plan document producer for a Multica workflow.\n\n")
	fmt.Fprintf(&b, "Split plan generation: %d\n", in.Generation)
	fmt.Fprintf(&b, "Workflow node run ID: %s\n", in.NodeRunID)
	if in.IssueID != "" {
		fmt.Fprintf(&b, "Planning issue ID: %s\n", in.IssueID)
	}
	if in.ParentTitle != "" {
		fmt.Fprintf(&b, "Parent issue title: %s\n", in.ParentTitle)
	}
	if strings.TrimSpace(in.ParentDescription) != "" {
		fmt.Fprintf(&b, "\nParent issue description:\n%s\n", strings.TrimSpace(in.ParentDescription))
	}
	if strings.TrimSpace(in.ReviewComment) != "" {
		fmt.Fprintf(&b, "\nThe previous generation was rejected. Apply this review feedback:\n%s\n", strings.TrimSpace(in.ReviewComment))
		if strings.TrimSpace(in.ReviewedContent) != "" {
			fmt.Fprintf(&b, "\nPrevious fixed task.md excerpt:\n```markdown\n%s\n```\n", strings.TrimSpace(in.ReviewedContent))
		}
		if in.ReviewHeadCommitSHA != "" && in.ReviewTaskPath != "" {
			fmt.Fprintf(&b, "\nThe previous plan is immutable input. If the excerpt is insufficient, inspect the full file with `git show %s:%s`.\n", in.ReviewHeadCommitSHA, in.ReviewTaskPath)
		}
	}
	b.WriteString("\nCreate one UTF-8 Markdown document named task.md. Use this exact format for every child task:\n\n")
	b.WriteString("## Task: <title>\nkey: <stable-key>\nassignee: <active member email>\n\n<complete task description>\n\n")
	b.WriteString("When a task has dependencies, add `depends-on: <comma-separated keys>` directly after `assignee`. Omit `depends-on` for independent tasks.\n\n")
	b.WriteString("Keys must be unique. Dependencies must reference keys in this document and must be acyclic. Use only active human workspace members listed below. Do not include workflow_id; the server applies the configured default issue workflow.\n\n")
	if len(in.Members) > 0 {
		b.WriteString("Active human workspace members:\n")
		for _, member := range in.Members {
			fmt.Fprintf(&b, "- %s <%s>\n", strings.TrimSpace(member.DisplayName), strings.TrimSpace(member.Email))
		}
		if in.MembersTruncated {
			b.WriteString("- The roster is truncated; use an email shown above, never guess another member.\n")
		}
		b.WriteString("\n")
	}
	b.WriteString("Hard rules:\n")
	b.WriteString("- Do not create or update issues, comments, statuses, or application code.\n")
	b.WriteString("- Do not use the retired split draft CLI.\n")
	b.WriteString("- Do not submit partial task sets.\n")
	if in.DeliverableID != "" {
		fmt.Fprintf(&b, "- Submit the finished document with `cs-cloud workflow deliverable submit --deliverable %s --file task.md`.\n", in.DeliverableID)
	}
	if in.DeliverablePath != "" {
		fmt.Fprintf(&b, "- The platform-owned repository path is `%s`; the CLI resolves it from the deliverable ID.\n", in.DeliverablePath)
	}
	finish := strings.TrimSpace(in.FinishInstruction)
	if finish == "" {
		finish = "After the deliverable submit command succeeds, exit."
	}
	b.WriteString("- " + finish + "\n")
	return b.String()
}
