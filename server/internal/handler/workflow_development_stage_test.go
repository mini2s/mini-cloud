package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestListDevelopmentStages_IncludesBuiltin(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	w := httptest.NewRecorder()
	req := newRequest("GET", "/api/development-stages", nil)
	testHandler.ListDevelopmentStages(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		DevelopmentStages []struct {
			Name  string `json:"name"`
			Scope string `json:"scope"`
		} `json:"development_stages"`
	}
	json.Unmarshal(w.Body.Bytes(), &resp)

	// Should include built-in stages
	if len(resp.DevelopmentStages) < 5 {
		t.Fatalf("expected at least 5 built-in stages, got %d", len(resp.DevelopmentStages))
	}

	builtinCount := 0
	for _, s := range resp.DevelopmentStages {
		if s.Scope == "builtin" {
			builtinCount++
		}
	}
	if builtinCount < 5 {
		t.Fatalf("expected 5 builtin stages, got %d", builtinCount)
	}
}

func TestCreateDevelopmentStage_Validation(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	// Missing name
	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/development-stages", map[string]any{
		"description": "test",
	})
	testHandler.CreateDevelopmentStage(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing name, got %d", w.Code)
	}
}

func TestUpdateBuiltinDevelopmentStage_Rejected(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()

	// Get a builtin stage ID
	stages, err := testHandler.Queries.ListBuiltinDevelopmentStages(ctx)
	if err != nil || len(stages) == 0 {
		t.Skip("no builtin stages")
	}

	w := httptest.NewRecorder()
	req := newRequest("PUT", "/api/development-stages/"+uuidToString(stages[0].ID), map[string]any{
		"name": "Renamed",
	})
	req = withURLParams(req, "id", uuidToString(stages[0].ID))
	testHandler.UpdateDevelopmentStage(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for updating builtin, got %d", w.Code)
	}
}
