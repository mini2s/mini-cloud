package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestUpdateWorkspaceCascadesRepoRemovalToProjects asserts that removing a
// repo URL from workspace.repos (Settings → Repositories) also detaches it
// from every project in the workspace, so the project page and settings page
// stay consistent.
func TestUpdateWorkspaceCascadesRepoRemovalToProjects(t *testing.T) {
	const url = "https://github.com/multica-ai/cascade-test"

	putRepos := func(repos []map[string]any) {
		w := httptest.NewRecorder()
		req := newRequest("PUT", "/api/workspaces/"+testWorkspaceID, map[string]any{"repos": repos})
		req = withURLParam(req, "id", testWorkspaceID)
		testHandler.UpdateWorkspace(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("UpdateWorkspace repos=%v: %d %s", repos, w.Code, w.Body.String())
		}
	}

	// Add the URL to workspace.repos, then attach it to a project.
	putRepos([]map[string]any{{"url": url}})
	defer putRepos([]map[string]any{})

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/projects?workspace_id="+testWorkspaceID, map[string]any{
		"title": "Cascade test project",
		"resources": []map[string]any{
			{"resource_type": "github_repo", "resource_ref": map[string]any{"url": url}},
		},
	})
	testHandler.CreateProject(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateProject: %d %s", w.Code, w.Body.String())
	}
	var project struct {
		ID string `json:"id"`
	}
	json.NewDecoder(w.Body).Decode(&project)
	defer func() {
		r := newRequest("DELETE", "/api/projects/"+project.ID, nil)
		r = withURLParam(r, "id", project.ID)
		testHandler.DeleteProject(httptest.NewRecorder(), r)
	}()

	listTotal := func() int {
		w := httptest.NewRecorder()
		req := newRequest("GET", "/api/projects/"+project.ID+"/resources", nil)
		req = withURLParam(req, "id", project.ID)
		testHandler.ListProjectResources(w, req)
		var resp struct {
			Total int `json:"total"`
		}
		json.NewDecoder(w.Body).Decode(&resp)
		return resp.Total
	}
	if got := listTotal(); got != 1 {
		t.Fatalf("before cascade: project resources = %d, want 1", got)
	}

	// Remove the URL from workspace.repos → cascade detaches it from projects.
	putRepos([]map[string]any{})

	if got := listTotal(); got != 0 {
		t.Errorf("after cascade: project resources = %d, want 0", got)
	}
}
