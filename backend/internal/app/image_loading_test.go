package app

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"privatechat/internal/model"

	"github.com/gin-gonic/gin"
)

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
