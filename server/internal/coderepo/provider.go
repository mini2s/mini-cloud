package coderepo

import (
	"context"
	"fmt"

	"github.com/multica-ai/multica/server/internal/gitea"
)

type Provider string

const ProviderGitea Provider = "gitea"

type OrgMember struct {
	Login string
}

type RepositoryProvider interface {
	Name() Provider
	Configured() bool
	CreateBranch(ctx context.Context, owner, repo, branch, fromRef string) error
	UpsertFile(ctx context.Context, owner, repo, branch, path, content, message string) error
	OpenReviewRequest(ctx context.Context, owner, repo, head, base, title string) (string, error)
	MergeReviewRequest(ctx context.Context, owner, repo string, index int) error
	CloseReviewRequest(ctx context.Context, owner, repo string, index int) error
	ListOrgMembers(ctx context.Context, org string) ([]OrgMember, error)
	// FetchReviewRequestTitleByURL resolves a PR/MR web URL to its title
	// (cached at submit time so the submissions list needn't fan out to the
	// code host on every read). Returns an empty title (no error) when the URL
	// does not belong to this provider; other failures surface as errors so the
	// caller can decide whether to block or treat as best-effort.
	FetchReviewRequestTitleByURL(ctx context.Context, prURL string) (string, error)
}

type ReviewSnapshotProvider interface {
	RepositoryProvider
	ReviewHost() string
	GetReviewRequest(ctx context.Context, owner, repo string, index int) (gitea.PullRequestMetadata, error)
	ReadFileAtCommit(ctx context.Context, owner, repo, path, commitSHA string) ([]byte, string, error)
	MergeReviewRequestAtHead(ctx context.Context, owner, repo string, index int, headCommitSHA string) error
}

type FactoryConfig struct {
	Gitea *gitea.Client
}

type Factory struct {
	cfg FactoryConfig
}

func NewFactory(cfg FactoryConfig) Factory {
	return Factory{cfg: cfg}
}

func (f Factory) Provider(provider Provider) (RepositoryProvider, error) {
	switch provider {
	case "", ProviderGitea:
		return GiteaAdapter{Client: f.cfg.Gitea}, nil
	default:
		return nil, fmt.Errorf("unsupported repository provider %q", provider)
	}
}

type GiteaAdapter struct {
	Client *gitea.Client
}

func (a GiteaAdapter) Name() Provider {
	return ProviderGitea
}

func (a GiteaAdapter) Configured() bool {
	return a.Client != nil && a.Client.Configured()
}

func (a GiteaAdapter) CreateBranch(ctx context.Context, owner, repo, branch, fromRef string) error {
	return a.Client.CreateBranch(ctx, owner, repo, branch, fromRef)
}

func (a GiteaAdapter) UpsertFile(ctx context.Context, owner, repo, branch, path, content, message string) error {
	return a.Client.UpsertFile(ctx, owner, repo, branch, path, content, message)
}

func (a GiteaAdapter) OpenReviewRequest(ctx context.Context, owner, repo, head, base, title string) (string, error) {
	return a.Client.OpenPR(ctx, owner, repo, head, base, title)
}

func (a GiteaAdapter) MergeReviewRequest(ctx context.Context, owner, repo string, index int) error {
	return a.Client.MergePR(ctx, owner, repo, index)
}

func (a GiteaAdapter) CloseReviewRequest(ctx context.Context, owner, repo string, index int) error {
	return a.Client.ClosePR(ctx, owner, repo, index)
}

func (a GiteaAdapter) ListOrgMembers(ctx context.Context, org string) ([]OrgMember, error) {
	members, err := a.Client.ListOrgMembers(ctx, org)
	if err != nil {
		return nil, err
	}
	out := make([]OrgMember, 0, len(members))
	for _, m := range members {
		out = append(out, OrgMember{Login: m.Login})
	}
	return out, nil
}

// FetchReviewRequestTitleByURL resolves a Gitea PR web URL to its title. A
// non-Gitea URL yields an empty title (no error) so callers can stay
// best-effort across providers.
func (a GiteaAdapter) FetchReviewRequestTitleByURL(ctx context.Context, prURL string) (string, error) {
	ref, err := gitea.ParsePullRequestURL(prURL)
	if err != nil {
		return "", nil // not a Gitea PR URL — best-effort empty title
	}
	return a.Client.GetPRTitle(ctx, ref.Owner, ref.Repo, ref.Index)
}

func (a GiteaAdapter) ReviewHost() string { return a.Client.ReviewHost() }

func (a GiteaAdapter) GetReviewRequest(ctx context.Context, owner, repo string, index int) (gitea.PullRequestMetadata, error) {
	return a.Client.GetPullRequest(ctx, owner, repo, index)
}

func (a GiteaAdapter) ReadFileAtCommit(ctx context.Context, owner, repo, path, commitSHA string) ([]byte, string, error) {
	return a.Client.ReadFileAtCommit(ctx, owner, repo, path, commitSHA)
}

func (a GiteaAdapter) MergeReviewRequestAtHead(ctx context.Context, owner, repo string, index int, headCommitSHA string) error {
	return a.Client.MergePRAtHead(ctx, owner, repo, index, headCommitSHA)
}
