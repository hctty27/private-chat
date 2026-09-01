package config

import (
	"reflect"
	"strings"
	"testing"
	"time"
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

func TestLoadReadsAllowedWebSocketOrigins(t *testing.T) {
	t.Setenv("WS_ALLOWED_ORIGINS", "https://chat.example.com, https://admin.example.com ")

	cfg := Load()

	expected := []string{"https://chat.example.com", "https://admin.example.com"}
	if !reflect.DeepEqual(cfg.AllowedOrigins, expected) {
		t.Fatalf("expected allowed origins %#v, got %#v", expected, cfg.AllowedOrigins)
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

func TestLoadDoesNotProvideSecretDefaults(t *testing.T) {
	t.Setenv("JWT_SECRET", "")
	t.Setenv("REDIS_PASSWORD", "")

	cfg := Load()

	if cfg.JWTSecret != "" {
		t.Fatal("expected JWT secret to have no built-in default")
	}
	if cfg.RedisPassword != "" {
		t.Fatal("expected Redis password to have no built-in default")
	}
}

func TestValidateRejectsMissingJWTSecret(t *testing.T) {
	cfg := Config{}

	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "JWT_SECRET") {
		t.Fatalf("expected JWT_SECRET validation error, got %v", err)
	}
}

func TestValidateRejectsShortJWTSecret(t *testing.T) {
	cfg := Config{JWTSecret: "too-short"}

	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "32") {
		t.Fatalf("expected minimum length validation error, got %v", err)
	}
}

func TestValidateAcceptsStrongJWTSecret(t *testing.T) {
	cfg := Config{JWTSecret: "0123456789abcdef0123456789abcdef"}

	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected configuration to be valid, got %v", err)
	}
}

func validWebRTCTestConfig() Config {
	return Config{JWTSecret: "this-is-a-valid-test-secret-with-32-characters"}
}

func TestConfigValidateAcceptsDisabledWebRTCWithoutTurn(t *testing.T) {
	cfg := validWebRTCTestConfig()
	cfg.WebRTCEnabled = false
	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected disabled WebRTC to validate: %v", err)
	}
}

func TestConfigValidateAcceptsAllIcePolicy(t *testing.T) {
	cfg := validWebRTCTestConfig()
	cfg.WebRTCEnabled = true
	cfg.WebRTCICEPolicy = "all"
	cfg.WebRTCStunURL = "stun:turn.example.com:3478"
	cfg.WebRTCTurnURLs = []string{"turn:turn.example.com:3478?transport=udp"}
	cfg.WebRTCTurnSecret = "shared-secret"
	cfg.WebRTCTurnCredentialTTL = 10 * time.Minute
	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected config to validate: %v", err)
	}
}

func TestConfigValidateAcceptsRelayIcePolicy(t *testing.T) {
	cfg := validWebRTCTestConfig()
	cfg.WebRTCEnabled = true
	cfg.WebRTCICEPolicy = "relay"
	cfg.WebRTCTurnURLs = []string{"turn:turn.example.com:3478?transport=udp"}
	cfg.WebRTCTurnSecret = "shared-secret"
	cfg.WebRTCTurnCredentialTTL = 10 * time.Minute
	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected relay config to validate: %v", err)
	}
}

func TestConfigValidateRejectsUnknownIcePolicy(t *testing.T) {
	cfg := validWebRTCTestConfig()
	cfg.WebRTCEnabled = true
	cfg.WebRTCICEPolicy = "unknown"
	cfg.WebRTCTurnURLs = []string{"turn:turn.example.com:3478"}
	cfg.WebRTCTurnSecret = "shared-secret"
	cfg.WebRTCTurnCredentialTTL = 10 * time.Minute
	if err := cfg.Validate(); err == nil || !strings.Contains(err.Error(), "WEBRTC_ICE_POLICY") {
		t.Fatalf("expected policy validation error, got %v", err)
	}
}

func TestConfigValidateRequiresTurnWhenEnabled(t *testing.T) {
	cfg := validWebRTCTestConfig()
	cfg.WebRTCEnabled = true
	cfg.WebRTCICEPolicy = "relay"
	cfg.WebRTCTurnCredentialTTL = 10 * time.Minute
	if err := cfg.Validate(); err == nil || !strings.Contains(err.Error(), "WEBRTC_TURN_URLS") {
		t.Fatalf("expected TURN URL validation error, got %v", err)
	}

	cfg.WebRTCTurnURLs = []string{"turn:turn.example.com:3478"}
	if err := cfg.Validate(); err == nil || !strings.Contains(err.Error(), "WEBRTC_TURN_SECRET") {
		t.Fatalf("expected TURN secret validation error, got %v", err)
	}
}

func TestConfigLoadUsesWebRTCDefaults(t *testing.T) {
	t.Setenv("WEBRTC_ENABLED", "")
	t.Setenv("WEBRTC_ICE_POLICY", "")
	t.Setenv("WEBRTC_TURN_CREDENTIAL_TTL", "")
	cfg := Load()
	if cfg.WebRTCEnabled {
		t.Fatal("expected WebRTC disabled by default")
	}
	if cfg.WebRTCICEPolicy != "all" {
		t.Fatalf("expected all policy, got %q", cfg.WebRTCICEPolicy)
	}
	if cfg.WebRTCTurnCredentialTTL != 10*time.Minute {
		t.Fatalf("expected 10m credential TTL, got %v", cfg.WebRTCTurnCredentialTTL)
	}
}

func TestConfigLoadUsesCloudflareTurnDefaults(t *testing.T) {
	t.Setenv("WEBRTC_TURN_PROVIDER", "")
	t.Setenv("CLOUDFLARE_TURN_KEY_ID", "")
	t.Setenv("CLOUDFLARE_TURN_API_TOKEN", "")

	cfg := Load()

	if cfg.WebRTCTurnProvider != "cloudflare" {
		t.Fatalf("expected cloudflare TURN provider by default, got %q", cfg.WebRTCTurnProvider)
	}
}

func TestConfigValidateAcceptsCloudflareTurn(t *testing.T) {
	cfg := validWebRTCTestConfig()
	cfg.WebRTCEnabled = true
	cfg.WebRTCICEPolicy = "all"
	cfg.WebRTCTurnProvider = "cloudflare"
	cfg.CloudflareTurnKeyID = "0123456789abcdef0123456789abcdef"
	cfg.CloudflareTurnAPIToken = "server-only-token"
	cfg.WebRTCTurnCredentialTTL = 10 * time.Minute

	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected Cloudflare TURN config to validate: %v", err)
	}
}

func TestConfigValidateRequiresCloudflareTurnCredentials(t *testing.T) {
	cfg := validWebRTCTestConfig()
	cfg.WebRTCEnabled = true
	cfg.WebRTCICEPolicy = "all"
	cfg.WebRTCTurnProvider = "cloudflare"
	cfg.WebRTCTurnCredentialTTL = 10 * time.Minute

	if err := cfg.Validate(); err == nil || !strings.Contains(err.Error(), "CLOUDFLARE_TURN_KEY_ID") {
		t.Fatalf("expected Cloudflare TURN key validation error, got %v", err)
	}

	cfg.CloudflareTurnKeyID = "0123456789abcdef0123456789abcdef"
	if err := cfg.Validate(); err == nil || !strings.Contains(err.Error(), "CLOUDFLARE_TURN_API_TOKEN") {
		t.Fatalf("expected Cloudflare TURN token validation error, got %v", err)
	}
}

func TestConfigValidateStillSupportsCoturn(t *testing.T) {
	cfg := validWebRTCTestConfig()
	cfg.WebRTCEnabled = true
	cfg.WebRTCICEPolicy = "relay"
	cfg.WebRTCTurnProvider = "coturn"
	cfg.WebRTCTurnURLs = []string{"turn:turn.example.com:3478?transport=udp"}
	cfg.WebRTCTurnSecret = "shared-secret"
	cfg.WebRTCTurnCredentialTTL = 10 * time.Minute

	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected Coturn config to remain valid: %v", err)
	}
}
