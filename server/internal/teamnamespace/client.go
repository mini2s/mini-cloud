package teamnamespace

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Config struct {
	BaseURL string
	Token   string
	Tenant  string
	Timeout time.Duration
}

type Client struct {
	baseURL string
	token   string
	tenant  string
	http    *http.Client
}

func NewClient(cfg Config) *Client {
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	return &Client{
		baseURL: strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/"),
		token:   strings.TrimSpace(cfg.Token),
		tenant:  strings.TrimSpace(cfg.Tenant),
		http:    &http.Client{Timeout: timeout},
	}
}

func (c *Client) Configured() bool {
	return c != nil && c.baseURL != "" && c.token != ""
}

type UserRef struct {
	UserID      string `json:"user_id,omitempty"`
	UniversalID string `json:"universal_id,omitempty"`
}

type BotInfo struct {
	GiteaUsername string `json:"gitea_username"`
	GiteaUserID   int64  `json:"gitea_user_id"`
	TokenID       int64  `json:"token_id"`
	Token         string `json:"token,omitempty"`
	TokenSHA256   string `json:"token_sha256,omitempty"`
}

type CreateTeamRequest struct {
	TeamID          string    `json:"team_id"`
	TeamDisplayName string    `json:"team_display_name"`
	Creator         UserRef   `json:"creator"`
	InitialMembers  []UserRef `json:"initial_members,omitempty"`
}

type CreateTeamResponse struct {
	TeamID          string  `json:"team_id"`
	TeamNSOrg       string  `json:"team_ns_org"`
	TeamDisplayName string  `json:"team_display_name"`
	GitServerID     string  `json:"git_server_id"`
	GiteaBaseURL    string  `json:"gitea_base_url"`
	Bot             BotInfo `json:"bot"`
}

type SyncMembersRequest struct {
	Mode          string    `json:"mode"`
	AddMembers    []UserRef `json:"add_members,omitempty"`
	RemoveMembers []UserRef `json:"remove_members,omitempty"`
}

type SyncMembersResponse struct {
	TeamNSOrg           string `json:"team_ns_org"`
	MembersAddedCount   int    `json:"members_added_count"`
	MembersRemovedCount int    `json:"members_removed_count"`
}

type UpdateTeamRequest struct {
	TeamDisplayName string `json:"team_display_name,omitempty"`
	Description     string `json:"description,omitempty"`
}

type DissolveTeamRequest struct {
	Reason string  `json:"reason"`
	Actor  UserRef `json:"actor"`
}

type RotateBotTokenRequest struct {
	Reason string  `json:"reason"`
	Actor  UserRef `json:"actor"`
}

type RotateBotTokenResponse struct {
	TeamID string  `json:"team_id"`
	Bot    BotInfo `json:"bot"`
}

type WorkflowInitRequest struct {
	WorkflowDefSlug    string `json:"workflow_def_slug"`
	InstanceID         string `json:"instance_id"`
	TeamID             string `json:"team_id"`
	DefinitionSnapshot string `json:"definition_snapshot,omitempty"`
}

type WorkflowInitResponse struct {
	WFRepoPath       string `json:"wf_repo_path"`
	WFCloneURL       string `json:"wf_clone_url"`
	WFWebURL         string `json:"wf_web_url"`
	InstanceBranch   string `json:"instance_branch"`
	TeamNSExists     bool   `json:"team_ns_exists"`
	AlgorithmVersion string `json:"algorithm_version"`
	BotCredentials   struct {
		GiteaUsername     string `json:"gitea_username"`
		GiteaUserID       int64  `json:"gitea_user_id"`
		Token             string `json:"token"`
		CloneURLWithToken string `json:"clone_url_with_token"`
	} `json:"bot_credentials"`
}

func (c *Client) CreateTeam(ctx context.Context, req CreateTeamRequest) (CreateTeamResponse, error) {
	var out CreateTeamResponse
	err := c.do(ctx, http.MethodPost, "/api/internal/teams", req, &out)
	return out, err
}

func (c *Client) SyncMembers(ctx context.Context, teamID string, req SyncMembersRequest) (SyncMembersResponse, error) {
	var out SyncMembersResponse
	err := c.do(ctx, http.MethodPost, "/api/internal/teams/"+teamID+"/members:sync", req, &out)
	return out, err
}

func (c *Client) UpdateTeam(ctx context.Context, teamID string, req UpdateTeamRequest) error {
	return c.do(ctx, http.MethodPatch, "/api/internal/teams/"+teamID, req, nil)
}

func (c *Client) DissolveTeam(ctx context.Context, teamID string, req DissolveTeamRequest) error {
	return c.do(ctx, http.MethodPost, "/api/internal/teams/"+teamID+"/dissolve", req, nil)
}

func (c *Client) RotateBotToken(ctx context.Context, teamID string, req RotateBotTokenRequest) (RotateBotTokenResponse, error) {
	var out RotateBotTokenResponse
	err := c.do(ctx, http.MethodPost, "/api/internal/teams/"+teamID+"/bot-token:rotate", req, &out)
	return out, err
}

func (c *Client) InitWorkflow(ctx context.Context, req WorkflowInitRequest) (WorkflowInitResponse, error) {
	var out WorkflowInitResponse
	err := c.do(ctx, http.MethodPost, "/api/internal/workflow/init", req, &out)
	return out, err
}

func (c *Client) do(ctx context.Context, method, path string, body any, out any) error {
	if !c.Configured() {
		return fmt.Errorf("team namespace API not configured")
	}
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("marshal request: %w", err)
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("X-Internal-Service-Token", c.token)
	req.Header.Set("X-Internal-Secret", c.token)
	if c.tenant != "" {
		req.Header.Set("X-Tenant-Id", c.tenant)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("%s %s: status %d: %s", method, path, resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	if out == nil || resp.StatusCode == http.StatusNoContent {
		return nil
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("decode response: %w", err)
	}
	return nil
}
