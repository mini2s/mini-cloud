package workflowmeta

import (
	"encoding/json"
	"errors"
)

type NodeKind string

const (
	KindTask       NodeKind = "task"
	KindAnnotation NodeKind = "annotation"
	KindGateway    NodeKind = "gateway"
	KindSplit      NodeKind = "split"
	KindStart      NodeKind = "start"
	KindEnd        NodeKind = "end"
)

var ErrInvalidBoundaryEdge = errors.New("invalid workflow boundary edge")

func KindOf(raw json.RawMessage) NodeKind {
	var value struct {
		Type string `json:"type"`
	}
	if len(raw) == 0 || json.Unmarshal(raw, &value) != nil {
		return KindTask
	}

	switch NodeKind(value.Type) {
	case KindAnnotation, KindGateway, KindSplit, KindStart, KindEnd:
		return NodeKind(value.Type)
	default:
		return KindTask
	}
}

func IsBoundary(raw json.RawMessage) bool {
	kind := KindOf(raw)
	return kind == KindStart || kind == KindEnd
}

func ValidateBoundaryEdge(source, target json.RawMessage) error {
	sourceKind := KindOf(source)
	targetKind := KindOf(target)
	if targetKind == KindStart ||
		sourceKind == KindEnd ||
		(sourceKind == KindStart && targetKind == KindEnd) ||
		(IsBoundary(source) && targetKind == KindAnnotation) ||
		(sourceKind == KindAnnotation && IsBoundary(target)) {
		return ErrInvalidBoundaryEdge
	}
	return nil
}
