package gitea

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// ErrMergeConflict is returned by MergePR when Gitea responds 409 (the PR
// cannot be merged — e.g. unresolved conflicts). Terminal: callers should NOT
// retry; for the approve-time merge it means the node run must block.
var ErrMergeConflict = errors.New("gitea: pull request merge conflict")

// MergePR merges a pull request by its numeric index. Uses the admin token.
// Gitea returns 409 if the PR cannot be merged (conflicts) — surfaced as an error
// so the caller can block the node run rather than silently complete it.
func (c *Client) MergePR(ctx context.Context, owner, repo string, index int) error {
	resp, err := c.do(ctx, http.MethodPost, "/repos/"+owner+"/"+repo+"/pulls/"+strconv.Itoa(index)+"/merge", map[string]any{
		"Do": "merge",
	})
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	if resp.StatusCode == http.StatusConflict {
		return ErrMergeConflict
	}
	return decodeError(resp)
}

// ClosePR closes a pull request (sets state=closed). Used by the critic reject
// path to close document deliverable PRs after a rejection. Uses the admin
// token; the caller treats failure as best-effort (logged, non-blocking).
func (c *Client) ClosePR(ctx context.Context, owner, repo string, index int) error {
	resp, err := c.do(ctx, http.MethodPatch, "/repos/"+owner+"/"+repo+"/pulls/"+strconv.Itoa(index), map[string]any{
		"state": "closed",
	})
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	return decodeError(resp)
}

// OpenPR creates a pull request (head→base) and returns its html_url. Used by
// the server-side member-upload path to open a node→inst PR — symmetric with the
// daemon/cs-workflow path, which opens PRs client-side. Uses the admin token;
// the submission's submitted_by_* records the human author, not the git committer.
func (c *Client) OpenPR(ctx context.Context, owner, repo, head, base, title string) (string, error) {
	resp, err := c.do(ctx, http.MethodPost, "/repos/"+owner+"/"+repo+"/pulls", map[string]any{
		"head":  head,
		"base":  base,
		"title": title,
	})
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		if resp.StatusCode == http.StatusConflict {
			existingURL, err := c.findOpenPR(ctx, owner, repo, head, base)
			if err == nil && existingURL != "" {
				return existingURL, nil
			}
			if err != nil {
				return "", fmt.Errorf("find existing PR after conflict: %w", err)
			}
		}
		return "", fmt.Errorf("gitea create PR: status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var pr struct {
		HTMLURL string `json:"html_url"`
		Number  int    `json:"number"`
	}
	if err := json.Unmarshal(body, &pr); err != nil {
		return "", fmt.Errorf("parse PR response: %w", err)
	}
	if pr.HTMLURL == "" {
		return "", fmt.Errorf("gitea create PR: empty html_url in response")
	}
	return pr.HTMLURL, nil
}

func (c *Client) findOpenPR(ctx context.Context, owner, repo, head, base string) (string, error) {
	resp, err := c.do(ctx, http.MethodGet, "/repos/"+owner+"/"+repo+"/pulls?state=open", nil)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", decodeError(resp)
	}
	var prs []struct {
		HTMLURL string `json:"html_url"`
		Head    struct {
			Ref string `json:"ref"`
		} `json:"head"`
		Base struct {
			Ref string `json:"ref"`
		} `json:"base"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&prs); err != nil {
		return "", fmt.Errorf("parse PR list response: %w", err)
	}
	for _, pr := range prs {
		if pr.Head.Ref == head && pr.Base.Ref == base && pr.HTMLURL != "" {
			return pr.HTMLURL, nil
		}
	}
	return "", nil
}

// ParsePullRequestIndex extracts the numeric PR index from a Gitea PR web URL
// (e.g. https://gitea.example.com/t-7f3c9a1e/wf-11111111/pulls/42 → 42). Used by
// the server-side merge to resolve a submission's pull_request_url to a mergeable
// index. Returns an error if the URL is not a valid Gitea PR URL.
func ParsePullRequestIndex(raw string) (int, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, errInvalidPRURL
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return 0, errInvalidPRURL
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	idx := -1
	for i, p := range parts {
		if p == "pulls" && i+1 < len(parts) {
			idx = i + 1
			break
		}
	}
	if idx < 0 {
		return 0, errInvalidPRURL
	}
	n, err := strconv.Atoi(parts[idx])
	if err != nil || n <= 0 {
		return 0, errInvalidPRURL
	}
	return n, nil
}

// errInvalidPRURL is returned by ParsePullRequestIndex for a malformed PR URL.
// Typed so callers can distinguish a bad URL from a transient Gitea failure.
var errInvalidPRURL = &parseError{msg: "gitea: not a valid gitea pull request URL"}

type parseError struct{ msg string }

func (e *parseError) Error() string { return e.msg }
