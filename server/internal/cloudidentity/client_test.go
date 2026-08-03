package cloudidentity

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestResolveSubjectID_TranslatesAndCachesByUniversalID(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		if r.URL.Path != "/api/auth/me" {
			t.Errorf("path = %q, want /api/auth/me", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer tok-1" {
			t.Errorf("auth header = %q, want Bearer tok-1", got)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"user": map[string]any{"subjectId": "usr_48b35a2c-1234"},
		})
	}))
	defer srv.Close()

	c := NewClient(Config{BaseURL: srv.URL, CacheTTL: time.Minute})
	ctx := context.Background()

	// First call hits the upstream and caches by universal_id.
	got, err := c.ResolveSubjectID(ctx, "aadbc069-universal", "tok-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "usr_48b35a2c-1234" {
		t.Errorf("subject = %q, want usr_48b35a2c-1234", got)
	}

	// A second call with the SAME universal_id but a DIFFERENT (refreshed)
	// access token must be served from cache — no new upstream hit. This is
	// the point of keying the cache on the stable universal_id, not the token.
	got2, err := c.ResolveSubjectID(ctx, "aadbc069-universal", "tok-2-refreshed")
	if err != nil || got2 != got {
		t.Fatalf("cached call with refreshed token: got=%q err=%v", got2, err)
	}
	if n := atomic.LoadInt32(&calls); n != 1 {
		t.Errorf("upstream calls = %d, want 1 (cache keyed by universal_id)", n)
	}
}

func TestResolveSubjectID_DisabledWhenBaseURLEmpty(t *testing.T) {
	c := NewClient(Config{}) // no BaseURL
	if c.Enabled() {
		t.Fatal("client should be disabled without BaseURL")
	}
	if _, err := c.ResolveSubjectID(context.Background(), "aadbc069-universal", "tok"); err == nil {
		t.Fatal("expected error when client disabled")
	}
}

func TestResolveSubjectID_Non200Errors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.Copy(io.Discard, r.Body)
	}))
	defer srv.Close()

	c := NewClient(Config{BaseURL: srv.URL})
	if _, err := c.ResolveSubjectID(context.Background(), "aadbc069-universal", "tok"); err == nil ||
		!strings.Contains(err.Error(), "401") {
		t.Fatalf("expected 401 error, got %v", err)
	}
}
