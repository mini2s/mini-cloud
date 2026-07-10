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

func emptyCatalogSkillListResponse() map[string]any {
	return map[string]any{
		"items":    []any{},
		"total":    0,
		"page":     defaultBuiltinPluginPage,
		"pageSize": defaultBuiltinPluginPageSize,
		"hasMore":  false,
	}
}

func catalogSkillSearch(values url.Values) string {
	if search := strings.TrimSpace(values.Get("q")); search != "" {
		return search
	}
	return strings.TrimSpace(values.Get("search"))
}

func catalogSkillListParams(values url.Values) url.Values {
	search := catalogSkillSearch(values)
	page, pageSize := builtinPluginPagination(values)

	params := url.Values{}
	params.Set("type", catalogSkillType)
	params.Set("page", strconv.Itoa(page))
	params.Set("pageSize", strconv.Itoa(pageSize))
	if search != "" {
		params.Set("search", search)
	}
	return params
}

// ListCatalogSkills proxies public skill catalog searches from the shared cloud
// capability catalog. It fails open to an empty list so catalog downtime does
// not block the rest of the API.
func (h *Handler) ListCatalogSkills(w http.ResponseWriter, r *http.Request) {
	baseURL := h.cfg.BuiltinPluginAPIBaseURL
	if baseURL == "" {
		writeJSON(w, http.StatusOK, emptyCatalogSkillListResponse())
		return
	}

	proxyURL, err := buildPluginCatalogURL(baseURL, "/api/items", catalogSkillListParams(r.URL.Query()))
	if err != nil {
		slog.Warn("catalog skill: failed to build list proxy URL", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to build proxy request")
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, proxyURL, nil)
	if err != nil {
		slog.Warn("catalog skill: failed to build list proxy request", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to build proxy request")
		return
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		slog.Warn("catalog skill: list proxy API unreachable", "url", proxyURL, "error", err)
		writeJSON(w, http.StatusOK, emptyCatalogSkillListResponse())
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		slog.Warn("catalog skill: list proxy API returned non-200", "status", resp.StatusCode)
		writeJSON(w, http.StatusOK, emptyCatalogSkillListResponse())
		return
	}

	var body any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		slog.Warn("catalog skill: failed to decode list proxy response", "error", err)
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
