package execenv

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

const (
	testCloudSkillUUID1 = "11111111-1111-4111-8111-111111111111"
	testCloudSkillUUID2 = "22222222-2222-4222-8222-222222222222"
	testCloudSkillUUID3 = "33333333-3333-4333-8333-333333333333"
)

func writeCloudSkillFakeCSC(t *testing.T) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("shell script fake not supported on windows")
	}
	path := filepath.Join(t.TempDir(), "fake-csc")
	script := `#!/bin/sh
{
  printf 'cwd=%s\n' "$PWD"
  i=0
  for arg in "$@"; do
    printf 'arg%d=%s\n' "$i" "$arg"
    i=$((i + 1))
  done
  printf '%s\n' '---'
} >> "$CLOUD_SKILL_LOG"
if [ "$3" = "$CLOUD_SKILL_FAIL_TARGET" ]; then
  i=0
  while [ "$i" -lt "${CLOUD_SKILL_STDERR_BYTES:-0}" ]; do
    printf x >&2
    i=$((i + 1))
  done
  printf ' install failed for %s' "$3" >&2
  exit 7
fi
if [ "$3" = "$CLOUD_SKILL_SLEEP_TARGET" ]; then
  exec sleep 10
fi
exit 0
`
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake csc: %v", err)
	}
	return path
}

func cloudSkillBinding(id, slug, method, spec, skillID string) CloudSkillInstall {
	return CloudSkillInstall{
		ID:   id,
		Slug: slug,
		Name: slug,
		Install: &CloudSkillInstallSpec{
			Method:  method,
			Spec:    spec,
			SkillID: skillID,
		},
	}
}

func TestNormalizeCloudSkillInstalls(t *testing.T) {
	bindings := []CloudSkillInstall{
		cloudSkillBinding(testCloudSkillUUID1, "first-skill", "csc_skill", "", ""),
		cloudSkillBinding("opaque-second-id", "second-skill", "", "", " "+testCloudSkillUUID2+" "),
		cloudSkillBinding(testCloudSkillUUID3, "third-skill", "csc", " third-skill ", testCloudSkillUUID1),
	}

	got, err := normalizeCloudSkillInstalls(bindings)
	if err != nil {
		t.Fatalf("normalizeCloudSkillInstalls: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("normalized count = %d, want 3", len(got))
	}
	if got[0].method != "csc" || got[0].target != testCloudSkillUUID1 {
		t.Fatalf("first normalized install = %+v", got[0])
	}
	if got[1].method != "csc" || got[1].target != testCloudSkillUUID2 {
		t.Fatalf("second normalized install = %+v", got[1])
	}
	if got[2].method != "csc" || got[2].target != "third-skill" {
		t.Fatalf("third normalized install = %+v", got[2])
	}
}

func TestNormalizeCloudSkillInstalls_Validation(t *testing.T) {
	tests := []struct {
		name     string
		bindings []CloudSkillInstall
	}{
		{
			name:     "missing install metadata",
			bindings: []CloudSkillInstall{{ID: testCloudSkillUUID1, Slug: "first"}},
		},
		{
			name:     "unsupported method",
			bindings: []CloudSkillInstall{cloudSkillBinding(testCloudSkillUUID1, "first", "shell", "", "")},
		},
		{
			name:     "empty target",
			bindings: []CloudSkillInstall{cloudSkillBinding("", "", "csc", "", "")},
		},
		{
			name:     "slug mismatch",
			bindings: []CloudSkillInstall{cloudSkillBinding("opaque-id", "safe-slug", "csc", "opaque-id", "")},
		},
		{
			name:     "unsafe slug path",
			bindings: []CloudSkillInstall{cloudSkillBinding("../escape", "../escape", "csc", "", "")},
		},
		{
			name:     "unsafe slug flag",
			bindings: []CloudSkillInstall{cloudSkillBinding("--help", "--help", "csc", "", "")},
		},
		{
			name:     "noncanonical uuid",
			bindings: []CloudSkillInstall{cloudSkillBinding("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", "csc", "", "")},
		},
		{
			name: "duplicate target",
			bindings: []CloudSkillInstall{
				cloudSkillBinding(testCloudSkillUUID1, "first", "csc", "", ""),
				cloudSkillBinding(testCloudSkillUUID1, "other", "csc", "", ""),
			},
		},
	}

	tooMany := make([]CloudSkillInstall, maxCloudSkillInstallCount+1)
	for i := range tooMany {
		slug := fmt.Sprintf("skill-%d", i)
		tooMany[i] = cloudSkillBinding(slug, slug, "csc", "", "")
	}
	tests = append(tests, struct {
		name     string
		bindings []CloudSkillInstall
	}{name: "too many", bindings: tooMany})

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := normalizeCloudSkillInstalls(tt.bindings); err == nil {
				t.Fatalf("normalizeCloudSkillInstalls(%s) expected error", tt.name)
			}
		})
	}
}

func TestSetupCloudSkills_ExactArgvCwdAndOrder(t *testing.T) {
	bin := writeCloudSkillFakeCSC(t)
	logPath := filepath.Join(t.TempDir(), "invocations.log")
	t.Setenv("CLOUD_SKILL_LOG", logPath)
	workDir := t.TempDir()

	err := setupCloudSkills(context.Background(), "csc", bin, workDir, []CloudSkillInstall{
		cloudSkillBinding(testCloudSkillUUID1, "first-skill", "csc", "", ""),
		cloudSkillBinding(testCloudSkillUUID2, "second-skill", "csc_skill", "second-skill", ""),
	}, testLogger())
	if err != nil {
		t.Fatalf("setupCloudSkills: %v", err)
	}

	data, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("read invocation log: %v", err)
	}
	want := "cwd=" + workDir + "\n" +
		"arg0=skill\narg1=install\narg2=" + testCloudSkillUUID1 + "\narg3=--scope\narg4=project\narg5=--force\narg6=--json\n---\n" +
		"cwd=" + workDir + "\n" +
		"arg0=skill\narg1=install\narg2=second-skill\narg3=--scope\narg4=project\narg5=--force\narg6=--json\n---\n"
	if got := string(data); got != want {
		t.Fatalf("invocations:\n%s\nwant:\n%s", got, want)
	}
}

func TestSetupCloudSkills_EmptyBinaryFailsClosed(t *testing.T) {
	err := setupCloudSkills(context.Background(), "csc", "", t.TempDir(), []CloudSkillInstall{
		cloudSkillBinding(testCloudSkillUUID1, "first-skill", "csc", "", ""),
	}, testLogger())
	if err == nil || !strings.Contains(err.Error(), "binary") {
		t.Fatalf("setupCloudSkills empty binary error = %v", err)
	}
}

func TestSetupCloudSkills_FirstFailureStopsAndTruncatesStderr(t *testing.T) {
	bin := writeCloudSkillFakeCSC(t)
	logPath := filepath.Join(t.TempDir(), "invocations.log")
	t.Setenv("CLOUD_SKILL_LOG", logPath)
	t.Setenv("CLOUD_SKILL_FAIL_TARGET", testCloudSkillUUID1)
	t.Setenv("CLOUD_SKILL_STDERR_BYTES", "5000")

	err := setupCloudSkills(context.Background(), "csc", bin, t.TempDir(), []CloudSkillInstall{
		cloudSkillBinding(testCloudSkillUUID1, "first-skill", "csc", "", ""),
		cloudSkillBinding(testCloudSkillUUID2, "second-skill", "csc", "", ""),
	}, testLogger())
	if err == nil {
		t.Fatal("setupCloudSkills expected failure")
	}
	if !strings.Contains(err.Error(), testCloudSkillUUID1) || !strings.Contains(err.Error(), "truncated") {
		t.Fatalf("failure error missing target or truncation marker: %v", err)
	}
	if len(err.Error()) > cloudSkillOutputLimit+1000 {
		t.Fatalf("failure error too large: %d bytes", len(err.Error()))
	}
	data, readErr := os.ReadFile(logPath)
	if readErr != nil {
		t.Fatalf("read invocation log: %v", readErr)
	}
	if strings.Contains(string(data), testCloudSkillUUID2) {
		t.Fatalf("second install ran after failure:\n%s", data)
	}
}

func TestSetupCloudSkills_ContextCancellationAndTimeout(t *testing.T) {
	bin := writeCloudSkillFakeCSC(t)
	logPath := filepath.Join(t.TempDir(), "invocations.log")
	t.Setenv("CLOUD_SKILL_LOG", logPath)
	t.Setenv("CLOUD_SKILL_SLEEP_TARGET", testCloudSkillUUID1)
	binding := cloudSkillBinding(testCloudSkillUUID1, "first-skill", "csc", "", "")

	t.Run("cancelled", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		err := setupCloudSkills(ctx, "csc", bin, t.TempDir(), []CloudSkillInstall{binding}, testLogger())
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancel error = %v, want context.Canceled", err)
		}
	})

	t.Run("timed out", func(t *testing.T) {
		oldTimeout := cloudSkillInstallTimeout
		cloudSkillInstallTimeout = 20 * time.Millisecond
		t.Cleanup(func() { cloudSkillInstallTimeout = oldTimeout })
		err := setupCloudSkills(context.Background(), "csc", bin, t.TempDir(), []CloudSkillInstall{binding}, testLogger())
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("timeout error = %v, want context.DeadlineExceeded", err)
		}
	})
}

func TestPrepare_CloudSkillsFreshOnlyAndReuseNoop(t *testing.T) {
	bin := writeCloudSkillFakeCSC(t)
	logPath := filepath.Join(t.TempDir(), "invocations.log")
	t.Setenv("CLOUD_SKILL_LOG", logPath)
	root := t.TempDir()

	env, err := Prepare(PrepareParams{
		WorkspacesRoot: root,
		WorkspaceID:    "workspace-1",
		TaskID:         "11111111-1111-4111-8111-111111111111",
		Provider:       "csc",
		CSCBin:         bin,
		Task: TaskContextForEnv{CloudSkills: []CloudSkillInstall{
			cloudSkillBinding(testCloudSkillUUID1, "first-skill", "csc", "", ""),
		}},
	}, testLogger())
	if err != nil {
		t.Fatalf("Prepare: %v", err)
	}
	if data, err := os.ReadFile(logPath); err != nil || !strings.Contains(string(data), testCloudSkillUUID1) {
		t.Fatalf("fresh Prepare did not install cloud skill: data=%q err=%v", data, err)
	}

	marker := filepath.Join(env.WorkDir, ".costrict", "skills", "existing", "SKILL.md")
	if err := os.MkdirAll(filepath.Dir(marker), 0o755); err != nil {
		t.Fatalf("create marker dir: %v", err)
	}
	if err := os.WriteFile(marker, []byte("keep me"), 0o644); err != nil {
		t.Fatalf("write marker: %v", err)
	}
	if err := os.Remove(logPath); err != nil {
		t.Fatalf("clear invocation log: %v", err)
	}

	changed := []CloudSkillInstall{
		cloudSkillBinding(testCloudSkillUUID2, "second-skill", "csc", "", ""),
		cloudSkillBinding(testCloudSkillUUID1, "first-skill", "csc", "first-skill", ""),
	}
	reused := Reuse(ReuseParams{
		WorkDir:  env.WorkDir,
		Provider: "csc",
		Task:     TaskContextForEnv{CloudSkills: changed},
	}, testLogger())
	if reused == nil {
		t.Fatal("Reuse returned nil")
	}
	if _, err := os.Stat(logPath); !os.IsNotExist(err) {
		t.Fatalf("Reuse invoked csc: stat error = %v", err)
	}
	if data, err := os.ReadFile(marker); err != nil || string(data) != "keep me" {
		t.Fatalf("Reuse changed existing cloud skill: data=%q err=%v", data, err)
	}
}

func TestPrepare_CloudSkillsIgnoredForNonCSC(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "invocations.log")
	t.Setenv("CLOUD_SKILL_LOG", logPath)
	_, err := Prepare(PrepareParams{
		WorkspacesRoot: t.TempDir(),
		WorkspaceID:    "workspace-1",
		TaskID:         "11111111-1111-4111-8111-111111111111",
		Provider:       "claude",
		CSCBin:         filepath.Join(t.TempDir(), "must-not-run"),
		Task: TaskContextForEnv{CloudSkills: []CloudSkillInstall{
			cloudSkillBinding("invalid", "different", "shell", "--dangerous", ""),
		}},
	}, testLogger())
	if err != nil {
		t.Fatalf("non-csc Prepare: %v", err)
	}
	if _, err := os.Stat(logPath); !os.IsNotExist(err) {
		t.Fatalf("non-csc Prepare invoked process: stat error = %v", err)
	}
}

func TestPrepare_CloudSkillsRejectsShellFragments(t *testing.T) {
	bin := writeCloudSkillFakeCSC(t)
	logPath := filepath.Join(t.TempDir(), "invocations.log")
	sentinel := filepath.Join(t.TempDir(), "sentinel")
	t.Setenv("CLOUD_SKILL_LOG", logPath)
	target := "safe;touch-" + filepath.Base(sentinel)
	_, err := Prepare(PrepareParams{
		WorkspacesRoot: t.TempDir(),
		WorkspaceID:    "workspace-1",
		TaskID:         "11111111-1111-4111-8111-111111111111",
		Provider:       "csc",
		CSCBin:         bin,
		Task: TaskContextForEnv{CloudSkills: []CloudSkillInstall{
			cloudSkillBinding(target, target, "csc", "", ""),
		}},
	}, testLogger())
	if err == nil {
		t.Fatal("Prepare accepted shell fragment")
	}
	if _, err := os.Stat(logPath); !os.IsNotExist(err) {
		t.Fatalf("rejected shell fragment invoked csc: stat error = %v", err)
	}
	if _, err := os.Stat(sentinel); !os.IsNotExist(err) {
		t.Fatalf("shell fragment created sentinel: stat error = %v", err)
	}
}
