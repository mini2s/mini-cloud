package middleware

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"

	"github.com/multica-ai/multica/server/internal/auth"
)

// CasdoorCookieName is the cookie name Casdoor sets for the admin session.
// The middleware reads the RS256 JWT from this cookie, falling back to the
// Authorization: Bearer header for API clients.
const CasdoorCookieName = "zgsmAdminToken"

// SubjectResolver maps a Casdoor subject ID (the "sub" claim from the JWT)
// to a Multica user UUID. It is called after the JWT has been validated.
// Implementations typically look up the user in the database by subject_id.
// name and email are extracted from the Casdoor JWT claims; they are used
// for auto-provisioning and updating the user's profile.
type SubjectResolver func(ctx context.Context, subjectID, universalID, name, email string) (userID string, err error)

// CloudSubjectTranslator optionally translates a Casdoor access token into the
// cloud-api stable subject id (e.g. "usr_...") that Multica users are keyed by.
// A raw Casdoor JWT's "sub" is the Casdoor user id, not the cloud subject id
// the account was provisioned under. When the translator is nil, or when
// ResolveSubjectID errors, the middleware falls back to the raw JWT "sub".
type CloudSubjectTranslator interface {
	ResolveSubjectID(ctx context.Context, universalID, accessToken string) (string, error)
}

// CasdoorAuth returns Chi middleware that parses a Casdoor-issued JWT (its
// RS256 signature is verified upstream by the gateway) and resolves the
// Casdoor subject to a Multica user.
//
// Token sources (in priority order):
//  1. zgsmAdminToken cookie (Casdoor session)
//  2. Authorization: Bearer <token> header (API clients)
//
// Personal Access Tokens (Bearer tokens starting with "mul_") are passed
// through unchanged — the downstream Auth middleware handles them.
//
// On success the middleware sets:
//   - X-User-ID:    the Multica user UUID returned by the resolver
//   - X-Subject-ID: the raw Casdoor subject ID from the JWT "sub" claim
//
// On failure it responds with 401 and a JSON error body.
func CasdoorAuth(resolver SubjectResolver, cloudTrans CloudSubjectTranslator) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := extractCasdoorToken(r)
			if token == "" {
				// No Casdoor token present — fall through to the standard
				// Auth middleware, which handles multica_auth cookies (set by
				// the Casdoor OAuth callback) and legacy Bearer tokens.
				next.ServeHTTP(w, r)
				return
			}

			// PAT tokens are handled by the existing Auth middleware;
			// this middleware only validates Casdoor RS256 JWTs.
			if strings.HasPrefix(token, "mul_") {
				next.ServeHTTP(w, r)
				return
			}

			userInfo, err := auth.ParseCasdoorJWT(token)
			if err != nil {
				slog.Debug("casdoor auth: invalid JWT", "path", r.URL.Path, "error", err)
				writeUnauthorized(w, "invalid token")
				return
			}

			// Translate the Casdoor token to the cloud-api stable subject id
			// (e.g. "usr_...") that Multica users are keyed by. Fall back to the
			// JWT "sub" when the translator is unavailable or fails, preserving
			// prior behavior when cloud-api is not configured.
			subjectID := userInfo.SubjectID
			if cloudTrans != nil {
				if sid, terr := cloudTrans.ResolveSubjectID(r.Context(), userInfo.UniversalID, token); terr != nil {
					// Warn, not Debug: the fallback provisions users under the
					// raw Casdoor sub, which splits one person into multiple
					// accounts. Silent at Debug this was invisible in production.
					slog.Warn("casdoor auth: cloud subject translation failed, using JWT sub",
						"path", r.URL.Path, "error", terr)
				} else if sid != "" {
					subjectID = sid
				}
			}

			multicaUserID, err := resolver(r.Context(), subjectID, userInfo.UniversalID, userInfo.Name, userInfo.Email)
			if err != nil {
				slog.Warn("casdoor auth: subject resolution failed",
					"path", r.URL.Path,
					"subject", subjectID,
					"error", err,
				)
				writeUnauthorized(w, "unknown user")
				return
			}

			r.Header.Set("X-User-ID", multicaUserID)
			r.Header.Set("X-Subject-ID", subjectID)

			next.ServeHTTP(w, r)
		})
	}
}

// extractCasdoorToken reads the Casdoor session token from the request.
// Priority: zgsmAdminToken cookie > Authorization: Bearer header.
func extractCasdoorToken(r *http.Request) string {
	// Cookie takes priority — this is the standard Casdoor session path.
	if cookie, err := r.Cookie(CasdoorCookieName); err == nil && cookie.Value != "" {
		return cookie.Value
	}

	// Fall back to Bearer header for API clients.
	if authHeader := r.Header.Get("Authorization"); authHeader != "" {
		token := strings.TrimPrefix(authHeader, "Bearer ")
		if token != authHeader {
			return token
		}
	}

	return ""
}

// writeUnauthorized sends a 401 response with a JSON error body.
func writeUnauthorized(w http.ResponseWriter, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}
