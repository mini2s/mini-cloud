package handler

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestNormalizeWorkflowRoleInput(t *testing.T) {
	name, description, err := normalizeWorkflowRoleInput("  Developer  ", "  Builds product changes.  ")
	if err != nil {
		t.Fatal(err)
	}
	if name != "Developer" || description != "Builds product changes." {
		t.Fatalf("unexpected normalized values: %q, %q", name, description)
	}
}

func TestNormalizeWorkflowRoleInputValidation(t *testing.T) {
	tests := []struct {
		name, roleName, description, wantError string
	}{
		{"missing name", "  ", "description", "name is required"},
		{"long name", strings.Repeat("角", 101), "description", "name must be at most 100 characters"},
		{"missing description", "role", "  ", "description is required"},
		{"long description", "role", strings.Repeat("责", 2001), "description must be at most 2000 characters"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, _, err := normalizeWorkflowRoleInput(tt.roleName, tt.description)
			if err == nil || err.Error() != tt.wantError {
				t.Fatalf("expected %q, got %v", tt.wantError, err)
			}
		})
	}

	name, description, err := normalizeWorkflowRoleInput(strings.Repeat("角", 100), strings.Repeat("责", 2000))
	if err != nil || utf8.RuneCountInString(name) != 100 || utf8.RuneCountInString(description) != 2000 {
		t.Fatalf("valid rune limits were rejected: %v", err)
	}
}
