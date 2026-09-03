package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	ListenAddr              string
	GinMode                 string
	TrustedProxies          []string
	AllowedOrigins          []string
	AuthCookieSecure        bool
	PostgresHost            string
	PostgresPort            string
	PostgresUser            string
	PostgresPassword        string
	PostgresDatabase        string
	PostgresSSLMode         string
	RedisAddr               string
	RedisPassword           string
	StorageEndpoint         string
	StorageAccessKey        string
	StorageSecretKey        string
	StorageBucket           string
	ObjectStoragePrefix     string
	IP2RegionV4XDBPath      string
	IP2RegionV6XDBPath      string
	JWTSecret               string
	JWTExpiration           time.Duration
	JWTAbsoluteExpiration   time.Duration
	MessagePageSize         int
	TimeZone                string
	WebRTCEnabled           bool
	WebRTCICEPolicy         string
	WebRTCTurnProvider      string
	CloudflareTurnKeyID     string
	CloudflareTurnAPIToken  string
	WebRTCStunURL           string
	WebRTCTurnURLs          []string
	WebRTCTurnSecret        string
	WebRTCTurnCredentialTTL time.Duration
}

func Load() Config {
	return Config{
		ListenAddr:              envOrDefault("LISTEN_ADDR", ":8080"),
		GinMode:                 envOrDefault("GIN_MODE", "release"),
		TrustedProxies:          envList("TRUSTED_PROXIES"),
		AllowedOrigins:          envList("WS_ALLOWED_ORIGINS"),
		AuthCookieSecure:        envBoolOrDefault("AUTH_COOKIE_SECURE", true),
		PostgresHost:            envOrDefault("POSTGRES_HOST", "postgres_db"),
		PostgresPort:            envOrDefault("POSTGRES_PORT", "5432"),
		PostgresUser:            envOrDefault("POSTGRES_USER", "admin"),
		PostgresPassword:        envOrDefault("POSTGRES_PASSWORD", "postgres"),
		PostgresDatabase:        envOrDefault("POSTGRES_DB", "private_chat"),
		PostgresSSLMode:         envOrDefault("POSTGRES_SSLMODE", "disable"),
		RedisAddr:               envOrDefault("REDIS_ADDR", "redis:6379"),
		RedisPassword:           envOrDefault("REDIS_PASSWORD", ""),
		StorageEndpoint:         envOrDefault("R2_ENDPOINT", ""),
		StorageAccessKey:        envOrDefault("R2_ACCESS_KEY", ""),
		StorageSecretKey:        envOrDefault("R2_SECRET_KEY", ""),
		StorageBucket:           envOrDefault("R2_BUCKET", ""),
		ObjectStoragePrefix:     envOrDefault("R2_OBJECT_PREFIX", ""),
		IP2RegionV4XDBPath:      envOrDefault("IP2REGION_V4_XDB", "/app/data/ip2region_v4.xdb"),
		IP2RegionV6XDBPath:      envOrDefault("IP2REGION_V6_XDB", "/app/data/ip2region_v6.xdb"),
		JWTSecret:               envOrDefault("JWT_SECRET", ""),
		JWTExpiration:           envDurationOrDefault("JWT_EXPIRATION", time.Hour),
		JWTAbsoluteExpiration:   envDurationOrDefault("JWT_ABSOLUTE_EXPIRATION", 30*24*time.Hour),
		MessagePageSize:         envIntOrDefault("MESSAGE_PAGE_SIZE", 20),
		TimeZone:                envOrDefault("TIME_ZONE", "Asia/Shanghai"),
		WebRTCEnabled:           envBoolOrDefault("WEBRTC_ENABLED", false),
		WebRTCICEPolicy:         envOrDefault("WEBRTC_ICE_POLICY", "all"),
		WebRTCTurnProvider:      envOrDefault("WEBRTC_TURN_PROVIDER", "cloudflare"),
		CloudflareTurnKeyID:     envOrDefault("CLOUDFLARE_TURN_KEY_ID", ""),
		CloudflareTurnAPIToken:  envOrDefault("CLOUDFLARE_TURN_API_TOKEN", ""),
		WebRTCStunURL:           envOrDefault("WEBRTC_STUN_URL", ""),
		WebRTCTurnURLs:          envList("WEBRTC_TURN_URLS"),
		WebRTCTurnSecret:        envOrDefault("WEBRTC_TURN_SECRET", ""),
		WebRTCTurnCredentialTTL: envDurationOrDefault("WEBRTC_TURN_CREDENTIAL_TTL", 10*time.Minute),
	}
}

func (c Config) Validate() error {
	secret := strings.TrimSpace(c.JWTSecret)
	if secret == "" {
		return fmt.Errorf("JWT_SECRET is required")
	}
	if len(secret) < 32 {
		return fmt.Errorf("JWT_SECRET must be at least 32 characters")
	}
	if !c.WebRTCEnabled {
		return nil
	}
	if c.WebRTCICEPolicy != "all" && c.WebRTCICEPolicy != "relay" {
		return fmt.Errorf("WEBRTC_ICE_POLICY must be all or relay")
	}
	if c.WebRTCTurnCredentialTTL <= 0 {
		return fmt.Errorf("WEBRTC_TURN_CREDENTIAL_TTL must be positive")
	}

	provider := strings.TrimSpace(c.WebRTCTurnProvider)
	if provider == "" {
		provider = "coturn"
	}

	switch provider {
	case "cloudflare":
		if strings.TrimSpace(c.CloudflareTurnKeyID) == "" {
			return fmt.Errorf("CLOUDFLARE_TURN_KEY_ID is required when WEBRTC_TURN_PROVIDER=cloudflare")
		}
		if strings.TrimSpace(c.CloudflareTurnAPIToken) == "" {
			return fmt.Errorf("CLOUDFLARE_TURN_API_TOKEN is required when WEBRTC_TURN_PROVIDER=cloudflare")
		}
	case "coturn":
		if c.WebRTCICEPolicy == "all" && strings.TrimSpace(c.WebRTCStunURL) == "" {
			return fmt.Errorf("WEBRTC_STUN_URL is required when WEBRTC_ICE_POLICY=all")
		}
		if len(c.WebRTCTurnURLs) == 0 {
			return fmt.Errorf("WEBRTC_TURN_URLS is required when WEBRTC_ENABLED=true")
		}
		if strings.TrimSpace(c.WebRTCTurnSecret) == "" {
			return fmt.Errorf("WEBRTC_TURN_SECRET is required when WEBRTC_ENABLED=true")
		}
	default:
		return fmt.Errorf("WEBRTC_TURN_PROVIDER must be cloudflare or coturn")
	}

	return nil
}

func envOrDefault(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func envIntOrDefault(key string, fallback int) int {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return fallback
}

func envBoolOrDefault(key string, fallback bool) bool {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		if parsed, err := strconv.ParseBool(v); err == nil {
			return parsed
		}
	}
	return fallback
}

func envList(key string) []string {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return nil
	}

	parts := strings.Split(v, ",")
	items := make([]string, 0, len(parts))
	for _, part := range parts {
		item := strings.TrimSpace(part)
		if item != "" {
			items = append(items, item)
		}
	}
	return items
}

func envDurationOrDefault(key string, fallback time.Duration) time.Duration {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return time.Duration(n) * time.Millisecond
		}
	}
	return fallback
}
