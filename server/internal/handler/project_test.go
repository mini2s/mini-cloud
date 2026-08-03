package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestCreateProjectRequiresRepository asserts a project cannot be created
// without at least one code repository — requirements iterate on the linked
// repo(s), so a repo-less project would force greenfield work on every
// requirement.
func TestCreateProjectRequiresRepository(t *testing.T) {
	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/projects?workspace_id="+testWorkspaceID, map[string]any{
		"title": "Project with no repo",
	})
	testHandler.CreateProject(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("CreateProject without resources: expected 400, got %d: %s", w.Code, w.Body.String())
	}
}
