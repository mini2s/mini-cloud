package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/multica-ai/multica/server/internal/auth"
)

func giteaProxyAuthMiddleware(next http.Handler) http.Handler {
	return GiteaProxyAuth()(next)
}

func TestGiteaProxyAuth_ValidBearer(t *testing.T) {
	var gotUserID, gotEmail string
	handler := giteaProxyAuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUserID = r.Header.Get("X-User-ID")
		gotEmail = r.Header.Get("X-User-Email")
		w.WriteHeader(http.StatusOK)
	}))

	token := generateToken(validClaims(), auth.JWTSecret())
	req := httptest.NewRequest("GET", "/gitea/t-x/w-y/pulls/1", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if gotUserID != "test-user-id" {
		t.Fatalf("expected X-User-ID 'test-user-id', got '%s'", gotUserID)
	}
	if gotEmail != "test@multica.ai" {
		t.Fatalf("expected X-User-Email 'test@multica.ai', got '%s'", gotEmail)
	}
}

func TestGiteaProxyAuth_ValidCookieNoCSRF(t *testing.T) {
	// Unlike Auth, GiteaProxyAuth must NOT require CSRF on a cookie token —
	// Gitea's own UI POSTs carry Gitea's CSRF, not multica's.
	ok := false
	handler := giteaProxyAuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ok = true
	}))
	token := generateToken(validClaims(), auth.JWTSecret())
	req := httptest.NewRequest("POST", "/gitea/t-x/w-y/issues", nil)
	req.AddCookie(&http.Cookie{Name: auth.AuthCookieName, Value: token})
	// Deliberately NO X-CSRF-Token header.
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("cookie POST without CSRF must pass (Gitea has its own CSRF); got %d", w.Code)
	}
	if !ok {
		t.Fatal("next handler should have been called")
	}
}

func TestGiteaProxyAuth_Missing(t *testing.T) {
	handler := giteaProxyAuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("next handler should not be called")
	}))
	req := httptest.NewRequest("GET", "/gitea/", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestGiteaProxyAuth_Invalid(t *testing.T) {
	handler := giteaProxyAuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("next handler should not be called")
	}))
	req := httptest.NewRequest("GET", "/gitea/", nil)
	req.Header.Set("Authorization", "Bearer not-a-jwt")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestGiteaProxyAuth_PresetUserIDPassthrough(t *testing.T) {
	// If CasdoorAuth (stacked before) already set X-User-ID, skip re-validation.
	var got string
	handler := giteaProxyAuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Header.Get("X-User-ID")
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest("GET", "/gitea/", nil)
	req.Header.Set("X-User-ID", "casdoor-resolved-id")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if got != "casdoor-resolved-id" {
		t.Fatalf("expected passthrough X-User-ID, got '%s'", got)
	}
}
