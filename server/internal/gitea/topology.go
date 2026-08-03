// Package gitea provides the platform-owned Gitea integration: a topology
// (name derivation) layer, a token-authenticated HTTP client, and idempotent
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

// CodePath is the in-repo path — relative to a NodeDir — where one code MR
// deliverable is archived: code/<deliverableID>.md. deliverableID is a UUID;
// used verbatim (UUIDs are path-safe) so the archived entry traces back to the
// multica deliverable row. Full path is NodeDir(...) + "/" + CodePath(...).
func CodePath(deliverableID string) string {
	return "code/" + deliverableID + ".md"
}

// SplitChildPath is the in-repo path — relative to the PARENT run's split-node
// NodeDir — where a split-out child issue's deliverable-address is registered:
// splits/<issueNumber>[-<sanitizedTitle>].md. Title omitted when empty/all-symbol
// (like NodeDir). Lets the parent repo browser list every child task's
// deliverable repo at a glance.
func SplitChildPath(issueNumber int, childTitle string) string {
	title := sanitizePathSeg(childTitle)
	if title == "" {
		return fmt.Sprintf("splits/%d.md", issueNumber)
	}
	return fmt.Sprintf("splits/%d-%s.md", issueNumber, title)
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

// TopoNode is the minimal node identity needed to compute a topological order.
type TopoNode struct {
	ID        string
	SortOrder int32 // tiebreaker only
	Title     string
}

// TopoEdge is a directed edge From → To.
type TopoEdge struct{ From, To string }

// NodeTopoOrder returns each node's 1-based position in a stable topological
// order of the DAG (Kahn's algorithm). Among nodes that are simultaneously
// ready (in-degree zero), the one with the smallest (sort_order, title, ID) is
// emitted first, so the order is deterministic across runs/restarts and does
// not depend on the input slice order.
//
// The result drives the readable <NN> prefix in deliverable repo paths (see
// NodeBranch/NodeDir/DeliverablePath), so the first node is 01 (not 00) and
// nodes sort in execution order even when sort_order was not explicitly set.
// Every node in `nodes` receives a position; nodes locked by a cycle
// (ValidateDAG should prevent these) get the trailing positions in tiebreak
// order.
func NodeTopoOrder(nodes []TopoNode, edges []TopoEdge) map[string]int {
	byID := make(map[string]TopoNode, len(nodes))
	inDegree := make(map[string]int, len(nodes))
	adj := make(map[string][]string)
	for _, n := range nodes {
		byID[n.ID] = n
		inDegree[n.ID] = 0
	}
	for _, e := range edges {
		if _, ok := byID[e.From]; !ok {
			continue
		}
		if _, ok := byID[e.To]; !ok {
			continue
		}
		adj[e.From] = append(adj[e.From], e.To)
		inDegree[e.To]++
	}

	order := make(map[string]int, len(nodes))
	emitted := make(map[string]bool, len(nodes))
	for pos := 0; pos < len(nodes); pos++ {
		pick := readyMin(nodes, byID, emitted, inDegree)
		if pick == "" {
			// No in-degree-zero node remains (cycle). Fall back to tiebreak
			// order for the remaining nodes so the map stays complete.
			pick = leftoverMin(nodes, byID, emitted)
			if pick == "" {
				break
			}
		}
		order[pick] = pos + 1 // 1-based: first node is 01
		emitted[pick] = true
		for _, v := range adj[pick] {
			inDegree[v]--
		}
	}
	return order
}

// readyMin returns the smallest (by tiebreak) in-degree-zero, unemitted node.
func readyMin(nodes []TopoNode, byID map[string]TopoNode, emitted map[string]bool, inDegree map[string]int) string {
	var pick string
	for _, n := range nodes {
		if emitted[n.ID] || inDegree[n.ID] != 0 {
			continue
		}
		if pick == "" || lessTopo(n, byID[pick]) {
			pick = n.ID
		}
	}
	return pick
}

// leftoverMin returns the smallest unemitted node (cycle fallback).
func leftoverMin(nodes []TopoNode, byID map[string]TopoNode, emitted map[string]bool) string {
	var pick string
	for _, n := range nodes {
		if emitted[n.ID] {
			continue
		}
		if pick == "" || lessTopo(n, byID[pick]) {
			pick = n.ID
		}
	}
	return pick
}

// lessTopo is the stable tiebreak: sort_order, then title, then ID.
func lessTopo(a, b TopoNode) bool {
	if a.SortOrder != b.SortOrder {
		return a.SortOrder < b.SortOrder
	}
	if a.Title != b.Title {
		return a.Title < b.Title
	}
	return a.ID < b.ID
}
