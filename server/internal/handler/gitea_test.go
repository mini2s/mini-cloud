package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// seedGiteaSettings writes gitea_pat into the shared test workspace's settings
// JSONB and returns a cleanup that restores the original settings.
func seedGiteaSettings(t *testing.T, pat string) {
	t.Helper()
	ctx := context.Background()
	var orig []byte
	err := testPool.QueryRow(ctx, `SELECT settings FROM multica_workspace WHERE id = $1`, testWorkspaceID).Scan(&orig)
	if err != nil {
		t.Fatalf("read settings: %v", err)
	}
	settingsMap := map[string]any{}
	if len(orig) > 0 {
		_ = json.Unmarshal(orig, &settingsMap)
	}
	if pat != "" {
		settingsMap["gitea_pat"] = pat
	} else {
		delete(settingsMap, "gitea_pat")
	}
	raw, _ := json.Marshal(settingsMap)
	if _, err := testPool.Exec(ctx, `UPDATE multica_workspace SET settings = $1 WHERE id = $2`, raw, testWorkspaceID); err != nil {
		t.Fatalf("write settings: %v", err)
	}
	t.Cleanup(func() {
		if _, err := testPool.Exec(ctx, `UPDATE multica_workspace SET settings = $1 WHERE id = $2`, orig, testWorkspaceID); err != nil {
			t.Errorf("restore workspace settings: %v", err)
		}
	})
}

func TestHandleGiteaCredential_ReturnsPATAndEnvBaseURL(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	seedGiteaSettings(t, "pat-secret")

	t.Setenv("GITEA_BASE_URL", "https://gitea.example.com")

	req := newRequest(http.MethodGet, "/api/gitea/credential", nil)
	req.Header.Set("X-Workspace-ID", testWorkspaceID)
	rec := httptest.NewRecorder()
	testHandler.HandleGiteaCredential(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var out map[string]string
	json.Unmarshal(rec.Body.Bytes(), &out)
	if out["token"] != "pat-secret" {
		t.Errorf("token = %q", out["token"])
	}
	if out["base_url"] != "https://gitea.example.com" {
		t.Errorf("base_url = %q", out["base_url"])
	}
}

func TestHandleGiteaCredential_NotConfigured(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	seedGiteaSettings(t, "") // no PAT

	req := newRequest(http.MethodGet, "/api/gitea/credential", nil)
	req.Header.Set("X-Workspace-ID", testWorkspaceID)
	rec := httptest.NewRecorder()
	testHandler.HandleGiteaCredential(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (no PAT configured)", rec.Code)
	}
}
