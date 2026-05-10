package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"privatechat/internal/config"

	"github.com/gin-gonic/gin"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

func TestDownloadHandlerSupportsRangeRequests(t *testing.T) {
	gin.SetMode(gin.TestMode)

	body := "0123456789"
	storage := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/bucket/video.mp4" {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.Header().Set("Content-Type", "video/mp4")
		w.Header().Set("Content-Length", "10")
		w.Header().Set("ETag", `"test-etag"`)
		w.Header().Set("Last-Modified", "Sun, 10 May 2026 00:00:00 GMT")
		w.Header().Set("Accept-Ranges", "bytes")
		if r.Method == http.MethodHead {
			return
		}
		if r.Header.Get("Range") == "bytes=0-3" {
			w.Header().Set("Content-Range", "bytes 0-3/10")
			w.WriteHeader(http.StatusPartialContent)
			_, _ = w.Write([]byte(body[:4]))
			return
		}
		_, _ = w.Write([]byte(body))
	}))
	defer storage.Close()

	client, err := minio.New(strings.TrimPrefix(storage.URL, "http://"), &minio.Options{
		Creds:  credentials.NewStaticV4("access-key", "secret-key", ""),
		Secure: false,
		Region: "us-east-1",
	})
	if err != nil {
		t.Fatalf("new storage client: %v", err)
	}

	app := &App{
		cfg:     config.Config{StorageBucket: "bucket"},
		storage: client,
	}
	r := gin.New()
	r.GET("/api/file/download/:objectName", app.downloadHandler)

	req := httptest.NewRequest(http.MethodGet, "/api/file/download/video.mp4", nil)
	req.Header.Set("Range", "bytes=0-3")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusPartialContent {
		t.Fatalf("expected status 206, got %d with body %q", w.Code, w.Body.String())
	}
	if got := w.Header().Get("Content-Range"); got != "bytes 0-3/10" {
		t.Fatalf("expected Content-Range bytes 0-3/10, got %q", got)
	}
	if got := w.Body.String(); got != "0123" {
		t.Fatalf("expected partial body 0123, got %q", got)
	}
}
