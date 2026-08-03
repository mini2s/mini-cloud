// Package csuser is a minimal client for the costrict-web cs-user internal API.
package csuser

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Config struct {
	BaseURL string
	Token   string // X-Internal-Token
	Timeout time.Duration
}

type Client struct {
	baseURL string
	token   string
	http    *http.Client
}

func NewClient(cfg Config) *Client {
	if cfg.Timeout == 0 {
		cfg.Timeout = 10 * time.Second
	}
	return &Client{
		baseURL: strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/"),
		token:   strings.TrimSpace(cfg.Token),
		http:    &http.Client{Timeout: cfg.Timeout},
	}
}

func (c *Client) Configured() bool {
	return c != nil && c.baseURL != "" && c.token != ""
}

// User mirrors the subset of cs-user models.User that multica consumes.
type User struct {
	SubjectID          string  `json:"subject_id"`
	Username           string  `json:"username"`
	DisplayName        *string `json:"display_name"`
	Email              *string `json:"email"`
	CasdoorUniversalID *string `json:"casdoor_universal_id"`
	Organization       *string `json:"organization"`
}

// Name is the best display name (display_name, else username).
func (u User) Name() string {
	if u.DisplayName != nil && strings.TrimSpace(*u.DisplayName) != "" {
		return *u.DisplayName
	}
	return u.Username
}

func (u User) EmailOrEmpty() string {
	if u.Email != nil {
		return *u.Email
	}
	return ""
}

// UniversalID is the transient dept-sync lookup token; never persisted by multica.
func (u User) UniversalID() string {
	if u.CasdoorUniversalID != nil {
		return *u.CasdoorUniversalID
	}
	return ""
}

var ErrNotConfigured = fmt.Errorf("cs-user client is not configured")

// SearchUsers calls GET /api/internal/users/search?keyword=&limit= (active users).
func (c *Client) SearchUsers(ctx context.Context, keyword string, limit int) ([]User, error) {
	if !c.Configured() {
		return nil, ErrNotConfigured
	}
	q := url.Values{}
	q.Set("keyword", keyword)
	if limit > 0 {
		q.Set("limit", fmt.Sprintf("%d", limit))
	}
	var wrapper struct {
		Users []User `json:"users"`
	}
	if err := c.get(ctx, "/api/internal/users/search?"+q.Encode(), &wrapper); err != nil {
		return nil, err
	}
	return wrapper.Users, nil
}

// GetUser calls GET /api/internal/users/:subject_id (bare User object).
func (c *Client) GetUser(ctx context.Context, subjectID string) (User, error) {
	if !c.Configured() {
		return User{}, ErrNotConfigured
	}
	var u User
	if err := c.get(ctx, "/api/internal/users/"+url.PathEscape(subjectID), &u); err != nil {
		return User{}, err
	}
	return u, nil
}

func (c *Client) get(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("X-Internal-Token", c.token)
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode >= 400 {
		return fmt.Errorf("cs-user %s: HTTP %d: %s", path, resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return json.Unmarshal(body, out)
}
