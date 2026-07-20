package handler

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// TestValidateAssigneePair_RejectsDefaultWorkflow verifies a default (system)
// workflow cannot be bound as an issue's assignee — it is a hidden archive sink
// for non-workflow issues, never a user-selectable workflow.
func TestValidateAssigneePair_RejectsDefaultWorkflow(t *testing.T) {
	if testPool == nil {
		t.Skip("testPool not initialized (no DATABASE_URL)")
	}
	ctx := context.Background()
	suffix := fmt.Sprintf("dw%d", time.Now().UnixNano())

	var wsID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workspace (name, slug, description, issue_prefix)
		VALUES ($1, $2, 'default wf guard test', 'DW') RETURNING id
	`, "DW WS "+suffix, "dw-"+suffix).Scan(&wsID); err != nil {
		t.Fatalf("seed workspace: %v", err)
	}
	t.Cleanup(func() { testPool.Exec(ctx, `DELETE FROM multica_workspace WHERE id = $1`, wsID) })

	var wfID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow (workspace_id, title, status, created_by_type, is_default)
		VALUES ($1, 'Default Archive', 'active', 'system', TRUE) RETURNING id
	`, wsID).Scan(&wfID); err != nil {
		t.Fatalf("seed default workflow: %v", err)
	}
	wfUUID, _ := util.ParseUUID(wfID)

	h := &Handler{Queries: db.New(testPool)}
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	code, msg := h.validateAssigneePair(ctx, req, wsID,
		pgtype.Text{String: "workflow", Valid: true}, wfUUID)
	if code != http.StatusBadRequest {
		t.Fatalf("binding a default workflow: want status %d, got %d (%q)",
			http.StatusBadRequest, code, msg)
	}
}
