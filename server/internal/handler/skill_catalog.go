package handler

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

const catalogSkillType = "skill"
const catalogPluginType = "plugin"

func emptyCatalogItemListResponse() map[string]any {
	return map[string]any{
		"items":    []any{},
		"total":    0,
		"page":     defaultBuiltinPluginPage,
		"pageSize": defaultBuiltinPluginPageSize,
		"hasMore":  false,
	}
}

func catalogItemSearch(values url.Values) string {
	if search := strings.TrimSpace(values.Get("q")); search != "" {
		return search
	}
	return strings.TrimSpace(values.Get("search"))
}

func catalogItemListParams(values url.Values, itemType string) url.Values {
	search := catalogItemSearch(values)
	page, pageSize := builtinPluginPagination(values)

	params := url.Values{}
	params.Set("type", itemType)
	params.Set("page", strconv.Itoa(page))
	params.Set("pageSize", strconv.Itoa(pageSize))
	if search != "" {
		params.Set("search", search)
	}
	return params
}

func catalogSkillListParams(values url.Values) url.Values {
	return catalogItemListParams(values, catalogSkillType)
}

func catalogPluginListParams(values url.Values) url.Values {
	params := catalogItemListParams(values, catalogPluginType)
	params.Set("sortBy", "favoriteCount")
	params.Set("sortOrder", "desc")
	return params
}

// ListCatalogSkills proxies public skill catalog searches from the shared cloud
// capability catalog. It fails open to an empty list so catalog downtime does
// not block the rest of the API.
func (h *Handler) ListCatalogSkills(w http.ResponseWriter, r *http.Request) {
	h.listCatalogItems(w, r, "catalog skill", catalogSkillListParams(r.URL.Query()))
}

// ListCatalogPlugins proxies public plugin catalog searches from the shared
// cloud capability catalog. Results are ordered by popularity and capped by
// the shared pagination helper at 100 items per request.
func (h *Handler) ListCatalogPlugins(w http.ResponseWriter, r *http.Request) {
	h.listCatalogItems(w, r, "catalog plugin", catalogPluginListParams(r.URL.Query()))
}

func (h *Handler) listCatalogItems(w http.ResponseWriter, r *http.Request, logPrefix string, params url.Values) {
	baseURL := h.cfg.BuiltinPluginAPIBaseURL
	if baseURL == "" {
		writeJSON(w, http.StatusOK, emptyCatalogItemListResponse())
		return
	}

	proxyURL, err := buildPluginCatalogURL(baseURL, "/api/items", params)
	if err != nil {
		slog.Warn(logPrefix+": failed to build list proxy URL", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to build proxy request")
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, proxyURL, nil)
	if err != nil {
		slog.Warn(logPrefix+": failed to build list proxy request", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to build proxy request")
		return
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		slog.Warn(logPrefix+": list proxy API unreachable", "url", proxyURL, "error", err)
		writeJSON(w, http.StatusOK, emptyCatalogItemListResponse())
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		slog.Warn(logPrefix+": list proxy API returned non-200", "status", resp.StatusCode)
		writeJSON(w, http.StatusOK, emptyCatalogItemListResponse())
		return
	}

	var body any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		slog.Warn(logPrefix+": failed to decode list proxy response", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to decode proxy response")
		return
	}

	writeJSON(w, http.StatusOK, body)
}

// GetCatalogSkill proxies a public skill catalog item. Validation is fail-closed:
// non-skill, private, or malformed catalog items are reported as not found.
func (h *Handler) GetCatalogSkill(w http.ResponseWriter, r *http.Request) {
	skillID := strings.TrimSpace(chi.URLParam(r, "id"))
	if skillID == "" {
		writeError(w, http.StatusBadRequest, "skill id is required")
		return
	}

	body, status, err := h.fetchCatalogSkillDetail(r, skillID)
	if err != nil {
		slog.Warn("catalog skill: detail proxy failed", "skill_id", skillID, "status", status, "error", err)
	}
	switch status {
	case http.StatusOK:
		writeJSON(w, http.StatusOK, body)
	case http.StatusNotFound:
		writeError(w, http.StatusNotFound, "skill not found")
	case http.StatusBadGateway:
		writeError(w, http.StatusBadGateway, "skill catalog unavailable")
	case http.StatusInternalServerError:
		writeError(w, http.StatusInternalServerError, "failed to build proxy request")
	default:
		writeError(w, http.StatusBadGateway, "skill catalog unavailable")
	}
}

func (h *Handler) fetchCatalogSkillDetail(r *http.Request, skillID string) (map[string]any, int, error) {
	baseURL := h.cfg.BuiltinPluginAPIBaseURL
	if baseURL == "" {
		return nil, http.StatusNotFound, nil
	}

	proxyURL, err := buildPluginCatalogURL(baseURL, "/api/items/"+url.PathEscape(skillID), nil)
	if err != nil {
		return nil, http.StatusInternalServerError, err
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, proxyURL, nil)
	if err != nil {
		return nil, http.StatusInternalServerError, err
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, http.StatusBadGateway, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, http.StatusNotFound, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, http.StatusBadGateway, fmt.Errorf("catalog returned status %d", resp.StatusCode)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, http.StatusInternalServerError, err
	}
	if !isPublicSkillCatalogItem(body) {
		return nil, http.StatusNotFound, nil
	}
	normalizeCatalogSkillInstall(body, skillID)
	return body, http.StatusOK, nil
}

func isPublicSkillCatalogItem(body map[string]any) bool {
	itemType := catalogString(body["itemType"])
	if itemType == "" {
		itemType = catalogString(body["item_type"])
	}
	return itemType == catalogSkillType && catalogString(body["repoVisibility"]) == "public"
}

func normalizeCatalogSkillInstall(body map[string]any, skillID string) {
	metadata, ok := body["metadata"].(map[string]any)
	if !ok || metadata == nil {
		metadata = map[string]any{}
	}
	if _, ok := metadata["install"]; !ok || metadata["install"] == nil {
		metadata["install"] = defaultCatalogSkillInstall(skillID)
	}
	body["metadata"] = metadata
}

func defaultCatalogSkillInstall(skillID string) map[string]any {
	return map[string]any{
		"method":   "csc",
		"skill_id": skillID,
		"spec":     skillID,
	}
}

func catalogString(value any) string {
	s, _ := value.(string)
	return strings.TrimSpace(s)
}
