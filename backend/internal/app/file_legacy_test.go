package app

import (
	"context"
	"strings"
	"testing"
	"time"

	"privatechat/internal/model"
)

func TestPresignDownloadSniffsLegacyReadyFileWithoutDetectedType(t *testing.T) {
	png := []byte("\x89PNG\r\n\x1a\n")
	storage := &fakeFileStorage{prefix: png}
	manager := newFileManager(newFakeFileRepository(model.File{
		ID:             12,
		ObjectKey:      "legacy.png",
		OwnerID:        1,
		ConversationID: "1_2",
		OriginalName:   "legacy.png",
		Status:         model.FileStatusReady,
	}), storage)

	if _, err := manager.PresignDownload(context.Background(), 2, 12, 10*time.Minute); err != nil {
		t.Fatalf("presign legacy image: %v", err)
	}
	if storage.lastGetType != "image/png" {
		t.Fatalf("expected legacy image to be sniffed as image/png, got %q", storage.lastGetType)
	}
	if !strings.HasPrefix(storage.lastDisposition, "inline;") {
		t.Fatalf("expected legacy image inline disposition, got %q", storage.lastDisposition)
	}
}
