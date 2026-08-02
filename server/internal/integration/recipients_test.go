package integration

import (
	"context"
	"errors"
	"sort"
	"testing"
)

// fakeRecipientStore implements RecipientStore for unit tests.
type fakeRecipientStore struct {
	commentBodies []string
	emails        map[string]string // userID -> email
	err           error
}

func (f *fakeRecipientStore) ListCommentBodies(_ context.Context, _ string) ([]string, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.commentBodies, nil
}

func (f *fakeRecipientStore) GetUserEmail(_ context.Context, userID string) (string, error) {
	if f.err != nil {
		return "", f.err
	}
	return f.emails[userID], nil
}

func mentionLink(userID string) string {
	return "[@User](mention://member/" + userID + ")"
}

func sortedEmails(t *testing.T, got []string) []string {
	t.Helper()
	out := append([]string(nil), got...)
	sort.Strings(out)
	return out
}

func TestResolveRecipients(t *testing.T) {
	const (
		aliceID   = "11111111-1111-1111-1111-111111111111"
		bobID     = "22222222-2222-2222-2222-222222222222"
		agentID   = "33333333-3333-3333-3333-333333333333"
		creatorID = "44444444-4444-4444-4444-444444444444"
		ownerID   = "55555555-5555-5555-5555-555555555555"
	)
	emails := map[string]string{
		aliceID:   "alice@corp.com",
		bobID:     "bob@corp.com",
		creatorID: "creator@corp.com",
		ownerID:   "owner@corp.com",
	}

	tests := []struct {
		name  string
		in    ResolveInput
		store *fakeRecipientStore
		want  []string
	}{
		{
			name: "member mention in description wins",
			in: ResolveInput{
				IssueID:     "issue-1",
				Description: "please review " + mentionLink(aliceID),
			},
			store: &fakeRecipientStore{emails: emails},
			want:  []string{"alice@corp.com"},
		},
		{
			name: "mention only in comments is collected",
			in: ResolveInput{
				IssueID:     "issue-1",
				Description: "no mentions here",
			},
			store: &fakeRecipientStore{
				commentBodies: []string{"cc " + mentionLink(bobID)},
				emails:        emails,
			},
			want: []string{"bob@corp.com"},
		},
		{
			name: "multiple member mentions are deduplicated",
			in: ResolveInput{
				IssueID:     "issue-1",
				Description: mentionLink(aliceID) + " and " + mentionLink(bobID) + " again " + mentionLink(aliceID),
			},
			store: &fakeRecipientStore{emails: emails},
			want:  []string{"alice@corp.com", "bob@corp.com"},
		},
		{
			name: "agent-only mention falls back to responsible member",
			in: ResolveInput{
				IssueID:           "issue-1",
				Description:       "[@Bot](mention://agent/" + agentID + ")",
				ResponsibleUserID: ownerID,
			},
			store: &fakeRecipientStore{emails: emails},
			want:  []string{"owner@corp.com"},
		},
		{
			name: "no mentions falls back to responsible member",
			in: ResolveInput{
				IssueID:           "issue-1",
				Description:       "plain text",
				ResponsibleUserID: ownerID,
			},
			store: &fakeRecipientStore{emails: emails},
			want:  []string{"owner@corp.com"},
		},
		{
			name: "missing responsible member with no member mentions yields no recipients",
			in: ResolveInput{
				IssueID:     "issue-1",
				Description: "[@Bot](mention://agent/" + agentID + ")",
			},
			store: &fakeRecipientStore{emails: emails},
			want:  nil,
		},
		{
			name: "actor is excluded from mentioned recipients",
			in: ResolveInput{
				IssueID:     "issue-1",
				Description: mentionLink(aliceID) + " " + mentionLink(bobID),
				ActorType:   "member",
				ActorID:     aliceID,
			},
			store: &fakeRecipientStore{emails: emails},
			want:  []string{"bob@corp.com"},
		},
		{
			name: "actor as responsible fallback is excluded",
			in: ResolveInput{
				IssueID:           "issue-1",
				Description:       "plain text",
				ResponsibleUserID: ownerID,
				ActorType:         "member",
				ActorID:           ownerID,
			},
			store: &fakeRecipientStore{emails: emails},
			want:  nil,
		},
		{
			name: "system actor is not excluded from mentions",
			in: ResolveInput{
				IssueID:     "issue-1",
				Description: mentionLink(aliceID),
				ActorType:   "system",
				ActorID:     "",
			},
			store: &fakeRecipientStore{emails: emails},
			want:  []string{"alice@corp.com"},
		},
		{
			name: "mentioned user without email is skipped",
			in: ResolveInput{
				IssueID:     "issue-1",
				Description: mentionLink(aliceID) + " " + mentionLink("99999999-9999-9999-9999-999999999999"),
			},
			store: &fakeRecipientStore{emails: emails},
			want:  []string{"alice@corp.com"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ResolveRecipients(context.Background(), tt.store, tt.in)
			if err != nil {
				t.Fatalf("ResolveRecipients: %v", err)
			}
			gotSorted := sortedEmails(t, got)
			wantSorted := sortedEmails(t, tt.want)
			if len(gotSorted) != len(wantSorted) {
				t.Fatalf("got %v, want %v", got, tt.want)
			}
			for i := range gotSorted {
				if gotSorted[i] != wantSorted[i] {
					t.Fatalf("got %v, want %v", got, tt.want)
				}
			}
		})
	}
}

func TestResolveRecipients_StoreError(t *testing.T) {
	store := &fakeRecipientStore{err: errors.New("db down")}
	_, err := ResolveRecipients(context.Background(), store, ResolveInput{
		IssueID:     "issue-1",
		Description: "text",
	})
	if err == nil {
		t.Fatal("expected error to propagate")
	}
}
