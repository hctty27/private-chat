package app

import (
	"context"
	"errors"
	"fmt"
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

type thumbnailFileStorage struct {
	*fakeFileStorage
	statSizes  map[string]int64
	statErrors map[string]error
	prefixes   map[string][]byte
	getURLs    map[string]string
	statKeys   []string
	readKeys   []string
	getKeys    []string
}

func (s *thumbnailFileStorage) Stat(ctx context.Context, objectKey string) (int64, error) {
	s.statKeys = append(s.statKeys, objectKey)
	if err, ok := s.statErrors[objectKey]; ok {
		return 0, err
	}
	if size, ok := s.statSizes[objectKey]; ok {
		return size, nil
	}
	return s.fakeFileStorage.Stat(ctx, objectKey)
}

func (s *thumbnailFileStorage) ReadPrefix(ctx context.Context, objectKey string, maxBytes int64) ([]byte, error) {
	s.readKeys = append(s.readKeys, objectKey)
	if prefix, ok := s.prefixes[objectKey]; ok {
		if int64(len(prefix)) > maxBytes {
			return append([]byte(nil), prefix[:maxBytes]...), nil
		}
		return append([]byte(nil), prefix...), nil
	}
	return s.fakeFileStorage.ReadPrefix(ctx, objectKey, maxBytes)
}

func (s *thumbnailFileStorage) PresignGet(ctx context.Context, objectKey, contentType, disposition string, expiry time.Duration) (string, error) {
	s.getKeys = append(s.getKeys, objectKey)
	if url, ok := s.getURLs[objectKey]; ok {
		return url, nil
	}
	return s.fakeFileStorage.PresignGet(ctx, objectKey, contentType, disposition, expiry)
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

func TestFileThumbnailHandlerUsesValidatedThumbnailObject(t *testing.T) {
	contentType := "image/jpeg"
	thumbnailKey := "photo.jpg.thumb.jpg"
	storage := &thumbnailFileStorage{
		fakeFileStorage: &fakeFileStorage{},
		statSizes:       map[string]int64{thumbnailKey: 128},
		prefixes:        map[string][]byte{thumbnailKey: {0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 'J', 'F', 'I', 'F', 0x00}},
		getURLs:         map[string]string{thumbnailKey: "https://r2.example/thumbnail"},
	}
	app := &App{files: newFileManager(newFakeFileRepository(model.File{
		ID:                  31,
		ObjectKey:           "photo.jpg",
		OwnerID:             1,
		ConversationID:      "1_2",
		OriginalName:        "photo.jpg",
		Status:              model.FileStatusReady,
		DetectedContentType: &contentType,
	}), storage)}

	recorder := runThumbnailRequest(t, app, 2, 31)

	if recorder.Code != http.StatusFound || recorder.Header().Get("Location") != "https://r2.example/thumbnail" {
		t.Fatalf("expected thumbnail redirect, got status=%d location=%q", recorder.Code, recorder.Header().Get("Location"))
	}
	if len(storage.statKeys) != 1 || storage.statKeys[0] != thumbnailKey {
		t.Fatalf("expected thumbnail existence check, got %v", storage.statKeys)
	}
	if len(storage.readKeys) != 1 || storage.readKeys[0] != thumbnailKey {
		t.Fatalf("expected thumbnail content validation, got %v", storage.readKeys)
	}
	if len(storage.getKeys) != 1 || storage.getKeys[0] != thumbnailKey {
		t.Fatalf("expected thumbnail presign, got %v", storage.getKeys)
	}
}

func TestFileThumbnailHandlerFallsBackWhenThumbnailMissing(t *testing.T) {
	contentType := "image/jpeg"
	thumbnailKey := "photo.jpg.thumb.jpg"
	storage := &thumbnailFileStorage{
		fakeFileStorage: &fakeFileStorage{},
		statErrors:      map[string]error{thumbnailKey: errors.New("not found")},
		getURLs:         map[string]string{"photo.jpg": "https://r2.example/original"},
	}
	app := &App{files: newFileManager(newFakeFileRepository(model.File{
		ID:                  32,
		ObjectKey:           "photo.jpg",
		OwnerID:             1,
		ConversationID:      "1_2",
		OriginalName:        "photo.jpg",
		Status:              model.FileStatusReady,
		DetectedContentType: &contentType,
	}), storage)}

	recorder := runThumbnailRequest(t, app, 1, 32)

	if recorder.Code != http.StatusFound || recorder.Header().Get("Location") != "https://r2.example/original" {
		t.Fatalf("expected original fallback, got status=%d location=%q", recorder.Code, recorder.Header().Get("Location"))
	}
	if len(storage.statKeys) != 1 || storage.statKeys[0] != thumbnailKey {
		t.Fatalf("expected thumbnail existence check before fallback, got %v", storage.statKeys)
	}
	if len(storage.getKeys) != 1 || storage.getKeys[0] != "photo.jpg" {
		t.Fatalf("expected original presign after missing thumbnail, got %v", storage.getKeys)
	}
}

func TestFileThumbnailHandlerRejectsInvalidThumbnailContent(t *testing.T) {
	contentType := "image/jpeg"
	thumbnailKey := "photo.jpg.thumb.jpg"
	storage := &thumbnailFileStorage{
		fakeFileStorage: &fakeFileStorage{},
		statSizes:       map[string]int64{thumbnailKey: 128},
		prefixes:        map[string][]byte{thumbnailKey: []byte("<html>not an image</html>")},
		getURLs:         map[string]string{"photo.jpg": "https://r2.example/original"},
	}
	app := &App{files: newFileManager(newFakeFileRepository(model.File{
		ID:                  33,
		ObjectKey:           "photo.jpg",
		OwnerID:             1,
		ConversationID:      "1_2",
		OriginalName:        "photo.jpg",
		Status:              model.FileStatusReady,
		DetectedContentType: &contentType,
	}), storage)}

	recorder := runThumbnailRequest(t, app, 2, 33)

	if recorder.Code != http.StatusFound || recorder.Header().Get("Location") != "https://r2.example/original" {
		t.Fatalf("expected original fallback for invalid thumbnail, got status=%d location=%q", recorder.Code, recorder.Header().Get("Location"))
	}
	if len(storage.readKeys) != 1 || storage.readKeys[0] != thumbnailKey {
		t.Fatalf("expected invalid thumbnail to be inspected, got %v", storage.readKeys)
	}
	if len(storage.getKeys) != 1 || storage.getKeys[0] != "photo.jpg" {
		t.Fatalf("expected invalid thumbnail not to be served, got %v", storage.getKeys)
	}
}

func runThumbnailRequest(t *testing.T, app *App, userID, fileID int64) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Set("userID", userID)
	ctx.Params = gin.Params{{Key: "fileId", Value: fmt.Sprint(fileID)}}
	ctx.Request = httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/files/%d/thumbnail", fileID), nil)
	app.fileThumbnailHandler(ctx)
	return recorder
}
