package handler

import (
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"

	"github.com/multica-ai/multica/server/internal/gitea"
)

// GiteaProxyHandler reverse-proxies to the container-internal Gitea
// (GITEA_BASE_URL, e.g. http://gitea:3000) at root and injects reverse-proxy
// auth headers so Gitea auto-logs in the multica user. It is served on a
// dedicated listener (GITEA_PROXY_PORT, e.g. :8081) whose root namespace Gitea
// owns — Gitea's ROOTURL points at this port, so PR html_url values route
// through the proxy. The auth front-end is middleware.GiteaProxyAuth (JWT
// cookie, no CSRF — Gitea has its own CSRF).
//
// Per-request Director:
//   - derives the Gitea username from the caller's email
//     (gitea.MemberUsername, set as X-User-Email by GiteaProxyAuth);
//   - DELETES any client-supplied X-Forwarded-User/Email (anti-forgery: the
//     browser could otherwise impersonate any user) and the multica session
//     cookies, then injects our own identity headers.
//
// With Gitea [service] ENABLE_REVERSE_PROXY_AUTHENTICATION=true, a workspace
// member clicking a PR link from multica lands on the PR with no separate
// Gitea login — solving both the 404 (anonymous→private-repo) and the manual
// login. Mirrors 方式 1 (Reverse Proxy Authentication) from costrict-web's
// IDENTITY_FEDERATION_DECISION.md.
func GiteaProxyHandler() http.Handler {
	target, err := url.Parse(giteaBaseURL())
	if err != nil || target.Host == "" {
		// Gitea not configured — 503 so the listener still mounts cleanly.
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, `{"error":"gitea not configured"}`, http.StatusServiceUnavailable)
		})
	}

	rp := &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			// Capture the original host/scheme before rewriting for
			// X-Forwarded-Host/Proto (Gitea uses these in redirects).
			origHost := req.Host
			origProto := "http"
			if req.TLS != nil {
				origProto = "https"
			}

			req.URL.Scheme = target.Scheme
			req.URL.Host = target.Host
			req.Host = target.Host

			// Anti-forgery + hygiene: a browser could supply X-Forwarded-User
			// to impersonate anyone, and the multica session cookies are none
			// of Gitea's business. Drop them before injecting our identity.
			req.Header.Del("X-Forwarded-User")
			req.Header.Del("X-Forwarded-Email")
			req.Header.Del("X-Forwarded-Host")
			req.Header.Del("Cookie")

			email := req.Header.Get("X-User-Email")
			req.Header.Set("X-Forwarded-User", gitea.MemberUsername(email))
			if email != "" {
				req.Header.Set("X-Forwarded-Email", email)
			}
			req.Header.Set("X-Forwarded-Host", origHost)
			if existing := req.Header.Get("X-Forwarded-Proto"); existing == "" {
				req.Header.Set("X-Forwarded-Proto", origProto)
			}
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			slog.Warn("gitea proxy: upstream error", "path", r.URL.Path, "error", err)
			http.Error(w, `{"error":"gitea upstream unavailable"}`, http.StatusBadGateway)
		},
	}
	return rp
}
