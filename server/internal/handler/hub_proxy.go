package handler

import (
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
)

// Hub proxy: forwards Hub (capability store) API requests from the frontend to
// the shared cloud capability backend (BuiltinPluginAPIBaseURL). The frontend
// calls /api/items, /api/distributions, /api/repositories, etc. — none of which
// are implemented natively by this server. They live in the cloud-store backend
// served at <BuiltinPluginAPIBaseURL>/api/... (the base URL already includes the
// /cloud-api gateway prefix, e.g. https://zgsmtest.cn:30443/cloud-api).
//
// The proxy is a transparent reverse proxy: it forwards the original method,
// path (relative to /api), query string, body, and the caller's Cookie header
// so the cloud-store backend authenticates the request against the same browser
// session. Non-hub paths are unaffected.

// hubProxyPaths are /api/* subtrees owned by the cloud-store backend. Each entry
// is a path prefix (no leading wildcard) that should be proxied.
var hubProxyPaths = []string{
	"/api/items",
	"/api/distributions",
	"/api/repositories",
	"/api/registries",
	"/api/categories",
	"/api/tags",
	"/api/marketplace",
	"/api/enterprise-customers",
	"/api/users/search",
	"/api/users/names",
	"/api/users/info",
	"/api/plugins/upload",
	"/api/plugins/builtin",
	"/api/admin/items",
	"/api/admin/distributions",
	"/api/admin/enterprise-customers",
	"/api/admin/import-jobs",
	"/api/admin/import-stats",
	"/api/admin/notification-channels",
	"/api/admin/settings",
	"/api/admin/audit-logs",
	"/api/admin/announcements",
	"/api/admin/system-roles",
	"/api/admin/resource-permissions",
	"/api/admin/permission-grants",
	// Notification channels (user two-way channels) + identity binding — same
	// cloud-store backend, same session auth. Powers the "通知渠道" and identity
	// (身份绑定) pages.
	"/api/channels",
	"/api/auth/identities",
	"/api/auth/bind/start",
	"/api/auth/bind/confirm-merge",
	"/api/auth/bind/cancel-merge",
}

// IsHubProxyPath reports whether the given request path should be handled by the
// Hub cloud-store proxy. Used by the router to mount the proxy only on relevant
// routes and skip it for paths this server implements natively.
func IsHubProxyPath(path string) bool {
	// Native catalog routes (ListCatalogSkills/Plugins, GetPlugin) are served by
	// this server's own handlers — never proxy them even though they start with
	// /api/plugins or /api/catalog.
	if strings.HasPrefix(path, "/api/catalog/") {
		return false
	}
	if path == "/api/plugins/builtin" || strings.HasPrefix(path, "/api/plugins/") {
		// /api/plugins/{id} and /api/plugins/builtin are native; only
		// /api/plugins/upload (a cloud-store-only route) is proxied.
		return path == "/api/plugins/upload"
	}
	for _, prefix := range hubProxyPaths {
		if path == prefix || strings.HasPrefix(path, prefix+"/") {
			return true
		}
	}
	return false
}

// HubProxy returns a reverse-proxy handler that forwards Hub API requests to
// the cloud capability backend. Returns nil when the backend is unconfigured,
// in which case callers should return 503 themselves.
func (h *Handler) HubProxy() http.HandlerFunc {
	target := h.cfg.BuiltinPluginAPIBaseURL
	if target == "" {
		return nil
	}
	targetURL, err := url.Parse(strings.TrimRight(target, "/"))
	if err != nil {
		slog.Warn("hub-proxy: invalid BuiltinPluginAPIBaseURL, disabling proxy", "url", target, "error", err)
		return nil
	}

	// Dev-only: the cloud-store backend uses a separate Casdoor session. In dev
	// the mini-cloud session is not recognized upstream, so HUB_DEV_TOKEN lets
	// the operator inject a valid cloud-store JWT (the zgsmAdminToken cookie
	// value) so authenticated hub operations work locally. Leave empty in prod
	// where the two systems share a session domain.
	devToken := strings.TrimSpace(os.Getenv("HUB_DEV_TOKEN"))

	proxy := &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			// The frontend sends /api/items. The cloud-store backend is behind a
			// /cloud-api gateway prefix on production, so the upstream path is
			// <base>/api/items (base = https://host/cloud-api, path kept as-is).
			// BuiltinPluginAPIBaseURL already includes the gateway prefix, so we
			// just prepend it to the original path without modification.
			req.URL.Scheme = targetURL.Scheme
			req.URL.Host = targetURL.Host
			req.URL.Path = strings.TrimRight(targetURL.Path, "/") + req.URL.Path
			req.Host = targetURL.Host
			// Inject the dev token so the upstream sees an authenticated request.
			// The cloud-store backend authenticates via the zgsmAdminToken cookie,
			// so we send it both as a cookie and as a Bearer header for max compat.
			if devToken != "" {
				req.Header.Set("Cookie", "zgsmAdminToken="+devToken)
				if req.Header.Get("Authorization") == "" {
					req.Header.Set("Authorization", "Bearer "+devToken)
				}
			}
		},
		// Strip upstream CORS headers — the cloud-store backend sets its own
		// Access-Control-Allow-* headers, which would duplicate the ones this
		// server's CORS middleware already adds. Browsers reject responses with
		// duplicate Access-Control-Allow-Origin values, so drop them here and let
		// the local CORS middleware own the header.
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
			slog.Warn("hub-proxy: upstream request failed",
				"path", r.URL.Path, "host", targetURL.Host, "error", err)
			writeError(w, http.StatusBadGateway, "capability store unavailable")
		},
	}
	return proxy.ServeHTTP
}
