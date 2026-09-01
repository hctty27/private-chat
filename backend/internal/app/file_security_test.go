package app

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"privatechat/internal/model"
)

type fakeFileRepository struct {
	files   map[int64]model.File
	nextID  int64
	created *model.File
}

func newFakeFileRepository(files ...model.File) *fakeFileRepository {
	repo := &fakeFileRepository{files: map[int64]model.File{}, nextID: 1}
	for _, file := range files {
		repo.files[file.ID] = file
		if file.ID >= repo.nextID {
			repo.nextID = file.ID + 1
		}
	}
	return repo
}

func (r *fakeFileRepository) Create(_ context.Context, file *model.File) error {
	copy := *file
	copy.ID = r.nextID
	r.nextID++
	r.files[copy.ID] = copy
	r.created = &copy
	file.ID = copy.ID
	return nil
}

func (r *fakeFileRepository) FindByID(_ context.Context, id int64) (model.File, error) {
	file, ok := r.files[id]
	if !ok {
		return model.File{}, errors.New("not found")
	}
	return file, nil
}

func (r *fakeFileRepository) MarkReady(_ context.Context, id, actualSize int64, detectedContentType string, confirmedAt time.Time) (model.File, error) {
	file, ok := r.files[id]
	if !ok {
		return model.File{}, errors.New("not found")
	}
	file.ActualSize = &actualSize
	file.DetectedContentType = &detectedContentType
	file.Status = model.FileStatusReady
	file.ConfirmedAt = &confirmedAt
	r.files[id] = file
	return file, nil
}

type fakeFileStorage struct {
	statSize        int64
	prefix          []byte
	putURL          string
	getURL          string
	lastPutKey      string
	lastPutType     string
	lastGetKey      string
	lastGetType     string
	lastDisposition string
	lastGetExpiry   time.Duration
	multipartID     string
	multipartKey    string
	completedParts  []model.FileMultipartCompletedPart
	abortedUploadID string
}

func (s *fakeFileStorage) PresignPut(_ context.Context, objectKey, contentType string, _ time.Duration) (string, error) {
	s.lastPutKey = objectKey
	s.lastPutType = contentType
	if s.putURL == "" {
		return "https://r2.example/upload", nil
	}
	return s.putURL, nil
}

func (s *fakeFileStorage) BeginMultipart(_ context.Context, objectKey, _ string) (string, error) {
	s.multipartKey = objectKey
	if s.multipartID == "" {
		s.multipartID = "upload-1"
	}
	return s.multipartID, nil
}

func (s *fakeFileStorage) PresignMultipartPart(_ context.Context, _ string, uploadID string, partNumber int, _ time.Duration) (string, error) {
	return "https://r2.example/multipart/" + uploadID + "/" + strconv.Itoa(partNumber), nil
}

func (s *fakeFileStorage) CompleteMultipart(_ context.Context, _ string, _ string, parts []model.FileMultipartCompletedPart) error {
	s.completedParts = append([]model.FileMultipartCompletedPart(nil), parts...)
	return nil
}

func (s *fakeFileStorage) AbortMultipart(_ context.Context, _ string, uploadID string) error {
	s.abortedUploadID = uploadID
	return nil
}

func (s *fakeFileStorage) Stat(_ context.Context, _ string) (int64, error) {
	return s.statSize, nil
}

func (s *fakeFileStorage) ReadPrefix(_ context.Context, _ string, maxBytes int64) ([]byte, error) {
	if int64(len(s.prefix)) > maxBytes {
		return append([]byte(nil), s.prefix[:maxBytes]...), nil
	}
	return append([]byte(nil), s.prefix...), nil
}

func (s *fakeFileStorage) EnsureImageThumbnail(_ context.Context, _, _ string, _ int64) error {
	return nil
}

func (s *fakeFileStorage) PresignGet(_ context.Context, objectKey, contentType, disposition string, expiry time.Duration) (string, error) {
	s.lastGetKey = objectKey
	s.lastGetType = contentType
	s.lastDisposition = disposition
	s.lastGetExpiry = expiry
	if s.getURL == "" {
		return "https://r2.example/download", nil
	}
	return s.getURL, nil
}

func TestCreatePendingFileBindsOwnerConversationAndContentType(t *testing.T) {
	repo := newFakeFileRepository()
	storage := &fakeFileStorage{}
	manager := newFileManager(repo, storage)

	resp, err := manager.CreatePending(context.Background(), 1, model.FilePresignUploadRequest{
		ReceiverID:  2,
		FileName:    "photo.jpg",
		ContentType: "image/jpeg",
		FileSize:    1234,
	}, time.Hour)
	if err != nil {
		t.Fatalf("create pending file: %v", err)
	}
	if resp.FileID <= 0 {
		t.Fatalf("expected file id, got %d", resp.FileID)
	}
	if repo.created == nil {
		t.Fatal("expected file record to be created")
	}
	if repo.created.OwnerID != 1 || repo.created.ConversationID != "1_2" {
		t.Fatalf("unexpected ownership: owner=%d conversation=%q", repo.created.OwnerID, repo.created.ConversationID)
	}
	if repo.created.Status != model.FileStatusPending {
		t.Fatalf("expected pending status, got %q", repo.created.Status)
	}
	if storage.lastPutType != "image/jpeg" {
		t.Fatalf("expected signed content type image/jpeg, got %q", storage.lastPutType)
	}
	if storage.lastPutKey == "" || !strings.HasSuffix(storage.lastPutKey, ".jpg") {
		t.Fatalf("expected generated jpg object key, got %q", storage.lastPutKey)
	}
}

func TestCreatePendingFileRejectsOversizedImage(t *testing.T) {
	manager := newFileManager(newFakeFileRepository(), &fakeFileStorage{})
	_, err := manager.CreatePending(context.Background(), 1, model.FilePresignUploadRequest{
		ReceiverID:  2,
		FileName:    "large.jpg",
		ContentType: "image/jpeg",
		FileSize:    maxImageUploadSize + 1,
	}, time.Hour)
	if err == nil || !errors.Is(err, errFileTooLarge) {
		t.Fatalf("expected file-too-large error, got %v", err)
	}
}

func TestCreatePendingFileUsesMultipartForLargeVideo(t *testing.T) {
	storage := &fakeFileStorage{}
	manager := newFileManager(newFakeFileRepository(), storage)
	resp, err := manager.CreatePending(context.Background(), 1, model.FilePresignUploadRequest{
		ReceiverID:  2,
		FileName:    "large.mp4",
		ContentType: "video/mp4",
		FileSize:    multipartUploadThreshold + 1,
	}, time.Hour)
	if err != nil {
		t.Fatalf("create multipart pending file: %v", err)
	}
	if resp.UploadMode != "multipart" || resp.UploadID == "" {
		t.Fatalf("expected multipart upload response, got mode=%q id=%q", resp.UploadMode, resp.UploadID)
	}
	if resp.PartSize != multipartUploadPartSize || len(resp.Parts) == 0 {
		t.Fatalf("unexpected multipart plan: partSize=%d parts=%d", resp.PartSize, len(resp.Parts))
	}
	if storage.multipartKey == "" {
		t.Fatal("expected multipart upload to be initialized")
	}
}

func TestConfirmFileRejectsActualSizeMismatch(t *testing.T) {
	repo := newFakeFileRepository(model.File{
		ID:             7,
		ObjectKey:      "abc.jpg",
		OwnerID:        1,
		ConversationID: "1_2",
		ExpectedSize:   10,
		Status:         model.FileStatusPending,
	})
	manager := newFileManager(repo, &fakeFileStorage{statSize: 11, prefix: []byte("jpeg")})

	_, err := manager.Confirm(context.Background(), 1, 7)
	if err == nil || !errors.Is(err, errFileSizeMismatch) {
		t.Fatalf("expected size mismatch, got %v", err)
	}
	file, _ := repo.FindByID(context.Background(), 7)
	if file.Status != model.FileStatusPending {
		t.Fatalf("mismatched file must stay pending, got %q", file.Status)
	}
}

func TestConfirmFileDetectsContentAndMarksReady(t *testing.T) {
	png := []byte("\x89PNG\r\n\x1a\n")
	repo := newFakeFileRepository(model.File{
		ID:             8,
		ObjectKey:      "abc.png",
		OwnerID:        1,
		ConversationID: "1_2",
		OriginalName:   "photo.png",
		ExpectedSize:   int64(len(png)),
		Status:         model.FileStatusPending,
	})
	manager := newFileManager(repo, &fakeFileStorage{statSize: int64(len(png)), prefix: png})

	resp, err := manager.Confirm(context.Background(), 1, 8)
	if err != nil {
		t.Fatalf("confirm file: %v", err)
	}
	if resp.FileID != 8 || resp.URL != "/api/files/8/content" {
		t.Fatalf("unexpected response: %+v", resp)
	}
	file, _ := repo.FindByID(context.Background(), 8)
	if file.Status != model.FileStatusReady {
		t.Fatalf("expected ready status, got %q", file.Status)
	}
	if file.DetectedContentType == nil || *file.DetectedContentType != "image/png" {
		t.Fatalf("expected detected image/png, got %v", file.DetectedContentType)
	}
}

func TestResolveAttachmentRequiresReadyOwnerAndConversation(t *testing.T) {
	manager := newFileManager(newFakeFileRepository(model.File{
		ID:             9,
		OwnerID:        1,
		ConversationID: "1_2",
		Status:         model.FileStatusReady,
	}), &fakeFileStorage{})

	if _, err := manager.ResolveAttachment(context.Background(), 1, 2, 9); err != nil {
		t.Fatalf("expected valid attachment, got %v", err)
	}
	if _, err := manager.ResolveAttachment(context.Background(), 2, 1, 9); !errors.Is(err, errFileForbidden) {
		t.Fatalf("expected owner check to reject, got %v", err)
	}
	if _, err := manager.ResolveAttachment(context.Background(), 1, 3, 9); !errors.Is(err, errFileForbidden) {
		t.Fatalf("expected conversation check to reject, got %v", err)
	}
}

func TestPresignDownloadAllowsConversationParticipantsAndUsesSafeDisposition(t *testing.T) {
	contentType := "image/jpeg"
	repo := newFakeFileRepository(model.File{
		ID:                  10,
		ObjectKey:           "photo.jpg",
		OwnerID:             1,
		ConversationID:      "1_2",
		OriginalName:        "holiday.jpg",
		Status:              model.FileStatusReady,
		DetectedContentType: &contentType,
	})
	storage := &fakeFileStorage{}
	manager := newFileManager(repo, storage)

	url, err := manager.PresignDownload(context.Background(), 2, 10, 10*time.Minute)
	if err != nil {
		t.Fatalf("presign download: %v", err)
	}
	if url != "https://r2.example/download" {
		t.Fatalf("unexpected download url %q", url)
	}
	if storage.lastGetType != "image/jpeg" || !strings.HasPrefix(storage.lastDisposition, "inline;") {
		t.Fatalf("expected safe inline media, got type=%q disposition=%q", storage.lastGetType, storage.lastDisposition)
	}
	if storage.lastGetExpiry != 10*time.Minute {
		t.Fatalf("expected 10 minute expiry, got %s", storage.lastGetExpiry)
	}

	if _, err := manager.PresignDownload(context.Background(), 3, 10, 10*time.Minute); !errors.Is(err, errFileForbidden) {
		t.Fatalf("expected outsider forbidden, got %v", err)
	}
}

func TestUnsafeDetectedTypeDownloadsAsAttachment(t *testing.T) {
	contentType := "text/html; charset=utf-8"
	storage := &fakeFileStorage{}
	manager := newFileManager(newFakeFileRepository(model.File{
		ID:                  11,
		ObjectKey:           "payload.html",
		OwnerID:             1,
		ConversationID:      "1_2",
		OriginalName:        "payload.html",
		Status:              model.FileStatusReady,
		DetectedContentType: &contentType,
	}), storage)

	if _, err := manager.PresignDownload(context.Background(), 1, 11, 10*time.Minute); err != nil {
		t.Fatalf("presign unsafe download: %v", err)
	}
	if storage.lastGetType != "application/octet-stream" {
		t.Fatalf("expected octet-stream for unsafe type, got %q", storage.lastGetType)
	}
	if !strings.HasPrefix(storage.lastDisposition, "attachment;") {
		t.Fatalf("expected attachment disposition, got %q", storage.lastDisposition)
	}
}

func TestStableFileURLIsUsedInMessageDTO(t *testing.T) {
	fileID := int64(42)
	name := "photo.jpg"
	size := int64(123)
	msg := model.Message{
		ID:             100,
		ConversationID: "1_2",
		SenderID:       1,
		ReceiverID:     2,
		MsgType:        2,
		FileID:         &fileID,
		FileName:       &name,
		FileSize:       &size,
	}

	dto := toMessageDTO(msg, time.UTC)
	if dto.FileID == nil || *dto.FileID != 42 {
		t.Fatalf("expected fileId 42, got %v", dto.FileID)
	}
	if dto.FileURL == nil || *dto.FileURL != "/api/files/42/content" {
		t.Fatalf("expected stable file URL, got %v", dto.FileURL)
	}
}

func TestSafeMediaDetectionIncludesMp4(t *testing.T) {
	data := []byte("\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom")
	if got := http.DetectContentType(data); got != "video/mp4" {
		t.Fatalf("expected Go sniffer to detect mp4, got %q", got)
	}
}
