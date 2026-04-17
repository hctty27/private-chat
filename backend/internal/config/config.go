package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	ListenAddr       string
	PostgresHost     string
	PostgresPort     string
	PostgresUser     string
	PostgresPassword string
	PostgresDatabase string
	RedisAddr        string
	RedisPassword    string
	MinIOEndpoint    string
	MinIOAccessKey   string
	MinIOSecretKey   string
	MinIOBucket      string
	JWTSecret        string
	JWTExpiration    time.Duration
	MessagePageSize  int
	TimeZone         string
}

func Load() Config {
	return Config{
		ListenAddr:       envOrDefault("LISTEN_ADDR", ":8080"),
		PostgresHost:     envOrDefault("POSTGRES_HOST", "postgres_db"),
		PostgresPort:     envOrDefault("POSTGRES_PORT", "5432"),
		PostgresUser:     envOrDefault("POSTGRES_USER", "admin"),
		PostgresPassword: envOrDefault("POSTGRES_PASSWORD", "postgres"),
		PostgresDatabase: envOrDefault("POSTGRES_DB", "private_chat"),
		RedisAddr:        envOrDefault("REDIS_ADDR", "redis:6379"),
		RedisPassword:    envOrDefault("REDIS_PASSWORD", "ycy2026redis"),
		MinIOEndpoint:    envOrDefault("MINIO_ENDPOINT", "http://minio:9000"),
		MinIOAccessKey:   envOrDefault("MINIO_ACCESS_KEY", "admin"),
		MinIOSecretKey:   envOrDefault("MINIO_SECRET_KEY", "ycy2026minio"),
		MinIOBucket:      envOrDefault("MINIO_BUCKET", "private-chat"),
		JWTSecret:        envOrDefault("JWT_SECRET", "8bf6bfc1c08ec008f71aba7996d9f101fb553cce6cf31fb4a53d6e3ebffde5b9"),
		JWTExpiration:    envDurationOrDefault("JWT_EXPIRATION", 24*time.Hour),
		MessagePageSize:  envIntOrDefault("MESSAGE_PAGE_SIZE", 20),
		TimeZone:         envOrDefault("TIME_ZONE", "Asia/Shanghai"),
	}
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
