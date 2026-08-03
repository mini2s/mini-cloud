package handler

import (
	"net/http"
	"strings"
)

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
