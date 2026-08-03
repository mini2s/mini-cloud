package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestUpdateAgent_BuiltinPluginClear_Succeeds pins the fix for the
// "failed to clear plugin_id: no rows in result set" error on built-in
// agents (数智人). Built-in agents have workspace_id IS NULL; the dedicated
// clear queries used to filter on `WHERE id = $1 AND workspace_id = $2`,
// and `workspace_id = NULL` never matches, so the UPDATE hit zero rows and
// sqlc's :one returned pgx.ErrNoRows. The queries now filter on id only,
// matching ClearAgentMcpConfig / ClearAgentThinkingLevel.
func TestUpdateAgent_BuiltinPluginClear_Succeeds(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()

	// canManageAgent requires the global can_manage_workflows flag for
	// built-in agents. Grant it for the test user and restore the original
	// value afterwards.
	var wasAdmin bool
	if err := testPool.QueryRow(ctx,
		`SELECT can_manage_workflows FROM multica_user WHERE id = $1`,
		testUserID,
	).Scan(&wasAdmin); err != nil {
		t.Fatalf("read user workflow-admin flag: %v", err)
	}
	if _, err := testPool.Exec(ctx,
		`UPDATE multica_user SET can_manage_workflows = TRUE WHERE id = $1`,
		testUserID,
	); err != nil {
		t.Fatalf("grant workflow admin: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(ctx,
			`UPDATE multica_user SET can_manage_workflows = $1 WHERE id = $2`,
			wasAdmin, testUserID,
		)
	})

	// Seed a temporary built-in agent (workspace_id NULL, is_builtin TRUE)
	// with both plugin_id and plugin_name bound, mirroring the seeded 数智人
	// from migration 124.
	var agentID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_agent (
			workspace_id, name, description, runtime_mode, runtime_config,
			visibility, max_concurrent_tasks, owner_id, instructions,
			custom_env, custom_args, is_builtin, plugin_id, plugin_name
		)
		VALUES (NULL, $1, '', 'cloud', '{}'::jsonb, 'workspace', 1, $2, '',
		        '{}'::jsonb, '[]'::jsonb, TRUE, $3, $4)
		RETURNING id
	`, "builtin-plugin-clear-test", testUserID, "test-plugin-id", "test-plugin-slug").Scan(&agentID); err != nil {
		t.Fatalf("seed builtin agent: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM multica_agent WHERE id = $1`, agentID)
	})

	// Clear the plugin: empty plugin_id + plugin_name must 200, not 500.
	body := map[string]any{
		"plugin_id":   "",
		"plugin_name": "",
	}
	w := httptest.NewRecorder()
	req := withURLParam(newRequest(http.MethodPatch, "/api/agents/"+agentID, body), "id", agentID)
	testHandler.UpdateAgent(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("clear builtin plugin: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp["plugin_id"] != nil {
		t.Errorf("expected plugin_id cleared in response, got %v", resp["plugin_id"])
	}
	if resp["plugin_name"] != nil {
		t.Errorf("expected plugin_name cleared in response, got %v", resp["plugin_name"])
	}

	// Confirm the DB row is cleared.
	var pluginID, pluginName *string
	if err := testPool.QueryRow(ctx,
		`SELECT plugin_id, plugin_name FROM multica_agent WHERE id = $1`,
		agentID,
	).Scan(&pluginID, &pluginName); err != nil {
		t.Fatalf("query agent: %v", err)
	}
	if pluginID != nil {
		t.Errorf("expected plugin_id NULL in DB, got %q", *pluginID)
	}
	if pluginName != nil {
		t.Errorf("expected plugin_name NULL in DB, got %q", *pluginName)
	}
}
