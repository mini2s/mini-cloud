package middleware

import (
	"log/slog"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
	"github.com/multica-ai/multica/server/internal/auth"
)

// GiteaProxyAuth authenticates the browser user for the /gitea/* reverse
// proxy (RP-Auth pass-through to Gitea). It is the same JWT validation as
// Auth, but WITHOUT the CSRF requirement: Gitea's own UI POSTs carry Gitea's
// CSRF token, not multica's, so enforcing multica CSRF here would 403 every
// interactive Gitea action. Gitea's [service]
// ENABLE_REVERSE_PROXY_AUTHENTICATION then trusts the X-Forwarded-User header
// the proxy injects (see handler.GiteaProxyHandler).
//
// Accepts the multica_auth cookie JWT or an Authorization: Bearer JWT, and
// sets X-User-ID + X-User-Email so the proxy can derive the Gitea username
// (gitea.MemberUsername of the email). Mirrors 方式 1 (Reverse Proxy
// Authentication) from costrict-web's IDENTITY_FEDERATION_DECISION.md.
func GiteaProxyAuth() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// CasdoorAuth (if stacked) may have already set X-User-ID.
			if r.Header.Get("X-User-ID") != "" {
				next.ServeHTTP(w, r)
				return
			}

			tokenString, _ := extractToken(r)
			if tokenString == "" {
				http.Error(w, `{"error":"missing authorization"}`, http.StatusUnauthorized)
				return
			}

			token, err := jwt.Parse(tokenString, func(token *jwt.Token) (any, error) {
				if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
					return nil, jwt.ErrSignatureInvalid
				}
				return auth.JWTSecret(), nil
			})
			if err != nil || !token.Valid {
				slog.Warn("gitea proxy auth: invalid token", "path", r.URL.Path, "error", err)
				http.Error(w, `{"error":"invalid token"}`, http.StatusUnauthorized)
				return
			}

			claims, ok := token.Claims.(jwt.MapClaims)
			if !ok {
				http.Error(w, `{"error":"invalid claims"}`, http.StatusUnauthorized)
				return
			}
			sub, ok := claims["sub"].(string)
			if !ok || strings.TrimSpace(sub) == "" {
				http.Error(w, `{"error":"invalid claims"}`, http.StatusUnauthorized)
				return
			}
			r.Header.Set("X-User-ID", sub)
			if email, ok := claims["email"].(string); ok {
				r.Header.Set("X-User-Email", email)
			}
			next.ServeHTTP(w, r)
		})
	}
}
