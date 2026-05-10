package config

import "testing"

func TestLoadReadsPostgresSSLMode(t *testing.T) {
	t.Setenv("POSTGRES_SSLMODE", "require")

	cfg := Load()

	if cfg.PostgresSSLMode != "require" {
		t.Fatalf("expected postgres sslmode require, got %q", cfg.PostgresSSLMode)
	}
}

func TestLoadReadsR2StorageConfig(t *testing.T) {
	t.Setenv("R2_ENDPOINT", "https://account-id.r2.cloudflarestorage.com")
	t.Setenv("R2_ACCESS_KEY", "r2-access-key")
	t.Setenv("R2_SECRET_KEY", "r2-secret-key")
	t.Setenv("R2_BUCKET", "private-chat-r2")
	t.Setenv("R2_OBJECT_PREFIX", "private-chat")

	cfg := Load()

	if cfg.StorageEndpoint != "https://account-id.r2.cloudflarestorage.com" {
		t.Fatalf("expected R2 endpoint, got %q", cfg.StorageEndpoint)
	}
	if cfg.StorageAccessKey != "r2-access-key" {
		t.Fatalf("expected R2 access key, got %q", cfg.StorageAccessKey)
	}
	if cfg.StorageSecretKey != "r2-secret-key" {
		t.Fatalf("expected R2 secret key, got %q", cfg.StorageSecretKey)
	}
	if cfg.StorageBucket != "private-chat-r2" {
		t.Fatalf("expected R2 bucket, got %q", cfg.StorageBucket)
	}
	if cfg.ObjectStoragePrefix != "private-chat" {
		t.Fatalf("expected R2 object prefix, got %q", cfg.ObjectStoragePrefix)
	}
}
