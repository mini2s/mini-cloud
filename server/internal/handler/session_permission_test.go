package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func setTestRuntimeVisibility(t *testing.T, runtimeID, visibility string) {
	t.Helper()
	if _, err := testPool.Exec(context.Background(),
		`UPDATE multica_agent_runtime SET visibility = $2 WHERE id = $1`,
		runtimeID, visibility,
	); err != nil {
		t.Fatalf("set runtime visibility: %v", err)
	}
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(),
			`UPDATE multica_agent_runtime SET visibility = 'private' WHERE id = $1`,
			runtimeID,
		)
	})
}

func decodeSessionPermission(t *testing.T, w *httptest.ResponseRecorder) SessionPermissionResponse {
	t.Helper()
	var resp SessionPermissionResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return resp
}

func TestGetSessionPermission_PublicRuntimePlainMemberCanObserve(t *testing.T) {
	_, _, sessionID := seedHandbackNodeRun(t)
	setTestRuntimeVisibility(t, testRuntimeID, "public")

	plainMember := helperTestUser(t, "Public Session Member", "public-session-member@multica.ai")
	helperAddUserToWorkspace(t, plainMember, "member")

	req := withURLParam(
		newRequestAs(plainMember, "GET", "/api/sessions/"+sessionID+"/permission", nil),
		"sessionId", sessionID,
	)
	w := httptest.NewRecorder()
	testHandler.GetSessionPermission(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	resp := decodeSessionPermission(t, w)
	if !resp.CanObserve {
		t.Fatalf("public runtime: plain member should observe")
	}
	if resp.CanControl {
		t.Fatalf("plain member should not control")
	}
}

func TestGetSessionPermission_PrivateRuntimePlainMemberCannotObserve(t *testing.T) {
	_, _, sessionID := seedHandbackNodeRun(t)

	plainMember := helperTestUser(t, "Private Session Member", "private-session-member@multica.ai")
	helperAddUserToWorkspace(t, plainMember, "member")

	req := withURLParam(
		newRequestAs(plainMember, "GET", "/api/sessions/"+sessionID+"/permission", nil),
		"sessionId", sessionID,
	)
	w := httptest.NewRecorder()
	testHandler.GetSessionPermission(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestPrivateRuntimeOperatorCannotObserveButKeepsRuntimeControl(t *testing.T) {
	_, _, sessionID := seedHandbackNodeRun(t)

	operatorUser := helperTestUser(t, "Session Operator", "session-operator@multica.ai")
	helperAddUserToWorkspace(t, operatorUser, "member")
	helperGrantRuntimePermission(t, testRuntimeID, operatorUser, "operator")

	req := withURLParam(
		newRequestAs(operatorUser, "GET", "/api/sessions/"+sessionID+"/permission", nil),
		"sessionId", sessionID,
	)
	w := httptest.NewRecorder()
	testHandler.GetSessionPermission(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("session permission: expected 403, got %d: %s", w.Code, w.Body.String())
	}

	runtimeReq := withURLParam(
		newRequestAs(operatorUser, "GET", "/api/runtimes/"+testRuntimeID+"/permission", nil),
		"runtimeId", testRuntimeID,
	)
	runtimeW := httptest.NewRecorder()
	testHandler.GetRuntimePermissionForMe(runtimeW, runtimeReq)
	if runtimeW.Code != http.StatusOK {
		t.Fatalf("runtime permission: expected 200, got %d: %s", runtimeW.Code, runtimeW.Body.String())
	}
	var runtimeResp MyRuntimePermissionResponse
	if err := json.Unmarshal(runtimeW.Body.Bytes(), &runtimeResp); err != nil {
		t.Fatalf("decode runtime permission: %v", err)
	}
	if runtimeResp.Role != "operator" || !runtimeResp.CanControl {
		t.Fatalf("operator runtime permission: role=%q can_control=%v", runtimeResp.Role, runtimeResp.CanControl)
	}
}

func TestGetSessionPermission_PrivateRuntimeAdminCanObserve(t *testing.T) {
	_, _, sessionID := seedHandbackNodeRun(t)

	adminUser := helperTestUser(t, "Session Admin", "session-admin@multica.ai")
	helperAddUserToWorkspace(t, adminUser, "admin")

	req := withURLParam(
		newRequestAs(adminUser, "GET", "/api/sessions/"+sessionID+"/permission", nil),
		"sessionId", sessionID,
	)
	w := httptest.NewRecorder()
	testHandler.GetSessionPermission(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	resp := decodeSessionPermission(t, w)
	if !resp.CanObserve {
		t.Fatalf("workspace admin should observe private runtime")
	}
	if !resp.CanControl {
		t.Fatalf("workspace admin should control")
	}
}

func TestGetSessionPermission_UnknownCSCSessionReturns404(t *testing.T) {
	req := withURLParam(
		newRequest("GET", "/api/sessions/not-a-uuid-and-not-csc/permission", nil),
		"sessionId", "not-a-uuid-and-not-csc",
	)
	w := httptest.NewRecorder()
	testHandler.GetSessionPermission(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("non-UUID unknown session: expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestCanObserveSession_PublicAndPrivate(t *testing.T) {
	ownerUserID := "11111111-1111-1111-1111-111111111111"
	otherUserID := "22222222-2222-2222-2222-222222222222"

	privateRT := db.MulticaAgentRuntime{
		OwnerID:    util.MustParseUUID(ownerUserID),
		Visibility: "private",
	}
	publicRT := db.MulticaAgentRuntime{
		OwnerID:    util.MustParseUUID(ownerUserID),
		Visibility: "public",
	}

	plainMember := db.MulticaMember{UserID: util.MustParseUUID(otherUserID), Role: "member"}
	workspaceOwner := db.MulticaMember{UserID: util.MustParseUUID(otherUserID), Role: "owner"}
	runtimeOwner := db.MulticaMember{UserID: util.MustParseUUID(ownerUserID), Role: "member"}

	if !canObserveSession(plainMember, publicRT) {
		t.Fatal("public runtime: any member should observe")
	}
	if canObserveSession(plainMember, privateRT) {
		t.Fatal("private runtime: plain member must not observe")
	}
	if !canObserveSession(workspaceOwner, privateRT) {
		t.Fatal("private runtime: workspace owner should observe")
	}
	if !canObserveSession(runtimeOwner, privateRT) {
		t.Fatal("private runtime: runtime owner should observe")
	}
}
