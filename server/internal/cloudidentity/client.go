// Package cloudidentity translates a Casdoor-issued access token into the
// cloud-api stable subject id (e.g. "usr_...") by calling the cloud-api
// /api/auth/me endpoint.
//
// Background: a raw Casdoor JWT carries the Casdoor user id in its "sub"
// claim (e.g. "aadbc069-..."). Multica users, however, are keyed by the
// cloud-api subject id (e.g. "usr_48b35a2c-...") that the cloud-api assigns.
// To resolve the correct Multica user, the auth middleware first asks the
// cloud-api who the token belongs to and caches the resulting subject id,
// keyed by the stable universal_id (not the ephemeral access token).
package cloudidentity

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Config configures the cloud-api identity client.
type Config struct {
	// BaseURL is the cloud-api root, e.g. "https://zgsmtest.cn:30443/cloud-api".
	// When empty the client is disabled and ResolveSubjectID always errors,
	// letting callers fall back to the raw JWT "sub" claim.
	BaseURL string
	// Timeout bounds a single /api/auth/me call. Defaults to 5s.
	Timeout time.Duration
	// CacheTTL is how long a resolved subject id is cached per universal_id.
	// Defaults to 2m.
	CacheTTL time.Duration
}

// Client translates Casdoor access tokens to cloud-api subject ids.
// It is safe for concurrent use.
type Client struct {
	base     string
	cacheTTL time.Duration
	http     *http.Client

	mu    sync.RWMutex
	cache map[string]cacheEntry
}

type cacheEntry struct {
	subjectID string
	expiresAt time.Time
}

// NewClient constructs a cloud-api identity client. A zero/empty BaseURL
// yields a disabled client (ResolveSubjectID returns an error).
func NewClient(cfg Config) *Client {
	if cfg.Timeout <= 0 {
		cfg.Timeout = 5 * time.Second
	}
	if cfg.CacheTTL <= 0 {
		cfg.CacheTTL = 2 * time.Minute
	}
	return &Client{
		base:     strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/"),
		cacheTTL: cfg.CacheTTL,
		http:     &http.Client{Timeout: cfg.Timeout},
		cache:    make(map[string]cacheEntry),
	}
}

// Enabled reports whether the client has a configured BaseURL.
func (c *Client) Enabled() bool {
	return c != nil && c.base != ""
}

// authMeResponse is the subset of GET /api/auth/me we care about.
type authMeResponse struct {
	User struct {
		SubjectID string `json:"subjectId"`
	} `json:"user"`
}

// ResolveSubjectID returns the cloud-api subject id for the Casdoor identity
// described by universalID + accessToken. It calls GET {BaseURL}/api/auth/me
// with the access token and returns response.user.subjectId.
//
// The universal_id is stable across token rotations, so it is used as the
// cache key: a given user incurs at most one cloud-api call per CacheTTL
// window even as their access token refreshes. When universalID is empty the
// result is still resolved but not cached.
//
// On any failure (client disabled, network error, non-200, malformed body,
// empty subject id) it returns "" and a non-nil error so the caller can fall
// back to the raw JWT "sub" claim.
func (c *Client) ResolveSubjectID(ctx context.Context, universalID, accessToken string) (string, error) {
	if !c.Enabled() || accessToken == "" {
		return "", fmt.Errorf("cloud identity client not configured")
	}

	// Fast path: unexpired cache hit keyed by the stable universal_id.
	if universalID != "" {
		c.mu.RLock()
		if e, ok := c.cache[universalID]; ok && time.Now().Before(e.expiresAt) {
			c.mu.RUnlock()
			return e.subjectID, nil
		}
		c.mu.RUnlock()
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+"/api/auth/me", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("cloud-api /api/auth/me: %s", resp.Status)
	}

	var body authMeResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&body); err != nil {
		return "", fmt.Errorf("decode /api/auth/me: %w", err)
	}
	sid := strings.TrimSpace(body.User.SubjectID)
	if sid == "" {
		return "", fmt.Errorf("cloud-api returned empty subjectId")
	}

	// Cache keyed by the stable universal_id (skip when absent).
	if universalID != "" {
		c.mu.Lock()
		c.cache[universalID] = cacheEntry{subjectID: sid, expiresAt: time.Now().Add(c.cacheTTL)}
		c.mu.Unlock()
	}
	return sid, nil
}
