package handler

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

// giteaStub is an httptest server that records the proxied request it
// receives (method, path, X-Forwarded-* headers, Cookie) so the proxy's
// Director behavior can be asserted.
type giteaStub struct {
	srv *httptest.Server
	got *http.Request
}

func newGiteaStub(t *testing.T) *giteaStub {
	t.Helper()
	s := &giteaStub{}
	s.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.got = r.Clone(r.Context())
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))
	t.Cleanup(s.srv.Close)
	return s
}

func TestGiteaProxyHandler_InjectsDerivedUser(t *testing.T) {
	st := newGiteaStub(t)
	t.Setenv("GITEA_BASE_URL", st.srv.URL)

	proxy := GiteaProxyHandler()
	req := httptest.NewRequest("GET", "/t-abc/w-def/pulls/3", nil)
	// GiteaProxyAuth (the middleware front-end) sets these from the JWT.
	req.Header.Set("X-User-Email", "29219@dept.local")
	w := httptest.NewRecorder()
	proxy.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if st.got.Header.Get("X-Forwarded-User") != "29219" {
		t.Fatalf("expected X-Forwarded-User '29219', got '%s'", st.got.Header.Get("X-Forwarded-User"))
	}
	if st.got.Header.Get("X-Forwarded-Email") != "29219@dept.local" {
		t.Fatalf("expected X-Forwarded-Email, got '%s'", st.got.Header.Get("X-Forwarded-Email"))
	}
	if st.got.URL.Path != "/t-abc/w-def/pulls/3" {
		t.Fatalf("expected path forwarded verbatim, got '%s'", st.got.URL.Path)
	}
}

func TestGiteaProxyHandler_AntiForgeryStripsClientHeaders(t *testing.T) {
	// A malicious browser could supply X-Forwarded-User to impersonate anyone.
	// The proxy must drop it (and the multica session cookie) before injecting
	// its own identity derived from the validated JWT.
	st := newGiteaStub(t)
	t.Setenv("GITEA_BASE_URL", st.srv.URL)

	proxy := GiteaProxyHandler()
	req := httptest.NewRequest("GET", "/t-abc/w-def/pulls/3", nil)
	req.Header.Set("X-User-Email", "29219@dept.local")
	req.Header.Set("X-Forwarded-User", "evil-admin")        // client forgery attempt
	req.Header.Set("X-Forwarded-Email", "evil@admin.local") // client forgery attempt
	req.Header.Set("Cookie", "multica_auth=stolen; other=1") // multica cookie leak attempt

	w := httptest.NewRecorder()
	proxy.ServeHTTP(w, req)

	if st.got.Header.Get("X-Forwarded-User") != "29219" {
		t.Fatalf("client-supplied X-Forwarded-User must be overwritten with derived user; got '%s'", st.got.Header.Get("X-Forwarded-User"))
	}
	if st.got.Header.Get("X-Forwarded-Email") != "29219@dept.local" {
		t.Fatalf("client-supplied X-Forwarded-Email must be overwritten; got '%s'", st.got.Header.Get("X-Forwarded-Email"))
	}
	if st.got.Header.Get("Cookie") != "" {
		t.Fatalf("multica session cookie must not leak to Gitea; got '%s'", st.got.Header.Get("Cookie"))
	}
}

func TestGiteaProxyHandler_NotConfigured(t *testing.T) {
	t.Setenv("GITEA_BASE_URL", "")
	proxy := GiteaProxyHandler()
	req := httptest.NewRequest("GET", "/t-abc/w-def/pulls/3", nil)
	w := httptest.NewRecorder()
	proxy.ServeHTTP(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 when Gitea not configured, got %d", w.Code)
	}
}

func TestGiteaProxyHandler_TargetIsRootHost(t *testing.T) {
	// GITEA_BASE_URL may carry a path (subpath deployments); the proxy must
	// target the ROOT host while forwarding the request path verbatim.
	st := newGiteaStub(t)
	srvURL, _ := url.Parse(st.srv.URL)
	t.Setenv("GITEA_BASE_URL", st.srv.URL+"/gitea") // path-bearing base

	proxy := GiteaProxyHandler()
	req := httptest.NewRequest("GET", "/t-abc/w-def/pulls/3", nil)
	req.Header.Set("X-User-Email", "u@x.local")
	w := httptest.NewRecorder()
	proxy.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if st.got.URL.Path != "/t-abc/w-def/pulls/3" {
		t.Fatalf("path must be forwarded verbatim (not /gitea-prefixed); got '%s'", st.got.URL.Path)
	}
	if st.got.Host != srvURL.Host {
		t.Fatalf("must target the root host of GITEA_BASE_URL; got Host '%s'", st.got.Host)
	}
}
