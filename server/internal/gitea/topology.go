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
	"unicode"

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

// DefaultArchiveRepoName is the workspace-level repo for issue deliverables
// that are not tied to a user-defined workflow.
func DefaultArchiveRepoName() string { return "deliverable-archive" }

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

// NodeBranch is the per-node-run feature branch: node/<NN>-<nodeRunShort>, where
// NN is the node's sort_order (zero-padded). Based off the run's inst branch;
// deleted after the node PR merges. Branch names are strict-ASCII (Gitea repo/branch
// charset), so the node title (often CJK) is NOT carried here — it lives in the PR
// title and in the in-repo node directory (NodeDir).
func NodeBranch(seq int, nodeRunID string) string {
	return fmt.Sprintf("node/%02d-%s", seq, shortHex(nodeRunID))
}

// NodeDir is the in-repo directory holding a node-run's deliverables and reviews:
// nodes/<NN>[-<title>]-<nodeRunShort>. Unlike repo/branch names, in-repo paths are
// UTF-8 (git stores bytes, Gitea renders CJK), so the node title is kept when it
// sanitizes to something usable; an all-symbol/empty title omits the segment.
func NodeDir(seq int, nodeTitle, nodeRunID string) string {
	short := shortHex(nodeRunID)
	title := sanitizePathSeg(nodeTitle)
	if title == "" {
		return fmt.Sprintf("nodes/%02d-%s", seq, short)
	}
	return fmt.Sprintf("nodes/%02d-%s-%s", seq, title, short)
}

// DeliverablePath is the in-repo path where a document deliverable body lives:
// <NodeDir>/<deliverableTitle>.md. The deliverable is named by its own title (no ID
// suffix); an empty/all-symbol title falls back to "untitled". The server computes
// this and sends it in the claim response; the CLI consumes it verbatim.
//
// Caller is responsible for de-duplicating identical deliverable titles on the same
// node (append a short-ID suffix to the title before calling) — a rare edge case.
func DeliverablePath(seq int, nodeTitle, nodeRunID, deliverableTitle string) string {
	name := sanitizePathSeg(deliverableTitle)
	if name == "" {
		name = "untitled"
	}
	return NodeDir(seq, nodeTitle, nodeRunID) + "/" + name + ".md"
}

// ReviewPath is the in-repo path — relative to a NodeDir — where one review round's
// opinion is archived: reviews/<RR>-<reviewer>-<verdict>.md. RR is the round
// (zero-padded); verdict is the human word ("通过"/"驳回"). The full path is
// NodeDir(...) + "/" + ReviewPath(...).
func ReviewPath(round int, reviewer, verdict string) string {
	r := sanitizePathSeg(reviewer)
	if r == "" {
		r = "unknown"
	}
	v := sanitizePathSeg(verdict)
	if v == "" {
		v = "unknown"
	}
	return fmt.Sprintf("reviews/%02d-%s-%s.md", round, r, v)
}

// sanitizePathSeg lightly sanitizes a human string for use as a single path
// segment INSIDE a repo (not a repo/branch name). Unlike escapeDefSlug it
// preserves CJK and other Unicode letters/digits — git stores paths as UTF-8 and
// Gitea renders them — and only replaces path separators, control chars, and
// shell-hostile characters with '-', collapsing runs and trimming ends. Returns
// "" when nothing usable remains, so callers can omit the segment.
func sanitizePathSeg(s string) string {
	var b []rune
	for _, r := range s {
		switch {
		case unicode.IsLetter(r), unicode.IsDigit(r), r == '.', r == '_':
			b = append(b, r)
		default:
			b = append(b, '-')
		}
	}
	// Collapse consecutive '-' (both literal '-' and replaced chars yield '-').
	var out []rune
	for _, r := range b {
		if r == '-' && len(out) > 0 && out[len(out)-1] == '-' {
			continue
		}
		out = append(out, r)
	}
	// Trim leading/trailing '-'.
	for len(out) > 0 && out[0] == '-' {
		out = out[1:]
	}
	for len(out) > 0 && out[len(out)-1] == '-' {
		out = out[:len(out)-1]
	}
	res := string(out)
	if res == "." || res == ".." { // git forbids these as path components
		return ""
	}
	return res
}
