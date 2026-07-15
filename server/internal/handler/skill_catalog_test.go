package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

// TestListCatalogSkills covers the public GET /api/catalog/skills proxy: it
// must always forward to cloud-api /api/items with type=skill forced, honor the
// q/search alias, clamp pagination, pass the upstream body through, and degrade
// to the empty-list envelope (HTTP 200) when the upstream is unavailable.
func TestListCatalogSkills(t *testing.T) {
	// Empty query must still hit /api/items (not a local list) with type=skill
	// and default pagination, and forward the upstream body unchanged.
	t.Run("empty query forwards to /api/items with type=skill and defaults", func(t *testing.T) {
		upstream := newPluginUpstream(http.StatusOK,
			`{"items":[{"id":"s1","name":"Skill One"}],"total":1,"page":1,"pageSize":100,"hasMore":false}`)
		defer upstream.close()

		h := newTestHandler(Config{BuiltinPluginAPIBaseURL: upstream.baseURL()})
		req := httptest.NewRequest(http.MethodGet, "/api/catalog/skills", nil)
		w := httptest.NewRecorder()

		h.ListCatalogSkills(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("status: want 200, got %d: %s", w.Code, w.Body.String())
		}
		if upstream.callCount() != 1 {
			t.Fatalf("upstream call count: want 1, got %d", upstream.callCount())
		}
		if got := upstream.lastPath(); got != "/api/items" {
			t.Fatalf("upstream path: want /api/items, got %q", got)
		}
		q := upstream.lastQuery()
		if q.Get("type") != "skill" {
			t.Errorf("type param: want skill, got %q", q.Get("type"))
		}
		if q.Get("search") != "" {
			t.Errorf("search param: want absent for empty query, got %q", q.Get("search"))
		}
		if q.Get("page") != "1" {
			t.Errorf("page param: want 1, got %q", q.Get("page"))
		}
		if q.Get("pageSize") != "100" {
			t.Errorf("pageSize param: want 100, got %q", q.Get("pageSize"))
		}
		var env pluginListEnvelope
		if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		if len(env.Items) != 1 || env.Items[0]["id"] != "s1" {
			t.Fatalf("forwarded items: want [{id:s1}], got %#v", env.Items)
		}
	})

	// q must win over a concurrent search alias so callers can't accidentally
	// broaden a narrowed query.
	t.Run("q takes precedence over search alias", func(t *testing.T) {
		upstream := newPluginUpstream(http.StatusOK,
			`{"items":[],"total":0,"page":1,"pageSize":100,"hasMore":false}`)
		defer upstream.close()

		h := newTestHandler(Config{BuiltinPluginAPIBaseURL: upstream.baseURL()})
		req := httptest.NewRequest(http.MethodGet, "/api/catalog/skills?q=review&search=legacy", nil)
		w := httptest.NewRecorder()

		h.ListCatalogSkills(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("status: want 200, got %d: %s", w.Code, w.Body.String())
		}
		if got := upstream.lastQuery().Get("search"); got != "review" {
			t.Errorf("search param: want review (q wins), got %q", got)
		}
		if got := upstream.lastPath(); got != "/api/items" {
			t.Errorf("upstream path: want /api/items, got %q", got)
		}
		if got := upstream.lastQuery().Get("type"); got != "skill" {
			t.Errorf("type param: want skill, got %q", got)
		}
	})

	// search is the fallback alias when q is absent.
	t.Run("search alias used when q absent", func(t *testing.T) {
		upstream := newPluginUpstream(http.StatusOK,
			`{"items":[],"total":0,"page":1,"pageSize":100,"hasMore":false}`)
		defer upstream.close()

		h := newTestHandler(Config{BuiltinPluginAPIBaseURL: upstream.baseURL()})
		req := httptest.NewRequest(http.MethodGet, "/api/catalog/skills?search=legacy", nil)
		w := httptest.NewRecorder()

		h.ListCatalogSkills(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("status: want 200, got %d: %s", w.Code, w.Body.String())
		}
		if got := upstream.lastQuery().Get("search"); got != "legacy" {
			t.Errorf("search param: want legacy, got %q", got)
		}
	})

	// Non-ASCII queries must round-trip through percent-encoding so the upstream
	// receives the intended text rather than mojibake or a malformed request.
	t.Run("non-ASCII query is forwarded intact", func(t *testing.T) {
		upstream := newPluginUpstream(http.StatusOK,
			`{"items":[],"total":0,"page":1,"pageSize":100,"hasMore":false}`)
		defer upstream.close()

		h := newTestHandler(Config{BuiltinPluginAPIBaseURL: upstream.baseURL()})
		qs := url.Values{}
		qs.Set("q", "café")
		req := httptest.NewRequest(http.MethodGet, "/api/catalog/skills?"+qs.Encode(), nil)
		w := httptest.NewRecorder()

		h.ListCatalogSkills(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("status: want 200, got %d: %s", w.Code, w.Body.String())
		}
		if got := upstream.lastQuery().Get("search"); got != "café" {
			t.Errorf("search param: want café, got %q", got)
		}
	})

	// page must clamp to >=1 and pageSize to 1..100, mirroring the plugin
	// catalog defaults, so callers can't request unbounded or negative pages.
	t.Run("pagination clamps page and pageSize", func(t *testing.T) {
		cases := []struct {
			name     string
			query    string
			wantPage string
			wantSize string
		}{
			{"pageSize over max clamps to 100", "pageSize=999", "1", "100"},
			{"page below 1 clamps to 1", "page=0", "1", "100"},
			{"negative page and pageSize clamp", "page=-3&pageSize=-7", "1", "1"},
			{"zero pageSize clamps to 1", "pageSize=0", "1", "1"},
			{"valid page and pageSize pass through", "page=2&pageSize=25", "2", "25"},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				upstream := newPluginUpstream(http.StatusOK,
					`{"items":[],"total":0,"page":1,"pageSize":100,"hasMore":false}`)
				defer upstream.close()

				h := newTestHandler(Config{BuiltinPluginAPIBaseURL: upstream.baseURL()})
				req := httptest.NewRequest(http.MethodGet, "/api/catalog/skills?"+tc.query, nil)
				w := httptest.NewRecorder()

				h.ListCatalogSkills(w, req)

				if w.Code != http.StatusOK {
					t.Fatalf("status: want 200, got %d: %s", w.Code, w.Body.String())
				}
				q := upstream.lastQuery()
				if q.Get("type") != "skill" {
					t.Errorf("type param: want skill, got %q", q.Get("type"))
				}
				if q.Get("page") != tc.wantPage {
					t.Errorf("page param: want %q, got %q", tc.wantPage, q.Get("page"))
				}
				if q.Get("pageSize") != tc.wantSize {
					t.Errorf("pageSize param: want %q, got %q", tc.wantSize, q.Get("pageSize"))
				}
			})
		}
	})

	// A non-200 upstream must degrade to the empty-list envelope with HTTP 200,
	// never surfacing the upstream error to the public catalog caller.
	t.Run("upstream non-200 returns empty envelope with HTTP 200", func(t *testing.T) {
		upstream := newPluginUpstream(http.StatusBadGateway, `{"error":"upstream down"}`)
		defer upstream.close()

		h := newTestHandler(Config{BuiltinPluginAPIBaseURL: upstream.baseURL()})
		req := httptest.NewRequest(http.MethodGet, "/api/catalog/skills", nil)
		w := httptest.NewRecorder()

		h.ListCatalogSkills(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("status: want 200 (empty envelope), got %d: %s", w.Code, w.Body.String())
		}
		assertEmptyPluginEnvelope(t, w.Body.Bytes())
	})

	// An unreachable upstream (connection refused) must likewise degrade to the
	// empty-list envelope rather than 5xx.
	t.Run("unreachable upstream returns empty envelope with HTTP 200", func(t *testing.T) {
		upstream := newPluginUpstream(http.StatusOK, `{}`)
		upstream.close() // tear the listener down so the proxy dial fails

		h := newTestHandler(Config{BuiltinPluginAPIBaseURL: upstream.baseURL()})
		req := httptest.NewRequest(http.MethodGet, "/api/catalog/skills", nil)
		w := httptest.NewRecorder()

		h.ListCatalogSkills(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("status: want 200 (empty envelope), got %d: %s", w.Code, w.Body.String())
		}
		assertEmptyPluginEnvelope(t, w.Body.Bytes())
	})

	// An unconfigured base URL must behave like an unavailable catalog: HTTP 200
	// with the empty envelope, and no upstream call attempted.
	t.Run("empty base URL returns empty envelope with HTTP 200", func(t *testing.T) {
		h := newTestHandler(Config{})
		req := httptest.NewRequest(http.MethodGet, "/api/catalog/skills", nil)
		w := httptest.NewRecorder()

		h.ListCatalogSkills(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("status: want 200 (empty envelope), got %d: %s", w.Code, w.Body.String())
		}
		assertEmptyPluginEnvelope(t, w.Body.Bytes())
	})
}

func TestListCatalogPlugins(t *testing.T) {
	t.Run("forwards plugin type, popularity sort, search, and capped page size", func(t *testing.T) {
		upstream := newPluginUpstream(http.StatusOK,
			`{"items":[{"id":"p1","name":"Plugin One"}],"total":1,"page":1,"pageSize":100,"hasMore":false}`)
		defer upstream.close()

		h := newTestHandler(Config{BuiltinPluginAPIBaseURL: upstream.baseURL()})
		req := httptest.NewRequest(http.MethodGet, "/api/catalog/plugins?q=review&pageSize=999", nil)
		w := httptest.NewRecorder()

		h.ListCatalogPlugins(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("status: want 200, got %d: %s", w.Code, w.Body.String())
		}
		if got := upstream.lastPath(); got != "/api/items" {
			t.Fatalf("upstream path: want /api/items, got %q", got)
		}
		q := upstream.lastQuery()
		for key, want := range map[string]string{
			"type":      "plugin",
			"page":      "1",
			"pageSize":  "100",
			"search":    "review",
			"sortBy":    "favoriteCount",
			"sortOrder": "desc",
		} {
			if got := q.Get(key); got != want {
				t.Errorf("%s param: want %q, got %q", key, want, got)
			}
		}

		var env pluginListEnvelope
		if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		if len(env.Items) != 1 || env.Items[0]["id"] != "p1" {
			t.Fatalf("forwarded items: want [{id:p1}], got %#v", env.Items)
		}
	})

	t.Run("unconfigured catalog returns an empty envelope", func(t *testing.T) {
		h := newTestHandler(Config{})
		req := httptest.NewRequest(http.MethodGet, "/api/catalog/plugins", nil)
		w := httptest.NewRecorder()

		h.ListCatalogPlugins(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("status: want 200, got %d: %s", w.Code, w.Body.String())
		}
		assertEmptyPluginEnvelope(t, w.Body.Bytes())
	})
}

// TestGetCatalogSkill covers the public GET /api/catalog/skills/{id} proxy: it
// forwards to /api/items/{id}, surfaces upstream 404 as 404 and other
// failures as 502, rejects non-skill/private/missing-visibility items with 404
// without leaking the upstream body, normalizes a missing metadata.install, and
// preserves unknown top-level fields for valid public skills.
func TestGetCatalogSkill(t *testing.T) {
	// A valid public skill must round-trip through /api/items/{id}.
	t.Run("forwards to /api/items/{id}", func(t *testing.T) {
		upstream := newPluginUpstream(http.StatusOK,
			`{"id":"sk-123","name":"Review Skill","itemType":"skill","repoVisibility":"public","metadata":{"install":{"method":"csc","spec":"sk-123"}}}`)
		defer upstream.close()

		h := newTestHandler(Config{BuiltinPluginAPIBaseURL: upstream.baseURL()})
		req := httptest.NewRequest(http.MethodGet, "/api/catalog/skills/sk-123", nil)
		req = withURLParam(req, "id", "sk-123")
		w := httptest.NewRecorder()

		h.GetCatalogSkill(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("status: want 200, got %d: %s", w.Code, w.Body.String())
		}
		if upstream.callCount() != 1 {
			t.Fatalf("upstream call count: want 1, got %d", upstream.callCount())
		}
		if got := upstream.lastPath(); got != "/api/items/sk-123" {
			t.Fatalf("upstream path: want /api/items/sk-123, got %q", got)
		}
	})

	// Unknown cloud-api fields must survive the proxy so future catalog
	// additions aren't silently dropped; a missing metadata.install must be
	// normalized to the inert csc default keyed by the item id.
	t.Run("preserves unknown fields and normalizes missing install", func(t *testing.T) {
		upstream := newPluginUpstream(http.StatusOK,
			`{"id":"sk-123","name":"Review Skill","itemType":"skill","repoVisibility":"public","version":"1.2.3","category":"devops","content":"big skill content","assets":["a.md"],"metadata":{"author":"team"}}`)
		defer upstream.close()

		h := newTestHandler(Config{BuiltinPluginAPIBaseURL: upstream.baseURL()})
		req := httptest.NewRequest(http.MethodGet, "/api/catalog/skills/sk-123", nil)
		req = withURLParam(req, "id", "sk-123")
		w := httptest.NewRecorder()

		h.GetCatalogSkill(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("status: want 200, got %d: %s", w.Code, w.Body.String())
		}
		var body map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		// Unknown top-level fields preserved.
		if body["version"] != "1.2.3" {
			t.Errorf("version: want 1.2.3, got %#v", body["version"])
		}
		if body["category"] != "devops" {
			t.Errorf("category: want devops, got %#v", body["category"])
		}
		if body["content"] != "big skill content" {
			t.Errorf("content: want preserved, got %#v", body["content"])
		}
		assets, _ := body["assets"].([]any)
		if len(assets) != 1 {
			t.Errorf("assets: want 1 element preserved, got %#v", body["assets"])
		}
		// Existing metadata sub-field preserved alongside normalized install.
		meta, ok := body["metadata"].(map[string]any)
		if !ok {
			t.Fatalf("metadata: want object, got %#v", body["metadata"])
		}
		if meta["author"] != "team" {
			t.Errorf("metadata.author: want team, got %#v", meta["author"])
		}
		install, ok := meta["install"].(map[string]any)
		if !ok {
			t.Fatalf("metadata.install: want normalized object, got %#v", meta["install"])
		}
		if install["method"] != "csc" {
			t.Errorf("install.method: want csc, got %#v", install["method"])
		}
		if install["skill_id"] != "sk-123" {
			t.Errorf("install.skill_id: want sk-123, got %#v", install["skill_id"])
		}
		if install["spec"] != "sk-123" {
			t.Errorf("install.spec: want sk-123, got %#v", install["spec"])
		}
	})

	// A missing metadata block entirely must still yield a normalized install.
	t.Run("normalizes install when metadata absent", func(t *testing.T) {
		upstream := newPluginUpstream(http.StatusOK,
			`{"id":"sk-123","name":"Bare Skill","itemType":"skill","repoVisibility":"public"}`)
		defer upstream.close()

		h := newTestHandler(Config{BuiltinPluginAPIBaseURL: upstream.baseURL()})
		req := httptest.NewRequest(http.MethodGet, "/api/catalog/skills/sk-123", nil)
		req = withURLParam(req, "id", "sk-123")
		w := httptest.NewRecorder()

		h.GetCatalogSkill(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("status: want 200, got %d: %s", w.Code, w.Body.String())
		}
		var body map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		meta, ok := body["metadata"].(map[string]any)
		if !ok {
			t.Fatalf("metadata: want object, got %#v", body["metadata"])
		}
		install, ok := meta["install"].(map[string]any)
		if !ok {
			t.Fatalf("metadata.install: want normalized object, got %#v", meta["install"])
		}
		if install["method"] != "csc" || install["skill_id"] != "sk-123" || install["spec"] != "sk-123" {
			t.Fatalf("install: want {csc, sk-123, sk-123}, got %#v", install)
		}
	})

	// A present install must be preserved verbatim, not overwritten by the
	// default — normalization applies only when install is missing.
	t.Run("preserves existing install metadata", func(t *testing.T) {
		upstream := newPluginUpstream(http.StatusOK,
			`{"id":"sk-123","name":"Review Skill","itemType":"skill","repoVisibility":"public","metadata":{"install":{"method":"git","spec":"github.com/x/y","skill_id":"orig"}}}`)
		defer upstream.close()

		h := newTestHandler(Config{BuiltinPluginAPIBaseURL: upstream.baseURL()})
		req := httptest.NewRequest(http.MethodGet, "/api/catalog/skills/sk-123", nil)
		req = withURLParam(req, "id", "sk-123")
		w := httptest.NewRecorder()

		h.GetCatalogSkill(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("status: want 200, got %d: %s", w.Code, w.Body.String())
		}
		var body map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		install := body["metadata"].(map[string]any)["install"].(map[string]any)
		if install["method"] != "git" {
			t.Errorf("install.method: want git (preserved), got %#v", install["method"])
		}
		if install["spec"] != "github.com/x/y" {
			t.Errorf("install.spec: want github.com/x/y (preserved), got %#v", install["spec"])
		}
		if install["skill_id"] != "orig" {
			t.Errorf("install.skill_id: want orig (preserved), got %#v", install["skill_id"])
		}
	})

	// The snake_case item_type key must be accepted as an alternative to
	// itemType so the proxy tolerates either cloud-api response shape.
	t.Run("accepts item_type alternate key", func(t *testing.T) {
		upstream := newPluginUpstream(http.StatusOK,
			`{"id":"sk-123","name":"Snake Skill","item_type":"skill","repoVisibility":"public"}`)
		defer upstream.close()

		h := newTestHandler(Config{BuiltinPluginAPIBaseURL: upstream.baseURL()})
		req := httptest.NewRequest(http.MethodGet, "/api/catalog/skills/sk-123", nil)
		req = withURLParam(req, "id", "sk-123")
		w := httptest.NewRecorder()

		h.GetCatalogSkill(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("status: want 200, got %d: %s", w.Code, w.Body.String())
		}
	})

	// A non-skill item must be rejected with 404 and the upstream body must
	// not leak into the response — public catalog callers must never see plugin
	// or other-type item payloads.
	t.Run("non-skill item returns 404 without leaking body", func(t *testing.T) {
		upstream := newPluginUpstream(http.StatusOK,
			`{"id":"p1","name":"leaky-name","itemType":"plugin","repoVisibility":"public","content":"secret-content"}`)
		defer upstream.close()

		h := newTestHandler(Config{BuiltinPluginAPIBaseURL: upstream.baseURL()})
		req := httptest.NewRequest(http.MethodGet, "/api/catalog/skills/p1", nil)
		req = withURLParam(req, "id", "p1")
		w := httptest.NewRecorder()

		h.GetCatalogSkill(w, req)

		assertSkillNotFound(t, w, "leaky-name", "secret-content", "plugin")
	})

	// A private skill must be hidden behind 404 even though it exists upstream.
	t.Run("private repoVisibility returns 404 without leaking body", func(t *testing.T) {
		upstream := newPluginUpstream(http.StatusOK,
			`{"id":"sk-priv","name":"leaky-name","itemType":"skill","repoVisibility":"private","content":"secret-content"}`)
		defer upstream.close()

		h := newTestHandler(Config{BuiltinPluginAPIBaseURL: upstream.baseURL()})
		req := httptest.NewRequest(http.MethodGet, "/api/catalog/skills/sk-priv", nil)
		req = withURLParam(req, "id", "sk-priv")
		w := httptest.NewRecorder()

		h.GetCatalogSkill(w, req)

		assertSkillNotFound(t, w, "leaky-name", "secret-content", "private")
	})

	// A missing repoVisibility must fail closed to 404 rather than defaulting
	// to public — visibility must be explicit, not implied.
	t.Run("missing repoVisibility returns 404 without leaking body", func(t *testing.T) {
		upstream := newPluginUpstream(http.StatusOK,
			`{"id":"sk-unknown","name":"leaky-name","itemType":"skill","content":"secret-content"}`)
		defer upstream.close()

		h := newTestHandler(Config{BuiltinPluginAPIBaseURL: upstream.baseURL()})
		req := httptest.NewRequest(http.MethodGet, "/api/catalog/skills/sk-unknown", nil)
		req = withURLParam(req, "id", "sk-unknown")
		w := httptest.NewRecorder()

		h.GetCatalogSkill(w, req)

		assertSkillNotFound(t, w, "leaky-name", "secret-content")
	})

	// Upstream 404 must surface as 404 — the item genuinely doesn't exist.
	t.Run("upstream 404 returns 404", func(t *testing.T) {
		upstream := newPluginUpstream(http.StatusNotFound, `{"error":"not found"}`)
		defer upstream.close()

		h := newTestHandler(Config{BuiltinPluginAPIBaseURL: upstream.baseURL()})
		req := httptest.NewRequest(http.MethodGet, "/api/catalog/skills/missing", nil)
		req = withURLParam(req, "id", "missing")
		w := httptest.NewRecorder()

		h.GetCatalogSkill(w, req)

		if w.Code != http.StatusNotFound {
			t.Fatalf("status: want 404, got %d: %s", w.Code, w.Body.String())
		}
	})

	// Upstream 5xx must surface as 502 — the catalog is reachable but broken,
	// distinct from a not-found item.
	t.Run("upstream 500 returns 502", func(t *testing.T) {
		upstream := newPluginUpstream(http.StatusInternalServerError, `{"error":"boom"}`)
		defer upstream.close()

		h := newTestHandler(Config{BuiltinPluginAPIBaseURL: upstream.baseURL()})
		req := httptest.NewRequest(http.MethodGet, "/api/catalog/skills/sk-1", nil)
		req = withURLParam(req, "id", "sk-1")
		w := httptest.NewRecorder()

		h.GetCatalogSkill(w, req)

		if w.Code != http.StatusBadGateway {
			t.Fatalf("status: want 502, got %d: %s", w.Code, w.Body.String())
		}
	})

	// An unreachable upstream must surface as 502, not an empty envelope — the
	// detail path can't silently pretend the item doesn't exist.
	t.Run("unreachable upstream returns 502", func(t *testing.T) {
		upstream := newPluginUpstream(http.StatusOK, `{}`)
		upstream.close() // tear the listener down so the proxy dial fails

		h := newTestHandler(Config{BuiltinPluginAPIBaseURL: upstream.baseURL()})
		req := httptest.NewRequest(http.MethodGet, "/api/catalog/skills/sk-1", nil)
		req = withURLParam(req, "id", "sk-1")
		w := httptest.NewRecorder()

		h.GetCatalogSkill(w, req)

		if w.Code != http.StatusBadGateway {
			t.Fatalf("status: want 502, got %d: %s", w.Code, w.Body.String())
		}
	})

	// An empty id is a client error, not a catalog lookup.
	t.Run("empty id returns 400", func(t *testing.T) {
		upstream := newPluginUpstream(http.StatusOK, `{}`)
		defer upstream.close()

		h := newTestHandler(Config{BuiltinPluginAPIBaseURL: upstream.baseURL()})
		req := httptest.NewRequest(http.MethodGet, "/api/catalog/skills/", nil)
		req = withURLParam(req, "id", "")
		w := httptest.NewRecorder()

		h.GetCatalogSkill(w, req)

		if w.Code != http.StatusBadRequest {
			t.Fatalf("status: want 400, got %d: %s", w.Code, w.Body.String())
		}
		if upstream.callCount() != 0 {
			t.Errorf("upstream call count: want 0 (no fetch for empty id), got %d", upstream.callCount())
		}
	})
}

// assertSkillNotFound asserts the response is a 404 error envelope that does
// not leak any of the given upstream-only values, guarding the contract that
// non-public/non-skill detail requests fail closed without exposing the
// upstream item body.
func assertSkillNotFound(t *testing.T, w *httptest.ResponseRecorder, leaked ...string) {
	t.Helper()
	if w.Code != http.StatusNotFound {
		t.Fatalf("status: want 404, got %d: %s", w.Code, w.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(body) != 1 || body["error"] == nil {
		t.Fatalf("response must be a single-field error envelope, got %#v", body)
	}
	for _, leak := range leaked {
		if strings.Contains(w.Body.String(), leak) {
			t.Errorf("response leaked upstream value %q: %s", leak, w.Body.String())
		}
	}
}
