package handler

import "testing"

func TestGitlabAutoLinkFromSettings(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want bool
	}{
		{"empty settings -> off", ``, false},
		{"sub-flag on, master off -> still on (master no longer short-circuits)", `{"gitlab_enabled":false,"gitlab_auto_link_enabled":true}`, true},
		{"sub-flag on, master on -> on", `{"gitlab_enabled":true,"gitlab_auto_link_enabled":true}`, true},
		{"sub-flag off -> off", `{"gitlab_auto_link_enabled":false}`, false},
		{"sub-flag absent -> off (default off)", `{"gitlab_enabled":false}`, false},
		{"garbage json -> off", `{not json`, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := gitlabAutoLinkFromSettings([]byte(tc.raw)); got != tc.want {
				t.Errorf("gitlabAutoLinkFromSettings(%s) = %v, want %v", tc.raw, got, tc.want)
			}
		})
	}
}
