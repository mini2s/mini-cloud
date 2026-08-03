//go:build e2eauth

// e2eauth-tagged test: verifies CS_CLOUD_GITEA_CLONE_URL_AUTHED against the real
// multica DB (a real workspace that has gitea_pat + bot_username + a document
// deliverable). Run from the host against the exposed postgres port:
//
//	DATABASE_URL="postgres://root@localhost:5432/multica?sslmode=disable" \
//	  go test -tags=e2eauth -run TestE2EAuthedCloneURL -v ./internal/service/
package service

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestE2EAuthedCloneURL(t *testing.T) {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		t.Skip("DATABASE_URL not set")
	}
	// giteaDeliverableEnv gates on GITEA_BASE_URL but does not contact Gitea.
	if os.Getenv("GITEA_BASE_URL") == "" {
		os.Setenv("GITEA_BASE_URL", "http://gitea:3000")
	}
	if os.Getenv("GITEA_PUBLIC_BASE_URL") == "" {
		os.Setenv("GITEA_PUBLIC_BASE_URL", "http://localhost:23000")
	}
	wsID := os.Getenv("E2E_WORKSPACE_ID")
	if wsID == "" {
		wsID = "6aacc277-8616-44c9-811d-812c7ba19c57" // has gitea_pat + bot_username
	}

	pool, err := pgxpool.New(context.Background(), dbURL)
	if err != nil {
		t.Fatalf("connect db: %v", err)
	}
	defer pool.Close()

	// Pick a real node-run on this workspace that carries a document deliverable.
	var nrID pgtype.UUID
	err = pool.QueryRow(context.Background(), `
		select nr.id
		from multica_workflow_node_run nr
		join multica_workflow_run rr on rr.id = nr.workflow_run_id
		join multica_workflow_node_run_deliverable d on d.workflow_node_run_id = nr.id
		where rr.workspace_id = $1 and d.kind = 'document'
		limit 1`, wsID).Scan(&nrID)
	if err != nil {
		t.Fatalf("find document-deliverable node-run in workspace %s: %v", wsID, err)
	}

	svc := &TaskService{Queries: db.New(pool)}
	task := db.MulticaAgentTaskQueue{WorkflowNodeRunID: nrID}
	env := svc.giteaDeliverableEnv(context.Background(), task)
	if env == nil {
		t.Fatal("giteaDeliverableEnv returned nil — node-run has no document deliverable, or gitea env unset")
	}

	authed := env["CS_CLOUD_GITEA_CLONE_URL_AUTHED"]
	plain := env["CS_CLOUD_GITEA_CLONE_URL"]
	token := env["CS_CLOUD_GITEA_TOKEN"]

	fmt.Printf("\n========== E2E AUTHED CLONE URL (workspace %s) ==========\n", wsID)
	fmt.Printf("CS_CLOUD_GITEA_CLONE_URL        = %s\n", plain)
	fmt.Printf("CS_CLOUD_GITEA_CLONE_URL_AUTHED = %s\n", authed)
	fmt.Printf("CS_CLOUD_GITEA_TOKEN            = %s...(len %d)\n", safePrefix8(token), len(token))
	fmt.Printf("CS_CLOUD_GITEA_OWNER            = %s\n", env["CS_CLOUD_GITEA_OWNER"])
	fmt.Printf("CS_CLOUD_GITEA_REPO             = %s\n", env["CS_CLOUD_GITEA_REPO"])
	fmt.Printf("CS_CLOUD_GITEA_INST_BRANCH      = %s\n", env["CS_CLOUD_GITEA_INST_BRANCH"])
	fmt.Printf("CS_CLOUD_GITEA_NODE_BRANCH      = %s\n", env["CS_CLOUD_GITEA_NODE_BRANCH"])
	fmt.Printf("===========================================================\n")

	if authed == "" {
		t.Fatal("CS_CLOUD_GITEA_CLONE_URL_AUTHED is empty")
	}
	if authed == plain {
		t.Fatalf("AUTHED URL == plain URL (token NOT embedded): %q", authed)
	}
	if !strings.Contains(authed, "@") {
		t.Fatalf("AUTHED URL has no embedded credential (@): %q", authed)
	}
	switch {
	case strings.Contains(authed, "mc-bot-"):
		fmt.Printf("✓ bot username embedded (mc-bot-*): credentials injected into clone URL\n")
	case strings.Contains(authed, "oauth2:"):
		fmt.Printf("✓ oauth2 fallback used (gitea_bot_username not in settings)\n")
	default:
		t.Fatalf("AUTHED URL has no recognizable user prefix: %q", authed)
	}
	fmt.Printf("✓ END-TO-END VERIFIED: real workspace task payload carries authed clone URL\n")
}

func safePrefix8(s string) string {
	if len(s) < 8 {
		return s
	}
	return s[:8]
}
