package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/multica-ai/multica/server/internal/csuser"
)

type fakeCSUser struct {
	users    []csuser.User
	gotKw    string
	gotLimit int
}

func (f *fakeCSUser) SearchUsers(_ context.Context, keyword string, limit int) ([]csuser.User, error) {
	f.gotKw = keyword
	f.gotLimit = limit
	return f.users, nil
}

func (f *fakeCSUser) GetUser(context.Context, string) (csuser.User, error) {
	return csuser.User{}, nil
}

func ptrString(s string) *string { return &s }

// authedGet creates a GET request with X-User-ID set so requireUserID passes.
// This avoids depending on TestMain/package globals (which need a database).
func authedGet(path string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Header.Set("X-User-ID", "test-user-uuid")
	return req
}

func TestSearchDeptUsersCallsCSUserAndCapsAt3(t *testing.T) {
	h := &Handler{CsUser: &fakeCSUser{users: []csuser.User{
		{SubjectID: "usr_1", Username: "29219", DisplayName: ptrString("Alice"), Email: ptrString("a@x.com"), CasdoorUniversalID: ptrString("uni-1")},
	}}}
	req := authedGet("/api/dept/users/search?q=ali")
	rec := httptest.NewRecorder()
	h.SearchDeptUsers(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("code=%d body=%s", rec.Code, rec.Body.String())
	}
	f := h.CsUser.(*fakeCSUser)
	if f.gotLimit != 3 {
		t.Fatalf("limit passed to cs-user = %d, want 3", f.gotLimit)
	}
	if f.gotKw != "ali" {
		t.Fatalf("keyword = %q", f.gotKw)
	}
	var got []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v body=%s", err, rec.Body.String())
	}
	if len(got) != 1 || got[0]["subject_id"] != "usr_1" || got[0]["name"] != "Alice" {
		t.Fatalf("body=%s", rec.Body.String())
	}
	if _, leak := got[0]["casdoor_universal_id"]; leak {
		t.Fatalf("universal_id must not leak to frontend: %s", rec.Body.String())
	}
}

func TestSearchDeptUsersNotConfigured(t *testing.T) {
	h := &Handler{} // CsUser nil
	req := authedGet("/api/dept/users/search?q=ali")
	rec := httptest.NewRecorder()
	h.SearchDeptUsers(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("code=%d, want 503", rec.Code)
	}
}
