package integration

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"
)

// EventIssueStatusChanged is the envelope type for an issue status transition.
const EventIssueStatusChanged = "multica.issue.status_changed"

// maxAttempts is 1 initial try + 3 retries.
const maxAttempts = 4

// Envelope is the versioned contract POSTed to the integration endpoint.
// Unknown fields must be ignored by the receiver; new fields are additive.
type Envelope struct {
	Version    int          `json:"version"`
	EventID    string       `json:"event_id"`
	Type       string       `json:"type"`
	OccurredAt time.Time    `json:"occurred_at"`
	Workspace  WorkspaceRef `json:"workspace"`
	Actor      ActorRef     `json:"actor"`
	Issue      IssueRef     `json:"issue"`
	Recipients []string     `json:"recipients"`
}

type WorkspaceRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type ActorRef struct {
	Type string `json:"type"` // "member" | "agent" | "system"
	Name string `json:"name"`
}

type IssueRef struct {
	ID         string `json:"id"`
	Identifier string `json:"identifier"`
	Title      string `json:"title"`
	PrevStatus string `json:"prev_status"`
	Status     string `json:"status"`
	URL        string `json:"url"`
}

// Notifier pushes envelopes to the configured endpoint from background
// workers. Enqueue never blocks: the event bus dispatches synchronously in
// the request goroutine, so a slow or down peer must never affect the issue
// write path.
type Notifier struct {
	endpoint   string
	secret     string
	httpClient *http.Client
	queue      chan Envelope
	queueSize  int
	workers    int
	// backoff returns the sleep before retry attempt i (1-based). Replaceable
	// in tests.
	backoff func(attempt int) time.Duration
}

// NewNotifier builds a disabled-until-run notifier. Call Run to start the
// delivery workers.
func NewNotifier(endpoint, secret string) *Notifier {
	n := &Notifier{
		endpoint:   endpoint,
		secret:     secret,
		httpClient: &http.Client{Timeout: 5 * time.Second},
		queueSize:  1024,
		workers:    2,
	}
	n.backoff = func(attempt int) time.Duration {
		// 1s, 4s, 16s
		d := time.Second
		for i := 1; i < attempt; i++ {
			d *= 4
		}
		return d
	}
	return n
}

// ensureQueue lazily creates the delivery queue so queueSize stays
// configurable between NewNotifier and first use.
func (n *Notifier) ensureQueue() {
	if n.queue == nil {
		n.queue = make(chan Envelope, n.queueSize)
	}
}

// Enqueue queues an envelope for delivery. It never blocks; when the queue is
// full the envelope is dropped and false is returned (a Warn is logged by the
// caller path through the drop counter).
func (n *Notifier) Enqueue(env Envelope) bool {
	n.ensureQueue()
	select {
	case n.queue <- env:
		return true
	default:
		slog.Warn("integration notifier queue full, dropping envelope", "event_id", env.EventID, "type", env.Type)
		return false
	}
}

// Run starts the delivery workers and returns. It blocks until ctx is
// cancelled only in the sense that workers exit then; call it in a goroutine.
func (n *Notifier) Run(ctx context.Context) {
	n.ensureQueue()
	for i := 0; i < n.workers; i++ {
		go func() {
			for {
				select {
				case <-ctx.Done():
					return
				case env := <-n.queue:
					if err := n.deliver(ctx, env); err != nil {
						slog.Error("integration delivery failed after retries",
							"event_id", env.EventID, "type", env.Type, "error", err)
					}
				}
			}
		}()
	}
}

// deliver POSTs the signed envelope, retrying on network errors and 5xx/429.
// 4xx responses are contract/auth problems and are not retried.
func (n *Notifier) deliver(ctx context.Context, env Envelope) error {
	body, err := json.Marshal(env)
	if err != nil {
		return fmt.Errorf("marshal envelope: %w", err)
	}
	mac := hmac.New(sha256.New, []byte(n.secret))
	mac.Write(body)
	sig := "sha256=" + hex.EncodeToString(mac.Sum(nil))

	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if attempt > 1 {
			d := n.backoff(attempt - 1)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(d):
			}
		}
		retryable, err := n.postOnce(ctx, body, sig)
		if err == nil {
			return nil
		}
		lastErr = err
		if !retryable {
			return err
		}
	}
	return fmt.Errorf("delivery failed after %d attempts: %w", maxAttempts, lastErr)
}

// postOnce performs a single POST attempt. retryable reports whether another
// attempt makes sense.
func (n *Notifier) postOnce(ctx context.Context, body []byte, sig string) (retryable bool, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, n.endpoint, bytes.NewReader(body))
	if err != nil {
		return false, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Multica-Signature", sig)

	resp, err := n.httpClient.Do(req)
	if err != nil {
		return true, fmt.Errorf("post: %w", err)
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		return false, nil
	case resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500:
		return true, fmt.Errorf("peer returned %d", resp.StatusCode)
	default:
		return false, fmt.Errorf("peer returned %d (not retryable)", resp.StatusCode)
	}
}
