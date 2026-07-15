package deptsync

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestClientCachesDepartmentTree(t *testing.T) {
	var calls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/department/tree" {
			http.NotFound(w, r)
			return
		}
		atomic.AddInt32(&calls, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"success": true,
			"data": [
				{
					"dept_id": "D000",
					"dept_name": "Root",
					"children": [
						{"dept_id": "D100", "dept_name": "Platform"}
					]
				}
			]
		}`))
	}))
	defer server.Close()

	client := NewClient(Config{BaseURL: server.URL, QueryKey: "secret", CacheTTL: time.Minute})
	first, err := client.GetDepartment(t.Context(), "D100")
	if err != nil {
		t.Fatalf("GetDepartment first call: %v", err)
	}
	second, err := client.GetDepartment(t.Context(), "D100")
	if err != nil {
		t.Fatalf("GetDepartment second call: %v", err)
	}
	if first == nil || second == nil || first.DeptName != "Platform" || second.DeptName != "Platform" {
		t.Fatalf("unexpected departments: first=%+v second=%+v", first, second)
	}
	if calls != 1 {
		t.Fatalf("expected one upstream tree request, got %d", calls)
	}
}

func TestClientCacheExpires(t *testing.T) {
	var calls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/users/search" {
			http.NotFound(w, r)
			return
		}
		call := atomic.AddInt32(&calls, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"success": true,
			"data": [
				{
					"user_id": "E001",
					"username": "Alice ` + string(rune('0'+call)) + `",
					"universal_id": "u-1",
					"status": 1
				}
			]
		}`))
	}))
	defer server.Close()

	client := NewClient(Config{BaseURL: server.URL, QueryKey: "secret", CacheTTL: 10 * time.Millisecond})
	first, err := client.SearchUsers(t.Context(), "E001", 20)
	if err != nil {
		t.Fatalf("SearchUsers first call: %v", err)
	}
	second, err := client.SearchUsers(t.Context(), "E001", 20)
	if err != nil {
		t.Fatalf("SearchUsers cached call: %v", err)
	}
	if calls != 1 {
		t.Fatalf("expected cached second call, got %d upstream calls", calls)
	}
	if len(first) != 1 || len(second) != 1 || first[0].Username != second[0].Username {
		t.Fatalf("expected cached response, first=%+v second=%+v", first, second)
	}

	time.Sleep(20 * time.Millisecond)
	third, err := client.SearchUsers(t.Context(), "E001", 20)
	if err != nil {
		t.Fatalf("SearchUsers after expiry: %v", err)
	}
	if calls != 2 {
		t.Fatalf("expected cache expiry to trigger second upstream call, got %d", calls)
	}
	if len(third) != 1 || third[0].Username == first[0].Username {
		t.Fatalf("expected refreshed response after expiry, first=%+v third=%+v", first, third)
	}
}
