package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCreateProjectAllowsMissingRepository(t *testing.T) {
	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/projects?workspace_id="+testWorkspaceID, map[string]any{
		"title": "Project with no repo",
	})
	testHandler.CreateProject(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateProject without resources: expected 201, got %d: %s", w.Code, w.Body.String())
	}
}
