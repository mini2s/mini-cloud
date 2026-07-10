package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"

	"github.com/go-chi/chi/v5"
)

const (
	maxAgentCloudSkillCount    = 20
	maxAgentCloudSkillIDLength = 200
)

type SetAgentCloudSkillsRequest struct {
	SkillIDs []string `json:"skill_ids"`
}

type AgentCloudSkillData struct {
	ID          string          `json:"id"`
	Slug        string          `json:"slug,omitempty"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Install     json.RawMessage `json:"install"`
	Position    int32           `json:"position"`
}

type catalogSkillSnapshot struct {
	ID          string
	Slug        string
	Name        string
	Description string
	Install     []byte
}

func (h *Handler) ListAgentCloudSkills(w http.ResponseWriter, r *http.Request) {
	agent, ok := h.loadAgentCloudSkillsAgent(w, r)
	if !ok {
		return
	}

	rows, err := h.Queries.ListAgentCloudSkills(r.Context(), agent.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list agent cloud skills")
		return
	}
	resp, ok := agentCloudSkillRowsToResponse(w, rows)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) SetAgentCloudSkills(w http.ResponseWriter, r *http.Request) {
	agentID := chi.URLParam(r, "id")
	agent, ok := h.loadAgentForUser(w, r, agentID)
	if !ok {
		return
	}
	if !h.canManageAgent(w, r, agent) {
		return
	}

	var req SetAgentCloudSkillsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	ids, err := validateAgentCloudSkillIDs(req.SkillIDs)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	snapshots := make([]catalogSkillSnapshot, 0, len(ids))
	for _, id := range ids {
		snapshot, status, err := h.fetchCatalogSkillSnapshot(r, id)
		if err != nil {
			writeCatalogSkillBindingError(w, status)
			return
		}
		snapshots = append(snapshots, snapshot)
	}

	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start transaction")
		return
	}
	defer tx.Rollback(r.Context())

	qtx := h.Queries.WithTx(tx)
	if err := qtx.DeleteAgentCloudSkills(r.Context(), agent.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to clear agent cloud skills")
		return
	}
	for i, snapshot := range snapshots {
		if _, err := qtx.CreateAgentCloudSkill(r.Context(), db.CreateAgentCloudSkillParams{
			AgentID:      agent.ID,
			CloudSkillID: snapshot.ID,
			Slug:         snapshot.Slug,
			Name:         snapshot.Name,
			Description:  snapshot.Description,
			Install:      snapshot.Install,
			Position:     int32(i),
		}); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to add agent cloud skill")
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to commit")
		return
	}

	rows, err := h.Queries.ListAgentCloudSkills(r.Context(), agent.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list agent cloud skills")
		return
	}
	resp, ok := agentCloudSkillRowsToResponse(w, rows)
	if !ok {
		return
	}
	workspaceID := uuidToString(agent.WorkspaceID)
	actorType, actorID := h.resolveActor(r, requestUserID(r), workspaceID)
	h.publish(protocol.EventAgentStatus, workspaceID, actorType, actorID, map[string]any{"agent_id": uuidToString(agent.ID), "cloud_skills": resp})
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) loadAgentCloudSkillsAgent(w http.ResponseWriter, r *http.Request) (db.MulticaAgent, bool) {
	agentID := chi.URLParam(r, "id")
	agent, ok := h.loadAgentForUser(w, r, agentID)
	if !ok {
		return db.MulticaAgent{}, false
	}
	if agent.IsBuiltin {
		return agent, true
	}
	workspaceID := uuidToString(agent.WorkspaceID)
	actorType, actorID := h.resolveActor(r, requestUserID(r), workspaceID)
	if !h.canAccessPrivateAgent(r.Context(), agent, actorType, actorID, workspaceID) {
		writeError(w, http.StatusForbidden, "you do not have access to this agent")
		return db.MulticaAgent{}, false
	}
	return agent, true
}

func validateAgentCloudSkillIDs(raw []string) ([]string, error) {
	if len(raw) > maxAgentCloudSkillCount {
		return nil, fmt.Errorf("skill_ids must contain at most %d items", maxAgentCloudSkillCount)
	}
	ids := make([]string, 0, len(raw))
	seen := make(map[string]struct{}, len(raw))
	for _, value := range raw {
		id := strings.TrimSpace(value)
		if id == "" {
			return nil, fmt.Errorf("skill_ids must not contain empty ids")
		}
		if len(id) > maxAgentCloudSkillIDLength {
			return nil, fmt.Errorf("skill_ids must be %d characters or fewer", maxAgentCloudSkillIDLength)
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return ids, nil
}

func (h *Handler) fetchCatalogSkillSnapshot(r *http.Request, requestedID string) (catalogSkillSnapshot, int, error) {
	body, status, err := h.fetchCatalogSkillDetail(r, requestedID)
	if err != nil || status != http.StatusOK {
		if err == nil {
			err = fmt.Errorf("catalog skill %q unavailable", requestedID)
		}
		return catalogSkillSnapshot{}, status, err
	}

	name := catalogString(body["name"])
	if name == "" {
		return catalogSkillSnapshot{}, http.StatusNotFound, fmt.Errorf("catalog skill %q missing name", requestedID)
	}
	install, err := allowlistedCatalogSkillInstall(body, requestedID)
	if err != nil {
		return catalogSkillSnapshot{}, http.StatusNotFound, err
	}
	return catalogSkillSnapshot{
		ID:          requestedID,
		Slug:        catalogString(body["slug"]),
		Name:        name,
		Description: catalogString(body["description"]),
		Install:     install,
	}, http.StatusOK, nil
}

func allowlistedCatalogSkillInstall(body map[string]any, skillID string) ([]byte, error) {
	normalizeCatalogSkillInstall(body, skillID)
	metadata, ok := body["metadata"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("catalog skill %q metadata is invalid", skillID)
	}
	install, ok := metadata["install"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("catalog skill %q install metadata is invalid", skillID)
	}

	allowed := make(map[string]any, 5)
	for _, key := range []string{"method", "spec", "skill_id", "source_url"} {
		if value := catalogString(install[key]); value != "" {
			allowed[key] = value
		}
	}
	if value, ok := install["verified"].(bool); ok {
		allowed["verified"] = value
	}

	raw, err := json.Marshal(allowed)
	if err != nil {
		return nil, err
	}
	return raw, nil
}

func agentCloudSkillRowsToResponse(w http.ResponseWriter, rows []db.MulticaAgentCloudSkill) ([]AgentCloudSkillData, bool) {
	resp := make([]AgentCloudSkillData, len(rows))
	for i, row := range rows {
		install, ok := rawJSONObject(row.Install)
		if !ok {
			writeError(w, http.StatusInternalServerError, "stored cloud skill install metadata is invalid")
			return nil, false
		}
		resp[i] = AgentCloudSkillData{
			ID:          row.CloudSkillID,
			Slug:        row.Slug,
			Name:        row.Name,
			Description: row.Description,
			Install:     install,
			Position:    row.Position,
		}
	}
	return resp, true
}

func rawJSONObject(raw []byte) (json.RawMessage, bool) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" {
		return nil, false
	}
	var object map[string]any
	if err := json.Unmarshal([]byte(trimmed), &object); err != nil || object == nil {
		return nil, false
	}
	return json.RawMessage([]byte(trimmed)), true
}

func writeCatalogSkillBindingError(w http.ResponseWriter, status int) {
	switch status {
	case http.StatusNotFound:
		writeError(w, http.StatusNotFound, "skill not found")
	case http.StatusBadGateway:
		writeError(w, http.StatusBadGateway, "skill catalog unavailable")
	case http.StatusInternalServerError:
		writeError(w, http.StatusInternalServerError, "failed to fetch skill")
	default:
		writeError(w, http.StatusBadGateway, "skill catalog unavailable")
	}
}
