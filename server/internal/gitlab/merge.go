// Package gitlab issues server-side GitLab API calls for the critic review
// flow. Unlike the workspace-owned Gitea deliverable repo, GitLab has only a
// per-workspace user PAT, so the client is stateless and the token is supplied
// per call by the service layer.
package gitlab

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// ErrMergeConflict is returned when GitLab refuses to merge (conflict,
// unmergeable, or already merged). Terminal — callers must not retry, matching
// gitea.ErrMergeConflict so the service layer can treat both uniformly.
var ErrMergeConflict = errors.New("gitlab: merge request not mergeable")

// MergeRequestRef identifies a GitLab MR by its web-URL components.
type MergeRequestRef struct {
	BaseURL     string // e.g. http://gitlab.local (scheme + host, no path)
	ProjectPath string // e.g. root/repo (namespace/project, may be nested)
	IID         int
}

// ParseMergeRequestURL parses a GitLab MR web URL into API components. Accepts
// both the canonical "http://host/<path>/-/merge_requests/{n}" and the legacy
// "http://host/<path>/merge_requests/{n}" shapes. Ported from the URL-extraction
// logic in cmd/cs-workflow/cmd_mr.go (extractBaseFromRemote/extractPathFromRemote),
// adapted for MR web URLs.
func ParseMergeRequestURL(mrURL string) (MergeRequestRef, error) {
	u, err := url.Parse(mrURL)
	if err != nil {
		return MergeRequestRef{}, fmt.Errorf("parse gitlab mr url: %w", err)
	}
	if u.Scheme == "" || u.Host == "" {
		return MergeRequestRef{}, fmt.Errorf("gitlab mr url is not absolute: %q", mrURL)
	}
	const mrSeg = "/merge_requests/"
	idx := strings.Index(u.Path, mrSeg)
	if idx < 0 {
		return MergeRequestRef{}, fmt.Errorf("not a gitlab mr url (no /merge_requests/ segment): %q", mrURL)
	}
	// before is everything preceding /merge_requests/: "/<projectPath>/-" in
	// the canonical form, "/<projectPath>" in the legacy form. Strip the "/-"
	// separator then the leading "/" to recover the project path.
	before := u.Path[:idx]
	projectPath := strings.TrimPrefix(strings.TrimSuffix(before, "/-"), "/")
	if projectPath == "" {
		return MergeRequestRef{}, fmt.Errorf("gitlab mr url has empty project path: %q", mrURL)
	}
	rest := u.Path[idx+len(mrSeg):]
	// iid is the first path segment after /merge_requests/ (trim trailing slash
	// and ignore any /notes etc.).
	iidStr := rest
	if i := strings.Index(iidStr, "/"); i >= 0 {
		iidStr = iidStr[:i]
	}
	iidStr = strings.TrimSuffix(iidStr, "/")
	iid, err := strconv.Atoi(iidStr)
	if err != nil {
		return MergeRequestRef{}, fmt.Errorf("parse gitlab mr iid %q: %w", iidStr, err)
	}
	return MergeRequestRef{
		BaseURL:     fmt.Sprintf("%s://%s", u.Scheme, u.Host),
		ProjectPath: projectPath,
		IID:         iid,
	}, nil
}

// Client issues GitLab REST API calls. The zero value is usable (a default
// 30s HTTP client is allocated on first call). Stateless — pass the token per
// call, since GitLab PATs are per-workspace.
type Client struct {
	HTTP *http.Client
}

// MergeMR merges a GitLab merge request:
// PUT {base}/api/v4/projects/{urlEncodedPath}/merge_requests/{iid}/merge.
// A 405/406/409 response maps to ErrMergeConflict (terminal); other non-2xx are
// transient errors the caller may retry.
func (c *Client) MergeMR(ctx context.Context, ref MergeRequestRef, token string) error {
	if token == "" || ref.BaseURL == "" || ref.ProjectPath == "" || ref.IID == 0 {
		return fmt.Errorf("gitlab: merge request ref or token incomplete (base=%q path=%q iid=%d)",
			ref.BaseURL, ref.ProjectPath, ref.IID)
	}
	target := fmt.Sprintf("%s/api/v4/projects/%s/merge_requests/%d/merge",
		ref.BaseURL, url.PathEscape(ref.ProjectPath), ref.IID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, target, nil)
	if err != nil {
		return fmt.Errorf("build gitlab merge request: %w", err)
	}
	req.Header.Set("PRIVATE-TOKEN", token)

	resp, err := c.httpClient().Do(req)
	if err != nil {
		return fmt.Errorf("gitlab merge mr %d: %w", ref.IID, err)
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		return nil
	case resp.StatusCode == http.StatusMethodNotAllowed, // 405 — e.g. nothing to merge
		resp.StatusCode == http.StatusNotAcceptable, // 406 — conflicts / unmergeable
		resp.StatusCode == http.StatusConflict:      // 409
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("%w: status %d: %s", ErrMergeConflict, resp.StatusCode, body)
	default:
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("gitlab merge mr %d: status %d: %s", ref.IID, resp.StatusCode, body)
	}
}

func (c *Client) httpClient() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return &http.Client{Timeout: 30 * time.Second}
}
