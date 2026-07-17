package gitea

import (
	"context"
	"errors"
	"testing"
)

// fakeProvision records calls; implements provisionAPI.
type fakeProvision struct {
	users   map[string]bool
	tokens  map[string]string // username -> token returned
	members []string

	userCreateErr  error
	tokenCreateErr error
	addMemberErr   error
	orgExists      bool
	orgGetErr      error
}

func newFakeProvision() *fakeProvision {
	return &fakeProvision{users: map[string]bool{}, tokens: map[string]string{}, orgExists: true}
}

func (f *fakeProvision) AdminCreateUser(_ context.Context, username, email string) error {
	if f.userCreateErr != nil {
		return f.userCreateErr
	}
	f.users[username] = true
	return nil
}
func (f *fakeProvision) CreateUserToken(_ context.Context, username, name string) (string, error) {
	if f.tokenCreateErr != nil {
		return "", f.tokenCreateErr
	}
	tok := "pat-" + username
	f.tokens[username] = tok
	return tok, nil
}
func (f *fakeProvision) AddOrgMember(_ context.Context, org, username string) error {
	if f.addMemberErr != nil {
		return f.addMemberErr
	}
	f.members = append(f.members, org+"/"+username)
	return nil
}
func (f *fakeProvision) GetOrg(_ context.Context, org string) (bool, error) {
	return f.orgExists, f.orgGetErr
}

func TestProvisionWorkspaceBot(t *testing.T) {
	f := newFakeProvision()
	username, token, err := ProvisionWorkspaceBot(context.Background(), f, BotParams{
		WorkspaceID:   "7f3c9a1e-d4b2-4c8e-9a3f-1b2c3d4e5f6a",
		WorkspaceName: "Acme",
	})
	if err != nil {
		t.Fatalf("Provision: %v", err)
	}
	if username != "mc-bot-7f3c9a1e" {
		t.Errorf("username = %q", username)
	}
	if token != "pat-mc-bot-7f3c9a1e" {
		t.Errorf("token = %q", token)
	}
	if !f.users["mc-bot-7f3c9a1e"] {
		t.Error("bot user not created")
	}
	found := false
	for _, m := range f.members {
		if m == "t-7f3c9a1e/mc-bot-7f3c9a1e" {
			found = true
		}
	}
	if !found {
		t.Error("bot not added to org")
	}
}

func TestProvisionWorkspaceBot_OrgMissingSkipsMembership(t *testing.T) {
	f := newFakeProvision()
	f.orgExists = false
	_, _, err := ProvisionWorkspaceBot(context.Background(), f, BotParams{
		WorkspaceID: "7f3c9a1e-d4b2-4c8e-9a3f-1b2c3d4e5f6a",
	})
	if err != nil {
		t.Fatalf("Provision: %v", err)
	}
	if !f.users["mc-bot-7f3c9a1e"] {
		t.Error("bot user should be created even when the org is missing")
	}
	if len(f.members) != 0 {
		t.Errorf("membership must be skipped when the org is missing, got %v", f.members)
	}
}

func TestProvisionWorkspaceBot_AdminCreateUserFails(t *testing.T) {
	f := newFakeProvision()
	f.userCreateErr = errors.New("user boom")
	_, _, err := ProvisionWorkspaceBot(context.Background(), f, BotParams{
		WorkspaceID: "7f3c9a1e-d4b2-4c8e-9a3f-1b2c3d4e5f6a",
	})
	if err == nil || err.Error() != "create gitea bot user: user boom" {
		t.Fatalf("err = %v", err)
	}
	if len(f.tokens) != 0 || len(f.members) != 0 {
		t.Error("token mint and org membership must not happen after user-create failure")
	}
}

func TestProvisionWorkspaceBot_CreateUserTokenFails(t *testing.T) {
	f := newFakeProvision()
	f.tokenCreateErr = errors.New("token boom")
	_, _, err := ProvisionWorkspaceBot(context.Background(), f, BotParams{
		WorkspaceID: "7f3c9a1e-d4b2-4c8e-9a3f-1b2c3d4e5f6a",
	})
	if err == nil || err.Error() != "create gitea bot pat: token boom" {
		t.Fatalf("err = %v", err)
	}
	if len(f.members) != 0 {
		t.Error("org membership must not be added after token-create failure")
	}
}

func TestProvisionWorkspaceBot_AddOrgMemberFails(t *testing.T) {
	f := newFakeProvision()
	f.addMemberErr = errors.New("member boom")
	_, _, err := ProvisionWorkspaceBot(context.Background(), f, BotParams{
		WorkspaceID: "7f3c9a1e-d4b2-4c8e-9a3f-1b2c3d4e5f6a",
	})
	if err == nil || err.Error() != "add gitea bot to org: member boom" {
		t.Fatalf("err = %v", err)
	}
}
