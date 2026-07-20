package execenv

import (
	"context"
	"fmt"
	"log/slog"
	"os/exec"
	"strings"
	"time"
)

// AgentPlugin describes the plugin bound to an agent.
// Single plugin per agent — nil means no plugin is configured.
type AgentPlugin struct {
	ID      string         `json:"id"`
	Name    string         `json:"name"`
	Install *PluginInstall `json:"install,omitempty"`
}

// PluginInstall describes how to install a plugin from a marketplace.
type PluginInstall struct {
	Method              string `json:"method"`               // e.g. "plugin_marketplace"
	Marketplace         string `json:"marketplace"`          // e.g. "anthropics/claude-plugins-official"
	PluginName          string `json:"plugin_name"`          // e.g. "superpowers"
	MarketplaceName     string `json:"marketplace_name"`     // e.g. "claude-plugins-official"
	MarketplaceRepo     string `json:"marketplace_repo"`     // e.g. "anthropics/claude-plugins-official"
	MarketplaceVerified bool   `json:"marketplace_verified"` // e.g. true
}

// Built-in github defaults for the CSC plugin marketplace. Used only when the
// server does not deliver a marketplace identity (e.g. an older server build
// that predates this field), so a newer daemon keeps installing plugins
// against the canonical marketplace instead of failing on an empty name.
const (
	defaultCSCMarketplaceName = "costrict-plugins"
	defaultCSCMarketplaceRepo = "https://github.com/costrict-plugins-repo/marketplace.git"
)

// setupPlugins is a provider-aware plugin installer dispatcher.
// It routes to the correct implementation based on the provider string.
// Returns nil immediately when bin is empty or plugin is nil.
func setupPlugins(ctx context.Context, provider, bin, workDir string, plugin *AgentPlugin, logger *slog.Logger) error {
	if bin == "" || plugin == nil || plugin.Install == nil {
		return nil
	}
	switch provider {
	case "csc":
		return setupCSCPlugins(ctx, bin, workDir, plugin, logger)
	default:
		return nil
	}
}

// setupCSCPlugins installs a CSC plugin into the task's working directory.
// It runs the following commands:
//
//  1. csc plugin marketplace add <marketplaceRepo>        (non-fatal)
//  2. csc plugin marketplace update <marketplaceName>
//  3. csc plugin install <pluginName>@<marketplaceName> -s local
//  4. csc plugin update <pluginName>@<marketplaceName> -s local
//
// All commands run with cmd.Dir set to workDir (CSC uses cwd + scope, not --dir).
// marketplace add failure is non-fatal: the marketplace may already be registered.
func setupCSCPlugins(ctx context.Context, cscBin string, workDir string, plugin *AgentPlugin, logger *slog.Logger) error {
	if cscBin == "" || plugin == nil || plugin.Install == nil {
		return nil
	}
	install := plugin.Install

	// Marketplace identity comes from the server (delivered via the task-claim
	// response). Fall back to the built-in github default when the server left
	// it empty — e.g. an older server that doesn't deliver the field yet.
	name := install.MarketplaceName
	if name == "" {
		name = defaultCSCMarketplaceName
	}
	repo := install.MarketplaceRepo
	if repo == "" {
		repo = defaultCSCMarketplaceRepo
	}

	// Step 1: marketplace add (non-fatal — may already be registered)
	if err := runCSCCmd(ctx, cscBin, workDir, "plugin", "marketplace", "add", repo); err != nil {
		logger.Error("execenv: csc plugin marketplace add failed", "repo", repo, "error", err)
	}

	// Step 2: marketplace update
	if err := runCSCCmd(ctx, cscBin, workDir, "plugin", "marketplace", "update", name); err != nil {
		return fmt.Errorf("csc plugin marketplace update %s: %w", name, err)
	}

	// Step 3: install with local scope
	spec := install.PluginName + "@" + name
	if err := runCSCCmd(ctx, cscBin, workDir, "plugin", "install", spec, "-s", "local"); err != nil {
		return fmt.Errorf("csc plugin install %s: %w", spec, err)
	}

	// Step 4: update installed plugin
	if err := runCSCCmd(ctx, cscBin, workDir, "plugin", "update", spec, "-s", "local"); err != nil {
		return fmt.Errorf("csc plugin update %s: %w", spec, err)
	}

	return nil
}

// runCSCCmd executes a csc CLI command with the given arguments.
func runCSCCmd(ctx context.Context, cscBin, workDir string, args ...string) error {
	cmdCtx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()
	cmd := exec.CommandContext(cmdCtx, cscBin, args...)
	cmd.Dir = workDir
	var stdout strings.Builder
	var stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		output := strings.TrimSpace(strings.Join([]string{
			strings.TrimSpace(stdout.String()),
			strings.TrimSpace(stderr.String()),
		}, "\n"))
		if output != "" {
			return fmt.Errorf("%w: %s", err, output)
		}
		return err
	}
	return nil
}
