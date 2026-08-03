package plugincatalog

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFetchUsesTopLevelInstallFromItemDetail(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path != "/api/items/plugin-1" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(`{
			"id":"plugin-1",
			"name":"Plugin One",
			"content":"plugin content",
			"metadata":{"install":{"method":"legacy","plugin_name":"legacy-plugin"}},
			"install":{
				"method":"plugin_marketplace",
				"marketplace":"costrict-plugins-repo/plugin-one",
				"plugin_name":"plugin-one",
				"marketplace_name":"costrict-plugins",
				"marketplace_repo":"https://example.test/marketplace.git",
				"marketplace_verified":true
			}
		}`))
	}))
	defer upstream.Close()

	result := Fetch(t.Context(), upstream.URL, "plugin-1")
	if result == nil || result.Info == nil {
		t.Fatal("expected plugin detail result")
	}
	install := result.Info.Install
	if install.Method != "plugin_marketplace" {
		t.Fatalf("install method: want top-level plugin_marketplace, got %#v", install)
	}
	if install.PluginName != "plugin-one" {
		t.Fatalf("plugin name: want plugin-one, got %#v", install)
	}
	if install.MarketplaceRepo != "https://example.test/marketplace.git" {
		t.Fatalf("marketplace repo: got %#v", install)
	}
}

func TestFetchFallsBackToItemsPluginList(t *testing.T) {
	var paths []string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path+"?"+r.URL.RawQuery)
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/items/plugin-2":
			http.NotFound(w, r)
		case "/api/items":
			if r.URL.Query().Get("type") != "plugin" {
				t.Fatalf("type query: want plugin, got %q", r.URL.Query().Get("type"))
			}
			_, _ = w.Write([]byte(`{
				"items":[{
					"id":"plugin-2",
					"name":"Plugin Two",
					"content":"plugin two content",
					"install":{"method":"plugin_marketplace","plugin_name":"plugin-two"}
				}],
				"page":1,
				"pageSize":100,
				"hasMore":false
			}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	result := Fetch(t.Context(), upstream.URL, "plugin-2")
	if result == nil || result.Info == nil {
		t.Fatal("expected plugin from /api/items fallback")
	}
	if result.Info.Install.PluginName != "plugin-two" {
		t.Fatalf("plugin name: want plugin-two, got %#v", result.Info.Install)
	}
	if len(paths) != 2 {
		t.Fatalf("request count: want detail plus list fallback, got %d paths=%v", len(paths), paths)
	}
}
