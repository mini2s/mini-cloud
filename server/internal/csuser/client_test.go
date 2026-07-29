package csuser

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSearchUsersParsesEnvelopeAndSendsToken(t *testing.T) {
	var gotAuth, gotKw, gotLimit string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("X-Internal-Token")
		gotKw = r.URL.Query().Get("keyword")
		gotLimit = r.URL.Query().Get("limit")
		_, _ = w.Write([]byte(`{"users":[{"subject_id":"usr_1","username":"29219","display_name":"Alice","email":"a@x.com","casdoor_universal_id":"uni-1"}]}`))
	}))
	defer srv.Close()
	c := NewClient(Config{BaseURL: srv.URL, Token: "secret"})
	users, err := c.SearchUsers(context.Background(), "ali", 3)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if gotAuth != "secret" || gotKw != "ali" || gotLimit != "3" {
		t.Fatalf("auth=%q kw=%q limit=%q", gotAuth, gotKw, gotLimit)
	}
	if len(users) != 1 || users[0].SubjectID != "usr_1" || users[0].Name() != "Alice" || users[0].UniversalID() != "uni-1" {
		t.Fatalf("users=%+v", users)
	}
}

func TestGetUserParsesBareObject(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/internal/users/usr_9" {
			t.Fatalf("path=%s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"subject_id":"usr_9","username":"bob","display_name":"Bob"}`))
	}))
	defer srv.Close()
	c := NewClient(Config{BaseURL: srv.URL, Token: "t"})
	u, err := c.GetUser(context.Background(), "usr_9")
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if u.SubjectID != "usr_9" || u.Name() != "Bob" || u.UniversalID() != "" {
		t.Fatalf("user=%+v", u)
	}
}

func TestNotConfigured(t *testing.T) {
	c := NewClient(Config{})
	if _, err := c.SearchUsers(context.Background(), "x", 3); err != ErrNotConfigured {
		t.Fatalf("err=%v", err)
	}
	if _, err := c.GetUser(context.Background(), "usr_1"); err != ErrNotConfigured {
		t.Fatalf("err=%v", err)
	}
}
