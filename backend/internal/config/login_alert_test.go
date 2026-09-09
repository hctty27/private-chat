package config

import "testing"

func TestValidateLoginAlertDisabledByDefault(t *testing.T) {
	cfg := Config{JWTSecret: "12345678901234567890123456789012"}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected disabled login alert to validate: %v", err)
	}
}

func TestValidateLoginAlertRequiresResendSettings(t *testing.T) {
	cfg := Config{
		JWTSecret:         "12345678901234567890123456789012",
		LoginAlertUserIDs: []string{"2"},
	}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected missing Resend configuration to fail validation")
	}

	cfg.ResendAPIKey = "re_test"
	cfg.ResendFrom = "Private Chat <login@example.com>"
	cfg.LoginAlertEmail = "owner@example.com"
	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected complete login alert config to validate: %v", err)
	}
}

func TestValidateLoginAlertRejectsInvalidUserID(t *testing.T) {
	cfg := Config{
		JWTSecret:         "12345678901234567890123456789012",
		LoginAlertUserIDs: []string{"abc"},
		ResendAPIKey:      "re_test",
		ResendFrom:        "Private Chat <login@example.com>",
		LoginAlertEmail:   "owner@example.com",
	}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected invalid login alert user ID to fail validation")
	}
}
