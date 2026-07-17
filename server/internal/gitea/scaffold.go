package gitea

import (
	"context"
	"fmt"
)

// scaffoldAPI is the subset of *Client that ScaffoldRunDeliverable needs.
// Defined as an interface so the orchestration is unit-testable with a fake
// (the concrete *Client satisfies it structurally).
type scaffoldAPI interface {
	GetOrg(ctx context.Context, org string) (bool, error)
	CreateOrg(ctx context.Context, org, description string) error
	GetRepo(ctx context.Context, owner, name string) (bool, error)
	CreateRepo(ctx context.Context, owner, name, description string) error
	GetBranch(ctx context.Context, owner, repo, branch string) (bool, error)
	CreateBranch(ctx context.Context, owner, repo, branch, fromRef string) error
	CreateFile(ctx context.Context, owner, repo, branch, path, content, message string) error
	ProtectBranch(ctx context.Context, owner, repo, rule string) error
}

// Compile-time check that *Client satisfies scaffoldAPI.
var _ scaffoldAPI = (*Client)(nil)

// ScaffoldParams identifies what to scaffold.
type ScaffoldParams struct {
	WorkspaceID        string
	WorkflowID         string
	RunID              string
	WorkflowTitle      string // human-readable; written to org/repo description
	DefinitionSnapshot string // workflow definition text; seeded onto main (readable, not drift-checked)
}

// ScaffoldResult is the owner/repo/branch the daemon needs (M2 builds clone/web
// URLs from the configured base URL + these).
type ScaffoldResult struct {
	Owner      string // t-<ws[:8]>
	Repo       string // wf-<wf[:8]>
	InstBranch string // inst-<run[:8]>
}

// ScaffoldRunDeliverable get-or-creates, idempotently: the workspace org, the
// workflow repo (with main auto-initialized), branch protection on main, and
// the run's inst branch (based off main). Safe to retry on transient failure.
//
// Partial-failure caveat: the org and inst branch are re-verified on every
// call, but the repo's seed-file and branch protection are applied ONLY at
// first repo creation. If CreateRepo succeeds and a later step (seed or
// protection) fails, a retry sees the repo as existing and will NOT re-seed
// main or re-apply protection. This is acceptable: the DB is the source of
// truth (the seeded definition.yaml is human-readable only, no drift check)
// and M2 PR-gating — not branch protection — is the load-bearing write gate.
func ScaffoldRunDeliverable(ctx context.Context, c scaffoldAPI, p ScaffoldParams) (*ScaffoldResult, error) {
	owner := OrgName(p.WorkspaceID)
	repo := RepoName(p.WorkflowID)
	inst := InstBranch(p.RunID)

	// 1. Org (lazy, idempotent).
	exists, err := c.GetOrg(ctx, owner)
	if err != nil {
		return nil, fmt.Errorf("get gitea org: %w", err)
	}
	if !exists {
		if err := c.CreateOrg(ctx, owner, p.WorkflowTitle); err != nil {
			return nil, fmt.Errorf("create gitea org: %w", err)
		}
	}

	// 2. Repo (lazy, idempotent). main is auto-initialized on creation.
	repoExists, err := c.GetRepo(ctx, owner, repo)
	if err != nil {
		return nil, fmt.Errorf("get gitea repo: %w", err)
	}
	if !repoExists {
		if err := c.CreateRepo(ctx, owner, repo, p.WorkflowTitle); err != nil {
			return nil, fmt.Errorf("create gitea repo: %w", err)
		}
		if p.DefinitionSnapshot != "" {
			if err := c.CreateFile(ctx, owner, repo, "main", "definition.yaml", p.DefinitionSnapshot, "seed workflow definition"); err != nil {
				return nil, fmt.Errorf("seed gitea main: %w", err)
			}
		}
		// Best-effort: branch protection is defense-in-depth, NOT load-bearing.
		// M2 gates all daemon writes through node branches + PRs regardless, so
		// a protection failure here only means main could (in principle) be
		// pushed to directly — which M2's flow already prevents. The error is
		// intentionally ignored (this package has no logger); M2's caller can
		// surface protection failures if it ever needs to.
		_ = c.ProtectBranch(ctx, owner, repo, "main")
	}

	// 3. Inst branch (per run, idempotent GET-then-POST). Base = main.
	instExists, err := c.GetBranch(ctx, owner, repo, inst)
	if err != nil {
		return nil, fmt.Errorf("get gitea inst branch: %w", err)
	}
	if !instExists {
		if err := c.CreateBranch(ctx, owner, repo, inst, "main"); err != nil {
			return nil, fmt.Errorf("create gitea inst branch: %w", err)
		}
	}

	return &ScaffoldResult{Owner: owner, Repo: repo, InstBranch: inst}, nil
}
