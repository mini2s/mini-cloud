package gitea

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// fakeScaffold is a recording fake implementing scaffoldAPI.
type fakeScaffold struct {
	orgs  map[string]bool
	repos map[string]bool
	brs   map[string]bool
	files []string
	prot  []string

	createOrgCalls    int
	createRepoCalls   int
	createBranchCalls int

	orgGetErr    error
	orgCreateFn  func(org string) error
	repoCreateFn func(owner, name string) error
}

func newFakeScaffold() *fakeScaffold {
	return &fakeScaffold{
		orgs: map[string]bool{}, repos: map[string]bool{}, brs: map[string]bool{},
	}
}

func (f *fakeScaffold) GetOrg(_ context.Context, org string) (bool, error) {
	if f.orgGetErr != nil {
		return false, f.orgGetErr
	}
	return f.orgs[org], nil
}
func (f *fakeScaffold) CreateOrg(_ context.Context, org, _ string) error {
	f.createOrgCalls++
	if f.orgCreateFn != nil {
		return f.orgCreateFn(org)
	}
	f.orgs[org] = true
	return nil
}
func (f *fakeScaffold) GetRepo(_ context.Context, owner, name string) (bool, error) {
	return f.repos[owner+"/"+name], nil
}
func (f *fakeScaffold) CreateRepo(_ context.Context, owner, name, _ string) error {
	f.createRepoCalls++
	if f.repoCreateFn != nil {
		return f.repoCreateFn(owner, name)
	}
	f.repos[owner+"/"+name] = true
	return nil
}
func (f *fakeScaffold) GetBranch(_ context.Context, owner, repo, branch string) (bool, error) {
	return f.brs[owner+"/"+repo+"/"+branch], nil
}
func (f *fakeScaffold) CreateBranch(_ context.Context, owner, repo, branch, from string) error {
	f.createBranchCalls++
	f.brs[owner+"/"+repo+"/"+branch] = true
	return nil
}
func (f *fakeScaffold) CreateFile(_ context.Context, owner, repo, branch, path, _, _ string) error {
	f.files = append(f.files, owner+"/"+repo+"/"+branch+"/"+path)
	return nil
}
func (f *fakeScaffold) ProtectBranch(_ context.Context, owner, repo, rule string) error {
	f.prot = append(f.prot, owner+"/"+repo+"/"+rule)
	return nil
}

func TestScaffoldRun_CreatesEverything(t *testing.T) {
	f := newFakeScaffold()
	ws := "7f3c9a1e-d4b2-4c8e-9a3f-1b2c3d4e5f6a"
	wf := "11111111-2222-3333-4444-555555555555"
	run := "f3a8b2c1-9d7e-4a2b-8e1f-1234567890ab"

	if _, err := ScaffoldRunDeliverable(context.Background(), f, ScaffoldParams{
		WorkspaceID: ws, WorkflowID: wf, RunID: run,
		WorkflowTitle: "Bug Fix Flow", DefinitionSnapshot: "name: flow\n",
	}); err != nil {
		t.Fatalf("Scaffold: %v", err)
	}
	if !f.orgs["t-7f3c9a1e"] {
		t.Error("org not created")
	}
	if !f.repos["t-7f3c9a1e/wf-11111111"] {
		t.Error("repo not created")
	}
	if !f.brs["t-7f3c9a1e/wf-11111111/inst-f3a8b2c1"] {
		t.Error("inst branch not created")
	}
	if len(f.files) != 1 || f.files[0] != "t-7f3c9a1e/wf-11111111/main/definition.yaml" {
		t.Errorf("expected one seeded definition.yaml on main, got %v", f.files)
	}
	wantProt := map[string]bool{
		"t-7f3c9a1e/wf-11111111/main": true,
	}
	if len(f.prot) != len(wantProt) {
		t.Errorf("expected only main branch protection, got %v", f.prot)
	}
	for _, got := range f.prot {
		if !wantProt[got] {
			t.Errorf("unexpected branch protection %q; all protections: %v", got, f.prot)
		}
	}
}

func TestScaffoldRun_Idempotent(t *testing.T) {
	f := newFakeScaffold()
	// Pre-create everything as if a prior scaffold ran.
	f.orgs["t-7f3c9a1e"] = true
	f.repos["t-7f3c9a1e/wf-11111111"] = true
	f.brs["t-7f3c9a1e/wf-11111111/inst-f3a8b2c1"] = true

	ws := "7f3c9a1e-d4b2-4c8e-9a3f-1b2c3d4e5f6a"
	wf := "11111111-2222-3333-4444-555555555555"
	run := "f3a8b2c1-9d7e-4a2b-8e1f-1234567890ab"

	beforeFiles := len(f.files)
	if _, err := ScaffoldRunDeliverable(context.Background(), f, ScaffoldParams{
		WorkspaceID: ws, WorkflowID: wf, RunID: run, WorkflowTitle: "x",
	}); err != nil {
		t.Fatalf("Scaffold: %v", err)
	}
	// Idempotent: should not re-create the inst branch's seed file when repo+branch already exist.
	if len(f.files) != beforeFiles {
		t.Errorf("expected no new files, got %d new", len(f.files)-beforeFiles)
	}
	if f.createOrgCalls != 0 || f.createRepoCalls != 0 || f.createBranchCalls != 0 {
		t.Errorf("idempotent re-scaffold should not call Create*: org=%d repo=%d branch=%d",
			f.createOrgCalls, f.createRepoCalls, f.createBranchCalls)
	}
	wantProt := map[string]bool{
		"t-7f3c9a1e/wf-11111111/main": true,
	}
	if len(f.prot) != len(wantProt) {
		t.Errorf("idempotent re-scaffold should still ensure protections, got %v", f.prot)
	}
	for _, got := range f.prot {
		if !wantProt[got] {
			t.Errorf("unexpected idempotent protection %q; all protections: %v", got, f.prot)
		}
	}
}

func TestScaffoldRun_OrgCreateFailurePropagates(t *testing.T) {
	f := newFakeScaffold()
	f.orgCreateFn = func(string) error { return errors.New("boom") }
	_, err := ScaffoldRunDeliverable(context.Background(), f, ScaffoldParams{
		WorkspaceID:   "7f3c9a1e-d4b2-4c8e-9a3f-1b2c3d4e5f6a",
		WorkflowID:    "11111111-2222-3333-4444-555555555555",
		RunID:         "f3a8b2c1-9d7e-4a2b-8e1f-1234567890ab",
		WorkflowTitle: "x",
	})
	if err == nil || err.Error() != "create gitea org: boom" {
		t.Fatalf("err = %v", err)
	}
}

func TestScaffoldRun_RepoCreateFailurePropagates(t *testing.T) {
	f := newFakeScaffold()
	f.repoCreateFn = func(string, string) error { return errors.New("repo boom") }
	_, err := ScaffoldRunDeliverable(context.Background(), f, ScaffoldParams{
		WorkspaceID:   "7f3c9a1e-d4b2-4c8e-9a3f-1b2c3d4e5f6a",
		WorkflowID:    "11111111-2222-3333-4444-555555555555",
		RunID:         "f3a8b2c1-9d7e-4a2b-8e1f-1234567890ab",
		WorkflowTitle: "x",
	})
	if err == nil || err.Error() != "create gitea repo: repo boom" {
		t.Fatalf("err = %v", err)
	}
}

func TestScaffoldRun_RepoCreateAlreadyExistsContinues(t *testing.T) {
	f := newFakeScaffold()
	f.repoCreateFn = func(owner, name string) error {
		f.repos[owner+"/"+name] = true
		return ErrAlreadyExists
	}

	res, err := ScaffoldRunDeliverable(context.Background(), f, ScaffoldParams{
		WorkspaceID:        "7f3c9a1e-d4b2-4c8e-9a3f-1b2c3d4e5f6a",
		WorkflowID:         "11111111-2222-3333-4444-555555555555",
		RunID:              "f3a8b2c1-9d7e-4a2b-8e1f-1234567890ab",
		WorkflowTitle:      "x",
		DefinitionSnapshot: "name: flow\n",
	})
	if err != nil {
		t.Fatalf("Scaffold: %v", err)
	}
	if res.Repo != "wf-11111111" || res.InstBranch != "inst-f3a8b2c1" {
		t.Fatalf("result = %+v", res)
	}
	if !f.brs["t-7f3c9a1e/wf-11111111/inst-f3a8b2c1"] {
		t.Fatal("inst branch not created after repo already-exists response")
	}
	if len(f.files) != 0 {
		t.Fatalf("already-existing repo should not be seeded as newly created, got files %v", f.files)
	}
}

func TestScaffoldRun_EmptySnapshotSkipsSeed(t *testing.T) {
	f := newFakeScaffold()
	ws := "7f3c9a1e-d4b2-4c8e-9a3f-1b2c3d4e5f6a"
	wf := "11111111-2222-3333-4444-555555555555"
	run := "f3a8b2c1-9d7e-4a2b-8e1f-1234567890ab"

	if _, err := ScaffoldRunDeliverable(context.Background(), f, ScaffoldParams{
		WorkspaceID: ws, WorkflowID: wf, RunID: run, WorkflowTitle: "x",
		// DefinitionSnapshot intentionally empty.
	}); err != nil {
		t.Fatalf("Scaffold: %v", err)
	}
	if len(f.files) != 0 {
		t.Errorf("expected no seed file when snapshot is empty, got %v", f.files)
	}
	if !f.repos["t-7f3c9a1e/wf-11111111"] || !f.brs["t-7f3c9a1e/wf-11111111/inst-f3a8b2c1"] {
		t.Error("repo + inst branch should still be created with an empty snapshot")
	}
}

func TestScaffoldWorkspaceArchiveRepo_CreatesDefaultRepo(t *testing.T) {
	f := newFakeScaffold()
	ws := "7f3c9a1e-d4b2-4c8e-9a3f-1b2c3d4e5f6a"

	if err := ScaffoldWorkspaceArchiveRepo(context.Background(), f, ws, "Platform Team"); err != nil {
		t.Fatalf("ScaffoldWorkspaceArchiveRepo: %v", err)
	}
	if !f.orgs["t-7f3c9a1e"] {
		t.Error("org not created")
	}
	if !f.repos["t-7f3c9a1e/deliverable-archive"] {
		t.Error("default archive repo not created")
	}
	wantProt := map[string]bool{
		"t-7f3c9a1e/deliverable-archive/main": true,
	}
	if len(f.prot) != len(wantProt) {
		t.Errorf("expected only main branch protection for archive repo, got %v", f.prot)
	}
	for _, got := range f.prot {
		if !wantProt[got] {
			t.Errorf("unexpected archive repo branch protection %q; all protections: %v", got, f.prot)
		}
	}
}

func TestScaffoldWorkspaceArchiveRepo_Idempotent(t *testing.T) {
	f := newFakeScaffold()
	f.orgs["t-7f3c9a1e"] = true
	f.repos["t-7f3c9a1e/deliverable-archive"] = true

	if err := ScaffoldWorkspaceArchiveRepo(context.Background(), f, "7f3c9a1e-d4b2-4c8e-9a3f-1b2c3d4e5f6a", "Platform Team"); err != nil {
		t.Fatalf("ScaffoldWorkspaceArchiveRepo: %v", err)
	}
	if f.createOrgCalls != 0 || f.createRepoCalls != 0 {
		t.Errorf("idempotent archive scaffold should not call create: org=%d repo=%d prot=%v",
			f.createOrgCalls, f.createRepoCalls, f.prot)
	}
	wantProt := map[string]bool{
		"t-7f3c9a1e/deliverable-archive/main": true,
	}
	if len(f.prot) != len(wantProt) {
		t.Errorf("idempotent archive scaffold should still ensure protections, got %v", f.prot)
	}
	for _, got := range f.prot {
		if !wantProt[got] {
			t.Errorf("unexpected idempotent archive protection %q; all protections: %v", got, f.prot)
		}
	}
}

// TestScaffoldRun_RealClientE2E runs the real *Client against a stateful
// httptest Gitea stand-in to verify the orchestration's assumptions (404→not
// found, 201→created, idempotent re-run) match the real client's HTTP behavior.
func TestScaffoldRun_RealClientE2E(t *testing.T) {
	var mu sync.Mutex
	orgs := map[string]bool{}
	repos := map[string]bool{}
	brs := map[string]bool{}
	var files, protections int

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		path := r.URL.Path

		sendStatus := func(code int) { w.WriteHeader(code) }

		switch r.Method {
		case http.MethodGet:
			switch {
			case strings.HasPrefix(path, "/api/v1/repos/") && strings.Contains(path, "/branches/"):
				// GET /api/v1/repos/{owner}/{repo}/branches/{branch}
				parts := strings.Split(path, "/") // ["", api, v1, repos, owner, repo, branches, branch]
				key := parts[4] + "/" + parts[5] + "/" + parts[7]
				if brs[key] {
					sendStatus(http.StatusOK)
				} else {
					sendStatus(http.StatusNotFound)
				}
			case strings.HasPrefix(path, "/api/v1/repos/"):
				// GET /api/v1/repos/{owner}/{repo}
				parts := strings.Split(path, "/")
				if repos[parts[4]+"/"+parts[5]] {
					sendStatus(http.StatusOK)
				} else {
					sendStatus(http.StatusNotFound)
				}
			case strings.HasPrefix(path, "/api/v1/orgs/"):
				// GET /api/v1/orgs/{org}
				org := strings.TrimPrefix(path, "/api/v1/orgs/")
				if orgs[org] {
					sendStatus(http.StatusOK)
				} else {
					sendStatus(http.StatusNotFound)
				}
			default:
				sendStatus(http.StatusNotFound)
			}
		case http.MethodPost:
			var body map[string]any
			if r.Body != nil {
				_ = json.NewDecoder(r.Body).Decode(&body)
			}
			switch {
			case path == "/api/v1/orgs":
				orgs[body["username"].(string)] = true
				sendStatus(http.StatusCreated)
			case strings.HasSuffix(path, "/branch_protections"):
				protections++
				sendStatus(http.StatusCreated)
			case strings.Contains(path, "/contents/"):
				files++
				sendStatus(http.StatusCreated)
			case strings.HasSuffix(path, "/branches"):
				parts := strings.Split(path, "/")
				key := parts[4] + "/" + parts[5] + "/" + body["new_branch_name"].(string)
				brs[key] = true
				sendStatus(http.StatusCreated)
			case strings.Contains(path, "/orgs/") && strings.HasSuffix(path, "/repos"):
				parts := strings.Split(path, "/") // ["", api, v1, orgs, {org}, repos]
				repos[parts[4]+"/"+body["name"].(string)] = true
				sendStatus(http.StatusCreated)
			default:
				sendStatus(http.StatusInternalServerError)
			}
		default:
			sendStatus(http.StatusMethodNotAllowed)
		}
	}))
	defer srv.Close()

	c := NewClient(Config{BaseURL: srv.URL, Token: "admin-tok"})
	params := ScaffoldParams{
		WorkspaceID:        "7f3c9a1e-d4b2-4c8e-9a3f-1b2c3d4e5f6a",
		WorkflowID:         "11111111-2222-3333-4444-555555555555",
		RunID:              "f3a8b2c1-9d7e-4a2b-8e1f-1234567890ab",
		WorkflowTitle:      "Bug Fix Flow",
		DefinitionSnapshot: "name: flow\n",
	}

	res, err := ScaffoldRunDeliverable(context.Background(), c, params)
	if err != nil {
		t.Fatalf("first scaffold: %v", err)
	}
	if res.Owner != "t-7f3c9a1e" || res.Repo != "wf-11111111" || res.InstBranch != "inst-f3a8b2c1" {
		t.Errorf("result = %+v, want owner=t-7f3c9a1e repo=wf-11111111 inst=inst-f3a8b2c1", res)
	}
	if files != 1 {
		t.Errorf("expected 1 seed file, got %d", files)
	}
	if protections != 1 {
		t.Errorf("expected 1 protection rule (main only), got %d", protections)
	}

	// Second call must be idempotent: no new files/branches. Protection calls
	// are repeated intentionally because ProtectBranch is idempotent and repairs
	// repos that predate a new protection rule.
	filesBefore := files
	if _, err := ScaffoldRunDeliverable(context.Background(), c, params); err != nil {
		t.Fatalf("second scaffold: %v", err)
	}
	if files != filesBefore {
		t.Errorf("idempotent re-scaffold created %d new files", files-filesBefore)
	}
	if protections != 2 {
		t.Errorf("second scaffold should re-ensure 1 protection rule, got total %d", protections)
	}
}
