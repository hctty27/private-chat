package config

import (
	"reflect"
	"testing"
)

func TestLoadDefaultsGinProductionConfig(t *testing.T) {
	t.Setenv("GIN_MODE", "")
	t.Setenv("TRUSTED_PROXIES", "")

	cfg := Load()

	if cfg.GinMode != "release" {
		t.Fatalf("expected default gin mode release, got %q", cfg.GinMode)
	}
	if len(cfg.TrustedProxies) != 0 {
		t.Fatalf("expected no trusted proxies by default, got %#v", cfg.TrustedProxies)
	}
}

func TestLoadReadsGinProductionConfig(t *testing.T) {
	t.Setenv("GIN_MODE", "debug")
	t.Setenv("TRUSTED_PROXIES", "10.0.0.0/8, 172.16.0.0/12 ,192.168.0.0/16")

	cfg := Load()

	if cfg.GinMode != "debug" {
		t.Fatalf("expected gin mode debug, got %q", cfg.GinMode)
	}
	expected := []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"}
	if !reflect.DeepEqual(cfg.TrustedProxies, expected) {
		t.Fatalf("expected trusted proxies %#v, got %#v", expected, cfg.TrustedProxies)
	}
}

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
