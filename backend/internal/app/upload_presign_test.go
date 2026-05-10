package app

import (
	"context"
	"strings"
	"testing"
	"time"

	"privatechat/internal/config"
	"privatechat/internal/model"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

func TestPresignUploadRejectsFilesLargerThanLimit(t *testing.T) {
	app := &App{}
	_, err := app.presignUpload(context.Background(), model.FilePresignUploadRequest{
		FileName: "large.mp4",
		FileSize: maxFileUploadSize + 1,
	}, time.Hour)
	if err == nil {
		t.Fatal("expected oversized file error")
	}
	if !strings.Contains(err.Error(), "file too large") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestPresignUploadGeneratesPutURLAndDownloadURL(t *testing.T) {
	client, err := minio.New("example.r2.cloudflarestorage.com", &minio.Options{
		Creds:  credentials.NewStaticV4("access-key", "secret-key", ""),
		Secure: true,
		Region: "auto",
	})
	if err != nil {
		t.Fatalf("new storage client: %v", err)
	}

	app := &App{
		cfg: config.Config{
			StorageBucket:       "us-r2",
			ObjectStoragePrefix: "private-chat",
		},
		storage: client,
	}

	resp, err := app.presignUpload(context.Background(), model.FilePresignUploadRequest{
		FileName:    "clip.mp4",
		ContentType: "video/mp4",
		FileSize:    12345,
	}, time.Hour)
	if err != nil {
		t.Fatalf("presign upload: %v", err)
	}

	if resp.FileName != "clip.mp4" {
		t.Fatalf("expected original file name, got %q", resp.FileName)
	}
	if resp.FileSize != 12345 {
		t.Fatalf("expected file size 12345, got %d", resp.FileSize)
	}
	if !strings.HasPrefix(resp.URL, "/api/file/download/") {
		t.Fatalf("expected internal download URL, got %q", resp.URL)
	}
	if !strings.HasSuffix(resp.URL, ".mp4") {
		t.Fatalf("expected generated object name to keep extension, got %q", resp.URL)
	}
	if !strings.Contains(resp.UploadURL, "https://example.r2.cloudflarestorage.com/us-r2/private-chat/") {
		t.Fatalf("expected upload URL to target prefixed object key, got %q", resp.UploadURL)
	}
	if !strings.Contains(resp.UploadURL, "X-Amz-Algorithm=AWS4-HMAC-SHA256") {
		t.Fatalf("expected signed S3 upload URL, got %q", resp.UploadURL)
	}
}
