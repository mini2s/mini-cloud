package gitlab

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParseMergeRequestURL(t *testing.T) {
	cases := []struct {
		name     string
		in       string
		wantBase string
		wantPath string
		wantIID  int
		wantErr  bool
	}{
		{name: "canonical with -/-", in: "http://gitlab.local/root/repo/-/merge_requests/7",
			wantBase: "http://gitlab.local", wantPath: "root/repo", wantIID: 7},
		{name: "nested group", in: "http://gitlab.local/g/sub/proj/-/merge_requests/1",
			wantBase: "http://gitlab.local", wantPath: "g/sub/proj", wantIID: 1},
		{name: "legacy without -/-", in: "http://host/root/repo/merge_requests/3",
			wantBase: "http://host", wantPath: "root/repo", wantIID: 3},
		{name: "https + trailing slash", in: "https://gitlab.com/team/proj/-/merge_requests/42/",
			wantBase: "https://gitlab.com", wantPath: "team/proj", wantIID: 42},
		{name: "ignores /notes suffix", in: "http://host/root/repo/-/merge_requests/7/notes",
			wantBase: "http://host", wantPath: "root/repo", wantIID: 7},
		{name: "not a mr url", in: "http://host/root/repo", wantErr: true},
		{name: "relative url", in: "/root/repo/-/merge_requests/7", wantErr: true},
		{name: "empty project path", in: "http://host/-/merge_requests/7", wantErr: true},
		{name: "non-numeric iid", in: "http://host/root/repo/-/merge_requests/abc", wantErr: true},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			ref, err := ParseMergeRequestURL(tc.in)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error, got %+v", ref)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if ref.BaseURL != tc.wantBase {
				t.Errorf("BaseURL: want %q, got %q", tc.wantBase, ref.BaseURL)
			}
			if ref.ProjectPath != tc.wantPath {
				t.Errorf("ProjectPath: want %q, got %q", tc.wantPath, ref.ProjectPath)
			}
			if ref.IID != tc.wantIID {
				t.Errorf("IID: want %d, got %d", tc.wantIID, ref.IID)
			}
		})
	}
}

func TestClient_MergeMR(t *testing.T) {
	var gotMethod, gotRequestURI, gotToken string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotRequestURI = r.RequestURI
		gotToken = r.Header.Get("PRIVATE-TOKEN")
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	ref := MergeRequestRef{BaseURL: ts.URL, ProjectPath: "root/repo", IID: 7}
	if err := (&Client{}).MergeMR(context.Background(), ref, "tok-123"); err != nil {
		t.Fatalf("MergeMR: %v", err)
	}
	if gotMethod != http.MethodPut {
		t.Errorf("method: want PUT, got %q", gotMethod)
	}
	// The project path's "/" must be URL-encoded (%2F) so GitLab routes it as
	// a single :id segment — r.URL.Path decodes it, so assert on RequestURI.
	if want := "/api/v4/projects/root%2Frepo/merge_requests/7/merge"; gotRequestURI != want {
		t.Errorf("request URI: want %q, got %q", want, gotRequestURI)
	}
	if gotToken != "tok-123" {
		t.Errorf("PRIVATE-TOKEN: want tok-123, got %q", gotToken)
	}
}

func TestClient_MergeMR_ConflictReturnsSentinel(t *testing.T) {
	for _, status := range []int{http.StatusMethodNotAllowed, http.StatusNotAcceptable, http.StatusConflict} {
		ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(status)
			w.Write([]byte(`{"message":"cannot merge"}`))
		}))
		err := (&Client{}).MergeMR(context.Background(),
			MergeRequestRef{BaseURL: ts.URL, ProjectPath: "root/repo", IID: 1}, "tok")
		ts.Close()
		if !errors.Is(err, ErrMergeConflict) {
			t.Errorf("status %d: expected ErrMergeConflict, got %v", status, err)
		}
	}
}

func TestClient_MergeMR_TransientError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer ts.Close()
	err := (&Client{}).MergeMR(context.Background(),
		MergeRequestRef{BaseURL: ts.URL, ProjectPath: "root/repo", IID: 1}, "tok")
	if err == nil {
		t.Fatal("expected error")
	}
	if errors.Is(err, ErrMergeConflict) {
		t.Fatal("500 should not be ErrMergeConflict (it is transient)")
	}
	if !strings.Contains(err.Error(), "status 500") {
		t.Errorf("error should mention status 500: %v", err)
	}
}

func TestClient_MergeMR_IncompleteRef(t *testing.T) {
	err := (&Client{}).MergeMR(context.Background(),
		MergeRequestRef{BaseURL: "", ProjectPath: "root/repo", IID: 1}, "tok")
	if err == nil {
		t.Fatal("expected error for empty base URL")
	}
	err = (&Client{}).MergeMR(context.Background(),
		MergeRequestRef{BaseURL: "http://host", ProjectPath: "root/repo", IID: 1}, "")
	if err == nil {
		t.Fatal("expected error for empty token")
	}
}
