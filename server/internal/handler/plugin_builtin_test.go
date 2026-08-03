package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"testing"

	"github.com/multica-ai/multica/server/internal/plugincatalog"
)

// pluginListEnvelope mirrors the list envelope ListBuiltinPlugins returns to
// the client, including the empty-list fallback shape used on upstream failure.
type pluginListEnvelope struct {
	Items    []map[string]any `json:"items"`
	Total    int              `json:"total"`
	Page     int              `json:"page"`
	PageSize int              `json:"pageSize"`
	HasMore  bool             `json:"hasMore"`
}

// pluginUpstream is a minimal httptest stand-in for the cloud-api catalog. It
// records the last inbound request and replays a fixed status/body. Fields are
// mutex-guarded because the server handler runs on its own goroutine; the
// handler's client.Do is synchronous, so the recorded state is complete by the
// time the test reads it.
type pluginUpstream struct {
	server *httptest.Server

	mu    sync.Mutex
	path  string
	query url.Values
	calls int
}

// newPluginUpstream starts an httptest server that responds to every request
// with the given status and body, recording what it received.
func newPluginUpstream(status int, body string) *pluginUpstream {
	u := &pluginUpstream{}
	u.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u.mu.Lock()
		u.calls++
		u.path = r.URL.Path
		u.query = r.URL.Query()
		u.mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	return u
}

func (u *pluginUpstream) close()          { u.server.Close() }
func (u *pluginUpstream) baseURL() string { return u.server.URL }

func (u *pluginUpstream) callCount() int {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.calls
}

func (u *pluginUpstream) lastPath() string {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.path
}

// lastQuery returns a defensive copy of the last recorded query so callers can
// read it outside the lock.
func (u *pluginUpstream) lastQuery() url.Values {
	u.mu.Lock()
	defer u.mu.Unlock()
	cp := make(url.Values, len(u.query))
	for k, v := range u.query {
		cp[k] = append([]string(nil), v...)
	}
	return cp
}

// assertEmptyPluginEnvelope fails the test unless body is exactly the
// {items:[],total:0,page:1,pageSize:100,hasMore:false} fallback the handler
// must return when the upstream catalog is unavailable.
func assertEmptyPluginEnvelope(t *testing.T, body []byte) {
	t.Helper()
	var env pluginListEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(env.Items) != 0 {
		t.Errorf("items: want empty, got %d elements", len(env.Items))
	}
	if env.Total != 0 {
		t.Errorf("total: want 0, got %d", env.Total)
	}
	if env.Page != 1 {
		t.Errorf("page: want 1, got %d", env.Page)
	}
	if env.PageSize != 100 {
		t.Errorf("pageSize: want 100, got %d", env.PageSize)
	}
	if env.HasMore {
		t.Errorf("hasMore: want false, got true")
	}
}

func TestListBuiltinPlugins(t *testing.T) {
	// Empty search must proxy to the catalog's plugin listing endpoint
	// (/api/items?type=plugin), not /api/plugins/builtin (which returns an
	// empty list on cloud-api and would hide every plugin from the picker).
	t.Run("empty query forwards to /api/items?type=plugin", func(t *testing.T) {
		upstream := newPluginUpstream(http.StatusOK,
			`{"items":[{"id":"p1","name":"Plugin One"}],"total":1,"page":1,"pageSize":100,"hasMore":false}`)
		defer upstream.close()

		h := newTestHandler(Config{BuiltinPluginAPIBaseURL: upstream.baseURL()})
		req := httptest.NewRequest(http.MethodGet, "/api/plugins/builtin", nil)
		w := httptest.NewRecorder()

		h.ListBuiltinPlugins(w, req)

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
		if q.Get("type") != "plugin" {
			t.Errorf("type param: want plugin, got %q", q.Get("type"))
		}
		if _, ok := q["search"]; ok {
			t.Errorf("search param: want absent on empty query, got %q", q.Get("search"))
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
		if len(env.Items) != 1 || env.Items[0]["id"] != "p1" {
			t.Fatalf("forwarded items: want [{id:p1}], got %#v", env.Items)
		}
	})

	// A non-empty ?q= must redirect the proxy to the items search endpoint
	// scoped to plugins, instead of the unfiltered builtin catalog.
	t.Run("q=design forwards to /api/items search endpoint", func(t *testing.T) {
		upstream := newPluginUpstream(http.StatusOK,
			`{"items":[{"id":"figma","name":"Figma"}],"total":1,"page":1,"pageSize":100,"hasMore":false}`)
		defer upstream.close()

		h := newTestHandler(Config{BuiltinPluginAPIBaseURL: upstream.baseURL()})
		req := httptest.NewRequest(http.MethodGet, "/api/plugins/builtin?q=design", nil)
		w := httptest.NewRecorder()

		h.ListBuiltinPlugins(w, req)

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
		if q.Get("type") != "plugin" {
			t.Errorf("type param: want plugin, got %q", q.Get("type"))
		}
		if q.Get("search") != "design" {
			t.Errorf("search param: want design, got %q", q.Get("search"))
		}
		if q.Get("page") != "1" {
			t.Errorf("page param: want 1, got %q", q.Get("page"))
		}
		if q.Get("pageSize") != "100" {
			t.Errorf("pageSize param: want 100, got %q", q.Get("pageSize"))
		}
	})

	// A failing upstream (non-200) must degrade gracefully to the empty-list
	// envelope with an HTTP 200, never surfacing the error to the client.
	t.Run("upstream non-200 returns empty envelope with HTTP 200", func(t *testing.T) {
		upstream := newPluginUpstream(http.StatusBadGateway, `{"error":"upstream down"}`)
		defer upstream.close()

		h := newTestHandler(Config{BuiltinPluginAPIBaseURL: upstream.baseURL()})
		req := httptest.NewRequest(http.MethodGet, "/api/plugins/builtin", nil)
		w := httptest.NewRecorder()

		h.ListBuiltinPlugins(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("status: want 200 (empty envelope), got %d: %s", w.Code, w.Body.String())
		}
		assertEmptyPluginEnvelope(t, w.Body.Bytes())
	})

	// An unreachable upstream (connection refused) must likewise degrade to the
	// empty-list envelope with an HTTP 200.
	t.Run("unreachable upstream returns empty envelope with HTTP 200", func(t *testing.T) {
		upstream := newPluginUpstream(http.StatusOK, `{}`)
		upstream.close() // tear the listener down so the proxy dial fails

		h := newTestHandler(Config{BuiltinPluginAPIBaseURL: upstream.baseURL()})
		req := httptest.NewRequest(http.MethodGet, "/api/plugins/builtin", nil)
		w := httptest.NewRecorder()

		h.ListBuiltinPlugins(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("status: want 200 (empty envelope), got %d: %s", w.Code, w.Body.String())
		}
		assertEmptyPluginEnvelope(t, w.Body.Bytes())
	})
}

func TestGetPluginForwardsToItemDetail(t *testing.T) {
	upstream := newPluginUpstream(http.StatusOK,
		`{"id":"figma","name":"Figma","description":"Design","slug":"figma","version":"1.0.0","category":"design","metadata":{"install":{"plugin_name":"figma"}},"content":"plugin instructions"}`)
	defer upstream.close()

	h := newTestHandler(Config{BuiltinPluginAPIBaseURL: upstream.baseURL()})
	req := httptest.NewRequest(http.MethodGet, "/api/plugins/figma", nil)
	req = withURLParam(req, "id", "figma")
	w := httptest.NewRecorder()

	h.GetPlugin(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d: %s", w.Code, w.Body.String())
	}
	if upstream.callCount() != 1 {
		t.Fatalf("upstream call count: want 1, got %d", upstream.callCount())
	}
	if got := upstream.lastPath(); got != "/api/items/figma" {
		t.Fatalf("upstream path: want /api/items/figma, got %q", got)
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body["id"] != "figma" || body["content"] != "plugin instructions" {
		t.Fatalf("forwarded body: got %#v", body)
	}
}

func TestFetchPluginDataResolvesItemDetailOnlyPlugin(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/plugins/builtin":
			_, _ = w.Write([]byte(`{"items":[],"total":0,"page":1,"pageSize":100,"hasMore":false}`))
		case "/api/items/search-only":
			_, _ = w.Write([]byte(`{"id":"search-only","name":"Search Only","content":"Use this searched plugin.","metadata":{"install":{"method":"csc","plugin_name":"search-only-plugin","marketplace":"github"}}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	result := plugincatalog.Fetch(t.Context(), upstream.URL, "search-only")
	if result == nil {
		t.Fatal("expected plugin data from item detail, got nil")
	}
	if result.Content != "Use this searched plugin." {
		t.Fatalf("content: want detail content, got %q", result.Content)
	}
	if result.Info == nil {
		t.Fatal("expected plugin info")
	}
	if result.Info.ID != "search-only" || result.Info.Name != "Search Only" {
		t.Fatalf("plugin info: got %#v", result.Info)
	}
	if result.Info.Install.PluginName != "search-only-plugin" || result.Info.Install.Method != "csc" {
		t.Fatalf("install metadata: got %#v", result.Info.Install)
	}
}
