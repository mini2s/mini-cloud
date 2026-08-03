package handler

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/service"
)

func TestValidateWorkflowRuntimeSelectionOverrideRejectsInvalidPolicy(t *testing.T) {
	handler := &Handler{}
	request := httptest.NewRequest("POST", "/api/workflows/test/runs", strings.NewReader("{}"))
	response := httptest.NewRecorder()
	policy := "nearest_runtime"

	_, _, ok := handler.validateWorkflowRuntimeSelectionOverride(
		response,
		request,
		&policy,
		nil,
		pgtype.UUID{},
	)

	if ok || response.Code != 400 {
		t.Fatalf("got ok=%v status=%d, want ok=false status=400", ok, response.Code)
	}
}

func TestValidateWorkflowRuntimeSelectionOverrideRequiresSpecifiedRuntime(t *testing.T) {
	handler := &Handler{}
	request := httptest.NewRequest("POST", "/api/workflows/test/runs", strings.NewReader("{}"))
	response := httptest.NewRecorder()
	policy := service.RuntimeSelectionPolicySpecifiedRuntimeFirst

	_, _, ok := handler.validateWorkflowRuntimeSelectionOverride(
		response,
		request,
		&policy,
		nil,
		pgtype.UUID{},
	)

	if ok || response.Code != 400 {
		t.Fatalf("got ok=%v status=%d, want ok=false status=400", ok, response.Code)
	}
}
