package auth

import (
	"testing"
	"time"

	"privatechat/internal/model"

	"github.com/golang-jwt/jwt/v5"
)

func TestParseAcceptsHS256Token(t *testing.T) {
	manager := NewJWTManager("0123456789abcdef0123456789abcdef", time.Hour)
	token, err := manager.Generate(42, "tester")
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}

	userID, nickname, err := manager.Parse(token)
	if err != nil {
		t.Fatalf("parse token: %v", err)
	}
	if userID != 42 {
		t.Fatalf("expected user ID 42, got %d", userID)
	}
	if nickname != "tester" {
		t.Fatalf("expected nickname tester, got %q", nickname)
	}
}

func TestParseRejectsOtherHMACAlgorithms(t *testing.T) {
	secret := "0123456789abcdef0123456789abcdef"
	manager := NewJWTManager(secret, time.Hour)
	now := time.Now()
	claims := model.JWTClaims{
		Nickname: "tester",
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "42",
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS384, claims)
	signed, err := token.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}

	if _, _, err := manager.Parse(signed); err == nil {
		t.Fatal("expected HS384 token to be rejected")
	}
}
