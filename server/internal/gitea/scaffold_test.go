package gitea

import (
	"context"
	"errors"
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
	if len(f.prot) != 1 || f.prot[0] != "t-7f3c9a1e/wf-11111111/main" {
		t.Errorf("expected main branch protection, got %v", f.prot)
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
