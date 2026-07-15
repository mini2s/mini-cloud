package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// These tests exercise the agent cloud-skill binding endpoints
// (GET/PUT /api/agents/{id}/cloud-skills) end-to-end through the handler,
// against a real database and an httptest stand-in for the cloud-api catalog.
// They are intentionally black-box: requests are encoded as the documented
// {"skill_ids":[...]} JSON, responses are decoded generically, and bindings are
// seeded/inspected via raw SQL against multica_agent_cloud_skill. This couples
// the suite only to the public HTTP contract and the table, not to internal
// struct or sqlc symbol names.

// --- test doubles ------------------------------------------------------------

// cloudCatalogUpstream is an httptest stand-in for the cloud-api catalog detail
// endpoint (/api/items/{id}) that agent-skill binding validation calls during a
// PUT. It serves registered item bodies keyed by cloud item id and records every
// inbound path so tests can assert proxy fan-out — and, critically, its absence
// when request validation rejects input before any fetch.
type cloudCatalogUpstream struct {
	server *httptest.Server

	mu    sync.Mutex
	paths []string // inbound request paths, in call order
	items map[string]string
}

// newCloudCatalogUpstream starts an httptest server serving the registered item
// bodies for GET /api/items/{id}; an unregistered id yields a 404, mirroring the
// real catalog contract. The server is closed via t.Cleanup.
func newCloudCatalogUpstream(t *testing.T, items map[string]string) *cloudCatalogUpstream {
	t.Helper()
	u := &cloudCatalogUpstream{items: items}
	u.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u.mu.Lock()
		u.paths = append(u.paths, r.URL.Path)
		u.mu.Unlock()

		id := strings.TrimPrefix(r.URL.Path, "/api/items/")
		body, ok := u.items[id]
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(u.server.Close)
	return u
}

func (u *cloudCatalogUpstream) baseURL() string { return u.server.URL }

// callCount reports how many catalog detail requests reached the upstream.
func (u *cloudCatalogUpstream) callCount() int {
	u.mu.Lock()
	defer u.mu.Unlock()
	return len(u.paths)
}

// requestedIDs returns the cloud item ids fetched, in call order.
func (u *cloudCatalogUpstream) requestedIDs() []string {
	u.mu.Lock()
	defer u.mu.Unlock()
	ids := make([]string, len(u.paths))
	for i, p := range u.paths {
		ids[i] = strings.TrimPrefix(p, "/api/items/")
	}
	return ids
}

// cloudSkillHandler returns a Handler wired to the real shared test database
// (queries, pool, transactions, realtime hub/bus are all pointer/interface
// fields, so the shallow copy shares them) but with the cloud catalog base URL
// pointed at the given upstream. Every other Config field is inherited from the
// package testHandler.
func cloudSkillHandler(baseURL string) *Handler {
	h := *testHandler
	cfg := testHandler.cfg
	cfg.BuiltinPluginAPIBaseURL = baseURL
	h.cfg = cfg
	return &h
}

// marshalItemJSON renders a cloud-api item detail body. Using map[string]any
// lets each test express the exact field set the upstream returns (including
// itemType vs item_type, missing repoVisibility, hostile content/assets).
func marshalItemJSON(t *testing.T, item map[string]any) string {
	t.Helper()
	b, err := json.Marshal(item)
	if err != nil {
		t.Fatalf("marshal catalog item: %v", err)
	}
	return string(b)
}

// publicSkillBody is a minimal accepted catalog detail body for a public skill.
func publicSkillBody(t *testing.T, id string) string {
	t.Helper()
	return marshalItemJSON(t, map[string]any{
		"id":             id,
		"name":           strings.ToUpper(id),
		"slug":           id,
		"description":    "desc-" + id,
		"itemType":       "skill",
		"repoVisibility": "public",
	})
}

func TestAgentCloudSkillRowsToData_RejectsInvalidInstallJSON(t *testing.T) {
	tests := []struct {
		name    string
		install []byte
	}{
		{name: "malformed", install: []byte(`{"method":`)},
		{name: "array", install: []byte(`[{"method":"csc"}]`)},
		{name: "null", install: []byte(`null`)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := agentCloudSkillRowsToData([]db.MulticaAgentCloudSkill{{
				CloudSkillID: "11111111-1111-4111-8111-111111111111",
				Name:         "Review Helper",
				Install:      tt.install,
			}})
			if err == nil {
				t.Fatalf("agentCloudSkillRowsToData(%s) expected error", tt.name)
			}
		})
	}
}

// --- raw-SQL DB helpers ------------------------------------------------------

func seedAgentCloudSkillRow(t *testing.T, agentID, id, slug, name, description, install string, position int32) {
	t.Helper()
	if _, err := testPool.Exec(context.Background(), `
		INSERT INTO multica_agent_cloud_skill (agent_id, cloud_skill_id, slug, name, description, install, position)
		VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
	`, agentID, id, slug, name, description, install, position); err != nil {
		t.Fatalf("seed agent cloud skill row: %v", err)
	}
}

// agentCloudSkillIDs returns the agent's persisted cloud_skill_ids in storage
// order (position ASC, name ASC, cloud_skill_id ASC — the same order the
// handler must return).
func agentCloudSkillIDs(t *testing.T, agentID string) []string {
	t.Helper()
	rows, err := testPool.Query(context.Background(), `
		SELECT cloud_skill_id FROM multica_agent_cloud_skill
		WHERE agent_id = $1
		ORDER BY position ASC, name ASC, cloud_skill_id ASC`, agentID)
	if err != nil {
		t.Fatalf("query agent cloud skills: %v", err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatalf("scan cloud skill id: %v", err)
		}
		ids = append(ids, id)
	}
	return ids
}

// agentCloudSkillInstall returns the raw persisted install JSONB for a binding,
// so tests can prove the allowlist (not the full upstream metadata) reached
// storage.
func agentCloudSkillInstall(t *testing.T, agentID, id string) []byte {
	t.Helper()
	var install []byte
	if err := testPool.QueryRow(context.Background(), `
		SELECT install FROM multica_agent_cloud_skill
		WHERE agent_id = $1 AND cloud_skill_id = $2`, agentID, id).Scan(&install); err != nil {
		t.Fatalf("load install for %s: %v", id, err)
	}
	return install
}

// createUser inserts a user (optionally a global workflow admin) and removes it
// on test completion. Used for the built-in-agent permission gate so the suite
// never depends on — or mutates — the shared testUserID's workflow-admin flag.
func createUser(t *testing.T, email, name string, workflowAdmin bool) string {
	t.Helper()
	var id string
	if err := testPool.QueryRow(context.Background(), `
		INSERT INTO multica_user (name, email, can_manage_workflows)
		VALUES ($1, $2, $3)
		RETURNING id
	`, name, email, workflowAdmin).Scan(&id); err != nil {
		t.Fatalf("create user %s: %v", email, err)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM multica_user WHERE email = $1`, email)
	})
	return id
}

// --- response helpers --------------------------------------------------------

func decodeCloudSkillRows(t *testing.T, body []byte) []map[string]any {
	t.Helper()
	var rows []map[string]any
	if err := json.Unmarshal(body, &rows); err != nil {
		t.Fatalf("decode cloud skill rows %q: %v", body, err)
	}
	return rows
}

func cloudSkillIDsEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// assertCloudSkillPosition checks the position field when present. The wire
// struct uses position,omitempty, so a zero position may be encoded as a missing
// key; the ordering contract is therefore enforced by array order, and this
// helper only fails on a present-but-wrong value.
func assertCloudSkillPosition(t *testing.T, row map[string]any, want int) {
	t.Helper()
	v, ok := row["position"]
	if !ok {
		return
	}
	pos, ok := v.(float64)
	if !ok {
		t.Errorf("position: want number, got %T (%v)", v, v)
		return
	}
	if int(pos) != want {
		t.Errorf("position: want %d, got %v", want, pos)
	}
}

// --- validation --------------------------------------------------------------

// TestSetAgentCloudSkills_Validation guards the external-ID validation rules:
// trimmed non-empty text, per-id length <= 200, and at most 20 ids. Every case
// must 400 and, crucially, must not reach the catalog upstream — validation
// runs before any fetch, so a malformed request never fans out to the cloud-api.
func TestSetAgentCloudSkills_Validation(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	agentID := createHandlerTestAgent(t, "Cloud Skill Validation Agent", nil)
	upstream := newCloudCatalogUpstream(t, map[string]string{
		"good-id": publicSkillBody(t, "good-id"),
	})
	h := cloudSkillHandler(upstream.baseURL())

	tooMany := make([]string, 21)
	for i := range tooMany {
		tooMany[i] = string(rune('a' + i)) // 21 distinct ids: a..u
	}

	cases := []struct {
		name string
		ids  []string
	}{
		{"empty string id", []string{""}},
		{"whitespace-only id", []string{"   "}},
		{"empty id mixed with valid", []string{"good-id", ""}},
		{"id longer than 200 chars", []string{strings.Repeat("x", 201)}},
		{"more than 20 ids", tooMany},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			req := withURLParam(newRequest(http.MethodPut, "/api/agents/"+agentID+"/cloud-skills",
				map[string]any{"skill_ids": tc.ids}), "id", agentID)
			h.SetAgentCloudSkills(w, req)

			if w.Code != http.StatusBadRequest {
				t.Fatalf("expected 400 for %s, got %d: %s", tc.name, w.Code, w.Body.String())
			}
			if n := upstream.callCount(); n != 0 {
				t.Fatalf("validation failure must not reach the catalog upstream, got %d fetch(es)", n)
			}
			if ids := agentCloudSkillIDs(t, agentID); len(ids) != 0 {
				t.Fatalf("rejected PUT must not persist bindings, got %v", ids)
			}
		})
	}
}

// --- dedupe ------------------------------------------------------------------

// TestSetAgentCloudSkills_DedupPreservesOrder verifies duplicate requested ids
// collapse to a single binding each, preserving first-seen request order, and
// that each unique id is fetched exactly once from the catalog.
func TestSetAgentCloudSkills_DedupPreservesOrder(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	agentID := createHandlerTestAgent(t, "Cloud Skill Dedupe Agent", nil)
	upstream := newCloudCatalogUpstream(t, map[string]string{
		"a": publicSkillBody(t, "a"),
		"b": publicSkillBody(t, "b"),
		"c": publicSkillBody(t, "c"),
	})
	h := cloudSkillHandler(upstream.baseURL())

	w := httptest.NewRecorder()
	req := withURLParam(newRequest(http.MethodPut, "/api/agents/"+agentID+"/cloud-skills",
		map[string]any{"skill_ids": []string{"a", "b", "a", "c", "b"}}), "id", agentID)
	h.SetAgentCloudSkills(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("PUT: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	rows := decodeCloudSkillRows(t, w.Body.Bytes())
	want := []string{"a", "b", "c"}
	if len(rows) != len(want) {
		t.Fatalf("expected %d deduped rows, got %d (%s)", len(want), len(rows), w.Body.String())
	}
	for i, id := range want {
		if rows[i]["id"] != id {
			t.Errorf("row %d id: want %s, got %v (order must follow first-seen request order)", i, id, rows[i]["id"])
		}
		assertCloudSkillPosition(t, rows[i], i)
	}

	// Each unique id fetched exactly once.
	fetched := upstream.requestedIDs()
	if len(fetched) != 3 {
		t.Fatalf("expected 3 upstream fetches (one per unique id), got %d: %v", len(fetched), fetched)
	}
	counts := map[string]int{}
	for _, id := range fetched {
		counts[id]++
	}
	for _, id := range want {
		if counts[id] != 1 {
			t.Errorf("expected %q fetched exactly once, got %d", id, counts[id])
		}
	}

	if ids := agentCloudSkillIDs(t, agentID); !cloudSkillIDsEqual(ids, want) {
		t.Fatalf("persisted order: want %v, got %v", want, ids)
	}
}

// --- catalog validation atomicity -------------------------------------------

// TestSetAgentCloudSkills_CatalogValidationLeavesRowsUnchanged verifies that a
// PUT whose requested item fails catalog validation (non-skill item type,
// private repo, missing repoVisibility, or simply absent upstream) returns an
// error AND leaves previously persisted bindings untouched. The load-bearing
// invariant is atomicity: a failed replacement must never partially mutate the
// agent's bindings.
func TestSetAgentCloudSkills_CatalogValidationLeavesRowsUnchanged(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	agentID := createHandlerTestAgent(t, "Cloud Skill Catalog Validation Agent", nil)
	seedAgentCloudSkillRow(t, agentID, "existing-1", "e1", "Existing One", "pre-existing", `{"method":"csc"}`, 0)
	seedAgentCloudSkillRow(t, agentID, "existing-2", "e2", "Existing Two", "pre-existing", `{"method":"csc"}`, 1)
	pre := agentCloudSkillIDs(t, agentID)

	cases := []struct {
		name string
		item map[string]any // nil => item absent upstream (404)
	}{
		{"non-skill item type", map[string]any{"id": "bad", "name": "Bad", "slug": "bad", "itemType": "plugin", "repoVisibility": "public"}},
		{"private repo visibility", map[string]any{"id": "bad", "name": "Bad", "slug": "bad", "itemType": "skill", "repoVisibility": "private"}},
		{"missing repo visibility", map[string]any{"id": "bad", "name": "Bad", "slug": "bad", "itemType": "skill"}},
		{"upstream item not found", nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			items := map[string]string{}
			if tc.item != nil {
				items["bad"] = marshalItemJSON(t, tc.item)
			}
			upstream := newCloudCatalogUpstream(t, items)
			h := cloudSkillHandler(upstream.baseURL())

			w := httptest.NewRecorder()
			req := withURLParam(newRequest(http.MethodPut, "/api/agents/"+agentID+"/cloud-skills",
				map[string]any{"skill_ids": []string{"bad"}}), "id", agentID)
			h.SetAgentCloudSkills(w, req)

			if w.Code < http.StatusBadRequest {
				t.Fatalf("expected an error status for %s, got %d: %s", tc.name, w.Code, w.Body.String())
			}
			if got := agentCloudSkillIDs(t, agentID); !cloudSkillIDsEqual(got, pre) {
				t.Fatalf("rejected PUT mutated existing bindings: want %v, got %v", pre, got)
			}
		})
	}
}

// --- snapshot allowlist ------------------------------------------------------

// TestSetAgentCloudSkills_PersistsAllowlistedSnapshot verifies that only the
// documented snapshot fields survive a PUT: id/slug/name/description/install/
// position. Upstream content, assets, arbitrary metadata, and disallowed
// install sub-fields (commands, etc.) must be dropped from both the response and
// storage. install must serialize as a JSON object.
func TestSetAgentCloudSkills_PersistsAllowlistedSnapshot(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	agentID := createHandlerTestAgent(t, "Cloud Skill Snapshot Agent", nil)
	upstream := newCloudCatalogUpstream(t, map[string]string{
		"sk1": marshalItemJSON(t, map[string]any{
			"id":             "sk1",
			"name":           "Code Review",
			"slug":           "code-review",
			"description":    "Reviews PRs",
			"itemType":       "skill",
			"repoVisibility": "public",
			"content":        "SECRET SKILL BODY",
			"assets":         []map[string]any{{"url": "http://evil.example/x"}},
			"metadata": map[string]any{
				"install": map[string]any{
					"method":     "csc",
					"skill_id":   "sk1",
					"spec":       "sk1",
					"source_url": "https://example.com/sk1",
					"verified":   true,
					"commands":   []string{"rm -rf /"}, // must be dropped — never persisted/proxied
					"dangerous":  "must be dropped",
				},
				"other_meta": "must not be persisted",
			},
		}),
	})
	h := cloudSkillHandler(upstream.baseURL())

	w := httptest.NewRecorder()
	req := withURLParam(newRequest(http.MethodPut, "/api/agents/"+agentID+"/cloud-skills",
		map[string]any{"skill_ids": []string{"sk1"}}), "id", agentID)
	h.SetAgentCloudSkills(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("PUT: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	rows := decodeCloudSkillRows(t, w.Body.Bytes())
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d (%s)", len(rows), w.Body.String())
	}
	row := rows[0]

	for k, want := range map[string]any{
		"id":          "sk1",
		"slug":        "code-review",
		"name":        "Code Review",
		"description": "Reviews PRs",
	} {
		if row[k] != want {
			t.Errorf("snapshot %s: want %v, got %v", k, want, row[k])
		}
	}
	assertCloudSkillPosition(t, row, 0)

	// Hostile / out-of-contract fields must not appear on the snapshot.
	for _, banned := range []string{"content", "assets", "metadata"} {
		if _, ok := row[banned]; ok {
			t.Errorf("response must not include %q on a binding snapshot", banned)
		}
	}

	install, ok := row["install"].(map[string]any)
	if !ok {
		t.Fatalf("install must be a JSON object, got %T: %#v", row["install"], row["install"])
	}
	if len(install) != 5 {
		t.Errorf("install must contain exactly the 5 allowlisted fields, got %d: %#v", len(install), install)
	}
	for _, banned := range []string{"commands", "dangerous"} {
		if _, ok := install[banned]; ok {
			t.Errorf("install must drop disallowed field %q", banned)
		}
	}
	for k, want := range map[string]any{
		"method":     "csc",
		"skill_id":   "sk1",
		"spec":       "sk1",
		"source_url": "https://example.com/sk1",
		"verified":   true,
	} {
		if install[k] != want {
			t.Errorf("install.%s: want %v, got %v", k, want, install[k])
		}
	}

	// Storage must match the allowlist — no commands leaked into the JSONB.
	var dbInstall map[string]any
	if err := json.Unmarshal(agentCloudSkillInstall(t, agentID, "sk1"), &dbInstall); err != nil {
		t.Fatalf("decode persisted install: %v", err)
	}
	if _, ok := dbInstall["commands"]; ok {
		t.Errorf("persisted install must not contain commands")
	}
	if dbInstall["method"] != "csc" {
		t.Errorf("persisted install.method: want csc, got %v", dbInstall["method"])
	}
}

// TestSetAgentCloudSkills_NormalizesMissingInstall verifies that an accepted
// public skill with no upstream metadata.install gets the inert synthesized
// install snapshot {method:csc, skill_id:<id>, spec:<id>}. This is a
// stored snapshot only — nothing is installed.
func TestSetAgentCloudSkills_NormalizesMissingInstall(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	agentID := createHandlerTestAgent(t, "Cloud Skill NoInstall Agent", nil)
	upstream := newCloudCatalogUpstream(t, map[string]string{
		"nosint": marshalItemJSON(t, map[string]any{
			"id":             "nosint",
			"name":           "No Install",
			"slug":           "no-install",
			"description":    "d",
			"itemType":       "skill",
			"repoVisibility": "public",
		}),
	})
	h := cloudSkillHandler(upstream.baseURL())

	w := httptest.NewRecorder()
	req := withURLParam(newRequest(http.MethodPut, "/api/agents/"+agentID+"/cloud-skills",
		map[string]any{"skill_ids": []string{"nosint"}}), "id", agentID)
	h.SetAgentCloudSkills(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("PUT: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	rows := decodeCloudSkillRows(t, w.Body.Bytes())
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d (%s)", len(rows), w.Body.String())
	}
	install, ok := rows[0]["install"].(map[string]any)
	if !ok {
		t.Fatalf("install must be a JSON object, got %v", rows[0]["install"])
	}
	if len(install) != 3 {
		t.Errorf("synthesized install must have exactly 3 fields, got %d: %#v", len(install), install)
	}
	for k, want := range map[string]any{"method": "csc", "skill_id": "nosint", "spec": "nosint"} {
		if install[k] != want {
			t.Errorf("install.%s: want %v, got %v", k, want, install[k])
		}
	}
}

// --- replacement semantics ---------------------------------------------------

// TestSetAgentCloudSkills_ReplacementRemovesStaleBindings verifies the PUT is a
// full replace, not an append: binding [a] then [b] must leave only [b] in
// storage, and the replacement response lists only the new binding.
func TestSetAgentCloudSkills_ReplacementRemovesStaleBindings(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	agentID := createHandlerTestAgent(t, "Cloud Skill Replace Agent", nil)
	upstream := newCloudCatalogUpstream(t, map[string]string{
		"a": publicSkillBody(t, "a"),
		"b": publicSkillBody(t, "b"),
	})
	h := cloudSkillHandler(upstream.baseURL())

	put := func(ids []string) []map[string]any {
		w := httptest.NewRecorder()
		req := withURLParam(newRequest(http.MethodPut, "/api/agents/"+agentID+"/cloud-skills",
			map[string]any{"skill_ids": ids}), "id", agentID)
		h.SetAgentCloudSkills(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("PUT %v: expected 200, got %d: %s", ids, w.Code, w.Body.String())
		}
		return decodeCloudSkillRows(t, w.Body.Bytes())
	}

	put([]string{"a"})
	if ids := agentCloudSkillIDs(t, agentID); !cloudSkillIDsEqual(ids, []string{"a"}) {
		t.Fatalf("after PUT [a]: want [a], got %v", ids)
	}

	rows := put([]string{"b"})
	if len(rows) != 1 || rows[0]["id"] != "b" {
		t.Fatalf("replacement response: want [{id:b}], got %#v", rows)
	}
	if ids := agentCloudSkillIDs(t, agentID); !cloudSkillIDsEqual(ids, []string{"b"}) {
		t.Fatalf("after PUT [b]: want [b] (stale [a] removed), got %v", ids)
	}
}

// --- GET visibility gate -----------------------------------------------------

// TestListAgentCloudSkills_PrivateAgentVisibilityGate verifies GET mirrors
// GetAgent's private-agent read gate: the workspace owner and the agent owner
// see bindings; a plain member (neither owner nor admin) is denied 403 before
// any binding data is returned.
func TestListAgentCloudSkills_PrivateAgentVisibilityGate(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	agentID, ownerID, memberID := privateAgentTestFixture(t)
	seedAgentCloudSkillRow(t, agentID, "vis-1", "v1", "Visible Skill", "seeded", `{"method":"csc"}`, 0)

	// Workspace owner (testUserID): allowed via role, and returns the binding.
	w := httptest.NewRecorder()
	testHandler.ListAgentCloudSkills(w, withURLParam(
		newRequest(http.MethodGet, "/api/agents/"+agentID+"/cloud-skills", nil), "id", agentID))
	if w.Code != http.StatusOK {
		t.Fatalf("GET as workspace owner: want 200, got %d: %s", w.Code, w.Body.String())
	}
	rows := decodeCloudSkillRows(t, w.Body.Bytes())
	if len(rows) != 1 || rows[0]["id"] != "vis-1" {
		t.Fatalf("GET as workspace owner: want [{id:vis-1}], got %#v", rows)
	}

	// Agent owner (plain member who owns the agent): allowed.
	w = httptest.NewRecorder()
	testHandler.ListAgentCloudSkills(w, withURLParam(
		newRequestAs(ownerID, http.MethodGet, "/api/agents/"+agentID+"/cloud-skills", nil), "id", agentID))
	if w.Code != http.StatusOK {
		t.Fatalf("GET as agent owner: want 200, got %d: %s", w.Code, w.Body.String())
	}

	// Plain member (not owner, not admin): denied — mirrors GetAgent.
	w = httptest.NewRecorder()
	testHandler.ListAgentCloudSkills(w, withURLParam(
		newRequestAs(memberID, http.MethodGet, "/api/agents/"+agentID+"/cloud-skills", nil), "id", agentID))
	if w.Code != http.StatusForbidden {
		t.Fatalf("GET as plain member: want 403 (mirrors GetAgent gate), got %d: %s", w.Code, w.Body.String())
	}
}

// --- PUT permission gate -----------------------------------------------------

// TestSetAgentCloudSkills_BuiltinPermissionGate verifies PUT on a built-in
// agent mirrors canManageAgent: a non-workflow-admin user is forbidden (403) and
// persists nothing, while a user with can_manage_workflows may bind. The
// built-in agent's bindings are restored to their prior state on completion.
func TestSetAgentCloudSkills_BuiltinPermissionGate(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	// Hermetic: leave the shared global built-in agent exactly as found.
	t.Cleanup(func() {
		testPool.Exec(context.Background(),
			`DELETE FROM multica_agent_cloud_skill WHERE agent_id = $1`, builtinAgentID)
	})

	upstream := newCloudCatalogUpstream(t, map[string]string{
		"bi-skill": publicSkillBody(t, "bi-skill"),
	})

	// Non-admin: must not manage a built-in agent.
	nonAdmin := createUser(t, "cloud-skill-nonadmin@multica.test", "Non Admin", false)
	w := httptest.NewRecorder()
	req := withURLParam(newRequestAs(nonAdmin, http.MethodPut, "/api/agents/"+builtinAgentID+"/cloud-skills",
		map[string]any{"skill_ids": []string{"bi-skill"}}), "id", builtinAgentID)
	cloudSkillHandler(upstream.baseURL()).SetAgentCloudSkills(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("PUT built-in as non-admin: want 403 (mirrors canManageAgent), got %d: %s", w.Code, w.Body.String())
	}
	if ids := agentCloudSkillIDs(t, builtinAgentID); len(ids) != 0 {
		t.Fatalf("forbidden PUT must not persist built-in bindings, got %v", ids)
	}

	// Workflow admin: allowed to manage built-in agents.
	admin := createUser(t, "cloud-skill-wfadmin@multica.test", "WF Admin", true)
	w = httptest.NewRecorder()
	req = withURLParam(newRequestAs(admin, http.MethodPut, "/api/agents/"+builtinAgentID+"/cloud-skills",
		map[string]any{"skill_ids": []string{"bi-skill"}}), "id", builtinAgentID)
	cloudSkillHandler(upstream.baseURL()).SetAgentCloudSkills(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("PUT built-in as workflow admin: want 200, got %d: %s", w.Code, w.Body.String())
	}
	if ids := agentCloudSkillIDs(t, builtinAgentID); !cloudSkillIDsEqual(ids, []string{"bi-skill"}) {
		t.Fatalf("admin PUT should persist the built-in binding, got %v", ids)
	}
}
