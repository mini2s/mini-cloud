package workflowmeta

import (
	"encoding/json"
	"errors"
	"testing"
)

func TestBoundaryKindsAndEdges(t *testing.T) {
	start := json.RawMessage(`{"type":"start"}`)
	end := json.RawMessage(`{"type":"end"}`)
	task := json.RawMessage(`{"shape":"rectangle"}`)
	annotation := json.RawMessage(`{"type":"annotation"}`)

	if KindOf(start) != KindStart || KindOf(end) != KindEnd || KindOf(task) != KindTask {
		t.Fatal("unexpected node kind classification")
	}
	if ValidateBoundaryEdge(start, task) != nil || ValidateBoundaryEdge(task, end) != nil {
		t.Fatal("valid boundary edge rejected")
	}

	for _, pair := range [][2]json.RawMessage{
		{task, start},
		{end, task},
		{start, end},
		{start, annotation},
		{annotation, end},
	} {
		if !errors.Is(ValidateBoundaryEdge(pair[0], pair[1]), ErrInvalidBoundaryEdge) {
			t.Fatalf("invalid edge accepted: %s -> %s", pair[0], pair[1])
		}
	}
}
