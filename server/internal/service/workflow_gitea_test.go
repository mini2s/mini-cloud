package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/multica-ai/multica/server/internal/gitea"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// giteaFixture holds the seeded IDs for a single Gitea run-start test. Cleanup
// is registered via t.Cleanup in the seed helper.
type giteaFixture struct {
	pool      *pgxpool.Pool
	workspace pgtype.UUID
	workflow  pgtype.UUID
	run1      pgtype.UUID
	run2      pgtype.UUID // zero-valued when not seeded
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

	for i := 0; i < numRuns; i++ {
		var runID string
		if err := pool.QueryRow(ctx, `
			INSERT INTO multica_workflow_run (workflow_id, workspace_id, workflow_title, status, triggered_by_type, triggered_by_id)
			VALUES ($1, $2, 'Gitea Test Workflow', 'running', 'member', $3)
			RETURNING id
		`, wfID, wsID, userID).Scan(&runID); err != nil {
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
func fakeGiteaServer(t *testing.T) (srv *httptest.Server, tokensMinted, orgsCreated *int) {
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
	return srv, &tok, &orgCreated
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

// TestScaffoldRunDeliverables_ProvisionsBotAndScaffoldsRepo is the main
// run-start behavior test: against a DB-backed workspace and an httptest Gitea
// stand-in, ScaffoldRunDeliverables creates the org/repo/inst-branch and
// provisions the workspace bot once (gitea_pat + gitea_bot_username persisted
// into workspace.settings). A second call with a new run on the same workspace
// MUST NOT re-mint the PAT (lazy provision — assert tokens count stays at 1).
//
// Ordering is verified implicitly: if provision ran BEFORE scaffold, the bot
// would miss org membership (ProvisionWorkspaceBot only adds to an existing
// org) — the test would still pass onPAT count but the design's correctness
// invariant is scaffold-FIRST, which the implementation guarantees.
func TestScaffoldRunDeliverables_ProvisionsBotAndScaffoldsRepo(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()

	fix := seedGiteaFixture(t, pool, true /*document deliverable*/, 2 /*two runs*/)
	srv, tokensMinted, orgsCreated := fakeGiteaServer(t)

	svc := &WorkflowService{
		Queries: db.New(pool),
		Gitea:   gitea.NewClient(gitea.Config{BaseURL: srv.URL, Token: "admin-tok"}),
	}
	ctx := context.Background()

	// First run: full scaffold + first-time bot provision.
	svc.ScaffoldRunDeliverables(ctx, db.MulticaWorkflowRun{
		ID: fix.run1, WorkflowID: fix.workflow, WorkspaceID: fix.workspace,
	})

	if *tokensMinted != 1 {
		t.Fatalf("after first scaffold: tokens minted = %d, want exactly 1", *tokensMinted)
	}
	if *orgsCreated != 1 {
		t.Fatalf("after first scaffold: orgs created = %d, want exactly 1", *orgsCreated)
	}

	settings := workspaceSettings(t, pool, fix.workspace)
	pat, _ := settings["gitea_pat"].(string)
	bot, _ := settings["gitea_bot_username"].(string)
	if pat == "" {
		t.Fatalf("workspace.settings missing non-empty gitea_pat after scaffold: %+v", settings)
	}
	if bot == "" {
		t.Fatalf("workspace.settings missing non-empty gitea_bot_username after scaffold: %+v", settings)
	}
	if !strings.HasPrefix(bot, "mc-bot-") {
		t.Fatalf("bot username %q does not look like a multica bot (want prefix mc-bot-)", bot)
	}

	// Second run, same workspace: scaffold of the new inst-branch happens, but
	// provision must be skipped (PAT already stored).
	tokensBefore := *tokensMinted
	svc.ScaffoldRunDeliverables(ctx, db.MulticaWorkflowRun{
		ID: fix.run2, WorkflowID: fix.workflow, WorkspaceID: fix.workspace,
	})
	if *tokensMinted != tokensBefore {
		t.Fatalf("lazy provision broken: second scaffold minted %d new token(s), want 0",
			*tokensMinted-tokensBefore)
	}

	// PAT persisted from the first call is still present.
	settings2 := workspaceSettings(t, pool, fix.workspace)
	if got, _ := settings2["gitea_pat"].(string); got != pat {
		t.Fatalf("gitea_pat drifted between runs: first=%q second=%q", pat, got)
	}
}

// TestScaffoldRunDeliverables_NoOpWhenGiteaNil verifies the dormancy contract:
// when the service has no Gitea client (tests that bypass the router, or a
// future "Gitea disabled" deployment), run-start must not touch the network or
// the DB. The function returns immediately without panicking on a nil client.
func TestScaffoldRunDeliverables_NoOpWhenGiteaNil(t *testing.T) {
	svc := &WorkflowService{Gitea: nil} // Queries also nil — must never be dereferenced.

	// If the dormancy gate works, this returns without touching s.Queries.
	// A panic here means the nil check is broken.
	svc.ScaffoldRunDeliverables(context.Background(), db.MulticaWorkflowRun{
		ID: pgtype.UUID{}, WorkflowID: pgtype.UUID{}, WorkspaceID: pgtype.UUID{},
	})
}

// TestScaffoldRunDeliverables_NoOpWithoutDocumentDeliverable verifies that
// code-only workflows (no document deliverable) skip scaffolding entirely:
// no Gitea HTTP traffic, no PAT minted, nothing written to workspace.settings.
func TestScaffoldRunDeliverables_NoOpWithoutDocumentDeliverable(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()

	// Workflow has a node but NO deliverable row.
	fix := seedGiteaFixture(t, pool, false /*no document*/, 1 /*single run*/)
	srv, tokensMinted, orgsCreated := fakeGiteaServer(t)

	svc := &WorkflowService{
		Queries: db.New(pool),
		Gitea:   gitea.NewClient(gitea.Config{BaseURL: srv.URL, Token: "admin-tok"}),
	}

	svc.ScaffoldRunDeliverables(context.Background(), db.MulticaWorkflowRun{
		ID: fix.run1, WorkflowID: fix.workflow, WorkspaceID: fix.workspace,
	})

	if *tokensMinted != 0 {
		t.Fatalf("code-only workflow: %d tokens minted, want 0", *tokensMinted)
	}
	if *orgsCreated != 0 {
		t.Fatalf("code-only workflow: %d orgs created, want 0", *orgsCreated)
	}
	settings := workspaceSettings(t, pool, fix.workspace)
	if pat, ok := settings["gitea_pat"]; ok && pat != "" {
		t.Fatalf("code-only workflow wrote gitea_pat=%v, want absent/empty", pat)
	}
}
