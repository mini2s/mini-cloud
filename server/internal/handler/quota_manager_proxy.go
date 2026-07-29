package handler

import (
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
)

// Quota-manager proxy: forwards personal-quota (usage statistics) API requests
// from the frontend to the shared quota-manager service (QuotaManagerAPIBaseURL).
// The frontend calls /api/quota-manager/api/v1/quota and
// /api/quota-manager/api/v1/usage/statistics — none of which are implemented
// natively by this server. They live in the quota-manager backend served at
// <QuotaManagerAPIBaseURL>/quota-manager/api/v1/... (the base URL already
// includes the /cloud-api gateway prefix, e.g. https://zgsmtest.cn:30443/cloud-api).
//
// The proxy is a transparent reverse proxy: it forwards the original method,
// path (relative to /api/quota-manager), query string, body, and the caller's
// Cookie header so the quota-manager backend authenticates the request against
// the same browser session. This mirrors the Hub (capability store) proxy.

// QuotaManagerProxy returns a reverse-proxy handler that forwards personal-quota
// API requests to the quota-manager backend. Returns nil when the backend is
// unconfigured, in which case callers should return 503 themselves.
func (h *Handler) QuotaManagerProxy() http.HandlerFunc {
	target := h.cfg.QuotaManagerAPIBaseURL
	if target == "" {
		return nil
	}
	targetURL, err := url.Parse(strings.TrimRight(target, "/"))
	if err != nil {
		slog.Warn("quota-manager-proxy: invalid QuotaManagerAPIBaseURL, disabling proxy", "url", target, "error", err)
		return nil
	}

	// Dev-only: the quota-manager backend uses a separate Casdoor session. In
	// dev the mini-cloud session is not recognized upstream, so HUB_DEV_TOKEN
	// lets the operator inject a valid JWT (the zgsmAdminToken cookie value)
	// so authenticated quota operations work locally. Leave empty in prod where
	// the two systems share a session domain.
	devToken := strings.TrimSpace(os.Getenv("HUB_DEV_TOKEN"))

	proxy := &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			// The frontend sends /api/quota-manager/api/v1/quota. The
			// quota-manager backend is behind a /cloud-api gateway prefix on
			// production. QuotaManagerAPIBaseURL already includes the gateway
			// prefix (e.g. https://host/cloud-api), so we prepend it to the
			// original path. The leading /api/quota-manager segment is local
			// routing only — the upstream expects /quota-manager/api/v1/...
			// — so strip the /api prefix before forwarding.
			upstreamPath := req.URL.Path
			if strings.HasPrefix(upstreamPath, "/api/") {
				upstreamPath = strings.TrimPrefix(upstreamPath, "/api")
			}
			req.URL.Scheme = targetURL.Scheme
			req.URL.Host = targetURL.Host
			req.URL.Path = strings.TrimRight(targetURL.Path, "/") + upstreamPath
			req.Host = targetURL.Host
			// Inject the dev token so the upstream sees an authenticated request.
			// The quota-manager backend authenticates via the zgsmAdminToken
			// cookie, so we send it both as a cookie and as a Bearer header for
			// max compat.
			if devToken != "" {
				req.Header.Set("Cookie", "zgsmAdminToken="+devToken)
				if req.Header.Get("Authorization") == "" {
					req.Header.Set("Authorization", "Bearer "+devToken)
				}
			}
		},
		// Strip upstream CORS headers — the quota-manager backend sets its own
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
			slog.Warn("quota-manager-proxy: upstream request failed",
				"path", r.URL.Path, "host", targetURL.Host, "error", err)
			writeError(w, http.StatusBadGateway, "quota service unavailable")
		},
	}
	return proxy.ServeHTTP
}
