package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
	"github.com/spf13/cobra"

	"github.com/multica-ai/multica/server/pkg/protocol"
)

var issueWatchCmd = &cobra.Command{
	Use:   "watch <issue-id>",
	Short: "Watch real-time CSC stream output for an issue",
	Long: "Connects to the server WebSocket endpoint and prints task:stream events " +
		"for the given issue in real time. Useful for observing a CSC-runtime agent " +
		"as it runs. Press Ctrl-C to stop.",
	Args: exactArgs(1),
	RunE: runIssueWatch,
}

func init() {
	issueCmd.AddCommand(issueWatchCmd)
}

func runIssueWatch(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithCancel(cmd.Context())
	defer cancel()

	issueRef, err := resolveIssueRef(ctx, client, args[0])
	if err != nil {
		return fmt.Errorf("resolve issue: %w", err)
	}

	var issue struct {
		WorkspaceID string `json:"workspace_id"`
	}
	if err := client.GetJSON(ctx, "/api/issues/"+issueRef.ID, &issue); err != nil {
		return fmt.Errorf("get issue: %w", err)
	}
	if issue.WorkspaceID == "" {
		return fmt.Errorf("issue has no workspace_id")
	}

	wsURL := strings.Replace(client.BaseURL, "http://", "ws://", 1)
	wsURL = strings.Replace(wsURL, "https://", "wss://", 1)
	wsURL += "/ws?workspace_id=" + issue.WorkspaceID

	header := http.Header{}
	if client.Token != "" {
		header.Set("Authorization", "Bearer "+client.Token)
	}

	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, header)
	if err != nil {
		if resp != nil {
			return fmt.Errorf("dial websocket: %v (status %d)", err, resp.StatusCode)
		}
		return fmt.Errorf("dial websocket: %w", err)
	}
	defer conn.Close()

	fmt.Fprintf(os.Stderr, "Connected. Watching issue %s (workspace %s).\n", issueRef.ID, issue.WorkspaceID)

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sigCh
		cancel()
		conn.Close()
	}()

	for {
		select {
		case <-ctx.Done():
			return nil
		default:
		}

		_ = conn.SetReadDeadline(time.Now().Add(30 * time.Second))
		_, raw, err := conn.ReadMessage()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return fmt.Errorf("read websocket: %w", err)
		}

		var msg protocol.Message
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}
		if msg.Type != protocol.EventTaskStream {
			continue
		}
		var payload protocol.TaskStreamPayload
		if err := json.Unmarshal(msg.Payload, &payload); err != nil {
			continue
		}
		if payload.IssueID != issueRef.ID {
			continue
		}
		printStreamEvent(payload)
	}
}

func printStreamEvent(p protocol.TaskStreamPayload) {
	switch p.Type {
	case "text":
		fmt.Print(p.Content)
	case "thinking":
		fmt.Fprintf(os.Stderr, "\n[thinking] %s\n", p.Content)
	case "tool_use":
		fmt.Fprintf(os.Stderr, "\n[tool_use: %s]\n", p.Tool)
		if p.Input != nil {
			b, _ := json.MarshalIndent(p.Input, "", "  ")
			fmt.Fprintf(os.Stderr, "%s\n", b)
		}
	case "tool_result":
		fmt.Fprintf(os.Stderr, "\n[tool_result: %s]\n", p.Tool)
		if p.Output != "" {
			fmt.Fprintln(os.Stderr, p.Output)
		}
	case "status":
		fmt.Fprintf(os.Stderr, "\n[status] %s\n", p.Status)
	case "error":
		fmt.Fprintf(os.Stderr, "\n[error] %s\n", p.Content)
	case "log":
		fmt.Fprintf(os.Stderr, "\n[%s] %s\n", p.Level, p.Content)
	default:
		if p.Content != "" {
			fmt.Print(p.Content)
		}
	}
}
