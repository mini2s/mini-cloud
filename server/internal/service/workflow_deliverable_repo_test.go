package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/multica-ai/multica/server/internal/coderepo"
	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/gitea"
	"github.com/multica-ai/multica/server/internal/teamnamespace"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// giteaFixture holds the seeded IDs for a single Gitea run-start test. Cleanup
// is registered via t.Cleanup in the seed helper.
type giteaFixture struct {
	pool      *pgxpool.Pool
	workspace pgtype.UUID
	workflow  pgtype.UUID
	node      pgtype.UUID
	run1      pgtype.UUID
	run2      pgtype.UUID // zero-valued when not seeded
}

func seedRuntimeDeliverableRequirement(t *testing.T, pool *pgxpool.Pool, nodeRunID, sourceNodeID pgtype.UUID, kind string) pgtype.UUID {
	t.Helper()
	var requirementID pgtype.UUID
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO multica_workflow_node_run_deliverable (
			workflow_node_run_id, source_deliverable_id, kind, title, description, required, sort_order
		)
		SELECT $1, deliverable.id, deliverable.kind, deliverable.title,
		       deliverable.description, deliverable.required, deliverable.sort_order
		FROM multica_workflow_node_deliverable deliverable
		WHERE deliverable.workflow_node_id = $2 AND deliverable.kind = $3
		ORDER BY deliverable.sort_order, deliverable.id
		LIMIT 1
		RETURNING id
	`, nodeRunID, sourceNodeID, kind).Scan(&requirementID); err != nil {
		t.Fatalf("seed runtime %s deliverable requirement: %v", kind, err)
	}
	return requirementID
}

func seedRuntimeNodeRun(t *testing.T, fix *giteaFixture, runID pgtype.UUID, status string) pgtype.UUID {
	t.Helper()
	var nodeRunID pgtype.UUID
	if err := fix.pool.QueryRow(context.Background(), `
		INSERT INTO multica_workflow_node_run (
			workflow_run_id, workflow_node_id, node_title, status, worker_type, critic_type
		) VALUES ($1, $2, 'Doc Node', $3, 'agent', 'human')
		RETURNING id
	`, runID, fix.node, status).Scan(&nodeRunID); err != nil {
		t.Fatalf("seed runtime node run: %v", err)
	}
	return nodeRunID
}

// seedGiteaFixture inserts a workspace + user + member + workflow + node +
// (optionally) a document deliverable + N workflow_runs, using the canonical
// multica_* table names. All rows are removed via t.Cleanup. Returns the IDs
// needed to call ScaffoldRunDeliverables.
func seedGiteaFixture(t *testing.T, pool *pgxpool.Pool, withDocument bool, numRuns int) *giteaFixture {
	t.Helper()
	ctx := context.Background()
	suffix := fmt.Sprintf("gh-%d-%d", os.Getpid(), time.Now().UnixNano())

	var wsID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workspace (name, slug, description, issue_prefix)
		VALUES ($1, $2, 'gitea scaffold test', 'GH')
		RETURNING id
	`, "Gitea Test WS "+suffix, "gitea-test-"+suffix).Scan(&wsID); err != nil {
		t.Fatalf("seed workspace: %v", err)
	}

	var userID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_user (name, email)
		VALUES ($1, $2)
		RETURNING id
	`, "Gitea Test User "+suffix, "gitea-test-"+suffix+"@multica.ai").Scan(&userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO multica_member (workspace_id, user_id, role)
		VALUES ($1, $2, 'owner')
	`, wsID, userID); err != nil {
		t.Fatalf("seed member: %v", err)
	}

	var wfID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workflow (workspace_id, title, status, max_retries, created_by_type, created_by_id)
		VALUES ($1, 'Gitea Test Workflow', 'active', 3, 'member', $2)
		RETURNING id
	`, wsID, userID).Scan(&wfID); err != nil {
		t.Fatalf("seed workflow: %v", err)
	}

	var nodeID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node (workflow_id, title, worker_type, critic_type, sort_order)
		VALUES ($1, 'Doc Node', 'agent', 'human', 0)
		RETURNING id
	`, wfID).Scan(&nodeID); err != nil {
		t.Fatalf("seed node: %v", err)
	}

	if withDocument {
		if _, err := pool.Exec(ctx, `
			INSERT INTO multica_workflow_node_deliverable (workflow_node_id, kind, title, description, required, sort_order)
			VALUES ($1, 'document', 'Spec Doc', 'the spec', TRUE, 0)
		`, nodeID); err != nil {
			t.Fatalf("seed document deliverable: %v", err)
		}
	}

	fix := &giteaFixture{pool: pool}
	fix.workspace, _ = util.ParseUUID(wsID)
	fix.workflow, _ = util.ParseUUID(wfID)
	fix.node, _ = util.ParseUUID(nodeID)

	for i := 0; i < numRuns; i++ {
		var runID string
		if err := pool.QueryRow(ctx, `
			INSERT INTO multica_workflow_run (
				workflow_id, workspace_id, workflow_title, status, triggered_by_type, triggered_by_id,
				definition_schema_version, definition_snapshot
			)
			VALUES (
				$1, $2, 'Gitea Test Workflow', 'running', 'member', $3, 1,
				jsonb_build_object(
					'schema_version', 1, 'snapshot_origin', 'native',
					'workflow', jsonb_build_object('id', $1::uuid, 'workspace_id', $2::uuid, 'title', 'Gitea Test Workflow', 'is_default', false),
					'nodes', jsonb_build_array(jsonb_build_object('id', $4::uuid, 'title', 'Doc Node', 'sort_order', 0)),
					'edges', '[]'::jsonb, 'stages', '[]'::jsonb, 'roles', '[]'::jsonb, 'deliverables', '[]'::jsonb
				)
			)
			RETURNING id
		`, wfID, wsID, userID, nodeID).Scan(&runID); err != nil {
			t.Fatalf("seed run %d: %v", i, err)
		}
		u, _ := util.ParseUUID(runID)
		if i == 0 {
			fix.run1 = u
		} else if i == 1 {
			fix.run2 = u
		}
	}

	t.Cleanup(func() {
		// FK ON DELETE CASCADE propagates to workflow_node, workflow_run,
		// workflow_node_deliverable, etc.
		pool.Exec(ctx, `DELETE FROM multica_workflow WHERE id = $1`, wfID)
		pool.Exec(ctx, `DELETE FROM multica_member WHERE workspace_id = $1`, wsID)
		pool.Exec(ctx, `DELETE FROM multica_workspace WHERE id = $1`, wsID)
		pool.Exec(ctx, `DELETE FROM multica_user WHERE email = $1`, "gitea-test-"+suffix+"@multica.ai")
	})

	return fix
}

// fakeGiteaServer stands up an httptest.Server emulating the subset of the
// Gitea API that ScaffoldRunDeliverable + ProvisionWorkspaceBot touch. It keeps
// in-memory state of which orgs/repos/branches exist so the real *Client's
// 404→201→200 idempotency expectations hold. Returns the server plus pointers
// to mutable counters (tokens minted, orgs created) the test can assert on.
func fakeGiteaServer(t *testing.T) (srv *httptest.Server, tokensMinted, orgsCreated *int, repoExists func(string) bool, branchExists func(string) bool) {
	t.Helper()
	var mu sync.Mutex
	orgs := map[string]bool{}
	repos := map[string]bool{}
	brs := map[string]bool{}
	tok := 0
	orgCreated := 0

	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		path := r.URL.Path

		switch r.Method {
		case http.MethodGet:
			switch {
			case strings.HasPrefix(path, "/api/v1/repos/") && strings.Contains(path, "/branches/"):
				parts := strings.Split(path, "/") // ["",api,v1,repos,owner,repo,branches,branch]
				key := parts[4] + "/" + parts[5] + "/" + parts[7]
				if brs[key] {
					w.WriteHeader(http.StatusOK)
				} else {
					w.WriteHeader(http.StatusNotFound)
				}
			case strings.HasPrefix(path, "/api/v1/repos/"):
				parts := strings.Split(path, "/")
				if repos[parts[4]+"/"+parts[5]] {
					w.WriteHeader(http.StatusOK)
				} else {
					w.WriteHeader(http.StatusNotFound)
				}
			case strings.HasPrefix(path, "/api/v1/orgs/") && strings.HasSuffix(path, "/teams"):
				org := strings.TrimSuffix(strings.TrimPrefix(path, "/api/v1/orgs/"), "/teams")
				if orgs[org] {
					_ = json.NewEncoder(w).Encode([]map[string]any{{"id": 7, "name": "Owners"}})
				} else {
					w.WriteHeader(http.StatusNotFound)
				}
			case strings.HasPrefix(path, "/api/v1/orgs/"):
				org := strings.TrimPrefix(path, "/api/v1/orgs/")
				if orgs[org] {
					w.WriteHeader(http.StatusOK)
				} else {
					w.WriteHeader(http.StatusNotFound)
				}
			default:
				w.WriteHeader(http.StatusNotFound)
			}
		case http.MethodPost:
			var body map[string]any
			if r.Body != nil {
				_ = json.NewDecoder(r.Body).Decode(&body)
			}
			switch {
			case path == "/api/v1/orgs":
				orgs[body["username"].(string)] = true
				orgCreated++
				w.WriteHeader(http.StatusCreated)
			case path == "/api/v1/admin/users":
				// Real Gitea returns 422 on duplicate; client maps both to nil.
				w.WriteHeader(http.StatusCreated)
			case strings.HasSuffix(path, "/tokens"):
				// POST /api/v1/users/{u}/tokens — bot PAT mint.
				tok++
				w.WriteHeader(http.StatusCreated)
				_ = json.NewEncoder(w).Encode(map[string]string{"sha1": "pat-" + fmt.Sprint(tok)})
			case strings.HasSuffix(path, "/branch_protections"):
				w.WriteHeader(http.StatusCreated)
			case strings.Contains(path, "/contents/"):
				w.WriteHeader(http.StatusCreated)
			case strings.HasSuffix(path, "/branches"):
				parts := strings.Split(path, "/") // ["",api,v1,repos,owner,repo,branches]
				key := parts[4] + "/" + parts[5] + "/" + body["new_branch_name"].(string)
				brs[key] = true
				w.WriteHeader(http.StatusCreated)
			case strings.Contains(path, "/orgs/") && strings.HasSuffix(path, "/repos"):
				parts := strings.Split(path, "/") // ["",api,v1,orgs,{org},repos]
				repos[parts[4]+"/"+body["name"].(string)] = true
				w.WriteHeader(http.StatusCreated)
			default:
				w.WriteHeader(http.StatusInternalServerError)
			}
		case http.MethodPut:
			// PUT /api/v1/orgs/{org}/members/{user} — AddOrgMember.
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, &tok, &orgCreated, func(key string) bool {
			mu.Lock()
			defer mu.Unlock()
			return repos[key]
		}, func(key string) bool {
			mu.Lock()
			defer mu.Unlock()
			return brs[key]
		}
}

// workspaceSettings reads back the settings JSONB for the given workspace.
func workspaceSettings(t *testing.T, pool *pgxpool.Pool, wsID pgtype.UUID) map[string]any {
	t.Helper()
	var raw []byte
	if err := pool.QueryRow(context.Background(),
		`SELECT settings FROM multica_workspace WHERE id = $1`, wsID).Scan(&raw); err != nil {
		t.Fatalf("read workspace settings: %v", err)
	}
	out := map[string]any{}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &out); err != nil {
			t.Fatalf("unmarshal settings %q: %v", string(raw), err)
		}
	}
	return out
}

// TestScaffoldRunDeliverables_DelegatesToTeamNamespace is the main run-start
// behavior test now that direct-Gitea provisioning is removed: against a
// DB-backed workspace with a document deliverable, ScaffoldRunDeliverables
// delegates org/repo/bot provisioning to costrict-web via team-namespace
// (CreateTeam + InitWorkflow) and syncs members — observed via the mock.
func TestScaffoldRunDeliverables_DelegatesToTeamNamespace(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()

	fix := seedGiteaFixture(t, pool, true /*document deliverable*/, 1 /*one run*/)
	seedRuntimeDeliverableRequirement(t, pool, seedRuntimeNodeRun(t, fix, fix.run1, NodeRunStatusPending), fix.node, "document")
	// ensureTeamNamespace resolves the team creator from a member's cs-user
	// subject_id; the base fixture doesn't set one, so seed it.
	if _, err := pool.Exec(context.Background(),
		`UPDATE multica_member SET subject_id = $1 WHERE workspace_id = $2`,
		"usr-owner-"+util.UUIDToString(fix.workspace)[:8], fix.workspace,
	); err != nil {
		t.Fatalf("set member subject_id: %v", err)
	}

	tnSrv, rec := newTeamNamespaceTestServer(t)
	defer tnSrv.Close()
	tnClient := teamnamespace.NewClient(teamnamespace.Config{BaseURL: tnSrv.URL, Token: "svc-token"})

	svc := &WorkflowService{
		Queries:       db.New(pool),
		TeamNamespace: tnClient,
	}

	svc.ScaffoldRunDeliverables(context.Background(), db.MulticaWorkflowRun{
		ID: fix.run1, WorkflowID: fix.workflow, WorkspaceID: fix.workspace,
	})

	rec.mu.Lock()
	initCalled := rec.initCalled
	createTeamCalled := rec.createTeamCalled
	rec.mu.Unlock()
	if !createTeamCalled {
		t.Fatalf("expected CreateTeam to be delegated to team-namespace at run start")
	}
	if !initCalled {
		t.Fatalf("expected InitWorkflow to be delegated to team-namespace at run start")
	}
}

// TestSyncWorkspaceMembers_IncludesOwner asserts the workspace owner is part of
// the team-namespace member sync. workspaceMemberRefs returns the owner
// separately as `creator` (excluded from the member list to satisfy the
// create-team §1.5 contract); syncWorkspaceMembers must re-add them, otherwise
// the owner is the one member never synced into their own workspace's Gitea org.
func TestSyncWorkspaceMembers_IncludesOwner(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()

	fix := seedGiteaFixture(t, pool, false /*no deliverable*/, 0 /*no runs*/)
	ownerSubject := "usr-owner-" + util.UUIDToString(fix.workspace)[:8]
	if _, err := pool.Exec(context.Background(),
		`UPDATE multica_member SET subject_id = $1 WHERE workspace_id = $2`,
		ownerSubject, fix.workspace,
	); err != nil {
		t.Fatalf("set member subject_id: %v", err)
	}

	tnSrv, rec := newTeamNamespaceTestServer(t)
	defer tnSrv.Close()
	tnClient := teamnamespace.NewClient(teamnamespace.Config{BaseURL: tnSrv.URL, Token: "svc-token"})

	svc := &WorkflowService{Queries: db.New(pool), TeamNamespace: tnClient}
	svc.syncWorkspaceMembers(context.Background(), fix.workspace)

	rec.mu.Lock()
	syncReq := rec.lastSyncReq
	syncCalled := rec.syncCalled
	rec.mu.Unlock()
	if !syncCalled {
		t.Fatalf("expected SyncMembers to be called")
	}
	for _, m := range syncReq.AddMembers {
		if m.UserID == ownerSubject {
			return
		}
	}
	t.Fatalf("owner subject %q missing from synced AddMembers %#v", ownerSubject, syncReq.AddMembers)
}

func TestDeliverableRepoNameForWorkflow(t *testing.T) {
	workflowID, _ := util.ParseUUID("11111111-2222-3333-4444-555555555555")

	// The default archive workflow's repo is provisioned by the team-namespace
	// service (and the local mock) as gitea.RepoName of the archive slug — i.e.
	// "wf-deliverable-archive", NOT the bare slug. The wf- prefix is applied by
	// the same WORKFLOW_REPO_PATH_ALGORITHM v2 that names every workflow repo;
	// consumption (upload branch, clone URL) must match or it 404s.
	if got := DeliverableRepoNameForWorkflow(db.MulticaWorkflow{ID: workflowID, IsDefault: true}); got != "wf-deliverable-archive" {
		t.Fatalf("default workflow repo = %q, want wf-deliverable-archive", got)
	}
	if got := DeliverableRepoNameForWorkflow(db.MulticaWorkflow{ID: workflowID}); got != "wf-11111111" {
		t.Fatalf("regular workflow repo = %q, want wf-11111111", got)
	}
}

// TestScaffoldRunDeliverables_NoOpWhenTeamNamespaceNotConfigured verifies the
// dormancy contract: when team-namespace is not configured (no costrict-web
// delegation), run-start must not touch the network or the DB. The function
// returns immediately without panicking on nil clients.
func TestScaffoldRunDeliverables_NoOpWhenTeamNamespaceNotConfigured(t *testing.T) {
	svc := &WorkflowService{} // no TeamNamespace, no Gitea, Queries nil — never dereferenced.

	// If the dormancy gate works, this returns without touching s.Queries.
	// A panic here means the nil check is broken.
	svc.ScaffoldRunDeliverables(context.Background(), db.MulticaWorkflowRun{
		ID: pgtype.UUID{}, WorkflowID: pgtype.UUID{}, WorkspaceID: pgtype.UUID{},
	})
}

// TestScaffoldRunDeliverables_NoOpWhenDeliverableFree verifies that a workflow
// with NO deliverables at all (neither document nor pull_request) skips
// team-namespace delegation entirely: InitWorkflow is not called.
func TestScaffoldRunDeliverables_NoOpWhenDeliverableFree(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()

	// Workflow has a node but NO deliverable row.
	fix := seedGiteaFixture(t, pool, false /*no deliverable*/, 1 /*single run*/)
	tnSrv, rec := newTeamNamespaceTestServer(t)
	defer tnSrv.Close()
	tnClient := teamnamespace.NewClient(teamnamespace.Config{BaseURL: tnSrv.URL, Token: "svc-token"})

	svc := &WorkflowService{
		Queries:       db.New(pool),
		TeamNamespace: tnClient,
	}

	svc.ScaffoldRunDeliverables(context.Background(), db.MulticaWorkflowRun{
		ID: fix.run1, WorkflowID: fix.workflow, WorkspaceID: fix.workspace,
	})

	rec.mu.Lock()
	initCalled := rec.initCalled
	rec.mu.Unlock()
	if initCalled {
		t.Fatalf("deliverable-free workflow triggered InitWorkflow, want skipped")
	}
}

func TestRunDeliverablesRemainStableAfterDefinitionEditAndDelete(t *testing.T) {
	fixture := newWorkflowPrepareFixture(t, true)
	defer fixture.cleanup(t)

	prepared, err := fixture.service.PrepareWorkflowRunSnapshot(fixture.ctx, fixture.workflowID, PrepareWorkflowRunParams{
		TriggeredByType: "member",
		TriggeredByID:   fixture.userID,
	})
	if err != nil {
		t.Fatal(err)
	}
	nodeRuns, err := fixture.service.Queries.ListWorkflowNodeRunsByRun(fixture.ctx, prepared.Run.ID)
	if err != nil || len(nodeRuns) != 1 {
		t.Fatalf("node runs=%d error=%v, want one", len(nodeRuns), err)
	}
	requirements, err := fixture.service.Queries.ListNodeRunDeliverableRequirements(fixture.ctx, nodeRuns[0].ID)
	if err != nil || len(requirements) != 1 {
		t.Fatalf("requirements=%d error=%v, want one", len(requirements), err)
	}
	if _, err := fixture.pool.Exec(fixture.ctx, `
		UPDATE multica_workflow_node_deliverable SET title = 'Changed result'
		WHERE id = $1
	`, requirements[0].SourceDeliverableID); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.pool.Exec(fixture.ctx, `
		DELETE FROM multica_workflow_node_deliverable WHERE id = $1
	`, requirements[0].SourceDeliverableID); err != nil {
		t.Fatal(err)
	}

	requirements, err = fixture.service.Queries.ListNodeRunDeliverableRequirements(fixture.ctx, nodeRuns[0].ID)
	if err != nil || len(requirements) != 1 || requirements[0].Title != "Result" {
		t.Fatalf("runtime requirements=%#v error=%v", requirements, err)
	}
	satisfied, err := fixture.service.requiredDeliverablesSatisfied(fixture.ctx, nodeRuns[0])
	if err != nil {
		t.Fatal(err)
	}
	if satisfied {
		t.Fatal("required deliverables reported satisfied after definition deletion without a submission")
	}
	if _, err := fixture.service.Queries.UpsertNodeRunDeliverableSubmission(fixture.ctx, db.UpsertNodeRunDeliverableSubmissionParams{
		WorkflowNodeRunID: nodeRuns[0].ID,
		DeliverableID:     requirements[0].ID,
		SubmittedByType:   "member",
		SubmittedByID:     fixture.userID,
		Content:           "runtime result",
	}); err != nil {
		t.Fatal(err)
	}
	satisfied, err = fixture.service.requiredDeliverablesSatisfied(fixture.ctx, nodeRuns[0])
	if err != nil || !satisfied {
		t.Fatalf("required deliverables satisfied=%v error=%v, want true", satisfied, err)
	}
}

func TestDeliverableSubmissionRejectsRequirementFromAnotherRun(t *testing.T) {
	fixture := newWorkflowPrepareFixture(t, true)
	defer fixture.cleanup(t)

	prepare := func() (db.MulticaWorkflowNodeRun, db.MulticaWorkflowNodeRunDeliverable) {
		t.Helper()
		prepared, err := fixture.service.PrepareWorkflowRunSnapshot(fixture.ctx, fixture.workflowID, PrepareWorkflowRunParams{
			TriggeredByType: "member", TriggeredByID: fixture.userID,
		})
		if err != nil {
			t.Fatal(err)
		}
		nodeRuns, err := fixture.service.Queries.ListWorkflowNodeRunsByRun(fixture.ctx, prepared.Run.ID)
		if err != nil || len(nodeRuns) != 1 {
			t.Fatalf("node runs=%d error=%v, want one", len(nodeRuns), err)
		}
		requirements, err := fixture.service.Queries.ListNodeRunDeliverableRequirements(fixture.ctx, nodeRuns[0].ID)
		if err != nil || len(requirements) != 1 {
			t.Fatalf("requirements=%d error=%v, want one", len(requirements), err)
		}
		return nodeRuns[0], requirements[0]
	}
	firstNodeRun, _ := prepare()
	_, secondRequirement := prepare()

	_, err := fixture.service.Queries.UpsertNodeRunDeliverableSubmission(fixture.ctx, db.UpsertNodeRunDeliverableSubmissionParams{
		WorkflowNodeRunID: firstNodeRun.ID,
		DeliverableID:     secondRequirement.ID,
		SubmittedByType:   "member",
		SubmittedByID:     fixture.userID,
		Content:           "cross-run submission",
	})
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("cross-run submission error=%v, want pgx.ErrNoRows", err)
	}
	var count int
	if err := fixture.pool.QueryRow(fixture.ctx, `
		SELECT count(*) FROM multica_workflow_node_deliverable_submission
		WHERE workflow_node_run_id = $1
	`, firstNodeRun.ID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("cross-run submission count=%d, want zero", count)
	}
}

// TestProvisionWorkflowRepo_TeamNamespace_CreatesRepoFromWorkflowUUID asserts
// that when the costrict-web (team-namespace) path is configured, provisioning
// an activated deliverable-bearing workflow eagerly creates its repo via
// InitWorkflow keyed on the workflow's UUID — mirroring the run-start
// initWorkflowNamespace defSlug. This is the path the early
// `if teamNamespaceConfigured() { return }` previously short-circuited, leaving
// activation with no repo until the first run.
func TestProvisionWorkflowRepo_TeamNamespace_CreatesRepoFromWorkflowUUID(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()

	fix := seedGiteaFixture(t, pool, true /*document deliverable*/, 0 /*no runs needed at activation*/)

	// ensureTeamNamespace resolves the team creator from a member's cs-user
	// subject_id; the base fixture doesn't set one, so seed it.
	if _, err := pool.Exec(context.Background(),
		`UPDATE multica_member SET subject_id = $1 WHERE workspace_id = $2`,
		"usr-owner-"+util.UUIDToString(fix.workspace)[:8], fix.workspace,
	); err != nil {
		t.Fatalf("set member subject_id: %v", err)
	}

	srv, rec := newTeamNamespaceTestServer(t)
	defer srv.Close()
	tnClient := teamnamespace.NewClient(teamnamespace.Config{
		BaseURL: srv.URL,
		Token:   "svc-token",
		Tenant:  "default",
	})

	svc := &WorkflowService{
		Queries:       db.New(pool),
		TeamNamespace: tnClient,
	}

	svc.ProvisionWorkflowRepo(context.Background(), fix.workflow)

	rec.mu.Lock()
	initCalled := rec.initCalled
	gotReq := rec.lastInitReq
	rec.mu.Unlock()

	if !initCalled {
		t.Fatalf("expected InitWorkflow to be called via team-namespace when provisioning an activated workflow")
	}
	wantSlug := shortHexSafe(util.UUIDToString(fix.workflow))
	if gotReq.WorkflowDefSlug != wantSlug {
		t.Errorf("InitWorkflow WorkflowDefSlug = %q, want %q (workflow UUID prefix)",
			gotReq.WorkflowDefSlug, wantSlug)
	}
	if gotReq.InstanceID != util.UUIDToString(fix.workflow) {
		t.Errorf("InitWorkflow InstanceID = %q, want workflow UUID %q",
			gotReq.InstanceID, util.UUIDToString(fix.workflow))
	}
	if gotReq.TeamID != util.UUIDToString(fix.workspace) {
		t.Errorf("InitWorkflow TeamID = %q, want workspace UUID %q",
			gotReq.TeamID, util.UUIDToString(fix.workspace))
	}
}

// TestProvisionWorkflowRepo_TeamNamespace_CreatesRepoEvenWithoutDeliverables
// asserts that activating a workflow provisions its repo even when the workflow
// has NO deliverable nodes. Provisioning is gated only on team-namespace being
// configured (and the workflow not being the default), not on deliverables — the
// workflow repo is the archive home downstream paths key on regardless.
func TestProvisionWorkflowRepo_TeamNamespace_CreatesRepoEvenWithoutDeliverables(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()

	// No document deliverable seeded: this is the case that used to short-circuit.
	fix := seedGiteaFixture(t, pool, false /*no deliverable*/, 0 /*no runs needed at activation*/)

	// ensureTeamNamespace resolves the team creator from a member's cs-user
	// subject_id; the base fixture doesn't set one, so seed it.
	if _, err := pool.Exec(context.Background(),
		`UPDATE multica_member SET subject_id = $1 WHERE workspace_id = $2`,
		"usr-owner-"+util.UUIDToString(fix.workspace)[:8], fix.workspace,
	); err != nil {
		t.Fatalf("set member subject_id: %v", err)
	}

	srv, rec := newTeamNamespaceTestServer(t)
	defer srv.Close()
	tnClient := teamnamespace.NewClient(teamnamespace.Config{
		BaseURL: srv.URL,
		Token:   "svc-token",
		Tenant:  "default",
	})

	svc := &WorkflowService{
		Queries:       db.New(pool),
		TeamNamespace: tnClient,
	}

	svc.ProvisionWorkflowRepo(context.Background(), fix.workflow)

	rec.mu.Lock()
	initCalled := rec.initCalled
	rec.mu.Unlock()

	if !initCalled {
		t.Fatalf("expected InitWorkflow to be called even when the workflow has no deliverable nodes")
	}
}

func TestEnsureNodeRunBranch_CreatesNodeBranchFromInst(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()

	fix := seedGiteaFixture(t, pool, true /*document deliverable*/, 1 /*single run*/)
	queries := db.New(pool)
	// initWorkflowNamespace (via ensureTeamNamespace) resolves the team creator
	// from a member's cs-user subject_id; the base fixture doesn't set one.
	if _, err := pool.Exec(context.Background(),
		`UPDATE multica_member SET subject_id = $1 WHERE workspace_id = $2`,
		"usr-owner-"+util.UUIDToString(fix.workspace)[:8], fix.workspace,
	); err != nil {
		t.Fatalf("set member subject_id: %v", err)
	}

	var nodeRunID string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO multica_workflow_node_run (
			workflow_run_id, workflow_node_id, node_title, status, worker_type, critic_type
		)
		VALUES ($1, $2, 'Doc Node', 'format_ok', 'agent', 'human')
		RETURNING id
	`, fix.run1, fix.node).Scan(&nodeRunID); err != nil {
		t.Fatalf("seed node run: %v", err)
	}
	nodeRunUUID, _ := util.ParseUUID(nodeRunID)
	seedRuntimeDeliverableRequirement(t, pool, nodeRunUUID, fix.node, "document")
	nodeRun, err := queries.GetWorkflowNodeRun(context.Background(), nodeRunUUID)
	if err != nil {
		t.Fatalf("get node run: %v", err)
	}

	tnSrv, _ := newTeamNamespaceTestServer(t)
	defer tnSrv.Close()
	tnClient := teamnamespace.NewClient(teamnamespace.Config{BaseURL: tnSrv.URL, Token: "svc-token"})
	spy := &spyRepoProvider{configured: true}
	svc := &WorkflowService{
		Queries:            queries,
		TeamNamespace:      tnClient,
		RepositoryProvider: spy,
	}

	if err := svc.ensureNodeRunBranch(context.Background(), nodeRun); err != nil {
		t.Fatalf("ensure node branch: %v", err)
	}

	owner := gitea.OrgName(util.UUIDToString(fix.workspace))
	repo := gitea.RepoName(util.UUIDToString(fix.workflow))
	instBranch := gitea.InstBranch(util.UUIDToString(fix.run1))
	topo, err := RunNodeTopoOrder(context.Background(), queries, fix.run1)
	if err != nil {
		t.Fatalf("runtime node topo: %v", err)
	}
	nodeBranch := gitea.NodeBranch(topo[util.UUIDToString(nodeRun.ID)], nodeRunID)
	want := spyBranchCall{Owner: owner, Repo: repo, Branch: nodeBranch, FromRef: instBranch}
	found := false
	for _, c := range spy.branchCalls() {
		if c == want {
			found = true
		}
	}
	if !found {
		t.Fatalf("node branch %s/%s/%s from %s was not created via provider: %+v",
			owner, repo, nodeBranch, instBranch, spy.branchCalls())
	}
}

// fakeGiteaContentsServer stands up an httptest server that records file writes
// to the Gitea contents API (POST/PUT .../contents/<path>) and returns 201 so
// UpsertFile succeeds on a fresh file. Other requests get a permissive 200 so a
// stray probe does not 500 the client.
func fakeGiteaContentsServer(t *testing.T) (srv *httptest.Server, writtenPaths func() []string) {
	t.Helper()
	var mu sync.Mutex
	var paths []string
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if idx := strings.Index(r.URL.Path, "/contents/"); idx >= 0 && (r.Method == http.MethodPost || r.Method == http.MethodPut) {
			mu.Lock()
			paths = append(paths, r.URL.Path[idx+len("/contents/"):])
			mu.Unlock()
			w.WriteHeader(http.StatusCreated)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)
	return srv, func() []string {
		mu.Lock()
		defer mu.Unlock()
		out := make([]string, len(paths))
		copy(out, paths)
		return out
	}
}

// TestArchiveReviewComment_WritesReviewUnderNodeDir asserts the critic's review
// opinion is archived co-located with the node's deliverables under
// nodes/<NN>-<title>-<short>/reviews/<RR>-<reviewer>-<通过|驳回>.md, with the round
// derived from RetryCount and the verdict word mapped from the decision.
func TestArchiveReviewComment_WritesReviewUnderNodeDir(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()

	fix := seedGiteaFixture(t, pool, true /*document deliverable*/, 1 /*single run*/)
	queries := db.New(pool)
	ctx := context.Background()

	// Give the seeded workspace owner a display name so it resolves as the reviewer.
	var memberID string
	if err := pool.QueryRow(ctx, `
		UPDATE multica_member SET org_display_name = '张三'
		WHERE workspace_id = $1 RETURNING id
	`, fix.workspace).Scan(&memberID); err != nil {
		t.Fatalf("set member display name: %v", err)
	}

	cases := []struct {
		name        string
		retryCount  int32
		decision    string
		wantRound   int
		wantVerdict string
	}{
		// RetryCount is the POST-tx value ArchiveReviewComment sees. approve leaves
		// it unchanged (round = RetryCount+1); the tx has already incremented it on
		// reject (round = RetryCount).
		{"first_review_approved", 0, "approved", 1, "通过"},
		{"first_review_rejected", 1, "rejected", 1, "驳回"},
		{"second_review_approved", 1, "approved", 2, "通过"}, // after one prior reject
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			srv, writtenPaths := fakeGiteaContentsServer(t)
			var nodeRunID string
			if err := pool.QueryRow(ctx, `
				INSERT INTO multica_workflow_node_run (
					workflow_run_id, workflow_node_id, node_title, status,
					worker_type, critic_type, critic_id, retry_count
				)
				VALUES ($1, $2, '需求分析', 'format_ok', 'agent', 'human', $3, $4)
				RETURNING id
			`, fix.run1, fix.node, memberID, c.retryCount).Scan(&nodeRunID); err != nil {
				t.Fatalf("seed node run: %v", err)
			}
			nodeRunUUID, _ := util.ParseUUID(nodeRunID)
			nodeRun, err := queries.GetWorkflowNodeRun(ctx, nodeRunUUID)
			if err != nil {
				t.Fatalf("get node run: %v", err)
			}
			topo, err := RunNodeTopoOrder(ctx, queries, fix.run1)
			if err != nil {
				t.Fatalf("runtime node topo: %v", err)
			}

			svc := &WorkflowService{
				Queries: queries,
				Gitea:   gitea.NewClient(gitea.Config{BaseURL: srv.URL, Token: "admin-tok"}),
			}
			svc.ArchiveReviewComment(ctx, nodeRun, c.decision, "评审意见正文")

			expected := gitea.NodeDir(topo[util.UUIDToString(nodeRun.ID)], nodeRun.NodeTitle, nodeRunID) + "/" +
				gitea.ReviewPath(c.wantRound, "张三", c.wantVerdict)
			got := writtenPaths()
			if len(got) != 1 || got[0] != expected {
				t.Fatalf("archive review write = %v, want exactly [%s]", got, expected)
			}
		})
	}
}

// spyRepoProvider is a coderepo.RepositoryProvider spy that records UpsertFile
// calls (the only method ArchiveCodeDeliverable exercises). Other methods are
// stubbed to no-op so the spy satisfies the interface without a full httptest
// backend. Used by the ArchiveCodeDeliverable test to assert the exact owner,
// repo, branch, path, and content handed to UpsertFile.
type spyRepoProvider struct {
	configured bool
	mu         sync.Mutex
	upserts    []spyUpsertCall
	branches   []spyBranchCall
}

type spyUpsertCall struct {
	Owner, Repo, Branch, Path, Content, Message string
}

type spyBranchCall struct {
	Owner, Repo, Branch, FromRef string
}

func (s *spyRepoProvider) Name() coderepo.Provider { return coderepo.ProviderGitea }
func (s *spyRepoProvider) Configured() bool        { return s.configured }
func (s *spyRepoProvider) CreateBranch(ctx context.Context, owner, repo, branch, fromRef string) error {
	s.mu.Lock()
	s.branches = append(s.branches, spyBranchCall{owner, repo, branch, fromRef})
	s.mu.Unlock()
	return nil
}
func (s *spyRepoProvider) UpsertFile(ctx context.Context, owner, repo, branch, p, content, message string) error {
	s.mu.Lock()
	s.upserts = append(s.upserts, spyUpsertCall{owner, repo, branch, p, content, message})
	s.mu.Unlock()
	return nil
}
func (s *spyRepoProvider) OpenReviewRequest(ctx context.Context, owner, repo, head, base, title string) (string, error) {
	return "", nil
}
func (s *spyRepoProvider) MergeReviewRequest(ctx context.Context, owner, repo string, index int) error {
	return nil
}
func (s *spyRepoProvider) CloseReviewRequest(ctx context.Context, owner, repo string, index int) error {
	return nil
}
func (s *spyRepoProvider) ListOrgMembers(ctx context.Context, org string) ([]coderepo.OrgMember, error) {
	return nil, nil
}

func (s *spyRepoProvider) snapshot() []spyUpsertCall {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]spyUpsertCall, len(s.upserts))
	copy(out, s.upserts)
	return out
}

func (s *spyRepoProvider) branchCalls() []spyBranchCall {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]spyBranchCall, len(s.branches))
	copy(out, s.branches)
	return out
}

// TestArchiveCodeDeliverable_WritesCodePointerUnderNodeDir asserts that a code
// (GitLab MR) deliverable is archived co-located with the node's other artifacts
// under nodes/<NN>-<title>-<short>/code/<deliverableID>.md when a pull_request
// submission arrives. The MR itself stays in GitLab (source of truth); this is
// a best-effort read-only audit copy in the run's Gitea repo. Also covers the
// two no-op paths: empty MR URL and a dormant (not Configured) provider.
func TestArchiveCodeDeliverable_WritesCodePointerUnderNodeDir(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()

	fix := seedGiteaFixture(t, pool, false /*no document deliverable*/, 1 /*single run*/)
	queries := db.New(pool)
	ctx := context.Background()

	// Seed a pull_request-kind deliverable on the node.
	var deliverableID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node_deliverable (workflow_node_id, kind, title, description, required, sort_order)
		VALUES ($1, 'pull_request', 'Source MR', 'the worker code MR', TRUE, 0)
		RETURNING id
	`, fix.node).Scan(&deliverableID); err != nil {
		t.Fatalf("seed pull_request deliverable: %v", err)
	}

	// Seed a node_run under the seeded run.
	var nodeRunID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node_run (
			workflow_run_id, workflow_node_id, node_title, status, worker_type, critic_type
		)
		VALUES ($1, $2, '实现', 'format_ok', 'agent', 'human')
		RETURNING id
	`, fix.run1, fix.node).Scan(&nodeRunID); err != nil {
		t.Fatalf("seed node run: %v", err)
	}
	nodeRunUUID, _ := util.ParseUUID(nodeRunID)
	nodeRun, err := queries.GetWorkflowNodeRun(ctx, nodeRunUUID)
	if err != nil {
		t.Fatalf("get node run: %v", err)
	}
	node, err := queries.GetWorkflowNode(ctx, nodeRun.WorkflowNodeID)
	if err != nil {
		t.Fatalf("get node: %v", err)
	}
	workflow, err := queries.GetWorkflow(ctx, fix.workflow)
	if err != nil {
		t.Fatalf("get workflow: %v", err)
	}
	deliverableUUID, _ := util.ParseUUID(deliverableID)
	deliverable, err := lookupNodeDeliverable(ctx, queries, fix.node, deliverableUUID)
	if err != nil {
		t.Fatalf("get deliverable: %v", err)
	}

	const mrURL = "https://gitlab.example.com/group/proj/-/merge_requests/1"

	// Expected topological position for the node — mirrors the nodeSeq derivation
	// in ArchiveCodeDeliverable (topo first, fall back to sort_order). Computed
	// once outside the sub-tests so the assertion reflects the same path logic.
	wantNodeSeq := int(node.SortOrder)
	if topo, err := NodeTopoOrder(ctx, queries, fix.workflow); err == nil {
		wantNodeSeq = topo[util.UUIDToString(node.ID)]
	}

	t.Run("archives_mr_pointer", func(t *testing.T) {
		spy := &spyRepoProvider{configured: true}
		svc := &WorkflowService{Queries: queries, RepositoryProvider: spy}

		svc.ArchiveCodeDeliverable(ctx, nodeRun, deliverable, mrURL, "", "", "")

		calls := spy.snapshot()
		if len(calls) != 1 {
			t.Fatalf("UpsertFile calls = %d, want 1", len(calls))
		}
		got := calls[0]
		wantOwner := gitea.OrgName(util.UUIDToString(fix.workspace))
		wantRepo := DeliverableRepoNameForWorkflow(workflow)
		wantBranch := gitea.InstBranch(util.UUIDToString(fix.run1))
		if got.Owner != wantOwner || got.Repo != wantRepo || got.Branch != wantBranch {
			t.Errorf(" UpsertFile target = %s/%s @%s, want %s/%s @%s",
				got.Owner, got.Repo, got.Branch, wantOwner, wantRepo, wantBranch)
		}
		// Full path: NodeDir(...) + "/" + CodePath(<deliverableID>).
		wantPath := gitea.NodeDir(wantNodeSeq, nodeRun.NodeTitle, nodeRunID) + "/" +
			gitea.CodePath(deliverableID)
		if got.Path != wantPath {
			t.Errorf("UpsertFile path = %q, want %q", got.Path, wantPath)
		}
		if !strings.Contains(got.Path, "/code/"+deliverableID+".md") {
			t.Errorf("UpsertFile path = %q, want it under code/<deliverableID>.md", got.Path)
		}
		// Content carries the MR URL (the key pointer).
		if !strings.Contains(got.Content, mrURL) {
			t.Errorf("UpsertFile content missing MR URL %q; content=%q", mrURL, got.Content)
		}
	})

	t.Run("noop_when_mr_url_empty", func(t *testing.T) {
		spy := &spyRepoProvider{configured: true}
		svc := &WorkflowService{Queries: queries, RepositoryProvider: spy}

		svc.ArchiveCodeDeliverable(ctx, nodeRun, deliverable, "", "", "", "")

		if calls := spy.snapshot(); len(calls) != 0 {
			t.Fatalf("UpsertFile calls = %d, want 0 (empty MR URL = no-op)", len(calls))
		}
	})

	t.Run("noop_when_provider_dormant", func(t *testing.T) {
		spy := &spyRepoProvider{configured: false}
		svc := &WorkflowService{Queries: queries, RepositoryProvider: spy}

		svc.ArchiveCodeDeliverable(ctx, nodeRun, deliverable, mrURL, "", "", "")

		if calls := spy.snapshot(); len(calls) != 0 {
			t.Fatalf("UpsertFile calls = %d, want 0 (dormant provider = no-op)", len(calls))
		}
	})
}

// lookupNodeDeliverable loads a single deliverable by ID via the list-then-filter
// pattern (sqlc generated no GetWorkflowNodeDeliverable :one query). Returns the
// matching row or an error if not found on the node.
func lookupNodeDeliverable(ctx context.Context, q *db.Queries, nodeID, deliverableID pgtype.UUID) (db.MulticaWorkflowNodeDeliverable, error) {
	deliverables, err := q.ListWorkflowNodeDeliverables(ctx, nodeID)
	if err != nil {
		return db.MulticaWorkflowNodeDeliverable{}, err
	}
	for _, d := range deliverables {
		if d.ID == deliverableID {
			return d, nil
		}
	}
	return db.MulticaWorkflowNodeDeliverable{}, fmt.Errorf("deliverable %s not found on node %s", deliverableID, nodeID)
}

// fakeGiteaMergeServer stands up an httptest server that responds to PR merge
// requests (POST .../pulls/{index}/merge) with the configured status — 200 for
// a successful merge, 409 for a conflict. All other paths get a permissive 200
// so a stray probe (e.g. an idempotency GET) doesn't 500 the client. The
// returned mergeCalls counter lets tests assert the merge actually happened.
func fakeGiteaMergeServer(t *testing.T, mergeStatus int) (srv *httptest.Server, mergeCalls *int) {
	t.Helper()
	var mu sync.Mutex
	calls := 0
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/merge") {
			calls++
			w.WriteHeader(mergeStatus)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)
	return srv, &calls
}

// fakeGitlabMergeServer stands up an httptest.Server emulating the GitLab MR
// merge endpoint. A PUT ending in /merge records a call and returns mergeStatus;
// any other request gets a permissive 200. Returns the merge-call counter.
func fakeGitlabMergeServer(t *testing.T, mergeStatus int) (srv *httptest.Server, mergeCalls *int) {
	t.Helper()
	var mu sync.Mutex
	calls := 0
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if r.Method == http.MethodPut && strings.HasSuffix(r.URL.Path, "/merge") {
			calls++
			w.WriteHeader(mergeStatus)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)
	return srv, &calls
}

// seedNodeRunForReview inserts a workflow_node_run in critic_reviewing for the
// given run+node, plus a document deliverable submission carrying prURL with the
// given status. Returns the new node_run ID. Cleanup rides the fixture's
// workflow cascade (ON DELETE CASCADE through run → node_run → submission).
func seedNodeRunForReview(t *testing.T, pool *pgxpool.Pool, fix *giteaFixture, runID pgtype.UUID, prURL, submissionStatus string) pgtype.UUID {
	t.Helper()
	ctx := context.Background()

	var nodeRunID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node_run (workflow_run_id, workflow_node_id, node_title, status, worker_type, critic_type)
		VALUES ($1, $2, 'Doc Node', 'critic_reviewing', 'agent', 'human')
		RETURNING id
	`, util.UUIDToString(runID), util.UUIDToString(fix.node)).Scan(&nodeRunID); err != nil {
		t.Fatalf("seed node run: %v", err)
	}

	// The document deliverable row is created by seedGiteaFixture (withDocument).
	nrID, _ := util.ParseUUID(nodeRunID)
	deliverableID := seedRuntimeDeliverableRequirement(t, pool, nrID, fix.node, "document")

	if _, err := pool.Exec(ctx, `
		INSERT INTO multica_workflow_node_deliverable_submission (
			workflow_node_run_id, deliverable_id, submitted_by_type, status, content, pull_request_url
		)
		VALUES ($1, $2, 'system', $3, 'draft body', $4)
	`, nodeRunID, deliverableID, submissionStatus, prURL); err != nil {
		t.Fatalf("seed submission: %v", err)
	}
	return nrID
}

// nodeRunStatus reads the status of a workflow_node_run straight from the DB.
func nodeRunStatus(t *testing.T, pool *pgxpool.Pool, nodeRunID pgtype.UUID) string {
	t.Helper()
	var status string
	if err := pool.QueryRow(context.Background(),
		`SELECT status FROM multica_workflow_node_run WHERE id = $1`,
		util.UUIDToString(nodeRunID)).Scan(&status); err != nil {
		t.Fatalf("read node run status: %v", err)
	}
	return status
}

// submissionStatus reads the status of the (single) submission for a node run.
func submissionStatus(t *testing.T, pool *pgxpool.Pool, nodeRunID pgtype.UUID) string {
	t.Helper()
	var status string
	if err := pool.QueryRow(context.Background(),
		`SELECT status FROM multica_workflow_node_deliverable_submission WHERE workflow_node_run_id = $1`,
		util.UUIDToString(nodeRunID)).Scan(&status); err != nil {
		t.Fatalf("read submission status: %v", err)
	}
	return status
}

func TestSubmitWorkerOutput_BlocksMissingRequiredPullRequestDeliverable(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()
	ctx := context.Background()

	fix := seedGiteaFixture(t, pool, false /*no document deliverable*/, 1 /*one run*/)

	if _, err := pool.Exec(ctx, `
		INSERT INTO multica_workflow_node_deliverable (workflow_node_id, kind, title, description, required, sort_order)
		VALUES ($1, 'pull_request', 'Code MR', 'open an MR', TRUE, 0)
	`, util.UUIDToString(fix.node)); err != nil {
		t.Fatalf("seed pull_request deliverable: %v", err)
	}

	var criticID string
	if err := pool.QueryRow(ctx, `
		SELECT user_id FROM multica_member WHERE workspace_id = $1 LIMIT 1
	`, util.UUIDToString(fix.workspace)).Scan(&criticID); err != nil {
		t.Fatalf("seed critic: %v", err)
	}

	var nodeRunID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node_run (workflow_run_id, workflow_node_id, node_title, status, worker_type, critic_type, critic_id)
		VALUES ($1, $2, 'Code Node', 'working', 'agent', 'human', $3)
		RETURNING id
	`, util.UUIDToString(fix.run1), util.UUIDToString(fix.node), criticID).Scan(&nodeRunID); err != nil {
		t.Fatalf("seed node run: %v", err)
	}
	nrID, _ := util.ParseUUID(nodeRunID)
	seedRuntimeDeliverableRequirement(t, pool, nrID, fix.node, "pull_request")

	svc := &WorkflowService{Queries: db.New(pool), TxStarter: pool}
	err := svc.SubmitWorkerOutput(ctx, nrID, json.RawMessage(`{"output":"opened an MR but forgot to submit it"}`))
	if err == nil {
		t.Fatal("SubmitWorkerOutput succeeded without a required pull_request deliverable submission")
	}
	if !strings.Contains(err.Error(), "all required deliverables must be submitted") {
		t.Fatalf("SubmitWorkerOutput error = %q", err)
	}
	if got := nodeRunStatus(t, pool, nrID); got != NodeRunStatusWorking {
		t.Fatalf("node run status = %q, want %q", got, NodeRunStatusWorking)
	}
}

func TestHandleWorkflowTaskCompletion_BlocksMissingRequiredPullRequestDeliverable(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()
	ctx := context.Background()

	fix := seedGiteaFixture(t, pool, false /*no document deliverable*/, 1 /*one run*/)

	if _, err := pool.Exec(ctx, `
		INSERT INTO multica_workflow_node_deliverable (workflow_node_id, kind, title, description, required, sort_order)
		VALUES ($1, 'pull_request', 'Code MR', 'open an MR', TRUE, 0)
	`, util.UUIDToString(fix.node)); err != nil {
		t.Fatalf("seed pull_request deliverable: %v", err)
	}

	var criticID string
	if err := pool.QueryRow(ctx, `
		SELECT user_id FROM multica_member WHERE workspace_id = $1 LIMIT 1
	`, util.UUIDToString(fix.workspace)).Scan(&criticID); err != nil {
		t.Fatalf("seed critic: %v", err)
	}

	var nodeRunID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node_run (workflow_run_id, workflow_node_id, node_title, status, worker_type, critic_type, critic_id)
		VALUES ($1, $2, 'Code Node', 'working', 'agent', 'human', $3)
		RETURNING id
	`, util.UUIDToString(fix.run1), util.UUIDToString(fix.node), criticID).Scan(&nodeRunID); err != nil {
		t.Fatalf("seed node run: %v", err)
	}
	nrID, _ := util.ParseUUID(nodeRunID)
	seedRuntimeDeliverableRequirement(t, pool, nrID, fix.node, "pull_request")

	svc := &WorkflowService{Queries: db.New(pool), TxStarter: pool}
	err := svc.HandleWorkflowTaskCompletion(ctx, db.MulticaAgentTaskQueue{
		WorkflowNodeRunID: nrID,
		Context:           []byte(`{"phase":"worker"}`),
		Result:            []byte(`{"output":"opened an MR but forgot to submit it"}`),
	})
	if err == nil {
		t.Fatal("HandleWorkflowTaskCompletion succeeded without a required pull_request deliverable submission")
	}
	if !strings.Contains(err.Error(), "all required deliverables must be submitted") {
		t.Fatalf("HandleWorkflowTaskCompletion error = %q", err)
	}
	if got := nodeRunStatus(t, pool, nrID); got != NodeRunStatusWorking {
		t.Fatalf("node run status = %q, want %q", got, NodeRunStatusWorking)
	}
}

func TestHandleWorkflowTaskCompletion_AutoSubmitsSinglePullRequestURL(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()
	ctx := context.Background()

	fix := seedGiteaFixture(t, pool, false /*no document deliverable*/, 1 /*one run*/)

	var deliverableID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node_deliverable (workflow_node_id, kind, title, description, required, sort_order)
		VALUES ($1, 'pull_request', 'Code MR', 'open an MR', TRUE, 0)
		RETURNING id
	`, util.UUIDToString(fix.node)).Scan(&deliverableID); err != nil {
		t.Fatalf("seed pull_request deliverable: %v", err)
	}

	var criticID string
	if err := pool.QueryRow(ctx, `
		SELECT user_id FROM multica_member WHERE workspace_id = $1 LIMIT 1
	`, util.UUIDToString(fix.workspace)).Scan(&criticID); err != nil {
		t.Fatalf("seed critic: %v", err)
	}

	var nodeRunID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node_run (workflow_run_id, workflow_node_id, node_title, status, worker_type, critic_type, critic_id)
		VALUES ($1, $2, 'Code Node', 'working', 'agent', 'human', $3)
		RETURNING id
	`, util.UUIDToString(fix.run1), util.UUIDToString(fix.node), criticID).Scan(&nodeRunID); err != nil {
		t.Fatalf("seed node run: %v", err)
	}
	nrID, _ := util.ParseUUID(nodeRunID)
	runtimeDeliverableID := seedRuntimeDeliverableRequirement(t, pool, nrID, fix.node, "pull_request")

	mrURL := "http://gitlab.local/root/repo/-/merge_requests/7"
	svc := &WorkflowService{Queries: db.New(pool), TxStarter: pool}
	err := svc.HandleWorkflowTaskCompletion(ctx, db.MulticaAgentTaskQueue{
		WorkflowNodeRunID: nrID,
		Context:           []byte(`{"phase":"worker"}`),
		Result:            []byte(`{"output":"Opened MR: http://gitlab.local/root/repo/-/merge_requests/7"}`),
	})
	if err != nil {
		t.Fatalf("HandleWorkflowTaskCompletion: %v", err)
	}
	if got := nodeRunStatus(t, pool, nrID); got != NodeRunStatusAwaitingCritic {
		t.Fatalf("node run status = %q, want %q", got, NodeRunStatusAwaitingCritic)
	}

	var status, prURL string
	if err := pool.QueryRow(ctx, `
		SELECT status, pull_request_url
		FROM multica_workflow_node_deliverable_submission
		WHERE workflow_node_run_id = $1 AND deliverable_id = $2
	`, nodeRunID, runtimeDeliverableID).Scan(&status, &prURL); err != nil {
		t.Fatalf("read submission: %v", err)
	}
	if status != "submitted" || prURL != mrURL {
		t.Fatalf("submission = status %q url %q, want submitted %q", status, prURL, mrURL)
	}
}

func TestHandleWorkflowTaskCompletion_CriticOutputFallsBackToReviewComment(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()

	fix := seedGiteaFixture(t, pool, false /*no document deliverable*/, 1 /*single run*/)
	ctx := context.Background()

	var nodeRunID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node_run (
			workflow_run_id, workflow_node_id, node_title, status, worker_type, critic_type
		)
		VALUES ($1, $2, 'Doc Node', $3, 'agent', 'agent')
		RETURNING id
	`, util.UUIDToString(fix.run1), util.UUIDToString(fix.node), NodeRunStatusCriticReviewing).Scan(&nodeRunID); err != nil {
		t.Fatalf("seed node run: %v", err)
	}

	contextJSON, _ := json.Marshal(map[string]any{"phase": "critic"})
	result := json.RawMessage(`{"output":"Looks good from the automated critic."}`)
	svc := &WorkflowService{
		Queries:   db.New(pool),
		TxStarter: pool,
		Bus:       events.New(),
		Gitea:     nil,
	}
	nrID, _ := util.ParseUUID(nodeRunID)
	err := svc.HandleWorkflowTaskCompletion(ctx, db.MulticaAgentTaskQueue{
		WorkflowNodeRunID: nrID,
		Context:           contextJSON,
		Result:            result,
	})
	if err != nil {
		t.Fatalf("HandleWorkflowTaskCompletion: %v", err)
	}

	var status, comment string
	if err := pool.QueryRow(ctx, `
		SELECT status, critic_comment
		FROM multica_workflow_node_run
		WHERE id = $1
	`, nodeRunID).Scan(&status, &comment); err != nil {
		t.Fatalf("read node run: %v", err)
	}
	if status != NodeRunStatusCompleted {
		t.Fatalf("node run status = %q, want %q", status, NodeRunStatusCompleted)
	}
	if comment != "Approved: Looks good from the automated critic." {
		t.Fatalf("critic_comment = %q", comment)
	}
}

func TestNormalizeAgentCriticCommentPrefixesUnstructuredOutput(t *testing.T) {
	if got := normalizeAgentCriticComment(true, "The document exists and the PR is ready."); got != "Approved: The document exists and the PR is ready." {
		t.Fatalf("approved comment = %q", got)
	}
	if got := normalizeAgentCriticComment(false, "Missing required evidence."); got != "Rejected: Missing required evidence." {
		t.Fatalf("rejected comment = %q", got)
	}
	if got := normalizeAgentCriticComment(true, "Approved: looks good"); got != "Approved: looks good" {
		t.Fatalf("already-prefixed comment = %q", got)
	}
}

// TestReviewNodeRun_MergesDocumentDeliverablePRs is the M2 capstone behavior:
// when a critic approves a node run whose workflow has a document deliverable
// (and Gitea is configured), the server merges each document submission's PR
// with the admin token, then completes the node and marks the submission
// approved. The merge runs AFTER the critic_approved tx commits (it can't be
// rolled back), so a tx failure leaves no half-merged state.
func TestReviewNodeRun_MergesDocumentDeliverablePRs(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()

	fix := seedGiteaFixture(t, pool, true /*document deliverable*/, 1 /*one run*/)
	srv, mergeCalls := fakeGiteaMergeServer(t, http.StatusOK)

	svc := &WorkflowService{
		Queries:   db.New(pool),
		TxStarter: pool,
		Bus:       events.New(),
		Gitea:     gitea.NewClient(gitea.Config{BaseURL: srv.URL, Token: "admin-tok"}),
	}
	ctx := context.Background()

	prURL := srv.URL + "/t-abcd1234/wf-deadbeef/pulls/1"
	nodeRunID := seedNodeRunForReview(t, pool, fix, fix.run1, prURL, "submitted")

	if err := svc.ReviewNodeRun(ctx, nodeRunID, true /*approved*/, "lgtm", nil); err != nil {
		t.Fatalf("ReviewNodeRun: %v", err)
	}

	if got := nodeRunStatus(t, pool, nodeRunID); got != NodeRunStatusCompleted {
		t.Fatalf("node run status = %q, want %q", got, NodeRunStatusCompleted)
	}
	if got := submissionStatus(t, pool, nodeRunID); got != "approved" {
		t.Fatalf("submission status = %q, want %q", got, "approved")
	}
	if *mergeCalls != 1 {
		t.Fatalf("merge calls = %d, want exactly 1", *mergeCalls)
	}
}

// TestReviewNodeRun_MergesGitLabMR verifies the M4 GitLab path: a code-only
// workspace (Gitea nil) with a pull_request deliverable whose submission points
// at a GitLab MR. Approve → the MR is merged via the workspace's
// gitlab_access_token (PUT .../merge_requests/{iid}/merge), the node completes,
// and the submission is marked approved.
func TestReviewNodeRun_MergesGitLabMR(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()
	ctx := context.Background()

	fix := seedGiteaFixture(t, pool, false /*no document deliverable*/, 1)

	// Seed a code (pull_request) deliverable on the node.
	var deliverableID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node_deliverable (workflow_node_id, kind, title, required, sort_order)
		VALUES ($1, 'pull_request', 'Code MR', TRUE, 0)
		RETURNING id
	`, util.UUIDToString(fix.node)).Scan(&deliverableID); err != nil {
		t.Fatalf("seed pull_request deliverable: %v", err)
	}
	// Configure the workspace's GitLab PAT (read by gitlabAccessToken).
	if _, err := pool.Exec(ctx, `
		UPDATE multica_workspace
		SET settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{gitlab_access_token}', '"gl-tok-123"')
		WHERE id = $1
	`, util.UUIDToString(fix.workspace)); err != nil {
		t.Fatalf("set gitlab token: %v", err)
	}

	glSrv, mergeCalls := fakeGitlabMergeServer(t, http.StatusOK)
	svc := &WorkflowService{
		Queries:   db.New(pool),
		TxStarter: pool,
		Bus:       events.New(),
		Gitea:     nil, // code-only workspace — Gitea dormant
	}

	// Seed a critic_reviewing node_run + a submission carrying a GitLab MR URL.
	var nodeRunID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node_run (workflow_run_id, workflow_node_id, node_title, status, worker_type, critic_type)
		VALUES ($1, $2, 'Code Node', 'critic_reviewing', 'agent', 'human')
		RETURNING id
	`, util.UUIDToString(fix.run1), util.UUIDToString(fix.node)).Scan(&nodeRunID); err != nil {
		t.Fatalf("seed node run: %v", err)
	}
	mrURL := glSrv.URL + "/root/repo/-/merge_requests/7"
	if _, err := pool.Exec(ctx, `
		INSERT INTO multica_workflow_node_deliverable_submission (
			workflow_node_run_id, deliverable_id, submitted_by_type, status, content, pull_request_url
		)
		VALUES ($1, $2, 'system', 'submitted', 'code body', $3)
	`, nodeRunID, deliverableID, mrURL); err != nil {
		t.Fatalf("seed submission: %v", err)
	}
	nrID, _ := util.ParseUUID(nodeRunID)

	if err := svc.ReviewNodeRun(ctx, nrID, true /*approved*/, "lgtm", nil); err != nil {
		t.Fatalf("ReviewNodeRun: %v", err)
	}
	if got := nodeRunStatus(t, pool, nrID); got != NodeRunStatusCompleted {
		t.Fatalf("node run status = %q, want %q", got, NodeRunStatusCompleted)
	}
	if got := submissionStatus(t, pool, nrID); got != "approved" {
		t.Fatalf("submission status = %q, want %q", got, "approved")
	}
	if *mergeCalls != 1 {
		t.Fatalf("gitlab merge calls = %d, want exactly 1", *mergeCalls)
	}
}

// fakeGiteaCloseServer stands up an httptest.Server that counts PATCH requests
// on a pulls/{n} path (the Gitea close-PR call). Returns the close-call counter.
func fakeGiteaCloseServer(t *testing.T, closeStatus int) (srv *httptest.Server, closeCalls *int) {
	t.Helper()
	var mu sync.Mutex
	calls := 0
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if r.Method == http.MethodPatch && strings.Contains(r.URL.Path, "/pulls/") {
			calls++
			w.WriteHeader(closeStatus)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)
	return srv, &calls
}

// seedReviewSubmissionsNodeRun inserts a critic_reviewing node_run plus two
// submissions: one for deliverableIDDoc (document) with docPRURL, one for
// deliverableIDCode (pull_request) with codeMRURL. Returns the node_run ID.
func seedReviewSubmissionsNodeRun(t *testing.T, pool *pgxpool.Pool, fix *giteaFixture, deliverableIDDoc, deliverableIDCode pgtype.UUID, docPRURL, codeMRURL string) pgtype.UUID {
	t.Helper()
	ctx := context.Background()
	var nodeRunID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node_run (workflow_run_id, workflow_node_id, node_title, status, worker_type, critic_type)
		VALUES ($1, $2, 'Review Node', 'critic_reviewing', 'agent', 'human')
		RETURNING id
	`, util.UUIDToString(fix.run1), util.UUIDToString(fix.node)).Scan(&nodeRunID); err != nil {
		t.Fatalf("seed node run: %v", err)
	}
	for _, s := range []struct {
		deliverable pgtype.UUID
		url         string
	}{
		{deliverableIDDoc, docPRURL},
		{deliverableIDCode, codeMRURL},
	} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO multica_workflow_node_deliverable_submission (
				workflow_node_run_id, deliverable_id, submitted_by_type, status, content, pull_request_url)
			VALUES ($1, $2, 'system', 'submitted', 'body', $3)
		`, nodeRunID, util.UUIDToString(s.deliverable), s.url); err != nil {
			t.Fatalf("seed submission: %v", err)
		}
	}
	nrID, _ := util.ParseUUID(nodeRunID)
	return nrID
}

// TestCloseDeliverableReviewRequests_ClosesDocumentPROnly verifies the M4
// reject-close filter: a document deliverable PR (Gitea) is closed; a code MR
// (pull_request kind, GitLab) is left untouched. The function is best-effort
// (void) — see the _BestEffortOnError companion for failure handling.
func TestCloseDeliverableReviewRequests_ClosesDocumentPROnly(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()
	ctx := context.Background()
	fix := seedGiteaFixture(t, pool, false, 1)

	var docID, codeID string
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workflow_node_deliverable (workflow_node_id, kind, title, required, sort_order) VALUES ($1,'document','Doc',TRUE,0) RETURNING id`, util.UUIDToString(fix.node)).Scan(&docID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workflow_node_deliverable (workflow_node_id, kind, title, required, sort_order) VALUES ($1,'pull_request','Code',TRUE,1) RETURNING id`, util.UUIDToString(fix.node)).Scan(&codeID); err != nil {
		t.Fatal(err)
	}
	docUUID, _ := util.ParseUUID(docID)
	codeUUID, _ := util.ParseUUID(codeID)

	giteaSrv, closeCalls := fakeGiteaCloseServer(t, http.StatusOK)
	glSrv, glCalls := fakeGitlabMergeServer(t, http.StatusOK)
	svc := &WorkflowService{
		Queries:   db.New(pool),
		TxStarter: pool,
		Bus:       events.New(),
		Gitea:     gitea.NewClient(gitea.Config{BaseURL: giteaSrv.URL, Token: "admin"}),
	}

	nrID := seedReviewSubmissionsNodeRun(t, pool, fix, docUUID, codeUUID,
		giteaSrv.URL+"/owner/repo/pulls/5", glSrv.URL+"/root/repo/-/merge_requests/9")

	svc.closeDeliverableReviewRequests(ctx, db.MulticaWorkflowNodeRun{
		ID: nrID, WorkflowRunID: fix.run1, WorkflowNodeID: fix.node,
	})
	if *closeCalls != 1 {
		t.Fatalf("document PR close calls = %d, want 1", *closeCalls)
	}
	if *glCalls != 0 {
		t.Fatalf("gitlab merge/close calls = %d, want 0 (code MR must NOT be touched)", *glCalls)
	}
}

// TestCloseDeliverableReviewRequests_BestEffortOnError verifies a close failure
// (Gitea 500) does not abort the loop or surface — the function is best-effort.
func TestCloseDeliverableReviewRequests_BestEffortOnError(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()
	ctx := context.Background()
	fix := seedGiteaFixture(t, pool, false, 1)

	var docID string
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workflow_node_deliverable (workflow_node_id, kind, title, required, sort_order) VALUES ($1,'document','Doc',TRUE,0) RETURNING id`, util.UUIDToString(fix.node)).Scan(&docID); err != nil {
		t.Fatal(err)
	}

	giteaSrv, closeCalls := fakeGiteaCloseServer(t, http.StatusInternalServerError)
	svc := &WorkflowService{
		Queries:   db.New(pool),
		TxStarter: pool,
		Bus:       events.New(),
		Gitea:     gitea.NewClient(gitea.Config{BaseURL: giteaSrv.URL, Token: "admin"}),
	}
	// Seed only the document submission (a 500 on its close must not abort).
	var nodeRunID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node_run (workflow_run_id, workflow_node_id, node_title, status, worker_type, critic_type)
		VALUES ($1, $2, 'Review Node', 'critic_reviewing', 'agent', 'human')
		RETURNING id
	`, util.UUIDToString(fix.run1), util.UUIDToString(fix.node)).Scan(&nodeRunID); err != nil {
		t.Fatalf("seed node run: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO multica_workflow_node_deliverable_submission (
			workflow_node_run_id, deliverable_id, submitted_by_type, status, content, pull_request_url)
		VALUES ($1, $2, 'system', 'submitted', 'body', $3)
	`, nodeRunID, docID, giteaSrv.URL+"/owner/repo/pulls/5"); err != nil {
		t.Fatalf("seed submission: %v", err)
	}
	nrID, _ := util.ParseUUID(nodeRunID)

	// Must not panic and must return (void); the 500 is logged, not propagated.
	svc.closeDeliverableReviewRequests(ctx, db.MulticaWorkflowNodeRun{
		ID: nrID, WorkflowRunID: fix.run1, WorkflowNodeID: fix.node,
	})
	if *closeCalls != 1 {
		t.Fatalf("close attempts = %d, want 1 (failure must not abort)", *closeCalls)
	}
}

// TestReviewNodeRun_ClosesDocumentPROnReject verifies the M4 reject wiring:
// a critic rejection (retry < MaxRetries) closes the node-run's document
// deliverable PR, and the node transitions to rework (not completed).
func TestReviewNodeRun_ClosesDocumentPROnReject(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()
	ctx := context.Background()
	fix := seedGiteaFixture(t, pool, true /*document deliverable*/, 1)

	giteaSrv, closeCalls := fakeGiteaCloseServer(t, http.StatusOK)
	svc := &WorkflowService{
		Queries:   db.New(pool),
		TxStarter: pool,
		Bus:       events.New(),
		Gitea:     gitea.NewClient(gitea.Config{BaseURL: giteaSrv.URL, Token: "admin"}),
	}
	prURL := giteaSrv.URL + "/owner/repo/pulls/5"
	nodeRunID := seedNodeRunForReview(t, pool, fix, fix.run1, prURL, "submitted")

	if err := svc.ReviewNodeRun(ctx, nodeRunID, false /*rejected*/, "needs work", nil); err != nil {
		t.Fatalf("ReviewNodeRun: %v", err)
	}
	if *closeCalls != 1 {
		t.Fatalf("document PR close calls = %d, want 1 on reject", *closeCalls)
	}
	if got := nodeRunStatus(t, pool, nodeRunID); got == NodeRunStatusCompleted {
		t.Fatalf("node run completed on reject (should be rework/dispatched)")
	}
}

// TestReviewNodeRun_ApproveDoesNotClose is the symmetric regression: approve
// must NOT close the document PR (it merges it instead — covered by the merge
// tests). Asserts the close endpoint is untouched on approve.
func TestReviewNodeRun_ApproveDoesNotClose(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()
	ctx := context.Background()
	fix := seedGiteaFixture(t, pool, true, 1)

	giteaSrv, closeCalls := fakeGiteaCloseServer(t, http.StatusOK)
	svc := &WorkflowService{
		Queries:   db.New(pool),
		TxStarter: pool,
		Bus:       events.New(),
		Gitea:     gitea.NewClient(gitea.Config{BaseURL: giteaSrv.URL, Token: "admin"}),
	}
	// Use a non-merge URL shape so mergeDeliverablePRs finds nothing to merge
	// (the fake server doesn't implement /merge) — we only care that close isn't hit.
	prURL := giteaSrv.URL + "/owner/repo/pulls/5"
	nodeRunID := seedNodeRunForReview(t, pool, fix, fix.run1, prURL, "submitted")

	if err := svc.ReviewNodeRun(ctx, nodeRunID, true /*approved*/, "lgtm", nil); err != nil {
		t.Fatalf("ReviewNodeRun: %v", err)
	}
	if *closeCalls != 0 {
		t.Fatalf("close calls on approve = %d, want 0 (approve merges, never closes)", *closeCalls)
	}
}

// TestReviewNodeRun_BlocksWhenMergeConflicts verifies the failure path: a 409
// (gitea.ErrMergeConflict, terminal) blocks the node run instead of completing
// it. Blocking is NOT an error from ReviewNodeRun — the caller observes the
// blocked status. The submission stays in its pre-merge status (not approved),
// because the merge never succeeded.
func TestReviewNodeRun_BlocksWhenMergeConflicts(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()

	fix := seedGiteaFixture(t, pool, true, 1)
	srv, mergeCalls := fakeGiteaMergeServer(t, http.StatusConflict)

	svc := &WorkflowService{
		Queries:   db.New(pool),
		TxStarter: pool,
		Bus:       events.New(),
		Gitea:     gitea.NewClient(gitea.Config{BaseURL: srv.URL, Token: "admin-tok"}),
	}
	ctx := context.Background()

	prURL := srv.URL + "/t-abcd1234/wf-deadbeef/pulls/1"
	nodeRunID := seedNodeRunForReview(t, pool, fix, fix.run1, prURL, "submitted")

	if err := svc.ReviewNodeRun(ctx, nodeRunID, true /*approved*/, "lgtm", nil); err != nil {
		t.Fatalf("ReviewNodeRun: %v (block must surface as status, not error)", err)
	}

	if got := nodeRunStatus(t, pool, nodeRunID); got != NodeRunStatusBlocked {
		t.Fatalf("node run status = %q, want %q", got, NodeRunStatusBlocked)
	}
	if got := submissionStatus(t, pool, nodeRunID); got != "submitted" {
		t.Fatalf("submission status = %q, want %q (merge failed; do not mark approved)", got, "submitted")
	}
	if *mergeCalls != 1 {
		t.Fatalf("merge calls = %d, want exactly 1 (conflict is terminal, no retry)", *mergeCalls)
	}
}

// TestReviewNodeRun_CompletesWithoutMergeWhenGiteaNil verifies the dormancy
// contract: when Gitea is not configured (nil client), approve behaves exactly
// as before M2 — no merge attempt, the node completes, and the submission is
// left in its submitted status (no PR URL to merge anyway). This keeps the
// feature off for code-only / non-Gitea deployments and for tests that bypass
// the router.
func TestReviewNodeRun_CompletesWithoutMergeWhenGiteaNil(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()

	fix := seedGiteaFixture(t, pool, true, 1)

	svc := &WorkflowService{
		Queries:   db.New(pool),
		TxStarter: pool,
		Bus:       events.New(),
		Gitea:     nil, // feature dormant
	}
	ctx := context.Background()

	// No PR URL — realistic when Gitea is absent (the daemon never opened one).
	nodeRunID := seedNodeRunForReview(t, pool, fix, fix.run1, "", "submitted")

	if err := svc.ReviewNodeRun(ctx, nodeRunID, true /*approved*/, "lgtm", nil); err != nil {
		t.Fatalf("ReviewNodeRun: %v", err)
	}

	if got := nodeRunStatus(t, pool, nodeRunID); got != NodeRunStatusCompleted {
		t.Fatalf("node run status = %q, want %q (dormant: no merge, just complete)", got, NodeRunStatusCompleted)
	}
	if got := submissionStatus(t, pool, nodeRunID); got != "submitted" {
		t.Fatalf("submission status = %q, want %q (dormant: must not touch submissions)", got, "submitted")
	}
}

// subIssueMockDBTX is a focused mock of db.DBTX for ArchiveSubIssueAddress's
// cross-run linkage chain. It routes by SQL comment (sqlc embeds "-- name:
// <QueryName> :one/:many" at the top of every generated SQL string) and by the
// first positional arg where the same query is called with different IDs
// (GetIssue for child vs parent, GetWorkflowNode for split vs non-split).
// Reuses the scan helpers + mockRows types from task_cscloud_push_test.go
// (same package).
type subIssueMockDBTX struct {
	childIssue     db.MulticaIssue
	parentIssue    db.MulticaIssue
	parentRun      db.MulticaWorkflowRun
	parentNodeRuns []db.MulticaWorkflowNodeRun
	splitNode      db.MulticaWorkflowNode
	otherNodes     []db.MulticaWorkflowNode // returned by GetWorkflowNode for non-split IDs + ListWorkflowNodes
	parentWorkflow db.MulticaWorkflow
	workspace      db.MulticaWorkspace
}

func (m *subIssueMockDBTX) Exec(_ context.Context, _ string, _ ...interface{}) (pgconn.CommandTag, error) {
	return pgconn.NewCommandTag(""), nil
}

func (m *subIssueMockDBTX) Query(_ context.Context, sql string, _ ...interface{}) (pgx.Rows, error) {
	switch {
	case strings.Contains(sql, "ListWorkflowNodeRunsByRun"):
		return &mockRowsNodeRuns{rows: m.parentNodeRuns, idx: -1}, nil
	case strings.Contains(sql, "ListWorkflowNodes"):
		nodes := append([]db.MulticaWorkflowNode{m.splitNode}, m.otherNodes...)
		return &mockRowsWorkflowNodes{rows: nodes, idx: -1}, nil
	case strings.Contains(sql, "ListWorkflowEdges"):
		return &mockRowsWorkflowEdges{idx: -1}, nil
	default:
		return nil, fmt.Errorf("subIssueMockDBTX: unexpected Query: %s", sql)
	}
}

func (m *subIssueMockDBTX) QueryRow(_ context.Context, sql string, args ...interface{}) pgx.Row {
	switch {
	case strings.Contains(sql, "GetIssue"):
		if len(args) > 0 {
			if id, ok := args[0].(pgtype.UUID); ok && id == m.parentIssue.ID && m.parentIssue.ID.Valid {
				return &subIssueRow{issue: &m.parentIssue}
			}
		}
		return &subIssueRow{issue: &m.childIssue}
	case strings.Contains(sql, "GetWorkflowRunBySourceIssue"):
		if !m.parentRun.ID.Valid {
			return &subIssueRow{err: pgx.ErrNoRows}
		}
		return &subIssueRow{run: &m.parentRun}
	case strings.Contains(sql, "GetWorkflowNode"):
		if len(args) > 0 {
			if id, ok := args[0].(pgtype.UUID); ok && id == m.splitNode.ID && m.splitNode.ID.Valid {
				return &subIssueRow{node: &m.splitNode}
			}
		}
		if len(m.otherNodes) > 0 {
			return &subIssueRow{node: &m.otherNodes[0]}
		}
		return &subIssueRow{err: pgx.ErrNoRows}
	case strings.Contains(sql, "GetWorkflow "): // "GetWorkflow :one" (not GetWorkflowRun/Node)
		return &subIssueRow{workflow: &m.parentWorkflow}
	case strings.Contains(sql, "GetWorkspace"):
		return &subIssueRow{workspace: &m.workspace}
	default:
		return &subIssueRow{err: fmt.Errorf("subIssueMockDBTX: unexpected QueryRow: %s", sql)}
	}
}

// subIssueRow routes Scan to the correct per-model scan helper (all reused from
// task_cscloud_push_test.go). Exactly one model pointer is non-nil per row.
type subIssueRow struct {
	issue     *db.MulticaIssue
	run       *db.MulticaWorkflowRun
	workflow  *db.MulticaWorkflow
	node      *db.MulticaWorkflowNode
	workspace *db.MulticaWorkspace
	err       error
}

func (r *subIssueRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	switch {
	case r.issue != nil:
		return scanIssueFull(r.issue, dest)
	case r.run != nil:
		return scanWorkflowRun(r.run, dest)
	case r.workflow != nil:
		return scanWorkflow(r.workflow, dest)
	case r.node != nil:
		return scanWorkflowNode(r.node, dest)
	case r.workspace != nil:
		return scanWorkspaceFull(r.workspace, dest)
	}
	return nil
}

// mockRowsNodeRuns is a pgx.Rows yielding MulticaWorkflowNodeRun values, for
// ListWorkflowNodeRunsByRun. Reuses scanNodeRun from task_cscloud_push_test.go.
type mockRowsNodeRuns struct {
	rows []db.MulticaWorkflowNodeRun
	idx  int
}

func (m *mockRowsNodeRuns) Next() bool                                   { m.idx++; return m.idx < len(m.rows) }
func (m *mockRowsNodeRuns) Close()                                       {}
func (m *mockRowsNodeRuns) Err() error                                   { return nil }
func (m *mockRowsNodeRuns) CommandTag() pgconn.CommandTag                { return pgconn.NewCommandTag("") }
func (m *mockRowsNodeRuns) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (m *mockRowsNodeRuns) RawValues() [][]byte                          { return nil }
func (m *mockRowsNodeRuns) Values() ([]any, error)                       { return nil, nil }
func (m *mockRowsNodeRuns) Conn() *pgx.Conn                              { return nil }
func (m *mockRowsNodeRuns) Scan(dest ...any) error {
	r := &m.rows[m.idx]
	return scanNodeRun(r, dest)
}

// newSubIssueMockDBTX builds the happy-path mock: a child issue with a parent,
// the parent's run containing one split node-run, and a workspace with a Gitea
// clone URL. Individual test cases override fields to exercise no-op paths.
func newSubIssueMockDBTX() *subIssueMockDBTX {
	wsID := testUUID(20)
	childIssueID := testUUID(21)
	parentIssueID := testUUID(22)
	parentRunID := testUUID(23)
	parentWFID := testUUID(24)
	splitNodeID := testUUID(25)
	splitNodeRunID := testUUID(26)
	settings, _ := json.Marshal(map[string]any{
		"gitea_clone_url": "https://gitea.example.com/t-202020202020/child.git",
	})
	return &subIssueMockDBTX{
		childIssue: db.MulticaIssue{
			ID:            childIssueID,
			WorkspaceID:   wsID,
			Title:         "登录模块",
			ParentIssueID: parentIssueID,
			Number:        42,
		},
		parentIssue: db.MulticaIssue{
			ID:          parentIssueID,
			WorkspaceID: wsID,
			Title:       "父需求",
		},
		parentRun: db.MulticaWorkflowRun{
			ID:          parentRunID,
			WorkflowID:  parentWFID,
			WorkspaceID: wsID,
		},
		parentNodeRuns: []db.MulticaWorkflowNodeRun{
			{
				ID:             splitNodeRunID,
				WorkflowRunID:  parentRunID,
				WorkflowNodeID: splitNodeID,
				NodeTitle:      "需求拆分",
			},
		},
		splitNode: db.MulticaWorkflowNode{
			ID:           splitNodeID,
			WorkflowID:   parentWFID,
			Title:        "需求拆分",
			FormatSchema: []byte(`{"type":"split"}`),
			SortOrder:    1,
		},
		parentWorkflow: db.MulticaWorkflow{
			ID:          parentWFID,
			WorkspaceID: wsID,
			Title:       "Parent Workflow",
		},
		workspace: db.MulticaWorkspace{
			ID:       wsID,
			Settings: settings,
		},
	}
}

// TestArchiveSubIssueAddress_WritesToParentRepoUnderSplitNode is the happy path:
// a child run whose source issue is a split-out child → the child's
// deliverable-repo address is written into the PARENT issue's Gitea repo, under
// the split node's NodeDir at splits/<childIssueNumber>-<title>.md. The UpsertFile
// target is the parent run's org/repo/inst — NOT the child's.
func TestArchiveSubIssueAddress_WritesToParentRepoUnderSplitNode(t *testing.T) {
	mock := newSubIssueMockDBTX()
	const cloneURL = "https://gitea.example.com/t-202020202020/child.git"

	childRun := db.MulticaWorkflowRun{
		ID:            testUUID(27),
		WorkflowID:    testUUID(28),
		WorkspaceID:   mock.childIssue.WorkspaceID,
		SourceIssueID: mock.childIssue.ID,
	}

	spy := &spyRepoProvider{configured: true}
	svc := &WorkflowService{Queries: db.New(mock), RepositoryProvider: spy}

	svc.ArchiveSubIssueAddress(context.Background(), childRun)

	calls := spy.snapshot()
	if len(calls) != 1 {
		t.Fatalf("UpsertFile calls = %d, want 1", len(calls))
	}
	got := calls[0]

	// Target: PARENT run's repo, NOT the child's.
	wantOwner := gitea.OrgName(util.UUIDToString(mock.parentRun.WorkspaceID))
	wantRepo := DeliverableRepoNameForWorkflow(mock.parentWorkflow)
	wantBranch := gitea.InstBranch(util.UUIDToString(mock.parentRun.ID))
	if got.Owner != wantOwner || got.Repo != wantRepo || got.Branch != wantBranch {
		t.Errorf("UpsertFile target = %s/%s @%s, want %s/%s @%s (PARENT repo)",
			got.Owner, got.Repo, got.Branch, wantOwner, wantRepo, wantBranch)
	}

	// Path: under the split node's NodeDir, with the SplitChildPath suffix.
	if !strings.HasPrefix(got.Path, "nodes/") {
		t.Errorf("path %q must be under nodes/", got.Path)
	}
	if !strings.Contains(got.Path, "/splits/42-") {
		t.Errorf("path %q must contain '/splits/42-' (child issue Number=42)", got.Path)
	}
	if !strings.Contains(got.Path, "需求拆分") {
		t.Errorf("path %q must contain the split node title '需求拆分'", got.Path)
	}

	// Content: carries the child's clone URL + inst branch.
	childInst := gitea.InstBranch(util.UUIDToString(childRun.ID))
	if !strings.Contains(got.Content, cloneURL) {
		t.Errorf("content missing child clone URL %q", cloneURL)
	}
	if !strings.Contains(got.Content, childInst) {
		t.Errorf("content missing child inst branch %q", childInst)
	}
	// Commit message references the child issue number.
	if !strings.Contains(got.Message, "42") {
		t.Errorf("commit message %q must reference child issue Number 42", got.Message)
	}
}

// TestArchiveSubIssueAddress_NoOpCases covers every early-return path: the
// function must never call UpsertFile when the linkage chain can't resolve.
// Each case mutates the base happy-path mock to break one link.
func TestArchiveSubIssueAddress_NoOpCases(t *testing.T) {
	childRun := func(mock *subIssueMockDBTX) db.MulticaWorkflowRun {
		return db.MulticaWorkflowRun{
			ID:            testUUID(27),
			WorkflowID:    testUUID(28),
			WorkspaceID:   mock.childIssue.WorkspaceID,
			SourceIssueID: mock.childIssue.ID,
		}
	}

	cases := []struct {
		name    string
		setup   func(*subIssueMockDBTX)
		runFunc func(*subIssueMockDBTX) db.MulticaWorkflowRun
	}{
		{
			name:  "child_run_source_issue_invalid",
			setup: func(m *subIssueMockDBTX) {},
			runFunc: func(m *subIssueMockDBTX) db.MulticaWorkflowRun {
				r := childRun(m)
				r.SourceIssueID = pgtype.UUID{} // invalid → not a split child
				return r
			},
		},
		{
			name: "child_issue_has_no_parent",
			setup: func(m *subIssueMockDBTX) {
				m.childIssue.ParentIssueID = pgtype.UUID{} // no parent → not a split child
			},
			runFunc: childRun,
		},
		{
			name: "parent_run_has_no_split_node",
			setup: func(m *subIssueMockDBTX) {
				// Make the only node-run point at a non-split node: set its
				// WorkflowNodeID to something that doesn't match splitNode.ID,
				// so GetWorkflowNode returns a non-split node.
				m.parentNodeRuns[0].WorkflowNodeID = testUUID(99)
			},
			runFunc: childRun,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			mock := newSubIssueMockDBTX()
			c.setup(mock)
			spy := &spyRepoProvider{configured: true}
			svc := &WorkflowService{Queries: db.New(mock), RepositoryProvider: spy}

			run := c.runFunc(mock)
			svc.ArchiveSubIssueAddress(context.Background(), run)

			if calls := spy.snapshot(); len(calls) != 0 {
				t.Fatalf("UpsertFile calls = %d, want 0 (no-op path: %s)", len(calls), c.name)
			}
		})
	}

	// Dormant provider: Configured() == false → return before any DB call.
	t.Run("provider_dormant", func(t *testing.T) {
		mock := newSubIssueMockDBTX()
		spy := &spyRepoProvider{configured: false}
		svc := &WorkflowService{Queries: db.New(mock), RepositoryProvider: spy}

		run := childRun(mock)
		svc.ArchiveSubIssueAddress(context.Background(), run)

		if calls := spy.snapshot(); len(calls) != 0 {
			t.Fatalf("UpsertFile calls = %d, want 0 (dormant provider)", len(calls))
		}
	})
}
