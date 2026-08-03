package gitea

import (
	"context"
	"errors"
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

// ScaffoldOrg creates the team-namespace Gitea org for a workspace if it
// doesn't exist yet. Idempotent (GetOrg then CreateOrg). Called on workspace
// creation so the org is ready before any workflow runs, not lazily on the
// first document-run scaffold.
func ScaffoldOrg(ctx context.Context, c scaffoldAPI, workspaceID, displayName string) error {
	owner := OrgName(workspaceID)
	exists, err := c.GetOrg(ctx, owner)
	if err != nil {
		return fmt.Errorf("get gitea org %s: %w", owner, err)
	}
	if exists {
		return nil
	}
	if err := c.CreateOrg(ctx, owner, displayName); err != nil {
		if !errors.Is(err, ErrAlreadyExists) {
			return fmt.Errorf("create gitea org %s: %w", owner, err)
		}
	}
	return nil
}

// ScaffoldWorkspaceArchiveRepo creates the workspace-level default deliverable
// archive repo. It is idempotent and created eagerly with the workspace so
// direct member/agent issues have a stable archival target before any run.
func ScaffoldWorkspaceArchiveRepo(ctx context.Context, c scaffoldAPI, workspaceID, displayName string) error {
	owner := OrgName(workspaceID)
	repo := DefaultArchiveRepoName()

	orgExists, err := c.GetOrg(ctx, owner)
	if err != nil {
		return fmt.Errorf("get org: %w", err)
	}
	if !orgExists {
		if err := c.CreateOrg(ctx, owner, displayName); err != nil {
			if !errors.Is(err, ErrAlreadyExists) {
				return fmt.Errorf("create org: %w", err)
			}
		}
	}

	repoExists, err := c.GetRepo(ctx, owner, repo)
	if err != nil {
		return fmt.Errorf("get repo: %w", err)
	}
	if !repoExists {
		if err := c.CreateRepo(ctx, owner, repo, displayName+" deliverable archive"); err != nil {
			if !errors.Is(err, ErrAlreadyExists) {
				return fmt.Errorf("create repo: %w", err)
			}
		}
	}
	// Only main is protected. inst-* MUST stay unprotected: multica creates inst
	// branches and pushes deliverable content (files, node branches) to them
	// directly, and some Gitea versions reject even API branch creation that
	// matches a protected glob (status 500 PushRejected). See client.ProtectBranch.
	_ = c.ProtectBranch(ctx, owner, repo, "main")
	return nil
}

// ScaffoldWorkflowRepo creates the workflow's type repo (wf-<wf[:8]>) under the
// workspace org and ensures the main branch is protected. No concrete inst
// branch is created here (that's per-run). Called on workflow activation so the
// repo exists before the first run. Org + repo are idempotent.
func ScaffoldWorkflowRepo(ctx context.Context, c scaffoldAPI, workspaceID, workflowID, workflowTitle string) error {
	owner := OrgName(workspaceID)
	repo := RepoName(workflowID)

	// Org (idempotent, may already exist from workspace creation).
	orgExists, err := c.GetOrg(ctx, owner)
	if err != nil {
		return fmt.Errorf("get org: %w", err)
	}
	if !orgExists {
		if err := c.CreateOrg(ctx, owner, workflowTitle); err != nil {
			if !errors.Is(err, ErrAlreadyExists) {
				return fmt.Errorf("create org: %w", err)
			}
		}
	}

	// Repo (idempotent).
	repoExists, err := c.GetRepo(ctx, owner, repo)
	if err != nil {
		return fmt.Errorf("get repo: %w", err)
	}
	if !repoExists {
		if err := c.CreateRepo(ctx, owner, repo, workflowTitle); err != nil {
			if !errors.Is(err, ErrAlreadyExists) {
				return fmt.Errorf("create repo: %w", err)
			}
		}
	}
	_ = c.ProtectBranch(ctx, owner, repo, "main")
	return nil
}

// ScaffoldParams identifies what to scaffold.
type ScaffoldParams struct {
	WorkspaceID        string
	WorkflowID         string
	RepoName           string // optional override; default is RepoName(WorkflowID)
	RunID              string
	WorkflowTitle      string // human-readable; written to org/repo description
	DefinitionSnapshot string // workflow definition text; seeded onto main (readable, not drift-checked)
}

// ScaffoldResult is the owner/repo/branch the daemon needs (M2 builds clone/web
// URLs from the configured base URL + these).
type ScaffoldResult struct {
	Owner      string // t-<ws[:8]>
	Repo       string // wf-<wf[:8]> or an explicit archive repo override
	InstBranch string // inst-<run[:8]>
}

// ScaffoldRunDeliverable get-or-creates, idempotently: the workspace org, the
// workflow repo (with main auto-initialized), main branch protection, and the
// run's inst branch (based off main). Safe to retry on transient failure.
//
// Partial-failure caveat: the org and inst branch are re-verified on every
// call, and branch protections are re-ensured on every call. The repo's seed
// file is applied only at first repo creation. If CreateRepo succeeds and
// seeding fails, a retry sees the repo as existing and will not re-seed main.
// This is acceptable: the DB is the source of truth (the seeded definition.yaml
// is human-readable only, no drift check).
func ScaffoldRunDeliverable(ctx context.Context, c scaffoldAPI, p ScaffoldParams) (*ScaffoldResult, error) {
	owner := OrgName(p.WorkspaceID)
	repo := RepoName(p.WorkflowID)
	if p.RepoName != "" {
		repo = p.RepoName
	}
	inst := InstBranch(p.RunID)

	// 1. Org (lazy, idempotent).
	exists, err := c.GetOrg(ctx, owner)
	if err != nil {
		return nil, fmt.Errorf("get gitea org: %w", err)
	}
	if !exists {
		if err := c.CreateOrg(ctx, owner, p.WorkflowTitle); err != nil {
			if !errors.Is(err, ErrAlreadyExists) {
				return nil, fmt.Errorf("create gitea org: %w", err)
			}
		}
	}

	// 2. Repo (lazy, idempotent). main is auto-initialized on creation.
	repoExists, err := c.GetRepo(ctx, owner, repo)
	if err != nil {
		return nil, fmt.Errorf("get gitea repo: %w", err)
	}
	repoCreated := false
	repoReady := repoExists
	if !repoExists {
		if err := c.CreateRepo(ctx, owner, repo, p.WorkflowTitle); err != nil {
			if !errors.Is(err, ErrAlreadyExists) {
				return nil, fmt.Errorf("create gitea repo: %w", err)
			}
			repoReady = true
		} else {
			repoCreated = true
			repoReady = true
		}
	}
	if repoCreated && p.DefinitionSnapshot != "" {
		if err := c.CreateFile(ctx, owner, repo, "main", "definition.yaml", p.DefinitionSnapshot, "seed workflow definition"); err != nil {
			return nil, fmt.Errorf("seed gitea main: %w", err)
		}
	}
	if repoReady {
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
