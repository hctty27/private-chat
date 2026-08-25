package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"privatechat/internal/model"

	"github.com/gin-gonic/gin"
)

type countingFileStorage struct {
	*fakeFileStorage
	putKeys  []string
	putTypes []string
}

func (s *countingFileStorage) PresignPut(ctx context.Context, objectKey, contentType string, expiry time.Duration) (string, error) {
	s.putKeys = append(s.putKeys, objectKey)
	s.putTypes = append(s.putTypes, contentType)
	return s.fakeFileStorage.PresignPut(ctx, objectKey, contentType, expiry)
}

func TestImageUploadPresignsOriginalAndThumbnail(t *testing.T) {
	storage := &countingFileStorage{fakeFileStorage: &fakeFileStorage{}}
	manager := newFileManager(newFakeFileRepository(), storage)

	_, err := manager.CreatePending(context.Background(), 1, model.FilePresignUploadRequest{
		ReceiverID:  2,
		FileName:    "photo.jpg",
		ContentType: "image/jpeg",
		FileSize:    1024,
	}, time.Hour)
	if err != nil {
		t.Fatalf("create pending image: %v", err)
	}
	if len(storage.putKeys) != 2 {
		t.Fatalf("expected original and thumbnail presigns, got %d calls", len(storage.putKeys))
	}
	if storage.putTypes[1] != "image/jpeg" {
		t.Fatalf("expected jpeg thumbnail upload, got %q", storage.putTypes[1])
	}
	if storage.putKeys[1] == storage.putKeys[0] || storage.putKeys[1] != storage.putKeys[0]+".thumb.jpg" {
		t.Fatalf("unexpected thumbnail key %q for original %q", storage.putKeys[1], storage.putKeys[0])
	}
}

func TestFileContentHandlerUsesPrivateFiveMinuteCache(t *testing.T) {
	gin.SetMode(gin.TestMode)
	contentType := "image/jpeg"
	manager := newFileManager(newFakeFileRepository(model.File{
		ID:                  21,
		ObjectKey:           "photo.jpg",
		OwnerID:             1,
		ConversationID:      "1_2",
		OriginalName:        "photo.jpg",
		Status:              model.FileStatusReady,
		DetectedContentType: &contentType,
	}), &fakeFileStorage{getURL: "https://r2.example/download"})
	app := &App{files: manager}

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Set("userID", int64(1))
	ctx.Params = gin.Params{{Key: "fileId", Value: "21"}}
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/files/21/content", nil)

	app.fileContentHandler(ctx)

	if recorder.Code != http.StatusFound {
		t.Fatalf("expected redirect, got status %d", recorder.Code)
	}
	if got := recorder.Header().Get("Cache-Control"); got != "private, max-age=300" {
		t.Fatalf("expected private five-minute cache, got %q", got)
	}
}

func TestRoutesExposeProtectedThumbnailEndpoint(t *testing.T) {
	gin.SetMode(gin.TestMode)
	app := &App{}
	router, err := app.routes()
	if err != nil {
		t.Fatalf("build routes: %v", err)
	}

	for _, route := range router.Routes() {
		if route.Method == http.MethodGet && route.Path == "/api/files/:fileId/thumbnail" {
			return
		}
	}
	t.Fatal("expected protected thumbnail route")
}
