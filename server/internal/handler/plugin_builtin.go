package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/multica-ai/multica/server/internal/plugincatalog"
)

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

	url, err := plugincatalog.BuildURL(baseURL, path, params)
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

	url, err := plugincatalog.BuildURL(baseURL, "/api/items/"+url.PathEscape(pluginID), nil)
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
		writeError(w, http.StatusInternalServerError, "failed to decode detail proxy response")
		return
	}

	writeJSON(w, http.StatusOK, body)
}
