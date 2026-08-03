package handler

import (
	"testing"

	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// deliverableUploadWorkerAllowed mirrors the frontend's
// getHumanNodeRunActionAccess worker gate: a human-worked node run accepts
// uploads from its designated worker, from any member while undesignated, or
// from an owner/admin overriding; agent/squad-worked runs take no member
// uploads at all.
func TestDeliverableUploadWorkerAllowed(t *testing.T) {
	const me = "11111111-1111-1111-1111-111111111111"
	const myMember = "33333333-3333-3333-3333-333333333333"
	const other = "22222222-2222-2222-2222-222222222222"

	humanRun := func(workerID string) db.MulticaWorkflowNodeRun {
		nr := db.MulticaWorkflowNodeRun{WorkerType: "human"}
		if workerID != "" {
			nr.WorkerID = parseUUID(workerID)
		}
		return nr
	}

	cases := []struct {
		name     string
		nodeRun  db.MulticaWorkflowNodeRun
		userID   string
		memberID string
		isAdmin  bool
		want     bool
	}{
		{"designated member worker", humanRun(myMember), me, myMember, false, true},
		{"role-resolved user worker", humanRun(me), me, myMember, false, true},
		{"other member rejected", humanRun(other), me, myMember, false, false},
		{"admin override", humanRun(other), me, myMember, true, true},
		{"undesignated accepts any member", humanRun(""), me, myMember, false, true},
		{"agent worker rejects member", db.MulticaWorkflowNodeRun{WorkerType: "agent"}, me, myMember, false, false},
		{"agent worker rejects admin too", db.MulticaWorkflowNodeRun{WorkerType: "agent"}, me, myMember, true, false},
		{"squad worker rejects member", db.MulticaWorkflowNodeRun{WorkerType: "squad"}, me, myMember, false, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := deliverableUploadWorkerAllowed(tc.nodeRun, tc.userID, tc.memberID, tc.isAdmin); got != tc.want {
				t.Fatalf("deliverableUploadWorkerAllowed() = %v, want %v", got, tc.want)
			}
		})
	}
}

// normalizedPRURLs merges the legacy single-link field with the multi-link
// array, trimming blanks and dropping exact duplicates in order.
func TestUploadIssueDeliverablePRRequest_NormalizedPRURLs(t *testing.T) {
	cases := []struct {
		name string
		req  UploadIssueDeliverablePRRequest
		want []string
	}{
		{
			name: "legacy single field only",
			req:  UploadIssueDeliverablePRRequest{PullRequestURL: "https://git.example/pr/1"},
			want: []string{"https://git.example/pr/1"},
		},
		{
			name: "array only",
			req:  UploadIssueDeliverablePRRequest{PullRequestURLs: []string{"https://git.example/pr/1", "https://git.example/pr/2"}},
			want: []string{"https://git.example/pr/1", "https://git.example/pr/2"},
		},
		{
			name: "single + array merged and deduped",
			req: UploadIssueDeliverablePRRequest{
				PullRequestURL:  "https://git.example/pr/1",
				PullRequestURLs: []string{"https://git.example/pr/1", " https://git.example/pr/2 ", ""},
			},
			want: []string{"https://git.example/pr/1", "https://git.example/pr/2"},
		},
		{
			name: "blank single ignored",
			req:  UploadIssueDeliverablePRRequest{PullRequestURL: "  "},
			want: []string{},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := tc.req.normalizedPRURLs()
			if len(got) != len(tc.want) {
				t.Fatalf("normalizedPRURLs() = %v, want %v", got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Fatalf("normalizedPRURLs()[%d] = %q, want %q (all: %v)", i, got[i], tc.want[i], got)
				}
			}
		})
	}
}
