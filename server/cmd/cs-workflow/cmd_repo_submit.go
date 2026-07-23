package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

// httpClient has a bounded timeout so a hung Gitea or Multica endpoint cannot
// stall the agent CLI indefinitely. The agent loop has no other escape.
var httpClient = &http.Client{Timeout: 30 * time.Second}

// urlCredRedactor matches the scheme://user:pass@host credential segment in a
// URL (e.g. https://oauth2:<token>@host) so git stderr never leaks the PAT.
var urlCredRedactor = regexp.MustCompile(`(\w+://[^/:@]+:)[^@]+(@)`)

var giteaCmd = &cobra.Command{
	Use:   "gitea",
	Short: "Platform git-server deliverable operations",
}

var repoSubmitCmd = &cobra.Command{
	Use:   "submit",
	Short: "Push a document deliverable to the platform repository and open a review request",
	Long:  "Reads MULTICA_REPO_* env (set by the daemon), fetches the workspace repository credential, pushes the document to the node branch, opens a review request (node->inst), and registers the review URL back to Multica.",
	RunE:  runRepoSubmit,
}

var giteaSubmitCmd = &cobra.Command{
	Use:   "submit",
	Short: "Compatibility alias for repo submit",
	Long:  "Compatibility alias for repo submit. Prefer `cs-workflow repo submit`.",
	RunE:  runGiteaSubmit,
}

func init() {
	repoCmd.AddCommand(repoSubmitCmd)
	repoSubmitCmd.Flags().String("deliverable", "", "Deliverable ID (required)")
	repoSubmitCmd.Flags().String("file", "", "Local file whose content is the document body (required)")
	_ = repoSubmitCmd.MarkFlagRequired("deliverable")
	_ = repoSubmitCmd.MarkFlagRequired("file")

	giteaCmd.AddCommand(giteaSubmitCmd)
	giteaSubmitCmd.Flags().String("deliverable", "", "Deliverable ID (required)")
	giteaSubmitCmd.Flags().String("file", "", "Local file whose content is the document body (required)")
	_ = giteaSubmitCmd.MarkFlagRequired("deliverable")
	_ = giteaSubmitCmd.MarkFlagRequired("file")
}

func runRepoSubmit(cmd *cobra.Command, _ []string) error {
	deliverableID, _ := cmd.Flags().GetString("deliverable")
	filePath, _ := cmd.Flags().GetString("file")
	return submitDeliverable(submitConfig{
		deliverableID: deliverableID,
		filePath:      filePath,
		gitOps:        &execGitOps{},
	})
}

func runGiteaSubmit(cmd *cobra.Command, _ []string) error {
	deliverableID, _ := cmd.Flags().GetString("deliverable")
	filePath, _ := cmd.Flags().GetString("file")
	return submitDeliverable(submitConfig{
		deliverableID: deliverableID,
		filePath:      filePath,
		gitOps:        &execGitOps{},
	})
}

// submitConfig parameterizes submitDeliverable for testing.
type submitConfig struct {
	deliverableID     string
	filePath          string
	gitOps            gitOps
	repoBaseOverride  string // test-only: override the repository base URL (else from credential)
	giteaBaseOverride string // test-only: override the Gitea base URL (else from credential)
}

// gitOps abstracts the git operations so the submit flow is unit-testable.
// The production impl (execGitOps) shells out to git, mirroring cmd_mr.go.
type gitOps interface {
	Clone(authURL, branch, dir string) error
	PrepareBranch(dir, nodeBranch string) error
	WriteFile(dir, path string, content []byte) error
	Commit(dir, message string) error
	Push(dir, authURL, branch string) error
}

type repoContext struct {
	nodeRunID    string
	owner        string
	repo         string
	cloneURL     string // full <base>/<owner>/<repo>.git from the server (SoT, spec §10.3.1); preferred over self-built
	instBranch   string
	nodeBranch   string
	deliverables []repoDeliverableRef
}

type repoDeliverableRef struct {
	ID    string `json:"deliverable_id"`
	Title string `json:"title"`
	Path  string `json:"path"`
}

func readRepoContext() (*repoContext, error) {
	c := &repoContext{
		nodeRunID:  os.Getenv("MULTICA_NODE_RUN_ID"),
		owner:      envOr("MULTICA_REPO_OWNER", os.Getenv("MULTICA_GITEA_OWNER")),
		repo:       envOr("MULTICA_REPO_NAME", os.Getenv("MULTICA_GITEA_REPO")),
		cloneURL:   envOr("MULTICA_REPO_CLONE_URL", os.Getenv("MULTICA_GITEA_CLONE_URL")),
		instBranch: envOr("MULTICA_REPO_INST_BRANCH", os.Getenv("MULTICA_GITEA_INST_BRANCH")),
		nodeBranch: envOr("MULTICA_REPO_NODE_BRANCH", os.Getenv("MULTICA_GITEA_NODE_BRANCH")),
	}
	if c.nodeRunID == "" {
		return nil, fmt.Errorf("MULTICA_NODE_RUN_ID not set; this command must run inside a workflow-node task")
	}
	for _, f := range []string{c.owner, c.repo, c.instBranch, c.nodeBranch} {
		if f == "" {
			return nil, fmt.Errorf("MULTICA_REPO_* env incomplete (owner/name/inst/node-branch required)")
		}
	}
	raw := envOr("MULTICA_REPO_DELIVERABLES", os.Getenv("MULTICA_GITEA_DELIVERABLES"))
	if raw == "" {
		return nil, fmt.Errorf("MULTICA_REPO_DELIVERABLES not set")
	}
	if err := json.Unmarshal([]byte(raw), &c.deliverables); err != nil {
		return nil, fmt.Errorf("parse MULTICA_REPO_DELIVERABLES: %w", err)
	}
	return c, nil
}

func readGiteaContext() (*repoContext, error) {
	return readRepoContext()
}

func (c *repoContext) deliverablePath(id string) (string, error) {
	for _, d := range c.deliverables {
		if d.ID == id {
			return d.Path, nil
		}
	}
	return "", fmt.Errorf("deliverable %q not in MULTICA_REPO_DELIVERABLES", id)
}

// submitDeliverable is the testable core. Returns nil only after the PR is
// registered back to Multica.
func submitDeliverable(cfg submitConfig) error {
	ctx := context.Background()

	gctx, err := readRepoContext()
	if err != nil {
		return err
	}
	docPath, err := gctx.deliverablePath(cfg.deliverableID)
	if err != nil {
		return err
	}
	content, err := os.ReadFile(cfg.filePath)
	if err != nil {
		return fmt.Errorf("read --file: %w", err)
	}

	cred, err := fetchRepoCredential(envOr("MULTICA_SERVER_URL", ""), os.Getenv("MULTICA_TOKEN"), os.Getenv("MULTICA_WORKSPACE_ID"))
	if err != nil {
		return fmt.Errorf("fetch repository credential: %w", err)
	}
	repoBase := cfg.repoBaseOverride
	if repoBase == "" {
		repoBase = cfg.giteaBaseOverride
	}
	if repoBase == "" {
		repoBase = cred.BaseURL
	}
	// Prefer the server-provided full clone URL (spec §10.3.1 SoT); fall back to
	// self-building from base+owner+repo for older daemons that don't deliver it.
	cloneAuth := ""
	if gctx.cloneURL != "" {
		cloneAuth = injectTokenIntoURL(gctx.cloneURL, cred.Token)
	}
	if cloneAuth == "" {
		cloneAuth = injectToken(repoBase, gctx.owner, gctx.repo, cred.Token)
	}

	dir, err := os.MkdirTemp("", "multica-repo-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)

	if err := cfg.gitOps.Clone(cloneAuth, gctx.instBranch, dir); err != nil {
		return fmt.Errorf("clone: %w", err)
	}
	if err := cfg.gitOps.PrepareBranch(dir, gctx.nodeBranch); err != nil {
		return fmt.Errorf("prepare node branch: %w", err)
	}
	if err := cfg.gitOps.WriteFile(dir, docPath, content); err != nil {
		return fmt.Errorf("write document: %w", err)
	}
	if err := cfg.gitOps.Commit(dir, "deliverable: "+cfg.deliverableID); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	if err := cfg.gitOps.Push(dir, cloneAuth, gctx.nodeBranch); err != nil {
		return fmt.Errorf("push: %w", err)
	}

	prURL, err := openRepoReviewRequest(ctx, repoBase, cred.Token, gctx.owner, gctx.repo, gctx.nodeBranch, gctx.instBranch, cfg.deliverableID)
	if err != nil {
		return fmt.Errorf("open PR: %w", err)
	}
	if err := reportDeliverablePR(ctx, envOr("MULTICA_SERVER_URL", ""), os.Getenv("MULTICA_TOKEN"), gctx.nodeRunID, cfg.deliverableID, prURL); err != nil {
		return fmt.Errorf("report PR: %w", err)
	}
	fmt.Println(prURL)
	return nil
}

func envOr(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

// injectToken builds an HTTPS clone URL with the PAT embedded for git auth:
// https://oauth2:<token>@<host>/<owner>/<repo>.git. Mirrors cmd_mr.go's
// buildAuthURL pattern (Gitea accepts the token as the password).
func injectToken(baseURL, owner, repo, token string) string {
	u, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil || u.Host == "" {
		return ""
	}
	u.User = url.UserPassword("oauth2", token)
	u.Path = fmt.Sprintf("/%s/%s.git", owner, repo)
	return u.String()
}

// injectTokenIntoURL injects the PAT into a full clone URL (already carrying
// owner/repo) — used when the server delivers MULTICA_GITEA_CLONE_URL (spec
// §10.3.1 single-source-of-truth). Falls back to "" on an unparseable URL.
func injectTokenIntoURL(cloneURL, token string) string {
	u, err := url.Parse(strings.TrimSpace(cloneURL))
	if err != nil || u.Host == "" {
		return ""
	}
	u.User = url.UserPassword("oauth2", token)
	return u.String()
}

// fetchRepoCredential calls the neutral repository credential endpoint.
func fetchRepoCredential(serverURL, token, workspaceID string) (struct {
	BaseURL string `json:"base_url"`
	Token   string `json:"token"`
}, error) {
	cred, err := fetchCredentialAt(serverURL, token, workspaceID, "/api/repositories/credential")
	if err == nil {
		return cred, nil
	}
	if strings.Contains(err.Error(), "status 404") {
		return fetchCredentialAt(serverURL, token, workspaceID, "/api/gitea/credential")
	}
	return cred, err
}

func fetchCredentialAt(serverURL, token, workspaceID, endpoint string) (struct {
	BaseURL string `json:"base_url"`
	Token   string `json:"token"`
}, error) {
	var out struct {
		BaseURL string `json:"base_url"`
		Token   string `json:"token"`
	}
	if serverURL == "" || token == "" {
		return out, fmt.Errorf("MULTICA_SERVER_URL/MULTICA_TOKEN not set")
	}
	req, _ := http.NewRequest(http.MethodGet, serverURL+endpoint, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	if workspaceID != "" {
		req.Header.Set("X-Workspace-ID", workspaceID)
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return out, fmt.Errorf("credential request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return out, fmt.Errorf("credential: status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return out, err
	}
	if out.BaseURL == "" || out.Token == "" {
		return out, fmt.Errorf("credential response missing base_url/token")
	}
	return out, nil
}

func fetchGiteaCredential(serverURL, token, workspaceID string) (struct {
	BaseURL string `json:"base_url"`
	Token   string `json:"token"`
}, error) {
	return fetchRepoCredential(serverURL, token, workspaceID)
}

// openRepoReviewRequest opens a review request through the selected provider.
// The current adapter uses the Gitea-compatible pull request API.
func openRepoReviewRequest(ctx context.Context, base, token, owner, repo, head, baseBranch, deliverableID string) (string, error) {
	body, _ := json.Marshal(map[string]string{
		"head":  head,
		"base":  baseBranch,
		"title": "document deliverable " + deliverableID,
	})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost,
		strings.TrimRight(base, "/")+"/api/v1/repos/"+owner+"/"+repo+"/pulls", bytes.NewReader(body))
	req.Header.Set("Authorization", "token "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("create PR request: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("repository create review request: status %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}
	var pr struct {
		HTMLURL string `json:"html_url"`
		Number  int    `json:"number"`
	}
	if err := json.Unmarshal(respBody, &pr); err != nil {
		return "", fmt.Errorf("parse PR response: %w", err)
	}
	return pr.HTMLURL, nil
}

func openGiteaPR(ctx context.Context, base, token, owner, repo, head, baseBranch, deliverableID string) (string, error) {
	return openRepoReviewRequest(ctx, base, token, owner, repo, head, baseBranch, deliverableID)
}

// reportDeliverablePR POSTs the PR URL to the daemon report-pr endpoint.
func reportDeliverablePR(ctx context.Context, serverURL, token, nodeRunID, deliverableID, prURL string) error {
	body, _ := json.Marshal(map[string]string{"pull_request_url": prURL})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost,
		serverURL+"/api/daemon/node-runs/"+nodeRunID+"/deliverables/"+deliverableID+"/report-pr", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("report-pr request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("report-pr: status %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	return nil
}

// execGitOps implements gitOps via shelled-out git (mirrors cmd_mr.go).
type execGitOps struct{}

func (execGitOps) Clone(authURL, branch, dir string) error {
	return runGit("", "clone", "--depth", "1", "--single-branch", "--branch", branch, authURL, dir)
}
func (execGitOps) PrepareBranch(dir, nodeBranch string) error {
	// Create/reset the node branch off the just-cloned inst branch. -B resets
	// if it already exists locally (idempotent re-submit from a fresh shallow clone).
	return runGit(dir, "checkout", "-B", nodeBranch, "HEAD")
}
func (execGitOps) WriteFile(dir, path string, content []byte) error {
	full := filepath.Join(dir, path)
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return err
	}
	return os.WriteFile(full, content, 0o644)
}
func (execGitOps) Commit(dir, message string) error {
	if err := runGit(dir, "add", "-A"); err != nil {
		return err
	}
	return runGit(dir, "-c", "user.email=bot@multica", "-c", "user.name=Multica Bot", "commit", "-m", message)
}
func (execGitOps) Push(dir, authURL, branch string) error {
	// Force-push: a node branch has a single writer pre-merge; re-submit
	// replaces WIP and the open PR auto-updates.
	return runGit(dir, "push", "--force", authURL, branch)
}

// runGit runs git, emitting its stderr to the caller's stderr with any
// URL-embedded credentials redacted (the clone/push auth URL contains the PAT).
func runGit(dir string, args ...string) error {
	cmd := exec.Command("git", args...)
	if dir != "" {
		cmd.Dir = dir
	}
	var stderr bytes.Buffer
	cmd.Stdout = os.Stderr
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		os.Stderr.Write([]byte(urlCredRedactor.ReplaceAllString(stderr.String(), "${1}***${2}")))
		return err
	}
	if stderr.Len() > 0 {
		os.Stderr.Write([]byte(urlCredRedactor.ReplaceAllString(stderr.String(), "${1}***${2}")))
	}
	return nil
}
