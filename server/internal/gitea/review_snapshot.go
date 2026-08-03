package gitea

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

var ErrConditionalMergeUnsupported = errors.New("gitea: conditional pull request merge is unsupported")
var ErrPullRequestHeadChanged = errors.New("gitea: pull request head changed")

type PullRequestMetadata struct {
	Index         int
	State         string
	Merged        bool
	HTMLURL       string
	HeadOwner     string
	HeadRepo      string
	HeadRef       string
	HeadCommitSHA string
	BaseOwner     string
	BaseRepo      string
	BaseRef       string
}

func (c *Client) ReviewHost() string {
	parsed, err := url.Parse(c.baseURL)
	if err != nil {
		return ""
	}
	return strings.ToLower(parsed.Host)
}

func (c *Client) GetPullRequest(ctx context.Context, owner, repo string, index int) (PullRequestMetadata, error) {
	endpoint := "/repos/" + url.PathEscape(owner) + "/" + url.PathEscape(repo) + "/pulls/" + strconv.Itoa(index)
	resp, err := c.do(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return PullRequestMetadata{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return PullRequestMetadata{}, decodeError(resp)
	}
	var payload struct {
		Number  int    `json:"number"`
		State   string `json:"state"`
		Merged  bool   `json:"merged"`
		HTMLURL string `json:"html_url"`
		Head    struct {
			Ref  string `json:"ref"`
			SHA  string `json:"sha"`
			Repo struct {
				Name  string `json:"name"`
				Owner struct {
					Login string `json:"login"`
				} `json:"owner"`
			} `json:"repo"`
		} `json:"head"`
		Base struct {
			Ref  string `json:"ref"`
			Repo struct {
				Name  string `json:"name"`
				Owner struct {
					Login string `json:"login"`
				} `json:"owner"`
			} `json:"repo"`
		} `json:"base"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return PullRequestMetadata{}, fmt.Errorf("decode pull request metadata: %w", err)
	}
	return PullRequestMetadata{
		Index: payload.Number, State: payload.State, Merged: payload.Merged, HTMLURL: payload.HTMLURL,
		HeadOwner: payload.Head.Repo.Owner.Login, HeadRepo: payload.Head.Repo.Name,
		HeadRef: payload.Head.Ref, HeadCommitSHA: payload.Head.SHA,
		BaseOwner: payload.Base.Repo.Owner.Login, BaseRepo: payload.Base.Repo.Name, BaseRef: payload.Base.Ref,
	}, nil
}

func (c *Client) ReadFileAtCommit(ctx context.Context, owner, repo, filePath, commitSHA string) ([]byte, string, error) {
	pathParts := strings.Split(strings.TrimPrefix(filePath, "/"), "/")
	for index := range pathParts {
		pathParts[index] = url.PathEscape(pathParts[index])
	}
	endpoint := "/repos/" + url.PathEscape(owner) + "/" + url.PathEscape(repo) + "/contents/" + strings.Join(pathParts, "/") + "?ref=" + url.QueryEscape(commitSHA)
	resp, err := c.do(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, "", decodeError(resp)
	}
	var payload struct {
		Content  string `json:"content"`
		Encoding string `json:"encoding"`
		SHA      string `json:"sha"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, "", fmt.Errorf("decode file response: %w", err)
	}
	if payload.Encoding != "base64" {
		return nil, "", fmt.Errorf("gitea file encoding %q is unsupported", payload.Encoding)
	}
	content, err := base64.StdEncoding.DecodeString(strings.ReplaceAll(payload.Content, "\n", ""))
	if err != nil {
		return nil, "", fmt.Errorf("decode gitea file content: %w", err)
	}
	return content, payload.SHA, nil
}

func (c *Client) MergePRAtHead(ctx context.Context, owner, repo string, index int, headCommitSHA string) error {
	endpoint := "/repos/" + url.PathEscape(owner) + "/" + url.PathEscape(repo) + "/pulls/" + strconv.Itoa(index) + "/merge"
	resp, err := c.do(ctx, http.MethodPost, endpoint, map[string]any{"Do": "merge", "head_commit_id": headCommitSHA})
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		return nil
	case resp.StatusCode == http.StatusConflict:
		return ErrPullRequestHeadChanged
	case resp.StatusCode == http.StatusBadRequest || resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusUnprocessableEntity:
		return ErrConditionalMergeUnsupported
	default:
		return decodeError(resp)
	}
}
