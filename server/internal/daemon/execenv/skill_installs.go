package execenv

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"os/exec"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	maxCloudSkillInstallCount = 20
	maxCloudSkillTargetBytes  = 200
	cloudSkillOutputLimit     = 4 * 1024
)

var (
	cloudSkillInstallTimeout = 120 * time.Second
	safeCloudSkillSlug       = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)
)

// CloudSkillInstall is an allowlisted cloud catalog binding snapshot.
type CloudSkillInstall struct {
	ID          string                 `json:"id"`
	Slug        string                 `json:"slug,omitempty"`
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	Install     *CloudSkillInstallSpec `json:"install"`
	Position    int32                  `json:"position"`
}

// CloudSkillInstallSpec is the executable subset of cloud skill install metadata.
type CloudSkillInstallSpec struct {
	Method    string `json:"method,omitempty"`
	Spec      string `json:"spec,omitempty"`
	SkillID   string `json:"skill_id,omitempty"`
	SourceURL string `json:"source_url,omitempty"`
	Verified  bool   `json:"verified,omitempty"`
}

type normalizedCloudSkillInstall struct {
	id     string
	method string
	target string
}

func normalizeCloudSkillInstalls(bindings []CloudSkillInstall) ([]normalizedCloudSkillInstall, error) {
	if len(bindings) > maxCloudSkillInstallCount {
		return nil, fmt.Errorf("cloud skill bindings must contain at most %d items", maxCloudSkillInstallCount)
	}

	normalized := make([]normalizedCloudSkillInstall, 0, len(bindings))
	seen := make(map[string]struct{}, len(bindings))
	for i, binding := range bindings {
		id := strings.TrimSpace(binding.ID)
		if binding.Install == nil {
			return nil, fmt.Errorf("cloud skill %q at position %d has missing install metadata", id, i)
		}
		method := strings.TrimSpace(binding.Install.Method)
		switch method {
		case "", "csc", "csc_skill":
			method = "csc"
		default:
			return nil, fmt.Errorf("cloud skill %q at position %d has unsupported install method %q", id, i, method)
		}

		target := firstNonEmptyTrimmed(binding.Install.Spec, binding.Install.SkillID, binding.ID)
		if target == "" {
			return nil, fmt.Errorf("cloud skill at position %d has an empty install target", i)
		}
		if parsed, err := uuid.Parse(target); err == nil {
			if parsed.String() != target {
				return nil, fmt.Errorf("cloud skill %q at position %d has a non-canonical UUID target %q", id, i, target)
			}
		} else {
			slug := strings.TrimSpace(binding.Slug)
			if target != slug || len(target) > maxCloudSkillTargetBytes || strings.HasPrefix(target, "-") || !safeCloudSkillSlug.MatchString(target) {
				return nil, fmt.Errorf("cloud skill %q at position %d has an invalid slug target %q", id, i, target)
			}
		}
		if _, duplicate := seen[target]; duplicate {
			return nil, fmt.Errorf("cloud skill %q at position %d duplicates install target %q", id, i, target)
		}
		seen[target] = struct{}{}
		normalized = append(normalized, normalizedCloudSkillInstall{
			id:     id,
			method: method,
			target: target,
		})
	}
	return normalized, nil
}

func firstNonEmptyTrimmed(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func setupCloudSkills(ctx context.Context, provider, cscBin, workDir string, bindings []CloudSkillInstall, logger *slog.Logger) error {
	if provider != "csc" || len(bindings) == 0 {
		return nil
	}
	if strings.TrimSpace(cscBin) == "" {
		return fmt.Errorf("csc cloud skill installation requires a csc binary")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if logger == nil {
		logger = slog.Default()
	}

	installs, err := normalizeCloudSkillInstalls(bindings)
	if err != nil {
		return err
	}
	for _, install := range installs {
		if err := installCloudSkill(ctx, cscBin, workDir, install, logger); err != nil {
			return err
		}
	}
	return nil
}

func installCloudSkill(ctx context.Context, cscBin, workDir string, install normalizedCloudSkillInstall, logger *slog.Logger) error {
	installCtx, cancel := context.WithTimeout(ctx, cloudSkillInstallTimeout)
	defer cancel()

	cmd := exec.CommandContext(installCtx, cscBin,
		"skill", "install", install.target, "--scope", "project", "--force", "--json")
	cmd.Dir = workDir
	stdout := &boundedCloudSkillOutput{limit: cloudSkillOutputLimit}
	stderr := &boundedCloudSkillOutput{limit: cloudSkillOutputLimit}
	cmd.Stdout = stdout
	cmd.Stderr = stderr

	err := cmd.Run()
	if err == nil {
		logger.Debug("execenv: installed csc cloud skill",
			"cloud_skill_id", install.id,
			"target", install.target,
			"stdout", stdout.String(),
		)
		return nil
	}
	if contextErr := installCtx.Err(); contextErr != nil {
		err = contextErr
	}
	detail := strings.TrimSpace(stderr.String())
	if detail != "" {
		detail = ": " + detail
	}
	return fmt.Errorf("csc cloud skill install %q (id %q) failed%s: %w", install.target, install.id, detail, err)
}

type boundedCloudSkillOutput struct {
	buf       bytes.Buffer
	limit     int
	truncated bool
}

func (b *boundedCloudSkillOutput) Write(p []byte) (int, error) {
	written := len(p)
	remaining := b.limit - b.buf.Len()
	if remaining > 0 {
		if len(p) > remaining {
			_, _ = b.buf.Write(p[:remaining])
			b.truncated = true
		} else {
			_, _ = b.buf.Write(p)
		}
	} else if len(p) > 0 {
		b.truncated = true
	}
	return written, nil
}

func (b *boundedCloudSkillOutput) String() string {
	if !b.truncated {
		return b.buf.String()
	}
	return b.buf.String() + "\n...[truncated]"
}
