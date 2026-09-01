package app

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"privatechat/internal/model"

	"github.com/gin-gonic/gin"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type countingFileStorage struct {
	*fakeFileStorage
	putKeys  []string
	putTypes []string
}

type ensureThumbnailStorage struct {
	*fakeFileStorage
	ensuredSourceKey    string
	ensuredThumbnailKey string
	ensuredSourceSize   int64
}

func (s *ensureThumbnailStorage) EnsureImageThumbnail(_ context.Context, sourceKey, thumbnailKey string, sourceSize int64) error {
	s.ensuredSourceKey = sourceKey
	s.ensuredThumbnailKey = thumbnailKey
	s.ensuredSourceSize = sourceSize
	return nil
}

func (s *countingFileStorage) PresignPut(ctx context.Context, objectKey, contentType string, expiry time.Duration) (string, error) {
	s.putKeys = append(s.putKeys, objectKey)
	s.putTypes = append(s.putTypes, contentType)
	return s.fakeFileStorage.PresignPut(ctx, objectKey, contentType, expiry)
}

type thumbnailFileStorage struct {
	*fakeFileStorage
	getURLs  map[string]string
	statKeys []string
	readKeys []string
	getKeys  []string
}

func (s *thumbnailFileStorage) Stat(ctx context.Context, objectKey string) (int64, error) {
	s.statKeys = append(s.statKeys, objectKey)
	return s.fakeFileStorage.Stat(ctx, objectKey)
}

func (s *thumbnailFileStorage) ReadPrefix(ctx context.Context, objectKey string, maxBytes int64) ([]byte, error) {
	s.readKeys = append(s.readKeys, objectKey)
	return s.fakeFileStorage.ReadPrefix(ctx, objectKey, maxBytes)
}

func (s *thumbnailFileStorage) PresignGet(ctx context.Context, objectKey, contentType, disposition string, expiry time.Duration) (string, error) {
	s.getKeys = append(s.getKeys, objectKey)
	if signedURL, ok := s.getURLs[objectKey]; ok {
		return signedURL, nil
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

func TestVideoUploadPresignsOriginalAndThumbnail(t *testing.T) {
	storage := &countingFileStorage{fakeFileStorage: &fakeFileStorage{}}
	manager := newFileManager(newFakeFileRepository(), storage)

	_, err := manager.CreatePending(context.Background(), 1, model.FilePresignUploadRequest{
		ReceiverID:  2,
		FileName:    "clip.mp4",
		ContentType: "video/mp4",
		FileSize:    2048,
	}, time.Hour)
	if err != nil {
		t.Fatalf("create pending video: %v", err)
	}
	if len(storage.putKeys) != 2 {
		t.Fatalf("expected original and thumbnail presigns, got %d calls", len(storage.putKeys))
	}
	if storage.putTypes[1] != "image/jpeg" {
		t.Fatalf("expected jpeg thumbnail upload, got %q", storage.putTypes[1])
	}
	if storage.putKeys[1] != storage.putKeys[0]+".thumb.jpg" {
		t.Fatalf("unexpected thumbnail key %q for original %q", storage.putKeys[1], storage.putKeys[0])
	}
}

func TestConfirmImageEnsuresServerThumbnail(t *testing.T) {
	jpegHeader := []byte{0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 'J', 'F', 'I', 'F', 0x00, 0x01}
	storage := &ensureThumbnailStorage{fakeFileStorage: &fakeFileStorage{
		statSize: int64(len(jpegHeader)),
		prefix:   jpegHeader,
	}}
	repo := newFakeFileRepository(model.File{
		ID:             12,
		ObjectKey:      "photo.jpg",
		OwnerID:        1,
		ConversationID: "1_2",
		OriginalName:   "photo.jpg",
		ExpectedSize:   int64(len(jpegHeader)),
		Status:         model.FileStatusPending,
	})
	manager := newFileManager(repo, storage)

	if _, err := manager.Confirm(context.Background(), 1, 12); err != nil {
		t.Fatalf("confirm image: %v", err)
	}
	if storage.ensuredSourceKey != "photo.jpg" {
		t.Fatalf("expected original image to be used for thumbnail fallback, got %q", storage.ensuredSourceKey)
	}
	if storage.ensuredThumbnailKey != "photo.jpg.thumb.jpg" {
		t.Fatalf("expected thumbnail object key, got %q", storage.ensuredThumbnailKey)
	}
	if storage.ensuredSourceSize != int64(len(jpegHeader)) {
		t.Fatalf("expected source size %d, got %d", len(jpegHeader), storage.ensuredSourceSize)
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
	if got := recorder.Header().Get("Cache-Control"); got != filePrivateCacheValue {
		t.Fatalf("expected private five-minute cache, got %q", got)
	}
}

func TestDownloadMetadataUsesSafeClaimedVideoTypeWhenDetectionIsGeneric(t *testing.T) {
	detected := "application/octet-stream"
	contentType, disposition := downloadMetadata(model.File{
		OriginalName:        "iphone.mov",
		ClaimedContentType:  "video/quicktime",
		DetectedContentType: &detected,
	})

	if contentType != "video/quicktime" {
		t.Fatalf("expected quicktime content type, got %q", contentType)
	}
	if disposition != `inline; filename="iphone.mov"` {
		t.Fatalf("expected inline disposition, got %q", disposition)
	}
}

func TestPresignedGetOverridesObjectCacheControl(t *testing.T) {
	client, err := minio.New("r2.example", &minio.Options{
		Creds:  credentials.NewStaticV4("access", "secret", ""),
		Secure: true,
		Region: "us-east-1",
	})
	if err != nil {
		t.Fatalf("create minio client: %v", err)
	}
	storage := minioFileStorage{client: client, bucket: "private-chat"}

	rawURL, err := storage.PresignGet(context.Background(), "photo.jpg", "image/jpeg", `inline; filename="photo.jpg"`, time.Minute)
	if err != nil {
		t.Fatalf("presign get: %v", err)
	}
	parsed, err := url.Parse(rawURL)
	if err != nil {
		t.Fatalf("parse presigned url: %v", err)
	}
	if got := parsed.Query().Get("response-cache-control"); got != filePrivateCacheValue {
		t.Fatalf("expected response-cache-control %q, got %q", filePrivateCacheValue, got)
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

func TestFileThumbnailHandlerPresignsThumbnailWithoutStorageProbe(t *testing.T) {
	contentType := "image/jpeg"
	thumbnailKey := "photo.jpg.thumb.jpg"
	storage := &thumbnailFileStorage{
		fakeFileStorage: &fakeFileStorage{},
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
	if len(storage.statKeys) != 0 {
		t.Fatalf("expected no thumbnail stat probe, got %v", storage.statKeys)
	}
	if len(storage.readKeys) != 0 {
		t.Fatalf("expected no thumbnail content probe, got %v", storage.readKeys)
	}
	if len(storage.getKeys) != 1 || storage.getKeys[0] != thumbnailKey {
		t.Fatalf("expected direct thumbnail presign, got %v", storage.getKeys)
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
