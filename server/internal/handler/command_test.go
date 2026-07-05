package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/multica-ai/multica/server/internal/middleware"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// withCommandTestWorkspaceCtx injects the workspace+member context that the
// real chi middleware chain would normally set. SendCommand reads workspace
// ID from ctxWorkspaceID; without this the test harness, which calls handlers
// directly, gets "invalid workspace id" on the parseUUIDOrBadRequest call.
func withCommandTestWorkspaceCtx(t *testing.T, req *http.Request) *http.Request {
	t.Helper()
	memberRow, err := testHandler.Queries.GetMemberByUserAndWorkspace(context.Background(), db.GetMemberByUserAndWorkspaceParams{
		UserID:      util.MustParseUUID(testUserID),
		WorkspaceID: util.MustParseUUID(testWorkspaceID),
	})
	if err != nil {
		t.Fatalf("load test member row: %v", err)
	}
	return req.WithContext(middleware.SetMemberContext(req.Context(), testWorkspaceID, memberRow))
}

func TestSendCommand_MissingContextType(t *testing.T) {
	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/commands", map[string]any{
		"user_input": "assign to reviewer",
		"mode":       "command",
	})
	req = withCommandTestWorkspaceCtx(t, req)
	testHandler.SendCommand(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing context_type, got %d: %s", w.Code, w.Body.String())
	}
}

func TestSendCommand_InvalidContextType(t *testing.T) {
	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/commands", map[string]any{
		"context_type": "invalid",
		"user_input":   "assign to reviewer",
		"mode":         "command",
	})
	req = withCommandTestWorkspaceCtx(t, req)
	testHandler.SendCommand(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid context_type, got %d: %s", w.Code, w.Body.String())
	}
}

func TestSendCommand_EmptyInput(t *testing.T) {
	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/commands", map[string]any{
		"context_type": "issue",
		"user_input":   "",
		"mode":         "command",
	})
	req = withCommandTestWorkspaceCtx(t, req)
	testHandler.SendCommand(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty user_input, got %d: %s", w.Code, w.Body.String())
	}
}

func TestSendCommand_InvalidMode(t *testing.T) {
	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/commands", map[string]any{
		"context_type": "issue",
		"user_input":   "assign to reviewer",
		"mode":         "invalid",
	})
	req = withCommandTestWorkspaceCtx(t, req)
	testHandler.SendCommand(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid mode, got %d: %s", w.Code, w.Body.String())
	}
}

func TestSendCommand_ValidRequest(t *testing.T) {
	// Create a dedicated test agent for this test.
	_ = createHandlerTestAgent(t, "SendCommand Valid Agent", nil)

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/commands", map[string]any{
		"context_type": "issue",
		"context_id":   "",
		"user_input":   "assign to @reviewer",
		"mode":         "command",
	})
	req = withCommandTestWorkspaceCtx(t, req)
	testHandler.SendCommand(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var resp CommandResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.TaskID == "" {
		t.Fatal("expected non-empty task_id in response")
	}
	if resp.AgentID == "" {
		t.Fatal("expected non-empty agent_id in response")
	}

	// Clean up the created task.
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM multica_agent_task_queue WHERE id = $1`, resp.TaskID)
	})
}
