package handler

import (
	"crypto/tls"
	"encoding/base64"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
)

// Kanban proxy: forwards efficiency-dashboard (kanban) API requests from the
// frontend to the separately deployed kanban backend (KanbanAPIBaseURL). The
// frontend calls /kanban/api/v2/* (hardcoded BASE in
// packages/core/efficiency/api.ts) — ~85 endpoints covering dashboard summary,
// dept-tree, needs, users, repos, projects, tasks, chat stats, pricing,
// datasources, sync tasks, etc. None of these are implemented natively by this
// server; they live in the kanban backend served at <KanbanAPIBaseURL>.
//
// The kanban backend authenticates via HTTP Basic Auth. In local dev the
// mini-cloud session is meaningless upstream, so KANBAN_API_USERNAME +
// KANBAN_API_PASSWORD let the operator inject valid credentials — the proxy
// synthesizes the Authorization header server-side, so the password never
// reaches the browser bundle. This bypasses the old project's manual
// login-again flow entirely.
//
// The proxy is a transparent reverse proxy: it forwards the original method,
// path (unmodified — upstream expects the same /kanban/api/v2/... path),
// query string, and body. This mirrors the quota-manager / Hub proxy pattern.

// KanbanProxy returns a reverse-proxy handler that forwards efficiency-dashboard
// API requests to the kanban backend with Basic Auth injected. Returns nil when
// the backend is unconfigured, in which case callers should return 503 themselves.
func (h *Handler) KanbanProxy() http.HandlerFunc {
	target := h.cfg.KanbanAPIBaseURL
	if target == "" {
		return nil
	}
	targetURL, err := url.Parse(strings.TrimRight(target, "/"))
	if err != nil {
		slog.Warn("kanban-proxy: invalid KanbanAPIBaseURL, disabling proxy", "url", target, "error", err)
		return nil
	}

	// Dev-only Basic Auth credentials. The kanban backend accepts HTTP Basic
	// Auth directly (verified against the live endpoint). Both must be set;
	// when either is empty the proxy still forwards requests but they will
	// return 401 upstream.
	username := strings.TrimSpace(os.Getenv("KANBAN_API_USERNAME"))
	password := os.Getenv("KANBAN_API_PASSWORD")
	var basicAuth string
	if username != "" {
		basicAuth = "Basic " + base64.StdEncoding.EncodeToString([]byte(username+":"+password))
	}

	proxy := &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			// The frontend sends /kanban/api/v2/dashboard/summary. The kanban
			// backend expects exactly that path (verified against the live
			// endpoint), so no prefix stripping or rewriting — forward verbatim.
			req.URL.Scheme = targetURL.Scheme
			req.URL.Host = targetURL.Host
			req.URL.Path = req.URL.Path
			req.Host = targetURL.Host
			// Inject Basic Auth so the upstream sees an authenticated request.
			if basicAuth != "" {
				req.Header.Set("Authorization", basicAuth)
			}
			// The browser's own Authorization header (if any) is meaningless to
			// the kanban backend and could shadow the injected Basic Auth.
			// Setting above overwrites, so nothing more to do.
		},
		// The kanban backend is https; the shared session infra may use a
		// private CA in some environments. Match the caller's existing tolerance
		// for self-signed certs during dev (mirrors how other dev proxies behave).
		// This only affects outbound proxy→upstream, never the browser connection.
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
		// Strip upstream CORS headers — the kanban backend sets its own
		// Access-Control-Allow-* headers, which would duplicate the ones this
		// server's CORS middleware already adds. Browsers reject responses with
		// duplicate Access-Control-Allow-Origin values, so drop them here and
		// let the local CORS middleware own the header.
		ModifyResponse: func(resp *http.Response) error {
			resp.Header.Del("Access-Control-Allow-Origin")
			resp.Header.Del("Access-Control-Allow-Credentials")
			resp.Header.Del("Access-Control-Allow-Methods")
			resp.Header.Del("Access-Control-Allow-Headers")
			resp.Header.Del("Access-Control-Expose-Headers")
			resp.Header.Del("Access-Control-Max-Age")
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			slog.Warn("kanban-proxy: upstream request failed",
				"path", r.URL.Path, "host", targetURL.Host, "error", err)
			writeError(w, http.StatusBadGateway, "kanban service unavailable")
		},
	}
	return proxy.ServeHTTP
}
