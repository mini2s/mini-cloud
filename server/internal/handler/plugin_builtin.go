package handler

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
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

// PluginInfo is the subset of plugin data passed to the daemon for task execution.
type PluginInfo struct {
	ID      string        `json:"id"`
	Name    string        `json:"name"`
	Install PluginInstall `json:"install"`
}

// builtinPluginItem mirrors a single item in the external plugin API list response.
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

// pluginResult bundles plugin metadata and content from a single external API call.
type pluginResult struct {
	Info    *PluginInfo
	Content string
}

const (
	defaultBuiltinPluginPage     = 1
	defaultBuiltinPluginPageSize = 100
	maxBuiltinPluginPageSize     = 100
)

func emptyBuiltinPluginListResponse() map[string]any {
	return map[string]any{
		"items":    []any{},
		"total":    0,
		"page":     defaultBuiltinPluginPage,
		"pageSize": defaultBuiltinPluginPageSize,
		"hasMore":  false,
	}
}

func builtinPluginPagination(values url.Values) (int, int) {
	page := defaultBuiltinPluginPage
	if raw := strings.TrimSpace(values.Get("page")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed >= 1 {
			page = parsed
		}
	}

	pageSize := defaultBuiltinPluginPageSize
	if raw := strings.TrimSpace(values.Get("pageSize")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			if parsed < 1 {
				pageSize = 1
			} else if parsed > maxBuiltinPluginPageSize {
				pageSize = maxBuiltinPluginPageSize
			} else {
				pageSize = parsed
			}
		}
	}

	return page, pageSize
}

func builtinPluginSearch(values url.Values) string {
	if search := strings.TrimSpace(values.Get("q")); search != "" {
		return search
	}
	return strings.TrimSpace(values.Get("search"))
}

func buildPluginCatalogURL(baseURL string, path string, values url.Values) (string, error) {
	u, err := url.Parse(strings.TrimRight(baseURL, "/"))
	if err != nil {
		return "", err
	}
	u.Path = strings.TrimRight(u.Path, "/") + path
	u.RawQuery = values.Encode()
	return u.String(), nil
}

func pluginResultFromItem(p builtinPluginItem) *pluginResult {
	return &pluginResult{
		Info: &PluginInfo{
			ID:      p.ID,
			Name:    p.Name,
			Install: p.Metadata.Install,
		},
		Content: p.Content,
	}
}

// fetchPluginData fetches the plugin's metadata and content from the external
// catalog API. Returns nil when the API is unreachable, the plugin is not found,
// or the base URL is unconfigured — best-effort and must never block task startup.
func fetchPluginData(ctx context.Context, baseURL string, pluginID string) *pluginResult {
	if detail, ok := fetchPluginByID(ctx, baseURL, pluginID); ok {
		return pluginResultFromItem(*detail)
	}

	list, ok := fetchPluginList(ctx, baseURL)
	if !ok {
		return nil
	}
	for _, p := range list.Items {
		if p.ID == pluginID {
			return pluginResultFromItem(p)
		}
	}
	slog.Debug("plugin: plugin not found in catalog", "plugin_id", pluginID)
	return nil
}

// ListBuiltinPlugins proxies the external builtin plugin catalog API so the
// frontend doesn't need build-time env vars to reach it. The base URL is read
// from the server's runtime config (BUILTIN_PLUGIN_API_BASE_URL).
func (h *Handler) ListBuiltinPlugins(w http.ResponseWriter, r *http.Request) {
	baseURL := h.cfg.BuiltinPluginAPIBaseURL
	if baseURL == "" {
		writeJSON(w, http.StatusOK, emptyBuiltinPluginListResponse())
		return
	}

	search := builtinPluginSearch(r.URL.Query())
	page, pageSize := builtinPluginPagination(r.URL.Query())
	params := url.Values{}
	params.Set("page", strconv.Itoa(page))
	params.Set("pageSize", strconv.Itoa(pageSize))
	path := "/api/plugins/builtin"
	if search != "" {
		path = "/api/items"
		params.Set("type", "plugin")
		params.Set("search", search)
	}

	url, err := buildPluginCatalogURL(baseURL, path, params)
	if err != nil {
		slog.Warn("plugin: failed to build proxy URL", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to build proxy request")
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), "GET", url, nil)
	if err != nil {
		slog.Warn("plugin: failed to build proxy request", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to build proxy request")
		return
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		slog.Warn("plugin: proxy API unreachable", "url", url, "error", err)
		writeJSON(w, http.StatusOK, emptyBuiltinPluginListResponse())
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		slog.Warn("plugin: proxy API returned non-200", "status", resp.StatusCode)
		writeJSON(w, http.StatusOK, emptyBuiltinPluginListResponse())
		return
	}

	// Pass through the raw response body so we don't drop any fields.
	var body any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		slog.Warn("plugin: failed to decode proxy response", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to decode proxy response")
		return
	}

	writeJSON(w, http.StatusOK, body)
}

// GetPlugin proxies a single plugin item from the external catalog API.
func (h *Handler) GetPlugin(w http.ResponseWriter, r *http.Request) {
	baseURL := h.cfg.BuiltinPluginAPIBaseURL
	if baseURL == "" {
		writeError(w, http.StatusNotFound, "plugin not found")
		return
	}

	pluginID := strings.TrimSpace(chi.URLParam(r, "id"))
	if pluginID == "" {
		writeError(w, http.StatusBadRequest, "plugin id is required")
		return
	}

	url, err := buildPluginCatalogURL(baseURL, "/api/items/"+url.PathEscape(pluginID), nil)
	if err != nil {
		slog.Warn("plugin: failed to build detail proxy URL", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to build proxy request")
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), "GET", url, nil)
	if err != nil {
		slog.Warn("plugin: failed to build detail proxy request", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to build proxy request")
		return
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		slog.Warn("plugin: detail proxy API unreachable", "url", url, "error", err)
		writeError(w, http.StatusBadGateway, "plugin catalog unavailable")
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		writeError(w, http.StatusNotFound, "plugin not found")
		return
	}
	if resp.StatusCode != http.StatusOK {
		slog.Warn("plugin: detail proxy API returned non-200", "status", resp.StatusCode)
		writeError(w, http.StatusBadGateway, "plugin catalog unavailable")
		return
	}

	var body any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		slog.Warn("plugin: failed to decode detail proxy response", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to decode proxy response")
		return
	}

	writeJSON(w, http.StatusOK, body)
}

func fetchPluginByID(ctx context.Context, baseURL string, pluginID string) (*builtinPluginItem, bool) {
	if baseURL == "" || strings.TrimSpace(pluginID) == "" {
		return nil, false
	}

	url, err := buildPluginCatalogURL(baseURL, "/api/items/"+url.PathEscape(pluginID), nil)
	if err != nil {
		slog.Warn("plugin: failed to build detail URL", "error", err)
		return nil, false
	}
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		slog.Warn("plugin: failed to build detail request", "error", err)
		return nil, false
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		slog.Warn("plugin: detail API unreachable", "url", url, "error", err)
		return nil, false
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		slog.Warn("plugin: detail API returned non-200", "status", resp.StatusCode)
		return nil, false
	}

	var item builtinPluginItem
	if err := json.NewDecoder(resp.Body).Decode(&item); err != nil {
		slog.Warn("plugin: failed to decode detail response", "error", err)
		return nil, false
	}
	if item.ID == "" {
		return nil, false
	}

	return &item, true
}

func fetchPluginList(ctx context.Context, baseURL string) (*builtinPluginListResponse, bool) {
	if baseURL == "" {
		return nil, false
	}

	params := url.Values{}
	params.Set("page", strconv.Itoa(defaultBuiltinPluginPage))
	params.Set("pageSize", strconv.Itoa(defaultBuiltinPluginPageSize))
	url, err := buildPluginCatalogURL(baseURL, "/api/plugins/builtin", params)
	if err != nil {
		slog.Warn("plugin: failed to build URL", "error", err)
		return nil, false
	}
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		slog.Warn("plugin: failed to build request", "error", err)
		return nil, false
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		slog.Warn("plugin: API unreachable", "url", url, "error", err)
		return nil, false
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		slog.Warn("plugin: API returned non-200", "status", resp.StatusCode)
		return nil, false
	}

	var list builtinPluginListResponse
	if err := json.NewDecoder(resp.Body).Decode(&list); err != nil {
		slog.Warn("plugin: failed to decode response", "error", err)
		return nil, false
	}

	return &list, true
}
