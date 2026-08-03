package service

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/internal/util"
)

// TestTransitionWorkingToCritic verifies the in_review side effect: only
// node runs currently in the "working" state get pushed into the critic
// (awaiting_critic) phase with a critic dispatch enqueued; every other status
// (here: pending) is left untouched.
func TestTransitionWorkingToCritic(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()
	ctx := context.Background()
	suffix := fmt.Sprintf("crit-%d-%d", os.Getpid(), time.Now().UnixNano())

	var wsID, userID, memberID string
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workspace (name, slug, description, issue_prefix) VALUES ($1,$2,'','CRT') RETURNING id`, "Critic "+suffix, suffix).Scan(&wsID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO multica_user (name, email) VALUES ('Critic User', $1) RETURNING id`, suffix+"@multica.test").Scan(&userID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO multica_member (workspace_id, user_id, role) VALUES ($1,$2,'owner') RETURNING id`, wsID, userID).Scan(&memberID); err != nil {
		t.Fatal(err)
	}

	var wfID, workingNodeID, pendingNodeID string
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workflow (workspace_id, title, status, max_retries, created_by_type, created_by_id) VALUES ($1,'W','active',3,'member',$2) RETURNING id`, wsID, userID).Scan(&wfID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workflow_node (workflow_id, title, worker_type, worker_id, critic_type, critic_id, sort_order) VALUES ($1,'Working','human',$2,'human',$3,0) RETURNING id`, wfID, memberID, memberID).Scan(&workingNodeID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workflow_node (workflow_id, title, worker_type, worker_id, critic_type, critic_id, sort_order) VALUES ($1,'Pending','human',$2,'human',$3,1) RETURNING id`, wfID, memberID, memberID).Scan(&pendingNodeID); err != nil {
		t.Fatal(err)
	}

	var runID, workingNRID, pendingNRID string
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workflow_run (workflow_id, workspace_id, workflow_title, status, triggered_by_type, triggered_by_id) VALUES ($1,$2,'W','running','member',$3) RETURNING id`, wfID, wsID, memberID).Scan(&runID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workflow_node_run (workflow_run_id, workflow_node_id, node_title, status, retry_count, worker_type, worker_id, critic_type, critic_id) VALUES ($1,$2,'Working','working',0,'human',$3,'human',$4) RETURNING id`, runID, workingNodeID, memberID, memberID).Scan(&workingNRID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workflow_node_run (workflow_run_id, workflow_node_id, node_title, status, retry_count, worker_type, worker_id, critic_type, critic_id) VALUES ($1,$2,'Pending','pending',0,'human',$3,'human',$4) RETURNING id`, runID, pendingNodeID, memberID, memberID).Scan(&pendingNRID); err != nil {
		t.Fatal(err)
	}

	runUUID, _ := util.ParseUUID(runID)
	svc := NewWorkflowService(db.New(pool), pgxTxStarter{pool: pool}, nil, nil)

	if err := svc.TransitionWorkingToCritic(ctx, runUUID); err != nil {
		t.Fatalf("TransitionWorkingToCritic: %v", err)
	}

	// working node run → awaiting_critic
	var workingStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM multica_workflow_node_run WHERE id = $1`, workingNRID).Scan(&workingStatus); err != nil {
		t.Fatal(err)
	}
	if workingStatus != NodeRunStatusAwaitingCritic {
		t.Fatalf("working node run status = %s, want %s", workingStatus, NodeRunStatusAwaitingCritic)
	}

	// pending node run untouched
	var pendingStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM multica_workflow_node_run WHERE id = $1`, pendingNRID).Scan(&pendingStatus); err != nil {
		t.Fatal(err)
	}
	if pendingStatus != NodeRunStatusPending {
		t.Fatalf("pending node run status = %s, want %s (should be untouched)", pendingStatus, NodeRunStatusPending)
	}

	// critic dispatch job enqueued for the working node run only
	var jobCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM multica_workflow_node_run_dispatch_job WHERE workflow_node_run_id = $1 AND phase = 'critic'`, workingNRID).Scan(&jobCount); err != nil {
		t.Fatal(err)
	}
	if jobCount != 1 {
		t.Fatalf("critic dispatch jobs for working node = %d, want 1", jobCount)
	}
	var pendingJobs int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM multica_workflow_node_run_dispatch_job WHERE workflow_node_run_id = $1`, pendingNRID).Scan(&pendingJobs); err != nil {
		t.Fatal(err)
	}
	if pendingJobs != 0 {
		t.Fatalf("dispatch jobs for pending node = %d, want 0 (untouched)", pendingJobs)
	}
}
