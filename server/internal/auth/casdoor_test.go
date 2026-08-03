package auth

import (
	"crypto/rand"
	"crypto/rsa"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// signRS256 creates a signed RS256 JWT with the given kid header and claims.
// ParseCasdoorJWT no longer verifies the signature (the gateway does), but a
// well-formed RS256 token remains a realistic fixture.
func signRS256(t *testing.T, key *rsa.PrivateKey, kid string, claims jwt.MapClaims) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = kid
	signed, err := token.SignedString(key)
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return signed
}

func TestParseCasdoorJWT_ValidToken(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}

	claims := jwt.MapClaims{
		"sub":                "user-abc-123",
		"name":               "Ada Lovelace",
		"preferred_username": "ada",
		"email":              "ada@example.com",
		"phone":              "+1234567890",
		"exp":                time.Now().Add(1 * time.Hour).Unix(),
	}
	tokenStr := signRS256(t, key, "any-kid", claims)

	info, err := ParseCasdoorJWT(tokenStr)
	if err != nil {
		t.Fatalf("ParseCasdoorJWT: %v", err)
	}

	if info.SubjectID != "user-abc-123" {
		t.Errorf("SubjectID = %q, want %q", info.SubjectID, "user-abc-123")
	}
	if info.Name != "Ada Lovelace" {
		t.Errorf("Name = %q, want %q", info.Name, "Ada Lovelace")
	}
	if info.PreferredUsername != "ada" {
		t.Errorf("PreferredUsername = %q, want %q", info.PreferredUsername, "ada")
	}
	if info.Email != "ada@example.com" {
		t.Errorf("Email = %q, want %q", info.Email, "ada@example.com")
	}
	if info.Phone != "+1234567890" {
		t.Errorf("Phone = %q, want %q", info.Phone, "+1234567890")
	}
}

func TestParseCasdoorJWT_ExpiredToken(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}

	claims := jwt.MapClaims{
		"sub":   "user-abc-123",
		"name":  "Ada Lovelace",
		"email": "ada@example.com",
		"exp":   time.Now().Add(-1 * time.Hour).Unix(), // expired
	}
	tokenStr := signRS256(t, key, "any-kid", claims)

	_, err = ParseCasdoorJWT(tokenStr)
	if err == nil {
		t.Fatal("expected error for expired token, got nil")
	}
}

// TestParseCasdoorJWT_NoSignatureVerification pins the trust-the-gateway
// behavior: a token signed with an arbitrary key (no JWKS configured anywhere)
// still parses successfully — signature validation is delegated upstream.
func TestParseCasdoorJWT_NoSignatureVerification(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	tokenStr := signRS256(t, key, "unknown-kid", jwt.MapClaims{
		"sub": "user-no-verify",
		"exp": time.Now().Add(time.Hour).Unix(),
	})

	info, err := ParseCasdoorJWT(tokenStr)
	if err != nil {
		t.Fatalf("expected trust-parse to succeed without signature verification: %v", err)
	}
	if info.SubjectID != "user-no-verify" {
		t.Errorf("SubjectID = %q, want %q", info.SubjectID, "user-no-verify")
	}
}
