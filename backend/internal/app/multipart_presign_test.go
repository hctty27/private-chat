package app

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

func TestPresignMultipartPartTargetsR2UploadPart(t *testing.T) {
	client, err := minio.New("example.r2.cloudflarestorage.com", &minio.Options{
		Creds:  credentials.NewStaticV4("access-key", "secret-key", ""),
		Secure: true,
		Region: "auto",
	})
	if err != nil {
		t.Fatalf("new storage client: %v", err)
	}

	storage := minioFileStorage{
		client:    client,
		bucket:    "us-r2",
		prefix:    "private-chat",
		accessKey: "access-key",
		secretKey: "secret-key",
	}
	url, err := storage.PresignMultipartPart(context.Background(), "clip.mp4", "upload-123", 7, time.Hour)
	if err != nil {
		t.Fatalf("presign multipart part: %v", err)
	}

	for _, expected := range []string{
		"https://example.r2.cloudflarestorage.com/us-r2/private-chat/clip.mp4?",
		"partNumber=7",
		"uploadId=upload-123",
		"X-Amz-Algorithm=AWS4-HMAC-SHA256",
	} {
		if !strings.Contains(url, expected) {
			t.Fatalf("expected %q in multipart URL: %s", expected, url)
		}
	}
}
