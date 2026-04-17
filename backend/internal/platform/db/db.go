package db

import (
	"context"
	"fmt"
	"strings"
	"time"

	"privatechat/internal/config"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"gorm.io/gorm/schema"
)

func OpenPostgres(cfg config.Config) (*gorm.DB, error) {
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable TimeZone=%s",
		cfg.PostgresHost,
		cfg.PostgresPort,
		cfg.PostgresUser,
		cfg.PostgresPassword,
		cfg.PostgresDatabase,
		cfg.TimeZone,
	)
	gormDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		NamingStrategy: schema.NamingStrategy{SingularTable: true},
		Logger:         logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return nil, err
	}
	sqlDB, err := gormDB.DB()
	if err != nil {
		return nil, err
	}
	sqlDB.SetMaxOpenConns(20)
	sqlDB.SetMaxIdleConns(10)
	sqlDB.SetConnMaxLifetime(30 * time.Minute)
	if err := sqlDB.Ping(); err != nil {
		return nil, fmt.Errorf("postgres ping failed: %w", err)
	}
	return gormDB, nil
}

func NewMinIOClient(cfg config.Config) (*minio.Client, error) {
	endpoint, secure := parseMinIOEndpoint(cfg.MinIOEndpoint)
	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.MinIOAccessKey, cfg.MinIOSecretKey, ""),
		Secure: secure,
	})
	if err != nil {
		return nil, fmt.Errorf("minio init failed: %w", err)
	}
	return client, nil
}

func parseMinIOEndpoint(raw string) (string, bool) {
	if strings.HasPrefix(raw, "http://") {
		return strings.TrimPrefix(raw, "http://"), false
	}
	if strings.HasPrefix(raw, "https://") {
		return strings.TrimPrefix(raw, "https://"), true
	}
	return raw, false
}

func EnsureBucket(ctx context.Context, client *minio.Client, bucket string) error {
	exists, err := client.BucketExists(ctx, bucket)
	if err != nil {
		return fmt.Errorf("minio bucket check failed: %w", err)
	}
	if exists {
		return nil
	}
	if err := client.MakeBucket(ctx, bucket, minio.MakeBucketOptions{}); err != nil {
		return fmt.Errorf("minio bucket create failed: %w", err)
	}
	return nil
}
