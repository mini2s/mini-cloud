// Package gitea provides the platform-owned Gitea integration: a topology
// (name derivation) layer, an admin-token HTTP client, and idempotent
// scaffolding + workspace-bot provisioning. multica stores only pointers to
// Gitea; the document deliverable bodies live in Gitea repos, symmetric with
// code-type PRs in customer repos.
package gitea

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"strings"

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

// RepoName is the Gitea repo name for a workflow definition: wf-<def_slug>.
// Non-UUID input follows costrict-web's WORKFLOW_REPO_PATH_ALGORITHM v2 escape
// rules. UUID input keeps the old short-id behavior for existing Multica call
// sites and already-provisioned repos.
func RepoName(workflowDefSlug string) string {
	if _, err := uuid.Parse(workflowDefSlug); err == nil {
		return "wf-" + shortHex(workflowDefSlug)
	}
	escaped := escapeDefSlug(workflowDefSlug)
	repo := "wf-" + escaped
	if len(repo) <= 64 {
		return repo
	}
	sum := sha1.Sum([]byte(escaped))
	return "wf-" + escaped[:51] + "~~" + hex.EncodeToString(sum[:])[:8]
}

// RepoPath is the full owner/name path: t-<ws[:8]>/wf-<wf[:8]>.
func RepoPath(workspaceID, workflowID string) string {
	return OrgName(workspaceID) + "/" + RepoName(workflowID)
}

func escapeDefSlug(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		switch {
		case r >= 'a' && r <= 'z':
			b.WriteRune(r)
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '.' || r == '_' || r == '-':
			b.WriteRune(r)
		default:
			b.WriteByte('_')
		}
	}
	out := b.String()
	if strings.HasPrefix(out, ".") {
		out = "_" + out
	}
	if out == "" {
		out = "unnamed"
	}
	return out
}

// InstBranch is the per-run instance branch: inst-<run.id[:8]>. Base = repo
// default branch (main). Long-lived (audit asset); not auto-deleted.
func InstBranch(runID string) string { return "inst-" + shortHex(runID) }

// NodeBranch is the per-node-run feature branch: node/<nodeRun.id[:8]>. Based
// off the run's inst branch; deleted after the node PR merges.
func NodeBranch(nodeRunID string) string { return "node/" + shortHex(nodeRunID) }

// DeliverablePath is the in-repo path where a document deliverable body lives:
// nodes/<nodeRunShort>/<deliverableShort>.md. Aligns with costrict-web's
// `nodes/` convention (WORKFLOW_REPO_PATH_ALGORITHM.md §7); multica derives the
// segments from UUIDs (not costrict's seq-slug). The server computes this and
// sends it in the claim response; the CLI consumes it verbatim (no re-derivation).
func DeliverablePath(nodeRunID, deliverableID string) string {
	return "nodes/" + shortHex(nodeRunID) + "/" + shortHex(deliverableID) + ".md"
}
