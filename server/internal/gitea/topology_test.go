package gitea

import (
	"strings"
	"testing"
)

func TestShortHex(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"7f3c9a1e-d4b2-4c8e-9a3f-1b2c3d4e5f6a", "7f3c9a1e"},
		{"F3A8B2C1-9D7E-4A2B-8E1F-1234567890AB", "f3a8b2c1"}, // case-normalized
	}
	for _, c := range cases {
		if got := shortHex(c.in); got != c.want {
			t.Errorf("shortHex(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestShortHex_PanicsOnInvalidUUID(t *testing.T) {
	for _, in := range []string{"", "not-a-uuid", "abc", "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"} {
		func() {
			defer func() {
				r := recover()
				if r == nil {
					t.Fatalf("shortHex(%q) did not panic", in)
				}
				msg, ok := r.(string)
				if !ok || !strings.Contains(msg, "gitea: invalid UUID") {
					t.Fatalf("shortHex(%q) panic = %v, want message containing %q", in, r, "gitea: invalid UUID")
				}
			}()
			_ = shortHex(in)
		}()
	}
}

func TestTopologyNames(t *testing.T) {
	ws := "7f3c9a1e-d4b2-4c8e-9a3f-1b2c3d4e5f6a"
	wf := "11111111-2222-3333-4444-555555555555"
	run := "f3a8b2c1-9d7e-4a2b-8e1f-1234567890ab"
	node := "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

	if got := OrgName(ws); got != "t-7f3c9a1e" {
		t.Errorf("OrgName = %q", got)
	}
	if got := RepoName(wf); got != "wf-11111111" {
		t.Errorf("RepoName = %q", got)
	}
	if got := RepoName("bug-fix-flow"); got != "wf-bug-fix-flow" {
		t.Errorf("RepoName(slug) = %q", got)
	}
	if got := RepoName("Bug Fix/Flow"); got != "wf-bug_fix_flow" {
		t.Errorf("RepoName(escaped slug) = %q", got)
	}
	if got := RepoName(".hidden-def"); got != "wf-_.hidden-def" {
		t.Errorf("RepoName(dot slug) = %q", got)
	}
	if got := RepoPath(ws, wf); got != "t-7f3c9a1e/wf-11111111" {
		t.Errorf("RepoPath = %q", got)
	}
	if got := InstBranch(run); got != "inst-f3a8b2c1" {
		t.Errorf("InstBranch = %q", got)
	}
	if got := NodeBranch(3, node); got != "node/03-aaaaaaaa" {
		t.Errorf("NodeBranch = %q", got)
	}
	if got := NodeBranch(12, node); got != "node/12-aaaaaaaa" {
		t.Errorf("NodeBranch(12) = %q", got)
	}
}

func TestNodeDir(t *testing.T) {
	nodeRun := "11111111-2222-3333-4444-555555555555"
	cases := []struct {
		seq       int
		nodeTitle string
		want      string
	}{
		{3, "需求分析", "nodes/03-需求分析-11111111"},
		{3, "", "nodes/03-11111111"},             // empty title → omit segment
		{3, "$$$", "nodes/03-11111111"},          // all-symbols title → omit
		{12, "Design", "nodes/12-Design-11111111"},
		{3, "API 规范", "nodes/03-API-规范-11111111"}, // space → dash
	}
	for _, c := range cases {
		if got := NodeDir(c.seq, c.nodeTitle, nodeRun); got != c.want {
			t.Errorf("NodeDir(%d, %q) = %q, want %q", c.seq, c.nodeTitle, got, c.want)
		}
	}
}

func TestDeliverablePath(t *testing.T) {
	nodeRun := "11111111-2222-3333-4444-555555555555"
	cases := []struct {
		seq              int
		nodeTitle        string
		deliverableTitle string
		want             string
	}{
		{3, "需求分析", "设计文档", "nodes/03-需求分析-11111111/设计文档.md"},
		{3, "", "设计文档", "nodes/03-11111111/设计文档.md"},
		{3, "需求分析", "", "nodes/03-需求分析-11111111/untitled.md"},
		{12, "Design", "Spec", "nodes/12-Design-11111111/Spec.md"},
	}
	for _, c := range cases {
		got := DeliverablePath(c.seq, c.nodeTitle, nodeRun, c.deliverableTitle)
		if got != c.want {
			t.Errorf("DeliverablePath(%d,%q,%q) = %q, want %q", c.seq, c.nodeTitle, c.deliverableTitle, got, c.want)
		}
	}
}

func TestReviewPath(t *testing.T) {
	cases := []struct {
		round    int
		reviewer string
		verdict  string
		want     string
	}{
		{1, "张三", "通过", "reviews/01-张三-通过.md"},
		{2, "李四", "驳回", "reviews/02-李四-驳回.md"},
		{1, "O'Brien", "通过", "reviews/01-O-Brien-通过.md"},
		{10, "张三", "通过", "reviews/10-张三-通过.md"},
	}
	for _, c := range cases {
		if got := ReviewPath(c.round, c.reviewer, c.verdict); got != c.want {
			t.Errorf("ReviewPath(%d,%q,%q) = %q, want %q", c.round, c.reviewer, c.verdict, got, c.want)
		}
	}
}

func TestSanitizePathSeg(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"需求分析", "需求分析"},     // CJK preserved
		{"Design Doc", "Design-Doc"}, // space → dash
		{"API规范 v2", "API规范-v2"},  // mixed CJK + ascii + space
		{"a/b", "a-b"},               // slash → dash
		{"fix$$$x", "fix-x"},         // symbols → dash, collapse
		{"  hello  ", "hello"},       // trim
		{"", ""},                     // empty
		{"$$$", ""},                  // all symbols → empty
		{"Bug.Fix_v2", "Bug.Fix_v2"}, // allowed punct kept
		{"a - b", "a-b"},             // collapse runs
		{".", ""},                    // lone dot → empty (git-forbidden component)
		{"..", ""},                   // lone dotdot → empty
	}
	for _, c := range cases {
		if got := sanitizePathSeg(c.in); got != c.want {
			t.Errorf("sanitizePathSeg(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
