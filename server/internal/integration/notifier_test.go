package integration

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func testEnvelope() Envelope {
	return Envelope{
		Version:    1,
		EventID:    "evt-1",
		Type:       EventIssueStatusChanged,
		OccurredAt: time.Date(2026, 7, 27, 10, 0, 0, 0, time.UTC),
		Workspace:  WorkspaceRef{ID: "ws-1", Name: "Acme"},
		Actor:      ActorRef{Type: "system", Name: "workflow"},
		Issue: IssueRef{
			ID:         "issue-1",
			Identifier: "MUL-123",
			Title:      "Fix the thing",
			PrevStatus: "in_progress",
			Status:     "done",
			URL:        "https://multica.example.com/acme/issues/MUL-123",
		},
		Recipients: []string{"alice@corp.com"},
	}
}

func TestDeliverSendsSignedEnvelope(t *testing.T) {
	var gotBody []byte
	var gotSig string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotBody, _ = io.ReadAll(r.Body)
		gotSig = r.Header.Get("X-Multica-Signature")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	n := NewNotifier(srv.URL, "topsecret")
	n.backoff = func(int) time.Duration { return 0 }
	if err := n.deliver(context.Background(), testEnvelope()); err != nil {
		t.Fatalf("deliver: %v", err)
	}

	mac := hmac.New(sha256.New, []byte("topsecret"))
	mac.Write(gotBody)
	wantSig := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	if gotSig != wantSig {
		t.Fatalf("signature = %q, want %q", gotSig, wantSig)
	}

	var env Envelope
	if err := json.Unmarshal(gotBody, &env); err != nil {
		t.Fatalf("body is not the envelope: %v", err)
	}
	if env.EventID != "evt-1" || env.Type != EventIssueStatusChanged || env.Issue.Identifier != "MUL-123" {
		t.Fatalf("unexpected envelope: %+v", env)
	}
	if len(env.Recipients) != 1 || env.Recipients[0] != "alice@corp.com" {
		t.Fatalf("unexpected recipients: %+v", env.Recipients)
	}
}

func TestDeliverRetriesOnServerError(t *testing.T) {
	var attempts atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		attempts.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	n := NewNotifier(srv.URL, "s")
	n.backoff = func(int) time.Duration { return 0 }
	err := n.deliver(context.Background(), testEnvelope())
	if err == nil {
		t.Fatal("expected error after retries exhausted")
	}
	if got := attempts.Load(); got != 4 { // 1 initial + 3 retries
		t.Fatalf("attempts = %d, want 4", got)
	}
}

func TestDeliverDoesNotRetryOnClientError(t *testing.T) {
	var attempts atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		attempts.Add(1)
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer srv.Close()

	n := NewNotifier(srv.URL, "s")
	n.backoff = func(int) time.Duration { return 0 }
	err := n.deliver(context.Background(), testEnvelope())
	if err == nil {
		t.Fatal("expected error on 400")
	}
	if got := attempts.Load(); got != 1 {
		t.Fatalf("attempts = %d, want 1 (no retry on 4xx)", got)
	}
}

func TestEnqueueDoesNotBlockWhenQueueFull(t *testing.T) {
	n := NewNotifier("http://127.0.0.1:1", "s")
	n.queueSize = 2

	if ok := n.Enqueue(testEnvelope()); !ok {
		t.Fatal("first enqueue should succeed")
	}
	if ok := n.Enqueue(testEnvelope()); !ok {
		t.Fatal("second enqueue should succeed")
	}
	done := make(chan bool, 1)
	go func() { done <- n.Enqueue(testEnvelope()) }()
	select {
	case ok := <-done:
		if ok {
			t.Fatal("enqueue on a full queue should report drop")
		}
	case <-time.After(time.Second):
		t.Fatal("Enqueue blocked on a full queue")
	}
}

func TestWorkerDeliversEnqueuedEnvelope(t *testing.T) {
	delivered := make(chan Envelope, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var env Envelope
		_ = json.NewDecoder(r.Body).Decode(&env)
		delivered <- env
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	n := NewNotifier(srv.URL, "s")
	n.backoff = func(int) time.Duration { return 0 }
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go n.Run(ctx)

	if ok := n.Enqueue(testEnvelope()); !ok {
		t.Fatal("enqueue failed")
	}
	select {
	case env := <-delivered:
		if env.EventID != "evt-1" {
			t.Fatalf("delivered envelope event_id = %q", env.EventID)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("worker did not deliver the envelope")
	}
}
