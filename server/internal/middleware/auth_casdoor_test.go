package middleware

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// casdoorCookieName is the Casdoor session cookie read by the middleware.
// Duplicated here only for test clarity; the production constant lives in
// auth_casdoor.go.
const casdoorCookieName = "zgsmAdminToken"

// signRS256 creates a signed RS256 JWT with the given kid header and claims.
// ParseCasdoorJWT no longer verifies the signature (the gateway does), but a
// well-formed RS256 token remains a realistic fixture.
func signRS256(t *testing.T, key *rsa.PrivateKey, kid string, claims jwt.MapClaims) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = kid
	signed, err := token.SignedString(key)
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return signed
}

// stubResolver returns a SubjectResolver that maps any subject to the given
// Multica user UUID. It fails the test when the resolver is called with an
// unexpected subject.
func stubResolver(t *testing.T, wantSubject, multicaUUID string) SubjectResolver {
	t.Helper()
	return func(_ context.Context, subjectID, universalID, name, email string) (string, error) {
		if subjectID != wantSubject {
			t.Fatalf("resolver called with subject %q, want %q", subjectID, wantSubject)
		}
		return multicaUUID, nil
	}
}

func TestCasdoorAuth_ValidCookie(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	const (
		kid         = "casdoor-test-kid"
		subjectID   = "casdoor-user-42"
		multicaUUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
	)
	resolver := stubResolver(t, subjectID, multicaUUID)

	mw := CasdoorAuth(resolver, nil)

	var gotUserID, gotSubject string
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUserID = r.Header.Get("X-User-ID")
		gotSubject = r.Header.Get("X-Subject-ID")
		w.WriteHeader(http.StatusOK)
	}))

	tokenStr := signRS256(t, key, kid, jwt.MapClaims{
		"sub":   subjectID,
		"name":  "Test User",
		"email": "test@example.com",
		"exp":   time.Now().Add(1 * time.Hour).Unix(),
	})

	req := httptest.NewRequest("GET", "/api/issues", nil)
	req.AddCookie(&http.Cookie{Name: casdoorCookieName, Value: tokenStr})
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body=%s", w.Code, w.Body.String())
	}
	if gotUserID != multicaUUID {
		t.Errorf("X-User-ID = %q, want %q", gotUserID, multicaUUID)
	}
	if gotSubject != subjectID {
		t.Errorf("X-Subject-ID = %q, want %q", gotSubject, subjectID)
	}
}

func TestCasdoorAuth_NoCookiePassesThrough(t *testing.T) {
	resolver := func(_ context.Context, _, _, _, _ string) (string, error) {
		t.Fatal("resolver should not be called when no token is present")
		return "", nil
	}

	mw := CasdoorAuth(resolver, nil)
	called := false
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		if uid := r.Header.Get("X-User-ID"); uid != "" {
			t.Errorf("X-User-ID should not be set without Casdoor token, got %q", uid)
		}
		if sid := r.Header.Get("X-Subject-ID"); sid != "" {
			t.Errorf("X-Subject-ID should not be set without Casdoor token, got %q", sid)
		}
		w.WriteHeader(http.StatusNoContent)
	}))

	req := httptest.NewRequest("GET", "/api/issues", nil)
	// No cookie, no Authorization header.
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204 pass-through, got %d; body=%s", w.Code, w.Body.String())
	}
	if !called {
		t.Fatal("next handler was not called without Casdoor token")
	}
}

func TestCasdoorAuth_PATTokenPassesThrough(t *testing.T) {
	// The resolver is irrelevant — a PAT-prefixed Bearer token must
	// short-circuit before it is consulted.
	resolver := func(_ context.Context, _, _, _, _ string) (string, error) {
		t.Fatal("resolver should not be called for PAT tokens")
		return "", nil
	}

	mw := CasdoorAuth(resolver, nil)

	called := false
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		// The middleware must NOT have set X-User-ID or X-Subject-ID —
		// those belong to the downstream PAT middleware.
		if uid := r.Header.Get("X-User-ID"); uid != "" {
			t.Errorf("X-User-ID should not be set by CasdoorAuth for PAT, got %q", uid)
		}
		if sid := r.Header.Get("X-Subject-ID"); sid != "" {
			t.Errorf("X-Subject-ID should not be set by CasdoorAuth for PAT, got %q", sid)
		}
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/api/issues", nil)
	req.Header.Set("Authorization", "Bearer mul_some_personal_access_token")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 pass-through for PAT, got %d", w.Code)
	}
	if !called {
		t.Fatal("next handler was not called for PAT pass-through")
	}
}
