// Package plugincatalog fetches plugin metadata from the external builtin
// plugin catalog API. It is shared by the handler layer (HTTP proxy + daemon
// claim-time plugin resolution) and the service layer (cs-cloud dispatch-time
// plugin resolution), so both resolve plugins identically.
package plugincatalog

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// PluginInstall mirrors the install metadata from the external plugin API.
type PluginInstall struct {
	Method              string `json:"method"`
	Marketplace         string `json:"marketplace"`
	PluginName          string `json:"plugin_name"`
	MarketplaceName     string `json:"marketplace_name"`
	MarketplaceRepo     string `json:"marketplace_repo"`
	MarketplaceVerified bool   `json:"marketplace_verified"`
}

// PluginInfo is the subset of plugin data needed to install and execute a
// plugin in a task environment.
type PluginInfo struct {
	ID      string        `json:"id"`
	Name    string        `json:"name"`
	Install PluginInstall `json:"install"`
}

// Result bundles plugin metadata and content from a single catalog call.
type Result struct {
	Info    *PluginInfo
	Content string
}

// builtinPluginItem mirrors a single item in the external plugin API response.
type builtinPluginItem struct {
	ID       string                    `json:"id"`
	Name     string                    `json:"name"`
	Content  string                    `json:"content"`
	Metadata builtinPluginItemMetadata `json:"metadata"`
}

type builtinPluginItemMetadata struct {
	Install PluginInstall `json:"install"`
}

// builtinPluginListResponse mirrors the external plugin API list response.
type builtinPluginListResponse struct {
	Items   []builtinPluginItem `json:"items"`
	HasMore bool                `json:"hasMore"`
	Page    int                 `json:"page"`
}

const (
	defaultPage     = 1
	defaultPageSize = 100
)

const catalogHTTPTimeout = 5 * time.Second

// BuildURL joins a catalog base URL with a path and query, used by both the
// fetch helpers here and the HTTP proxy handlers in the handler package.
func BuildURL(baseURL string, path string, values url.Values) (string, error) {
	u, err := url.Parse(strings.TrimRight(baseURL, "/"))
	if err != nil {
		return "", err
	}
	u.Path = strings.TrimRight(u.Path, "/") + path
	u.RawQuery = values.Encode()
	return u.String(), nil
}

func resultFromItem(p builtinPluginItem) *Result {
	return &Result{
		Info: &PluginInfo{
			ID:      p.ID,
			Name:    p.Name,
			Install: p.Metadata.Install,
		},
		Content: p.Content,
	}
}

// Fetch fetches the plugin's metadata and content from the external catalog
// API. Returns nil when the API is unreachable, the plugin is not found, or the
// base URL is unconfigured — best-effort and must never block task startup or
// dispatch.
func Fetch(ctx context.Context, baseURL string, pluginID string) *Result {
	if detail, ok := fetchByID(ctx, baseURL, pluginID); ok {
		return resultFromItem(*detail)
	}

	list, ok := fetchList(ctx, baseURL)
	if !ok {
		return nil
	}
	for _, p := range list.Items {
		if p.ID == pluginID {
			return resultFromItem(p)
		}
	}
	slog.Debug("plugincatalog: plugin not found", "plugin_id", pluginID)
	return nil
}

func fetchByID(ctx context.Context, baseURL string, pluginID string) (*builtinPluginItem, bool) {
	if baseURL == "" || strings.TrimSpace(pluginID) == "" {
		return nil, false
	}

	url, err := BuildURL(baseURL, "/api/items/"+url.PathEscape(pluginID), nil)
	if err != nil {
		slog.Warn("plugincatalog: failed to build detail URL", "error", err)
		return nil, false
	}
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		slog.Warn("plugincatalog: failed to build detail request", "error", err)
		return nil, false
	}

	client := &http.Client{Timeout: catalogHTTPTimeout}
	resp, err := client.Do(req)
	if err != nil {
		slog.Warn("plugincatalog: detail API unreachable", "url", url, "error", err)
		return nil, false
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		slog.Warn("plugincatalog: detail API returned non-200", "status", resp.StatusCode)
		return nil, false
	}

	var item builtinPluginItem
	if err := json.NewDecoder(resp.Body).Decode(&item); err != nil {
		slog.Warn("plugincatalog: failed to decode detail response", "error", err)
		return nil, false
	}
	if item.ID == "" {
		return nil, false
	}

	return &item, true
}

func fetchList(ctx context.Context, baseURL string) (*builtinPluginListResponse, bool) {
	if baseURL == "" {
		return nil, false
	}

	params := url.Values{}
	params.Set("page", strconv.Itoa(defaultPage))
	params.Set("pageSize", strconv.Itoa(defaultPageSize))
	url, err := BuildURL(baseURL, "/api/plugins/builtin", params)
	if err != nil {
		slog.Warn("plugincatalog: failed to build URL", "error", err)
		return nil, false
	}
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		slog.Warn("plugincatalog: failed to build request", "error", err)
		return nil, false
	}

	client := &http.Client{Timeout: catalogHTTPTimeout}
	resp, err := client.Do(req)
	if err != nil {
		slog.Warn("plugincatalog: API unreachable", "url", url, "error", err)
		return nil, false
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		slog.Warn("plugincatalog: API returned non-200", "status", resp.StatusCode)
		return nil, false
	}

	var list builtinPluginListResponse
	if err := json.NewDecoder(resp.Body).Decode(&list); err != nil {
		slog.Warn("plugincatalog: failed to decode response", "error", err)
		return nil, false
	}

	return &list, true
}
