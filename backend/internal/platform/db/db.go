package db

import (
	"context"
	"fmt"
	"net"
	"strings"
	"time"

	"privatechat/internal/config"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"gorm.io/gorm/schema"
)

func OpenPostgres(cfg config.Config) (*gorm.DB, error) {
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s TimeZone=%s",
		cfg.PostgresHost,
		cfg.PostgresPort,
		cfg.PostgresUser,
		cfg.PostgresPassword,
		cfg.PostgresDatabase,
		cfg.PostgresSSLMode,
		cfg.TimeZone,
	)
	pgxConfig, err := pgx.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}
	pgxConfig.Config.LookupFunc = postgresLookupFunc
	pgxConfig.Config.DialFunc = postgresDialFunc

	sqlDB := stdlib.OpenDB(*pgxConfig)
	gormDB, err := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB}), &gorm.Config{
		NamingStrategy: schema.NamingStrategy{SingularTable: true},
		Logger:         logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		sqlDB.Close()
		return nil, err
	}
	sqlDB.SetMaxOpenConns(20)
	sqlDB.SetMaxIdleConns(10)
	sqlDB.SetConnMaxLifetime(30 * time.Minute)
	if err := sqlDB.Ping(); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("postgres ping failed: %w", err)
	}
	return gormDB, nil
}

func postgresLookupFunc(ctx context.Context, host string) ([]string, error) {
	addrs, err := net.DefaultResolver.LookupHost(ctx, host)
	if err != nil {
		return nil, err
	}
	ipv4Addrs := make([]string, 0, len(addrs))
	for _, addr := range addrs {
		if ip := net.ParseIP(addr); ip != nil && ip.To4() != nil {
			ipv4Addrs = append(ipv4Addrs, addr)
		}
	}
	return ipv4Addrs, nil
}

func postgresDialFunc(ctx context.Context, _ string, addr string) (net.Conn, error) {
	var dialer net.Dialer
	return dialer.DialContext(ctx, "tcp4", addr)
}

func NewObjectStorageClient(cfg config.Config) (*minio.Client, error) {
	endpoint, secure := parseObjectStorageEndpoint(cfg.StorageEndpoint)
	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.StorageAccessKey, cfg.StorageSecretKey, ""),
		Secure: secure,
		Region: "auto",
	})
	if err != nil {
		return nil, fmt.Errorf("object storage init failed: %w", err)
	}
	return client, nil
}

func parseObjectStorageEndpoint(raw string) (string, bool) {
	if strings.HasPrefix(raw, "http://") {
		return strings.TrimPrefix(raw, "http://"), false
	}
	if strings.HasPrefix(raw, "https://") {
		return strings.TrimPrefix(raw, "https://"), true
	}
	return raw, false
}

type bucketChecker interface {
	BucketExists(context.Context, string) (bool, error)
}

func EnsureBucket(ctx context.Context, client *minio.Client, bucket string) error {
	return ensureBucketExists(ctx, client, bucket)
}

func ensureBucketExists(ctx context.Context, checker bucketChecker, bucket string) error {
	exists, err := checker.BucketExists(ctx, bucket)
	if err != nil {
		return fmt.Errorf("object storage bucket check failed: %w", err)
	}
	if !exists {
		return fmt.Errorf("object storage bucket %s does not exist", bucket)
	}
	return nil
}
