package handler

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestQuotaManagerProxy_NilWhenUnconfigured guards the "disabled" branch: when
// QUOTA_MANAGER_API_BASE_URL is empty the proxy returns nil so the router can
// fall back to a 503 instead of panicking on a nil handler.
func TestQuotaManagerProxy_NilWhenUnconfigured(t *testing.T) {
	h := &Handler{cfg: Config{QuotaManagerAPIBaseURL: ""}}
	if got := h.QuotaManagerProxy(); got != nil {
		t.Fatalf("expected nil proxy when unconfigured, got %v", got)
	}
}

// TestQuotaManagerProxy_NilWhenInvalidURL guards the parse-failure branch.
func TestQuotaManagerProxy_NilWhenInvalidURL(t *testing.T) {
	h := &Handler{cfg: Config{QuotaManagerAPIBaseURL: "://not-a-url"}}
	if got := h.QuotaManagerProxy(); got != nil {
		t.Fatalf("expected nil proxy for an invalid base URL, got %v", got)
	}
}

// TestQuotaManagerProxy_ForwardsPathAndQuery verifies the Director rewrites the
// path correctly: the frontend calls /api/quota-manager/api/v1/quota; the
// upstream (base = https://host/cloud-api) must receive
// /cloud-api/quota-manager/api/v1/quota. The leading /api segment is local
// routing only and is stripped before forwarding.
func TestQuotaManagerProxy_ForwardsPathAndQuery(t *testing.T) {
	var (
		gotPath   string
		gotMethod string
		gotQuery  string
	)

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotMethod = r.Method
		gotQuery = r.URL.RawQuery
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"total_quota":100,"used_quota":25,"quota_list":[]}`)
	}))
	defer upstream.Close()

	// The upstream is plain http://127.0.0.1:port — use that as the base.
	base := strings.TrimRight(upstream.URL, "/")
	h := &Handler{cfg: Config{QuotaManagerAPIBaseURL: base}}
	proxy := h.QuotaManagerProxy()
	if proxy == nil {
		t.Fatalf("expected non-nil proxy for configured base %q", base)
	}

	req := httptest.NewRequest(http.MethodGet,
		"/api/quota-manager/api/v1/usage/statistics?page=1&page_size=10&time_range=today", nil)
	rec := httptest.NewRecorder()
	proxy(rec, req)

	if gotMethod != http.MethodGet {
		t.Errorf("upstream method: got %q, want GET", gotMethod)
	}
	if gotPath != "/quota-manager/api/v1/usage/statistics" {
		t.Errorf("upstream path: got %q, want /quota-manager/api/v1/usage/statistics", gotPath)
	}
	if gotQuery != "page=1&page_size=10&time_range=today" {
		t.Errorf("upstream query: got %q, want the forwarded query string", gotQuery)
	}

	// Response body passes through unchanged.
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response body not valid JSON: %v (body=%q)", err, rec.Body.String())
	}
	if body["total_quota"] != float64(100) {
		t.Errorf("response total_quota: got %v, want 100", body["total_quota"])
	}
}

// TestQuotaManagerProxy_StripsUpstreamCORS confirms upstream CORS headers are
// dropped so they don't duplicate the local CORS middleware's headers.
func TestQuotaManagerProxy_StripsUpstreamCORS(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "https://evil.example")
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		_, _ = io.WriteString(w, `{"total_quota":1,"used_quota":0,"quota_list":[]}`)
	}))
	defer upstream.Close()

	h := &Handler{cfg: Config{QuotaManagerAPIBaseURL: strings.TrimRight(upstream.URL, "/")}}
	proxy := h.QuotaManagerProxy()

	req := httptest.NewRequest(http.MethodGet, "/api/quota-manager/api/v1/quota", nil)
	rec := httptest.NewRecorder()
	proxy(rec, req)

	if v := rec.Header().Get("Access-Control-Allow-Origin"); v != "" {
		t.Errorf("expected upstream CORS header stripped, got %q", v)
	}
}
