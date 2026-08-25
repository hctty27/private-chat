package thumbnailbackfill

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"testing"

	"privatechat/internal/model"
)

type fakeRepository struct {
	files []model.File
}

func (r *fakeRepository) ListReadyFiles(_ context.Context, afterID int64, limit int) ([]model.File, error) {
	batch := make([]model.File, 0, limit)
	for _, file := range r.files {
		if file.ID <= afterID {
			continue
		}
		batch = append(batch, file)
		if len(batch) == limit {
			break
		}
	}
	return batch, nil
}

type fakeStorage struct {
	objects      map[string][]byte
	contentTypes map[string]string
	readErr      map[string]error
}

func (s *fakeStorage) Exists(_ context.Context, key string) (bool, error) {
	_, ok := s.objects[key]
	return ok, nil
}

func (s *fakeStorage) Read(_ context.Context, key string, maxBytes int64) ([]byte, error) {
	if err := s.readErr[key]; err != nil {
		return nil, err
	}
	data, ok := s.objects[key]
	if !ok {
		return nil, errors.New("object not found")
	}
	if int64(len(data)) > maxBytes {
		return nil, ErrSourceTooLarge
	}
	return append([]byte(nil), data...), nil
}

func (s *fakeStorage) Write(_ context.Context, key string, data []byte, contentType string) error {
	if s.objects == nil {
		s.objects = map[string][]byte{}
	}
	if s.contentTypes == nil {
		s.contentTypes = map[string]string{}
	}
	s.objects[key] = append([]byte(nil), data...)
	s.contentTypes[key] = contentType
	return nil
}

func TestBackfillCreatesMissingThumbnailAndSkipsExisting(t *testing.T) {
	original := testJPEG(t, 1600, 1200)
	repo := &fakeRepository{files: []model.File{
		readyImageFile(1, "one.jpg", "image/jpeg"),
		readyImageFile(2, "two.jpg", "image/jpeg"),
	}}
	store := &fakeStorage{objects: map[string][]byte{
		"one.jpg":           original,
		"two.jpg":           original,
		"two.jpg.thumb.jpg": []byte("existing"),
	}}

	result, err := Backfill(context.Background(), repo, store, Options{BatchSize: 1})
	if err != nil {
		t.Fatalf("backfill thumbnails: %v", err)
	}
	if result.Scanned != 2 || result.Eligible != 2 || result.Created != 1 || result.SkippedExisting != 1 || result.Failed != 0 {
		t.Fatalf("unexpected result: %+v", result)
	}
	thumbnail := store.objects["one.jpg.thumb.jpg"]
	if len(thumbnail) == 0 {
		t.Fatal("expected generated thumbnail")
	}
	decoded, err := jpeg.Decode(bytes.NewReader(thumbnail))
	if err != nil {
		t.Fatalf("decode generated thumbnail: %v", err)
	}
	bounds := decoded.Bounds()
	if max(bounds.Dx(), bounds.Dy()) != DefaultMaxEdge {
		t.Fatalf("expected max edge %d, got %dx%d", DefaultMaxEdge, bounds.Dx(), bounds.Dy())
	}
	if got := store.contentTypes["one.jpg.thumb.jpg"]; got != "image/jpeg" {
		t.Fatalf("expected image/jpeg upload, got %q", got)
	}
	if !bytes.Equal(store.objects["one.jpg"], original) {
		t.Fatal("original object must not be modified")
	}
}

func TestBackfillSkipsNonImagesAndContinuesAfterPerFileFailure(t *testing.T) {
	valid := testJPEG(t, 800, 600)
	repo := &fakeRepository{files: []model.File{
		{ID: 1, ObjectKey: "notes.txt", OriginalName: "notes.txt", Status: model.FileStatusReady, ClaimedContentType: "text/plain"},
		readyImageFile(2, "broken.jpg", "image/jpeg"),
		readyImageFile(3, "valid.jpg", "image/jpeg"),
	}}
	store := &fakeStorage{
		objects: map[string][]byte{"valid.jpg": valid},
		readErr: map[string]error{"broken.jpg": errors.New("read failed")},
	}

	result, err := Backfill(context.Background(), repo, store, Options{BatchSize: 2})
	if err != nil {
		t.Fatalf("backfill should continue after per-file failure: %v", err)
	}
	if result.Scanned != 3 || result.SkippedNonImage != 1 || result.Created != 1 || result.Failed != 1 {
		t.Fatalf("unexpected result: %+v", result)
	}
	if len(result.Failures) != 1 || result.Failures[0].FileID != 2 {
		t.Fatalf("expected failure for file 2, got %+v", result.Failures)
	}
	if _, ok := store.objects["valid.jpg.thumb.jpg"]; !ok {
		t.Fatal("expected later valid image to be processed")
	}
}

func TestLikelyImageIncludesHistoricalWebPByExtension(t *testing.T) {
	file := model.File{OriginalName: "photo.WEBP", Status: model.FileStatusReady}
	if !isLikelyImage(file) {
		t.Fatal("expected webp extension to be eligible for backfill")
	}
}

func readyImageFile(id int64, key, contentType string) model.File {
	return model.File{
		ID:                  id,
		ObjectKey:           key,
		OriginalName:        key,
		Status:              model.FileStatusReady,
		ClaimedContentType:  contentType,
		DetectedContentType: stringPtr(contentType),
	}
}

func stringPtr(value string) *string {
	return &value
}

func testJPEG(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x % 255), G: uint8(y % 255), B: 128, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatalf("encode fixture: %v", err)
	}
	return buf.Bytes()
}
