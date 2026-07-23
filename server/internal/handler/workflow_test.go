package handler

import "testing"

func TestIsNonExecutableNodeDoesNotSkipSplitValidation(t *testing.T) {
	if isNonExecutableNode([]byte(`{"type":"split"}`)) {
		t.Fatal("split nodes must participate in activation worker/critic validation")
	}
	if !isNonExecutableNode([]byte(`{"type":"gateway","gateway_kind":"fork"}`)) {
		t.Fatal("gateway nodes should still skip worker/critic validation")
	}
	if !isNonExecutableNode([]byte(`{"type":"annotation"}`)) {
		t.Fatal("annotation nodes should still skip worker/critic validation")
	}
	if !isNonExecutableNode([]byte(`{"type":"start"}`)) {
		t.Fatal("start nodes should skip worker/critic validation")
	}
	if !isNonExecutableNode([]byte(`{"type":"end"}`)) {
		t.Fatal("end nodes should skip worker/critic validation")
	}
}
