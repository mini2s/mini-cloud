package service

import (
	"reflect"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/splitprompt"
)

func TestSplitPromptExampleMatchesTaskMarkdownParser(t *testing.T) {
	prompt := splitprompt.Build(splitprompt.Input{})
	start := strings.Index(prompt, "## Task: <title>")
	end := strings.Index(prompt[start:], "\nKeys must be unique.")
	if start < 0 || end < 0 {
		t.Fatalf("prompt example not found:\n%s", prompt)
	}
	example := prompt[start : start+end]
	example = strings.NewReplacer(
		"<title>", "Prepare API",
		"<stable-key>", "prepare-api",
		"<active member email>", "alex@example.com",
		"<complete task description>", "Document the new endpoint.",
	).Replace(example)
	plan, details := ParseSplitTaskMarkdown([]byte(example))
	if len(details) != 0 || len(plan.Tasks) != 1 {
		t.Fatalf("shared prompt example does not parse: plan=%+v details=%+v\n%s", plan, details, example)
	}
}

func TestParseSplitTaskMarkdownParsesValidPlan(t *testing.T) {
	content := []byte(`# Migration plan

## task: Prepare API
key: prepare-api
assignee: alex@example.com

Document the new endpoint.

## 子任务：Ship client
key: ship-client
assignee: Alex
depends-on: prepare-api

Update both clients.
`)

	got, details := ParseSplitTaskMarkdown(content)
	if len(details) != 0 {
		t.Fatalf("ParseSplitTaskMarkdown details = %+v", details)
	}
	want := []ParsedSplitTask{
		{Key: "prepare-api", Title: "Prepare API", Assignee: "alex@example.com", Description: "Document the new endpoint.", KeyLine: 4, AssigneeLine: 5, TitleLine: 3, DescriptionLine: 7},
		{Key: "ship-client", Title: "Ship client", Assignee: "Alex", DependsOn: []string{"prepare-api"}, Description: "Update both clients.", KeyLine: 10, AssigneeLine: 11, DependsOnLine: 12, TitleLine: 9, DescriptionLine: 14},
	}
	if !reflect.DeepEqual(got.Tasks, want) {
		t.Fatalf("ParseSplitTaskMarkdown tasks = %#v, want %#v", got.Tasks, want)
	}
}

func TestParseSplitTaskMarkdownRejectsInvalidEncodingAndOversizeInput(t *testing.T) {
	tests := []struct {
		name    string
		content []byte
		message string
	}{
		{name: "invalid utf-8", content: []byte{0xff}, message: "UTF-8"},
		{name: "over one MiB", content: []byte(strings.Repeat("x", maxSplitTaskMarkdownBytes+1)), message: "1 MiB"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, details := ParseSplitTaskMarkdown(tt.content)
			if len(details) != 1 || details[0].Line != 0 || !strings.Contains(details[0].Message, tt.message) {
				t.Fatalf("details = %+v, want one document error containing %q", details, tt.message)
			}
		})
	}
}

func TestParseSplitTaskMarkdownIgnoresHeadingsInsideFencedCode(t *testing.T) {
	content := []byte("## task: Document format\nkey: docs\nassignee: alex@example.com\n\nExplain with an example:\n\n```markdown\n## task: not-a-real-task\nkey: ignored\n```\n")

	got, details := ParseSplitTaskMarkdown(content)
	if len(details) != 0 {
		t.Fatalf("details = %+v", details)
	}
	if len(got.Tasks) != 1 || !strings.Contains(got.Tasks[0].Description, "not-a-real-task") {
		t.Fatalf("tasks = %#v, want one task retaining fenced example", got.Tasks)
	}
}

func TestParseSplitTaskMarkdownReturnsAllStructuralErrors(t *testing.T) {
	content := []byte(`## tasl: Lost task

## task:
keys: Bad_Key
assignee:

## task: Duplicate
key: duplicate
assignee: alex@example.com

Description.

## task: Duplicate again
key: duplicate
assignee: alex@example.com

Description.
`)

	_, details := ParseSplitTaskMarkdown(content)
	want := []struct {
		line  int
		field string
	}{
		{line: 1, field: "heading"},
		{line: 3, field: "title"},
		{line: 3, field: "key"},
		{line: 3, field: "description"},
		{line: 4, field: "keys"},
		{line: 5, field: "assignee"},
		{line: 14, field: "key"},
	}
	if len(details) != len(want) {
		t.Fatalf("details = %+v, want %d errors", details, len(want))
	}
	for index, expected := range want {
		if details[index].Line != expected.line || details[index].Field != expected.field {
			t.Fatalf("details[%d] = %+v, want line=%d field=%s", index, details[index], expected.line, expected.field)
		}
	}
	if !strings.Contains(details[4].Message, "key") {
		t.Fatalf("unknown field message = %q, want key suggestion", details[4].Message)
	}
}

func TestParseSplitTaskMarkdownValidatesDependencyGraph(t *testing.T) {
	content := []byte(`## task: A
key: task-a
assignee: alex@example.com
depends-on: task-b

A.

## task: B
key: task-b
assignee: alex@example.com
depends-on: task-a

B.

## task: C
key: task-c
assignee: alex@example.com
depends-on: task-c, task-dx

C.
`)

	_, details := ParseSplitTaskMarkdown(content)
	if len(details) != 3 {
		t.Fatalf("details = %+v, want cycle, self-dependency, and unknown dependency", details)
	}
	for index, want := range []string{"cycle", "depend on itself", "task-d"} {
		if !strings.Contains(details[index].Message, want) {
			t.Fatalf("details[%d] = %+v, want message containing %q", index, details[index], want)
		}
	}
}

func TestResolveSplitTaskAssigneesUsesEmailAndReportsEveryAmbiguity(t *testing.T) {
	tasks := []ParsedSplitTask{
		{Key: "email", Assignee: "ALEX@example.com", AssigneeLine: 3},
		{Key: "duplicate", Assignee: "Alex", AssigneeLine: 9},
		{Key: "missing", Assignee: "Nobody", AssigneeLine: 15},
		{Key: "agent", Assignee: "Planner", AssigneeLine: 21},
	}
	candidates := []SplitTaskAssigneeCandidate{
		{ID: "member-1", DisplayName: " Alex ", Email: "alex@example.com", Kind: SplitTaskAssigneeHuman},
		{ID: "member-2", DisplayName: "alex", Email: "alex.two@example.com", Kind: SplitTaskAssigneeHuman},
		{ID: "agent-1", DisplayName: "Planner", Kind: SplitTaskAssigneeAgent},
	}

	resolved, details := ResolveSplitTaskAssignees(tasks, candidates)
	if resolved[0].AssigneeID != "member-1" {
		t.Fatalf("email assignee id = %q, want member-1", resolved[0].AssigneeID)
	}
	if len(details) != 3 {
		t.Fatalf("details = %+v, want duplicate, missing, and non-human errors", details)
	}
	for index, want := range []string{"2 human members", "did not match", "human workspace member"} {
		if !strings.Contains(details[index].Message, want) {
			t.Fatalf("details[%d] = %+v, want message containing %q", index, details[index], want)
		}
	}
}
