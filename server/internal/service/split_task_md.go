package service

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"
)

const maxSplitTaskMarkdownBytes = 1 << 20
const maxSplitTasks = 50

var splitTaskHeadingPattern = regexp.MustCompile(`(?i)^##\s*(?:task|任务|子任务)\s*[:：]\s*(.*)$`)
var splitTaskH2Pattern = regexp.MustCompile(`^##(?:\s|$)`)
var splitTaskMetadataPattern = regexp.MustCompile(`^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$`)
var splitTaskKeyPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)

type SplitValidationDetail struct {
	Line    int    `json:"line"`
	Field   string `json:"field"`
	Message string `json:"message"`
}

type ParsedSplitTask struct {
	Key             string
	Title           string
	Assignee        string
	DependsOn       []string
	Description     string
	TitleLine       int
	KeyLine         int
	AssigneeLine    int
	DependsOnLine   int
	DescriptionLine int
}

type ParsedSplitTaskPlan struct {
	Tasks []ParsedSplitTask
}

type SplitTaskAssigneeKind string

const (
	SplitTaskAssigneeHuman SplitTaskAssigneeKind = "human"
	SplitTaskAssigneeAgent SplitTaskAssigneeKind = "agent"
	SplitTaskAssigneeSquad SplitTaskAssigneeKind = "squad"
)

type SplitTaskAssigneeCandidate struct {
	ID          string
	DisplayName string
	Email       string
	Kind        SplitTaskAssigneeKind
}

type ResolvedSplitTask struct {
	ParsedSplitTask
	AssigneeID string
}

func ParseSplitTaskMarkdown(content []byte) (ParsedSplitTaskPlan, []SplitValidationDetail) {
	if len(content) > maxSplitTaskMarkdownBytes {
		return ParsedSplitTaskPlan{}, []SplitValidationDetail{{Line: 0, Field: "document", Message: "task.md must not exceed 1 MiB"}}
	}
	if !utf8.Valid(content) {
		return ParsedSplitTaskPlan{}, []SplitValidationDetail{{Line: 0, Field: "document", Message: "task.md must be valid UTF-8"}}
	}
	lines := strings.Split(strings.ReplaceAll(string(content), "\r\n", "\n"), "\n")
	taskHeadingAt := make([]bool, len(lines))
	invalidH2At := make([]bool, len(lines))
	inFence := false
	fenceMarker := ""
	for index, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "```") || strings.HasPrefix(trimmed, "~~~") {
			marker := trimmed[:3]
			if !inFence {
				inFence = true
				fenceMarker = marker
			} else if marker == fenceMarker {
				inFence = false
				fenceMarker = ""
			}
			continue
		}
		if !inFence {
			taskHeadingAt[index] = splitTaskHeadingPattern.MatchString(line)
			invalidH2At[index] = splitTaskH2Pattern.MatchString(line) && !taskHeadingAt[index]
		}
	}
	plan := ParsedSplitTaskPlan{Tasks: make([]ParsedSplitTask, 0)}
	details := make([]SplitValidationDetail, 0)
	for index, invalid := range invalidH2At {
		if invalid {
			details = append(details, SplitValidationDetail{Line: index + 1, Field: "heading", Message: "unrecognized section heading; expected '## task: <title>'"})
		}
	}
	for index := 0; index < len(lines); {
		if !taskHeadingAt[index] {
			index++
			continue
		}
		match := splitTaskHeadingPattern.FindStringSubmatch(lines[index])

		task := ParsedSplitTask{Title: strings.TrimSpace(match[1]), TitleLine: index + 1}
		index++
		for index < len(lines) {
			line := strings.TrimSpace(lines[index])
			if line == "" {
				index++
				break
			}
			metadata := splitTaskMetadataPattern.FindStringSubmatch(line)
			if metadata == nil {
				break
			}
			key := strings.ToLower(strings.TrimSpace(metadata[1]))
			value := strings.TrimSpace(metadata[2])
			switch key {
			case "key":
				task.Key = value
				task.KeyLine = index + 1
			case "assignee":
				task.Assignee = value
				task.AssigneeLine = index + 1
			case "depends-on":
				task.DependsOnLine = index + 1
				for dependency := range strings.SplitSeq(value, ",") {
					if dependency = strings.TrimSpace(dependency); dependency != "" {
						task.DependsOn = append(task.DependsOn, dependency)
					}
				}
			default:
				details = append(details, SplitValidationDetail{
					Line: index + 1, Field: key,
					Message: fmt.Sprintf("unknown field %q; did you mean %q?", key, closestSplitTaskField(key)),
				})
			}
			index++
		}

		descriptionStart := index
		for index < len(lines) && !taskHeadingAt[index] {
			index++
		}
		descriptionLines := lines[descriptionStart:index]
		for len(descriptionLines) > 0 && strings.TrimSpace(descriptionLines[0]) == "" {
			descriptionLines = descriptionLines[1:]
			descriptionStart++
		}
		for len(descriptionLines) > 0 && strings.TrimSpace(descriptionLines[len(descriptionLines)-1]) == "" {
			descriptionLines = descriptionLines[:len(descriptionLines)-1]
		}
		task.Description = strings.TrimSpace(strings.Join(descriptionLines, "\n"))
		if task.Description != "" {
			task.DescriptionLine = descriptionStart + 1
		}
		plan.Tasks = append(plan.Tasks, task)
	}

	if len(plan.Tasks) > maxSplitTasks {
		details = append(details, SplitValidationDetail{Line: plan.Tasks[maxSplitTasks].TitleLine, Field: "document", Message: fmt.Sprintf("task.md may contain at most %d tasks", maxSplitTasks)})
	}
	if len(plan.Tasks) == 0 {
		details = append(details, SplitValidationDetail{Line: 0, Field: "document", Message: "task.md must contain at least one task section"})
	}
	keyLines := make(map[string]int, len(plan.Tasks))
	for _, task := range plan.Tasks {
		if task.Title == "" {
			details = append(details, SplitValidationDetail{Line: task.TitleLine, Field: "title", Message: "task title is required"})
		}
		if task.Key == "" {
			details = append(details, SplitValidationDetail{Line: task.TitleLine, Field: "key", Message: "key is required; for example: key: prepare-api"})
		} else if !splitTaskKeyPattern.MatchString(task.Key) {
			details = append(details, SplitValidationDetail{Line: task.KeyLine, Field: "key", Message: "key must contain only lowercase letters, digits, and hyphens (maximum 63 characters)"})
		} else if firstLine, exists := keyLines[task.Key]; exists {
			details = append(details, SplitValidationDetail{Line: task.KeyLine, Field: "key", Message: fmt.Sprintf("duplicate key %q; first defined on line %d", task.Key, firstLine)})
		} else {
			keyLines[task.Key] = task.KeyLine
		}
		if task.Assignee == "" {
			line := task.AssigneeLine
			if line == 0 {
				line = task.TitleLine
			}
			details = append(details, SplitValidationDetail{Line: line, Field: "assignee", Message: "assignee is required"})
		}
		if task.Description == "" {
			details = append(details, SplitValidationDetail{Line: task.TitleLine, Field: "description", Message: "task description is required"})
		}
	}
	details = append(details, validateParsedSplitTaskDependencies(plan.Tasks, keyLines)...)
	sort.SliceStable(details, func(i, j int) bool { return details[i].Line < details[j].Line })
	return plan, details
}

func ResolveSplitTaskAssignees(tasks []ParsedSplitTask, candidates []SplitTaskAssigneeCandidate) ([]ResolvedSplitTask, []SplitValidationDetail) {
	resolved := make([]ResolvedSplitTask, len(tasks))
	details := make([]SplitValidationDetail, 0)
	for index, task := range tasks {
		resolved[index].ParsedSplitTask = task
		needle := strings.TrimSpace(task.Assignee)
		matches := make([]SplitTaskAssigneeCandidate, 0)
		for _, candidate := range candidates {
			candidateValue := candidate.DisplayName
			if strings.Contains(needle, "@") {
				candidateValue = candidate.Email
			}
			if strings.EqualFold(strings.TrimSpace(candidateValue), needle) {
				matches = append(matches, candidate)
			}
		}

		humanMatches := make([]SplitTaskAssigneeCandidate, 0, len(matches))
		for _, match := range matches {
			if match.Kind == SplitTaskAssigneeHuman {
				humanMatches = append(humanMatches, match)
			}
		}
		switch {
		case len(humanMatches) == 1:
			resolved[index].AssigneeID = humanMatches[0].ID
		case len(humanMatches) > 1:
			emails := make([]string, 0, len(humanMatches))
			for _, match := range humanMatches {
				emails = append(emails, match.Email)
			}
			sort.Strings(emails)
			details = append(details, SplitValidationDetail{
				Line: task.AssigneeLine, Field: "assignee",
				Message: fmt.Sprintf("assignee %q matched %d human members (%s); use an email address", needle, len(humanMatches), strings.Join(emails, ", ")),
			})
		case len(matches) > 0:
			details = append(details, SplitValidationDetail{Line: task.AssigneeLine, Field: "assignee", Message: "assignee must be a human workspace member"})
		default:
			details = append(details, SplitValidationDetail{Line: task.AssigneeLine, Field: "assignee", Message: fmt.Sprintf("assignee %q did not match a workspace member; use a display name or email address", needle)})
		}
	}
	return resolved, details
}

func validateParsedSplitTaskDependencies(tasks []ParsedSplitTask, keyLines map[string]int) []SplitValidationDetail {
	details := make([]SplitValidationDetail, 0)
	knownDependencies := make(map[string][]string, len(tasks))
	for _, task := range tasks {
		if _, validKey := keyLines[task.Key]; !validKey {
			continue
		}
		for _, dependency := range task.DependsOn {
			switch {
			case dependency == task.Key:
				details = append(details, SplitValidationDetail{Line: task.DependsOnLine, Field: "depends-on", Message: fmt.Sprintf("task %q cannot depend on itself", task.Key)})
			case keyLines[dependency] == 0:
				suggestion := closestSplitTaskKey(dependency, keyLines)
				message := fmt.Sprintf("dependency key %q does not exist", dependency)
				if suggestion != "" {
					message += fmt.Sprintf("; did you mean %q (defined on line %d)?", suggestion, keyLines[suggestion])
				}
				details = append(details, SplitValidationDetail{Line: task.DependsOnLine, Field: "depends-on", Message: message})
			default:
				knownDependencies[task.Key] = append(knownDependencies[task.Key], dependency)
			}
		}
	}
	if cycle := findSplitTaskKeyCycle(knownDependencies); len(cycle) > 0 {
		line := keyLines[cycle[0]]
		for _, task := range tasks {
			if task.Key == cycle[0] && task.DependsOnLine > 0 {
				line = task.DependsOnLine
				break
			}
		}
		details = append(details, SplitValidationDetail{Line: line, Field: "depends-on", Message: fmt.Sprintf("dependency cycle detected: %s", strings.Join(cycle, " -> "))})
	}
	return details
}

func closestSplitTaskKey(value string, keyLines map[string]int) string {
	closest := ""
	closestDistance := len(value) + 1
	for candidate := range keyLines {
		distance := splitTaskEditDistance(value, candidate)
		if distance < closestDistance || (distance == closestDistance && candidate < closest) {
			closest = candidate
			closestDistance = distance
		}
	}
	if closestDistance > max(3, len(value)/3) {
		return ""
	}
	return closest
}

func findSplitTaskKeyCycle(dependencies map[string][]string) []string {
	const (
		unvisited = iota
		visiting
		visited
	)
	states := make(map[string]int, len(dependencies))
	stack := make([]string, 0, len(dependencies))
	var visit func(string) []string
	visit = func(key string) []string {
		states[key] = visiting
		stack = append(stack, key)
		for _, dependency := range dependencies[key] {
			switch states[dependency] {
			case unvisited:
				if cycle := visit(dependency); len(cycle) > 0 {
					return cycle
				}
			case visiting:
				for index, stackKey := range stack {
					if stackKey == dependency {
						return append(append([]string(nil), stack[index:]...), dependency)
					}
				}
			}
		}
		stack = stack[:len(stack)-1]
		states[key] = visited
		return nil
	}
	keys := make([]string, 0, len(dependencies))
	for key := range dependencies {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if states[key] == unvisited {
			if cycle := visit(key); len(cycle) > 0 {
				return cycle
			}
		}
	}
	return nil
}

func closestSplitTaskField(field string) string {
	best := "key"
	bestDistance := splitTaskEditDistance(field, best)
	for _, candidate := range []string{"assignee", "depends-on"} {
		if distance := splitTaskEditDistance(field, candidate); distance < bestDistance {
			best = candidate
			bestDistance = distance
		}
	}
	return best
}

func splitTaskEditDistance(left, right string) int {
	previous := make([]int, len(right)+1)
	for index := range previous {
		previous[index] = index
	}
	for leftIndex, leftRune := range left {
		current := make([]int, len(right)+1)
		current[0] = leftIndex + 1
		for rightIndex, rightRune := range right {
			cost := 1
			if leftRune == rightRune {
				cost = 0
			}
			current[rightIndex+1] = min(current[rightIndex]+1, previous[rightIndex+1]+1, previous[rightIndex]+cost)
		}
		previous = current
	}
	return previous[len(right)]
}
