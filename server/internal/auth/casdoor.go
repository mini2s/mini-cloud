package auth

import (
	"crypto/subtle"
	"fmt"
	"os"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

const (
	// devCasdoorTokenEnv holds a fixed opaque token that stands in for a real
	// Casdoor-issued JWT during local development. When set (and APP_ENV is not
	// production), a request whose Bearer token equals this value authenticates
	// as the dev subject below — without any JWKS round-trip to costrict-web.
	devCasdoorTokenEnv = "MULTICA_DEV_CASDOOR_TOKEN"
	// devCasdoorSubjectEnv overrides the synthetic subject ID the dev token maps
	// to. Defaults to defaultDevCasdoorSubject. The SubjectResolver
	// auto-provisions a Multica user for this subject on first use.
	devCasdoorSubjectEnv = "MULTICA_DEV_CASDOOR_SUBJECT"

	defaultDevCasdoorSubject = "dev-local"
)

// DevCasdoorBypass returns synthetic user info when local-dev token bypass is
// active and the supplied token matches the configured value. It returns nil
// in every other case, so callers fall through to real JWKS validation.
//
// The bypass exists so a developer can drive a local client against a local
// backend whose Casdoor (costrict-web) JWKS endpoint is unreachable. It is
// gated on APP_ENV != production and on MULTICA_DEV_CASDOOR_TOKEN being set,
// mirroring the MULTICA_DEV_VERIFICATION_CODE bypass for the email-code flow.
func DevCasdoorBypass(token string) *CasdoorUserInfo {
	if isProductionEnv() {
		return nil
	}
	want := strings.TrimSpace(os.Getenv(devCasdoorTokenEnv))
	if want == "" {
		return nil
	}
	// Constant-time compare to avoid leaking the dev token via timing.
	if subtle.ConstantTimeCompare([]byte(token), []byte(want)) != 1 {
		return nil
	}

	subject := strings.TrimSpace(os.Getenv(devCasdoorSubjectEnv))
	if subject == "" {
		subject = defaultDevCasdoorSubject
	}
	return &CasdoorUserInfo{
		SubjectID: subject,
		Name:      "Local Dev",
		Email:     subject + "@dev.local",
	}
}

// isProductionEnv reports whether APP_ENV is "production" (case-insensitive).
func isProductionEnv() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("APP_ENV")), "production")
}

// CasdoorUserInfo holds identity claims extracted from a Casdoor-issued JWT.
type CasdoorUserInfo struct {
	SubjectID         string // from "sub" (required)
	Name              string // from "name"
	PreferredUsername string // from "preferred_username"
	Email             string // from "email"
	Phone             string // from "phone"
}

// ParseCasdoorJWT validates an RS256 JWT signed by Casdoor and extracts user
// claims. jwks provides the public keys used for signature verification.
//
// The parser is intentionally strict:
//   - Only RS256 is accepted (prevents algorithm-confusion attacks).
//   - The token must carry an "exp" claim.
//   - The header must include a "kid" that resolves via jwks.
//   - "sub" must be present and non-empty.
func ParseCasdoorJWT(tokenString string, jwks *JWKSProvider) (*CasdoorUserInfo, error) {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (any, error) {
		kid, _ := token.Header["kid"].(string)
		if kid == "" {
			return nil, fmt.Errorf("token header missing kid")
		}
		return jwks.GetKey(kid)
	},
		jwt.WithValidMethods([]string{"RS256"}),
		jwt.WithExpirationRequired(),
	)
	if err != nil {
		return nil, fmt.Errorf("parse JWT: %w", err)
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token claims")
	}

	sub, _ := claims["sub"].(string)
	if strings.TrimSpace(sub) == "" {
		return nil, fmt.Errorf("missing or empty sub claim")
	}

	return &CasdoorUserInfo{
		SubjectID:         sub,
		Name:              stringClaim(claims, "name"),
		PreferredUsername: stringClaim(claims, "preferred_username"),
		Email:             stringClaim(claims, "email"),
		Phone:             stringClaim(claims, "phone"),
	}, nil
}

// stringClaim returns a claim as a string, or "" if absent / wrong type.
func stringClaim(claims jwt.MapClaims, key string) string {
	v, _ := claims[key].(string)
	return v
}
