package gitea

import "testing"

func TestParsePullRequestURL(t *testing.T) {
	cases := []struct {
		url     string
		want    PullRequestRef
		wantErr bool
	}{
		{"https://gitea.example.com/t-7f3c9a1e/wf-11111111/pulls/42", PullRequestRef{Owner: "t-7f3c9a1e", Repo: "wf-11111111", Index: 42}, false},
		{"http://gitea.local/t-abcd1234/wf-abcd1234/pulls/7", PullRequestRef{Owner: "t-abcd1234", Repo: "wf-abcd1234", Index: 7}, false},
		{"", PullRequestRef{}, true},
		{"not a url", PullRequestRef{}, true},
		{"https://gitea.example.com/t-x/wf-y/pulls/notanumber", PullRequestRef{}, true},
		{"https://gitea.example.com/pulls/42", PullRequestRef{}, true},           // missing owner/repo
		{"https://gitea.example.com/t-x/wf-y/issues/42", PullRequestRef{}, true}, // not pulls
	}
	for _, c := range cases {
		ref, err := ParsePullRequestURL(c.url)
		if c.wantErr {
			if err == nil {
				t.Fatalf("%q: want error, got %+v", c.url, ref)
			}
			continue
		}
		if err != nil {
			t.Fatalf("%q: unexpected error %v", c.url, err)
		}
		if ref != c.want {
			t.Fatalf("%q: got %+v, want %+v", c.url, ref, c.want)
		}
	}
}
