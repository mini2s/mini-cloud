package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/spf13/cobra"

	"github.com/multica-ai/multica/server/internal/cli"
)

var issueWorkflowCmd = &cobra.Command{
	Use:   "workflow <issue-id>",
	Short: "Show the workflow run + node run status tree for an issue (and its descendants)",
	Args:  exactArgs(1),
	RunE:  runIssueWorkflow,
}

func init() {
	issueCmd.AddCommand(issueWorkflowCmd)
	issueWorkflowCmd.Flags().Bool("descendants", false, "Include child/grandchild issues")
	issueWorkflowCmd.Flags().BoolP("json", "j", false, "Output raw JSON")
}

// issueWorkflowResponse mirrors server handler IssueWorkflowTreeResponse.
type issueWorkflowResponse struct {
	Issues []issueWorkflowNode `json:"issues"`
}

type issueWorkflowNode struct {
	IssueID     string            `json:"issue_id"`
	Number      int32             `json:"number"`
	Title       string            `json:"title"`
	Depth       int               `json:"depth"`
	Status      string            `json:"status"`
	WorkflowRun *issueWorkflowRun `json:"workflow_run"`
}

type issueWorkflowRun struct {
	ID       string                 `json:"id"`
	Status   string                 `json:"status"`
	NodeRuns []issueWorkflowNodeRun `json:"node_runs"`
}

type issueWorkflowNodeRun struct {
	NodeID        string                  `json:"node_id"`
	Title         string                  `json:"title"`
	Status        string                  `json:"status"`
	RetryCount    int32                   `json:"retry_count"`
	WorkerID      string                  `json:"worker_id"`
	CriticID      string                  `json:"critic_id"`
	FailureReason string                  `json:"failure_reason"`
	Deliverables  []issueDeliverableState `json:"deliverables"`
}

type issueDeliverableState struct {
	DeliverableID    string `json:"deliverable_id"`
	Title            string `json:"title"`
	SubmissionStatus string `json:"submission_status"`
}

func runIssueWorkflow(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	descendants, _ := cmd.Flags().GetBool("descendants")
	asJSON, _ := cmd.Flags().GetBool("json")

	resp, err := fetchIssueWorkflow(client, args[0], descendants)
	if err != nil {
		return err
	}
	if asJSON {
		return cli.PrintJSON(os.Stdout, resp)
	}
	printWorkflowTree(os.Stdout, resp.Issues)
	return nil
}

// fetchIssueWorkflow calls the daemon workflow-tree endpoint and decodes it.
func fetchIssueWorkflow(client *cli.APIClient, issueID string, descendants bool) (issueWorkflowResponse, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	path := "/api/daemon/issues/" + issueID + "/workflow-tree"
	if descendants {
		path += "?descendants=true"
	}
	var resp issueWorkflowResponse
	if err := client.GetJSON(ctx, path, &resp); err != nil {
		return resp, fmt.Errorf("get workflow tree: %w", err)
	}
	return resp, nil
}

func printWorkflowTree(w io.Writer, issues []issueWorkflowNode) {
	for _, iss := range issues {
		fmt.Fprintf(w, "%s (depth %d) [%s] %s\n", issueKey(iss.Number), iss.Depth, iss.Status, iss.Title)
		if iss.WorkflowRun == nil {
			fmt.Fprintln(w, "  (no workflow run)")
			continue
		}
		fmt.Fprintf(w, "  workflow run: %s\n", iss.WorkflowRun.Status)
		for i, nr := range iss.WorkflowRun.NodeRuns {
			line := fmt.Sprintf("  node %d %q [%s]", i+1, nr.Title, nr.Status)
			if nr.FailureReason != "" {
				line += " failure: " + nr.FailureReason
			}
			fmt.Fprintln(w, line)
			for _, d := range nr.Deliverables {
				st := d.SubmissionStatus
				if st == "" {
					st = "pending"
				}
				fmt.Fprintf(w, "    deliverable: %s [%s]\n", d.Title, st)
			}
		}
	}
}

// issueKey renders an issue number for display. The daemon endpoint does not
// return the project prefix, so use the bare number prefixed with '#'.
func issueKey(number int32) string {
	return fmt.Sprintf("#%d", number)
}
