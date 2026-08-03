package auth

import (
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// CasdoorUserInfo holds identity claims extracted from a Casdoor-issued JWT.
type CasdoorUserInfo struct {
	SubjectID         string // from "sub" (required)
	UniversalID       string // from "universal_id"
	Name              string // from "name"
	PreferredUsername string // from "preferred_username"
	Email             string // from "email"
	Phone             string // from "phone"
}

// ParseCasdoorJWT parses a Casdoor-issued JWT and extracts user claims.
//
// The RS256 signature is NOT verified here — Multica sits behind a gateway
// that has already validated the token's signature before forwarding it.
// We only decode the claims and enforce an "exp" sanity floor so a token
// past its lifetime cannot be replayed against the backend.
//
//   - "exp" must be present and not expired.
//   - "sub" must be present and non-empty.
func ParseCasdoorJWT(tokenString string) (*CasdoorUserInfo, error) {
	token, _, err := jwt.NewParser().ParseUnverified(tokenString, jwt.MapClaims{})
	if err != nil {
		return nil, fmt.Errorf("parse JWT: %w", err)
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return nil, fmt.Errorf("invalid token claims")
	}

	// exp sanity floor — signature verification is delegated to the gateway,
	// but we still refuse tokens that are missing exp or already past it.
	exp, err := claims.GetExpirationTime()
	if err != nil {
		return nil, fmt.Errorf("invalid exp claim: %w", err)
	}
	if exp == nil {
		return nil, fmt.Errorf("token missing exp claim")
	}
	if !exp.After(time.Now()) {
		return nil, fmt.Errorf("token is expired")
	}

	sub, _ := claims["sub"].(string)
	if strings.TrimSpace(sub) == "" {
		return nil, fmt.Errorf("missing or empty sub claim")
	}

	return &CasdoorUserInfo{
		SubjectID:         sub,
		UniversalID:       stringClaim(claims, "universal_id"),
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
