package middleware

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// slogCapture is a slog.Handler that records every log record for test
// assertions.
type slogCapture struct {
	mu   sync.Mutex
	recs []slog.Record
}

func (c *slogCapture) Enabled(_ context.Context, _ slog.Level) bool { return true }

func (c *slogCapture) Handle(_ context.Context, r slog.Record) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.recs = append(c.recs, r)
	return nil
}

func (c *slogCapture) WithAttrs(_ []slog.Attr) slog.Handler { return c }
func (c *slogCapture) WithGroup(_ string) slog.Handler      { return c }

func (c *slogCapture) hasRecordAtLeast(level slog.Level, msgSubstr string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, r := range c.recs {
		if r.Level >= level && strings.Contains(r.Message, msgSubstr) {
			return true
		}
	}
	return false
}

// installSlogCapture routes the default slog output into a capture for the
// duration of the test.
func installSlogCapture(t *testing.T) *slogCapture {
	t.Helper()
	cap := &slogCapture{}
	prev := slog.Default()
	slog.SetDefault(slog.New(cap))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return cap
}

// failingTranslator always fails cloud subject translation, forcing the
// middleware onto the raw-JWT-sub fallback path.
type failingTranslator struct{ err error }

func (f failingTranslator) ResolveSubjectID(context.Context, string, string) (string, error) {
	return "", f.err
}

// A failed cloud subject translation silently provisions users under the raw
// Casdoor sub, splitting one human into multiple accounts. That must be
// visible at Warn level — Debug is invisible in production.
func TestCasdoorAuth_TranslationFailureLogsWarn(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	const (
		subjectID   = "casdoor-user-42"
		multicaUUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
	)
	cap := installSlogCapture(t)

	mw := CasdoorAuth(stubResolver(t, subjectID, multicaUUID), failingTranslator{err: errors.New("cloud-api unreachable")})

	var gotSubject string
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotSubject = r.Header.Get("X-Subject-ID")
		w.WriteHeader(http.StatusOK)
	}))

	tokenStr := signRS256(t, key, "kid", jwt.MapClaims{
		"sub": subjectID,
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	req := httptest.NewRequest("GET", "/api/issues", nil)
	req.AddCookie(&http.Cookie{Name: casdoorCookieName, Value: tokenStr})
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body=%s", w.Code, w.Body.String())
	}
	if gotSubject != subjectID {
		t.Fatalf("X-Subject-ID = %q, want fallback to raw sub %q", gotSubject, subjectID)
	}
	if !cap.hasRecordAtLeast(slog.LevelWarn, "cloud subject translation failed") {
		t.Fatalf("translation failure not logged at Warn or above; records: %v", cap.recs)
	}
}

// Same visibility requirement on the daemon auth path.
func TestDaemonAuth_TranslationFailureLogsWarn(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	const (
		subjectID   = "casdoor-user-42"
		multicaUUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
	)
	cap := installSlogCapture(t)

	resolver := stubResolver(t, subjectID, multicaUUID)
	mw := DaemonAuth(nil, nil, nil, resolver, failingTranslator{err: errors.New("cloud-api unreachable")})

	var gotSubject string
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotSubject = r.Header.Get("X-Subject-ID")
		w.WriteHeader(http.StatusOK)
	}))

	tokenStr := signRS256(t, key, "kid", jwt.MapClaims{
		"sub": subjectID,
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	req := httptest.NewRequest("GET", "/api/issues", nil)
	req.Header.Set("Authorization", "Bearer "+tokenStr)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body=%s", w.Code, w.Body.String())
	}
	if gotSubject != subjectID {
		t.Fatalf("X-Subject-ID = %q, want fallback to raw sub %q", gotSubject, subjectID)
	}
	if !cap.hasRecordAtLeast(slog.LevelWarn, "cloud subject translation failed") {
		t.Fatalf("translation failure not logged at Warn or above; records: %v", cap.recs)
	}
}
