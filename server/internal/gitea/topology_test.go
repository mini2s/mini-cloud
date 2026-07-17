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
	if got := RepoPath(ws, wf); got != "t-7f3c9a1e/wf-11111111" {
		t.Errorf("RepoPath = %q", got)
	}
	if got := InstBranch(run); got != "inst-f3a8b2c1" {
		t.Errorf("InstBranch = %q", got)
	}
	if got := NodeBranch(node); got != "node/aaaaaaaa" {
		t.Errorf("NodeBranch = %q", got)
	}
}
