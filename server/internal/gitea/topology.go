// Package gitea provides the platform-owned Gitea integration: a topology
// (name derivation) layer, an admin-token HTTP client, and idempotent
// scaffolding + workspace-bot provisioning. multica stores only pointers to
// Gitea; the document deliverable bodies live in Gitea repos, symmetric with
// code-type PRs in customer repos.
package gitea

import (
	"encoding/hex"
	"fmt"

	"github.com/google/uuid"
)

// shortHex returns the first 8 hex chars of a UUID (the first 4 bytes, hex-encoded)
// — the multica/costrict convention for deriving Gitea names from UUIDs. It
// panics on a non-UUID because callers always pass DB-sourced UUID IDs; a
// non-UUID here is a programmer bug, not user input.
func shortHex(id string) string {
	u, err := uuid.Parse(id)
	if err != nil {
		panic(fmt.Sprintf("gitea: invalid UUID %q: %v", id, err))
	}
	return hex.EncodeToString(u[:4])
}

// OrgName is the Gitea org (team namespace) for a workspace: t-<workspace.id[:8]>.
func OrgName(workspaceID string) string { return "t-" + shortHex(workspaceID) }

// RepoName is the Gitea repo name for a workflow definition: wf-<workflow.id[:8]>.
// multica deliberately uses workflow.id (a UUID) instead of costrict's
// human-readable def_slug to avoid Chinese-title escape problems (wf-____).
func RepoName(workflowID string) string { return "wf-" + shortHex(workflowID) }

// RepoPath is the full owner/name path: t-<ws[:8]>/wf-<wf[:8]>.
func RepoPath(workspaceID, workflowID string) string {
	return OrgName(workspaceID) + "/" + RepoName(workflowID)
}

// InstBranch is the per-run instance branch: inst-<run.id[:8]>. Base = repo
// default branch (main). Long-lived (audit asset); not auto-deleted.
func InstBranch(runID string) string { return "inst-" + shortHex(runID) }

// NodeBranch is the per-node-run feature branch: node/<nodeRun.id[:8]>. Based
// off the run's inst branch; deleted after the node PR merges.
func NodeBranch(nodeRunID string) string { return "node/" + shortHex(nodeRunID) }
