package config

import "testing"

func TestLoadReadsPostgresSSLMode(t *testing.T) {
	t.Setenv("POSTGRES_SSLMODE", "require")

	cfg := Load()

	if cfg.PostgresSSLMode != "require" {
		t.Fatalf("expected postgres sslmode require, got %q", cfg.PostgresSSLMode)
	}
}
