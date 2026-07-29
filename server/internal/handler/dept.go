package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
)

func (h *Handler) SearchDeptDepartments(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireUserID(w, r); !ok {
		return
	}
	if h.DeptSync == nil || !h.DeptSync.Configured() {
		writeError(w, http.StatusServiceUnavailable, "dept sync is not configured")
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	limit := 20
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			writeError(w, http.StatusBadRequest, "invalid limit")
			return
		}
		if parsed < limit {
			limit = parsed
		}
	}
	departments, err := h.DeptSync.SearchDepartments(r.Context(), query, limit)
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to search departments")
		return
	}
	writeJSON(w, http.StatusOK, departments)
}

const deptUserSearchLimit = 3

// deptUserSearchHit is the trimmed DTO returned to the frontend.
type deptUserSearchHit struct {
	SubjectID string `json:"subject_id"`
	Name      string `json:"name"`
	Email     string `json:"email,omitempty"`
}

func (h *Handler) SearchDeptUsers(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireUserID(w, r); !ok {
		return
	}
	if h.CsUser == nil {
		writeError(w, http.StatusServiceUnavailable, "cs-user is not configured")
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	users, err := h.CsUser.SearchUsers(r.Context(), q, deptUserSearchLimit)
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to search users")
		return
	}
	if len(users) > deptUserSearchLimit {
		users = users[:deptUserSearchLimit]
	}
	hits := make([]deptUserSearchHit, 0, len(users))
	for _, u := range users {
		hits = append(hits, deptUserSearchHit{SubjectID: u.SubjectID, Name: u.Name(), Email: u.EmailOrEmpty()})
	}
	writeJSON(w, http.StatusOK, hits)
}

func (h *Handler) ListDeptDepartmentUsers(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireUserID(w, r); !ok {
		return
	}
	if h.DeptSync == nil || !h.DeptSync.Configured() {
		writeError(w, http.StatusServiceUnavailable, "dept sync is not configured")
		return
	}
	deptID := strings.TrimSpace(chi.URLParam(r, "id"))
	if deptID == "" {
		writeError(w, http.StatusBadRequest, "dept_id is required")
		return
	}
	users, err := h.DeptSync.ListDepartmentUsers(r.Context(), deptID, true)
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to load department users")
		return
	}
	writeJSON(w, http.StatusOK, users)
}
