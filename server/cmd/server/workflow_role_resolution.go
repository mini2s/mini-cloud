package main

import (
	"context"
	"crypto/sha256"
	"fmt"
	"log/slog"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/multica-ai/multica/server/internal/deptsync"
	"github.com/multica-ai/multica/server/internal/service"
)

const workflowRoleResolutionPromptVersion = "v1"

type workflowRoleResolutionRuntime struct {
	Enabled           bool
	Allowlist         map[string]struct{}
	Model             string
	MaxActiveJobs     int64
	WorkerConcurrency int
	PollInterval      time.Duration
	LeaseDuration     time.Duration
	Resolver          service.WorkflowRoleResolver
	Organization      service.WorkflowRoleOrganizationProvider
	MaxCandidates     int
	MaxSlots          int
	MaxInputChars     int
}

func workflowRoleResolutionRuntimeFromEnv(client *deptsync.Client) workflowRoleResolutionRuntime {
	organization := &deptWorkflowRoleOrganizationProvider{client: client}
	runtime := workflowRoleResolutionRuntime{
		Enabled:           strings.EqualFold(strings.TrimSpace(os.Getenv("WORKFLOW_ROLE_RESOLUTION_ENABLED")), "true"),
		Allowlist:         parseWorkflowRoleWorkspaceAllowlist(os.Getenv("WORKFLOW_ROLE_RESOLUTION_WORKSPACE_ALLOWLIST")),
		Model:             strings.TrimSpace(os.Getenv("WORKFLOW_ROLE_LLM_MODEL")),
		MaxActiveJobs:     int64(envPositiveInt("WORKFLOW_ROLE_MAX_ACTIVE_JOBS_PER_WORKSPACE", 5)),
		WorkerConcurrency: envPositiveInt("WORKFLOW_ROLE_WORKER_CONCURRENCY", 2),
		PollInterval:      envDuration("WORKFLOW_ROLE_WORKER_POLL_INTERVAL", time.Second),
		LeaseDuration:     envDuration("WORKFLOW_ROLE_WORKER_LEASE_DURATION", 15*time.Second),
		Organization:      organization,
		MaxCandidates:     envPositiveInt("WORKFLOW_ROLE_LLM_MAX_CANDIDATES", 200),
		MaxSlots:          envPositiveInt("WORKFLOW_ROLE_LLM_MAX_SLOTS", 50),
		MaxInputChars:     envPositiveInt("WORKFLOW_ROLE_LLM_MAX_INPUT_CHARS", 100000),
	}
	timeoutSeconds := envPositiveInt("WORKFLOW_ROLE_LLM_TIMEOUT_SECONDS", 30)
	temperature := envFloat("WORKFLOW_ROLE_LLM_TEMPERATURE", 0)
	provider := strings.ToLower(strings.TrimSpace(os.Getenv("WORKFLOW_ROLE_LLM_PROVIDER")))
	if provider == "" {
		provider = "openai"
	}
	if provider != "openai" {
		slog.Warn("unsupported workflow role LLM provider; runs will use manual assignment", "provider", provider)
	} else {
		resolver, err := service.NewOpenAIWorkflowRoleResolver(service.OpenAIWorkflowRoleResolverConfig{
			BaseURL:         strings.TrimSpace(os.Getenv("WORKFLOW_ROLE_LLM_BASE_URL")),
			APIKey:          os.Getenv("WORKFLOW_ROLE_LLM_API_KEY"),
			Model:           runtime.Model,
			MaxOutputTokens: envPositiveInt("WORKFLOW_ROLE_LLM_MAX_OUTPUT_TOKENS", 4096),
			Temperature:     temperature,
			Timeout:         time.Duration(timeoutSeconds) * time.Second,
		}, nil)
		if err != nil {
			slog.Info("workflow role automatic resolution unavailable; runs will use manual assignment", "error", err)
		} else {
			runtime.Resolver = resolver
		}
	}
	if runtime.Enabled && (!organization.Configured() || runtime.Resolver == nil) {
		slog.Warn("workflow role automatic resolution enabled but dependencies are not configured; runs will use manual assignment")
	}
	return runtime
}

func (r workflowRoleResolutionRuntime) AutoResolutionConfigured() bool {
	return r.Enabled && r.Resolver != nil && r.Organization != nil && r.Organization.Configured()
}

func parseWorkflowRoleWorkspaceAllowlist(raw string) map[string]struct{} {
	out := map[string]struct{}{}
	for _, item := range strings.Split(raw, ",") {
		item = strings.ToLower(strings.TrimSpace(item))
		if item != "" {
			out[item] = struct{}{}
		}
	}
	return out
}

func envFloat(name string, def float64) float64 {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return def
	}
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		slog.Warn("invalid env var, using default", "name", name, "value", raw, "default", def, "error", err)
		return def
	}
	return value
}

type deptWorkflowRoleOrganizationProvider struct {
	client *deptsync.Client
}

func (p *deptWorkflowRoleOrganizationProvider) Configured() bool {
	if p == nil {
		return false
	}
	return p.client != nil && p.client.Configured()
}

func (p *deptWorkflowRoleOrganizationProvider) ResolveMembers(ctx context.Context, externalIdentities []string) (service.WorkflowRoleOrganizationSnapshot, error) {
	if !p.Configured() {
		return service.WorkflowRoleOrganizationSnapshot{}, deptsync.ErrNotConfigured
	}
	identities := append([]string(nil), externalIdentities...)
	sort.Strings(identities)
	profiles := make([]service.WorkflowRoleOrganizationProfile, len(identities))
	present := make([]bool, len(identities))
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	const parallelism = 8
	sem := make(chan struct{}, parallelism)
	var wg sync.WaitGroup
	var firstErr error
	var errMu sync.Mutex
	for i, identity := range identities {
		i, identity := i, identity
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				return
			}
			rows, err := p.client.GetUserDepartmentsByUniversalID(ctx, identity)
			if err != nil {
				errMu.Lock()
				if firstErr == nil {
					firstErr = err
					cancel()
				}
				errMu.Unlock()
				return
			}
			profile, ok := selectWorkflowRoleOrganizationProfile(identity, rows)
			if ok {
				profiles[i] = profile
				present[i] = true
			}
		}()
	}
	wg.Wait()
	if firstErr != nil {
		return service.WorkflowRoleOrganizationSnapshot{}, firstErr
	}
	filtered := make([]service.WorkflowRoleOrganizationProfile, 0, len(profiles))
	for i := range profiles {
		if present[i] {
			filtered = append(filtered, profiles[i])
		}
	}
	fetchedAt := time.Now().UTC()
	hash := sha256.New()
	for _, profile := range filtered {
		fmt.Fprintf(hash, "%s\x00%s\x00%s\x00%s\x00%t\n", profile.ExternalIdentity, profile.DisplayName, profile.Position, profile.DepartmentPath, profile.IsMainDepartment)
	}
	return service.WorkflowRoleOrganizationSnapshot{
		Profiles:  filtered,
		Version:   fmt.Sprintf("fetched_at=%s;sha256=%x", fetchedAt.Format(time.RFC3339Nano), hash.Sum(nil)),
		FetchedAt: fetchedAt,
	}, nil
}

func selectWorkflowRoleOrganizationProfile(identity string, rows []deptsync.User) (service.WorkflowRoleOrganizationProfile, bool) {
	var selected *deptsync.User
	for i := range rows {
		row := &rows[i]
		if row.Status != 1 || strings.TrimSpace(row.UniversalID) != identity {
			continue
		}
		if selected == nil || (row.IsMain == 1 && selected.IsMain != 1) {
			selected = row
		}
	}
	if selected == nil {
		return service.WorkflowRoleOrganizationProfile{}, false
	}
	return service.WorkflowRoleOrganizationProfile{
		ExternalIdentity: identity,
		DisplayName:      strings.TrimSpace(selected.Username),
		Position:         strings.TrimSpace(selected.Position),
		DepartmentPath:   strings.TrimSpace(selected.DeptPath),
		IsMainDepartment: selected.IsMain == 1,
	}, true
}
