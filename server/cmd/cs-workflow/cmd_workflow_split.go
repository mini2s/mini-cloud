package main

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/multica-ai/multica/server/internal/cli"
)

var workflowCmd = &cobra.Command{
	Use:   "workflow",
	Short: "Work with workflows",
}

var workflowSplitCmd = &cobra.Command{
	Use:   "split",
	Short: "Work with dynamic split nodes",
}

var workflowSplitDraftCmd = &cobra.Command{
	Use:   "draft",
	Short: "Submit split draft tasks from an agent task",
}

var workflowSplitDraftAddCmd = &cobra.Command{
	Use:   "add <node-run-id>",
	Short: "Add or replace one split draft task",
	Args:  exactArgs(1),
	RunE:  runWorkflowSplitDraftAdd,
}

var workflowSplitDraftSubmitCmd = &cobra.Command{
	Use:   "submit <node-run-id>",
	Short: "Submit split draft tasks for review",
	Args:  exactArgs(1),
	RunE:  runWorkflowSplitDraftSubmit,
}

var workflowSplitDraftDeleteCmd = &cobra.Command{
	Use:   "delete <node-run-id> <draft-task-id>",
	Short: "Delete one split draft task",
	Args:  exactArgs(2),
	RunE:  runWorkflowSplitDraftDelete,
}

func init() {
	workflowCmd.AddCommand(workflowSplitCmd)
	workflowSplitCmd.AddCommand(workflowSplitDraftCmd)
	workflowSplitDraftCmd.AddCommand(workflowSplitDraftAddCmd)
	workflowSplitDraftCmd.AddCommand(workflowSplitDraftSubmitCmd)
	workflowSplitDraftCmd.AddCommand(workflowSplitDraftDeleteCmd)
	registerWorkflowSplitDraftAddFlags(workflowSplitDraftAddCmd)
}

func registerWorkflowSplitDraftAddFlags(cmd *cobra.Command) {
	cmd.Flags().String("key", "", "Stable draft key for idempotent retries")
	cmd.Flags().String("title", "", "Draft task title")
	cmd.Flags().String("description", "", "Draft task description")
	cmd.Flags().Bool("description-stdin", false, "Read draft task description from stdin")
	cmd.Flags().String("description-file", "", "Read draft task description from a UTF-8 file")
	cmd.Flags().String("assignee", "", "Suggested assignee as agent:<uuid> or member:<uuid>")
	cmd.Flags().StringSlice("depends-on", nil, "Dependency draft key (repeatable or comma-separated)")
	cmd.Flags().String("output", "json", "Output format: json or table")
}

func parseSplitDraftAssignee(raw string) (string, string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", "", fmt.Errorf("--assignee is required, expected agent:<uuid> or member:<uuid>")
	}
	parts := strings.SplitN(raw, ":", 2)
	if len(parts) != 2 {
		return "", "", fmt.Errorf("--assignee must be agent:<uuid> or member:<uuid>")
	}
	assigneeType := strings.TrimSpace(parts[0])
	assigneeID := strings.TrimSpace(parts[1])
	if assigneeType != "agent" && assigneeType != "member" {
		return "", "", fmt.Errorf("--assignee type must be agent or member")
	}
	if assigneeID == "" {
		return "", "", fmt.Errorf("--assignee id is required")
	}
	return assigneeType, assigneeID, nil
}

func runWorkflowSplitDraftAdd(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	if client.WorkspaceID == "" {
		if _, err := requireWorkspaceID(cmd); err != nil {
			return err
		}
	}

	key, _ := cmd.Flags().GetString("key")
	title, _ := cmd.Flags().GetString("title")
	if strings.TrimSpace(key) == "" {
		return fmt.Errorf("--key is required")
	}
	if strings.TrimSpace(title) == "" {
		return fmt.Errorf("--title is required")
	}
	description, ok, err := resolveTextFlag(cmd, "description")
	if err != nil {
		return err
	}
	if !ok || strings.TrimSpace(description) == "" {
		return fmt.Errorf("--description, --description-stdin, or --description-file is required")
	}
	assignee, _ := cmd.Flags().GetString("assignee")
	assigneeType, assigneeID, err := parseSplitDraftAssignee(assignee)
	if err != nil {
		return err
	}
	dependsOn, _ := cmd.Flags().GetStringSlice("depends-on")

	body := map[string]any{
		"key":                     strings.TrimSpace(key),
		"title":                   strings.TrimSpace(title),
		"description":             description,
		"suggested_assignee_type": assigneeType,
		"suggested_assignee_id":   assigneeID,
		"depends_on_keys":         dependsOn,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	var result map[string]any
	path := "/api/node-runs/" + url.PathEscape(args[0]) + "/split/draft-tasks"
	if err := client.PostJSON(ctx, path, body, &result); err != nil {
		return fmt.Errorf("add split draft task: %w", err)
	}
	output, _ := cmd.Flags().GetString("output")
	if output == "table" {
		fmt.Fprintf(os.Stdout, "Submitted split draft task %s for node run %s\n", key, args[0])
		return nil
	}
	return cli.PrintJSON(os.Stdout, result)
}

func runWorkflowSplitDraftSubmit(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	if client.WorkspaceID == "" {
		if _, err := requireWorkspaceID(cmd); err != nil {
			return err
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	var result map[string]any
	path := "/api/node-runs/" + url.PathEscape(args[0]) + "/split/draft-submit"
	if err := client.PostJSON(ctx, path, map[string]any{}, &result); err != nil {
		return fmt.Errorf("submit split draft tasks: %w", err)
	}
	return cli.PrintJSON(os.Stdout, result)
}

func runWorkflowSplitDraftDelete(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	if client.WorkspaceID == "" {
		if _, err := requireWorkspaceID(cmd); err != nil {
			return err
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	path := "/api/node-runs/" + url.PathEscape(args[0]) + "/split/draft-tasks/" + url.PathEscape(args[1])
	if err := client.DeleteJSON(ctx, path); err != nil {
		return fmt.Errorf("delete split draft task: %w", err)
	}
	fmt.Fprintf(os.Stdout, "Deleted split draft task %s from node run %s\n", args[1], args[0])
	return nil
}
