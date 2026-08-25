package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode"

	"privatechat/internal/model"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"gorm.io/gorm"
)

var (
	errFileTooLarge     = errors.New("file too large")
	errFileSizeMismatch = errors.New("file size mismatch")
	errFileForbidden    = errors.New("file forbidden")
	errFileNotReady     = errors.New("file not ready")
)

const (
	fileDownloadExpiry    = 10 * time.Minute
	filePrivateCacheValue = "private, max-age=300"
)

type fileRepository interface {
	Create(context.Context, *model.File) error
	FindByID(context.Context, int64) (model.File, error)
	MarkReady(context.Context, int64, int64, string, time.Time) (model.File, error)
}

type gormFileRepository struct{ db *gorm.DB }

func (r gormFileRepository) Create(ctx context.Context, file *model.File) error {
	return r.db.WithContext(ctx).Create(file).Error
}

func (r gormFileRepository) FindByID(ctx context.Context, id int64) (model.File, error) {
	var file model.File
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&file).Error
	return file, err
}

func (r gormFileRepository) MarkReady(ctx context.Context, id, actualSize int64, detectedContentType string, confirmedAt time.Time) (model.File, error) {
	updates := map[string]any{
		"actual_size":           actualSize,
		"detected_content_type": detectedContentType,
		"status":                model.FileStatusReady,
		"confirmed_at":          confirmedAt,
	}
	if err := r.db.WithContext(ctx).Model(&model.File{}).Where("id = ? AND status = ?", id, model.FileStatusPending).Updates(updates).Error; err != nil {
		return model.File{}, err
	}
	return r.FindByID(ctx, id)
}

type fileObjectStorage interface {
	PresignPut(context.Context, string, string, time.Duration) (string, error)
	Stat(context.Context, string) (int64, error)
	ReadPrefix(context.Context, string, int64) ([]byte, error)
	PresignGet(context.Context, string, string, string, time.Duration) (string, error)
}

type minioFileStorage struct {
	client *minio.Client
	bucket string
	prefix string
}

func (s minioFileStorage) key(objectKey string) string {
	return objectStorageKey(s.prefix, objectKey)
}

func (s minioFileStorage) PresignPut(ctx context.Context, objectKey, contentType string, expiry time.Duration) (string, error) {
	headers := http.Header{}
	headers.Set("Content-Type", contentType)
	u, err := s.client.PresignHeader(ctx, http.MethodPut, s.bucket, s.key(objectKey), expiry, nil, headers)
	if err != nil {
		return "", err
	}
	return u.String(), nil
}

func (s minioFileStorage) Stat(ctx context.Context, objectKey string) (int64, error) {
	stat, err := s.client.StatObject(ctx, s.bucket, s.key(objectKey), minio.StatObjectOptions{})
	if err != nil {
		return 0, err
	}
	return stat.Size, nil
}

func (s minioFileStorage) ReadPrefix(ctx context.Context, objectKey string, maxBytes int64) ([]byte, error) {
	opts := minio.GetObjectOptions{}
	if maxBytes > 0 {
		if err := opts.SetRange(0, maxBytes-1); err != nil {
			return nil, err
		}
	}
	obj, err := s.client.GetObject(ctx, s.bucket, s.key(objectKey), opts)
	if err != nil {
		return nil, err
	}
	defer obj.Close()
	return io.ReadAll(io.LimitReader(obj, maxBytes))
}

func (s minioFileStorage) PresignGet(ctx context.Context, objectKey, contentType, disposition string, expiry time.Duration) (string, error) {
	params := url.Values{}
	params.Set("response-content-type", contentType)
	params.Set("response-content-disposition", disposition)
	params.Set("response-cache-control", filePrivateCacheValue)
	u, err := s.client.PresignedGetObject(ctx, s.bucket, s.key(objectKey), expiry, params)
	if err != nil {
		return "", err
	}
	return u.String(), nil
}

type fileManager struct {
	repo    fileRepository
	storage fileObjectStorage
}

func newFileManager(repo fileRepository, storage fileObjectStorage) *fileManager {
	return &fileManager{repo: repo, storage: storage}
}

func stableFileURL(fileID int64) string {
	return fmt.Sprintf("/api/files/%d/content", fileID)
}

func thumbnailObjectKey(objectKey string) string {
	return objectKey + ".thumb.jpg"
}

func isImageUploadContentType(contentType string) bool {
	contentType = strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	return strings.HasPrefix(contentType, "image/")
}

func normalizeUploadContentType(fileName, contentType string) string {
	contentType = strings.TrimSpace(strings.Split(contentType, ";")[0])
	if contentType != "" {
		return contentType
	}
	if detected := mime.TypeByExtension(strings.ToLower(filepath.Ext(fileName))); detected != "" {
		return strings.Split(detected, ";")[0]
	}
	return "application/octet-stream"
}

func generatedObjectKey(fileName string) string {
	ext := strings.ToLower(filepath.Ext(filepath.Base(fileName)))
	if len(ext) > 16 {
		ext = ""
	}
	for _, r := range strings.TrimPrefix(ext, ".") {
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) {
			ext = ""
			break
		}
	}
	return uuid.NewString() + ext
}

func cleanDisplayFileName(name string) string {
	name = strings.TrimSpace(filepath.Base(name))
	name = strings.NewReplacer("\r", "_", "\n", "_", "\"", "_").Replace(name)
	if len(name) > 255 {
		name = name[:255]
	}
	return name
}

func (m *fileManager) CreatePending(ctx context.Context, ownerID int64, req model.FilePresignUploadRequest, expiry time.Duration) (model.FilePresignUploadDTO, error) {
	fileName := cleanDisplayFileName(req.FileName)
	if ownerID <= 0 || req.ReceiverID <= 0 || ownerID == req.ReceiverID || fileName == "" || req.FileSize < 0 {
		return model.FilePresignUploadDTO{}, fmt.Errorf("invalid file request")
	}
	if req.FileSize > maxFileUploadSize {
		return model.FilePresignUploadDTO{}, errFileTooLarge
	}
	contentType := normalizeUploadContentType(fileName, req.ContentType)
	file := model.File{
		ObjectKey:          generatedObjectKey(fileName),
		OwnerID:            ownerID,
		ConversationID:     conversationID(ownerID, req.ReceiverID),
		OriginalName:       fileName,
		ExpectedSize:       req.FileSize,
		ClaimedContentType: contentType,
		Status:             model.FileStatusPending,
	}
	if err := m.repo.Create(ctx, &file); err != nil {
		return model.FilePresignUploadDTO{}, err
	}
	uploadURL, err := m.storage.PresignPut(ctx, file.ObjectKey, contentType, expiry)
	if err != nil {
		return model.FilePresignUploadDTO{}, err
	}

	resp := model.FilePresignUploadDTO{
		FileID:    file.ID,
		UploadURL: uploadURL,
		URL:       stableFileURL(file.ID),
		FileName:  file.OriginalName,
		FileSize:  file.ExpectedSize,
		Headers:   map[string]string{"Content-Type": contentType},
	}
	if isImageUploadContentType(contentType) {
		thumbnailURL, thumbnailErr := m.storage.PresignPut(ctx, thumbnailObjectKey(file.ObjectKey), "image/jpeg", expiry)
		if thumbnailErr == nil {
			resp.ThumbnailUploadURL = thumbnailURL
			resp.ThumbnailHeaders = map[string]string{"Content-Type": "image/jpeg"}
		}
	}
	return resp, nil
}

func (m *fileManager) Confirm(ctx context.Context, userID, fileID int64) (model.FileUploadDTO, error) {
	file, err := m.repo.FindByID(ctx, fileID)
	if err != nil {
		return model.FileUploadDTO{}, err
	}
	if file.OwnerID != userID {
		return model.FileUploadDTO{}, errFileForbidden
	}
	if file.Status == model.FileStatusReady {
		size := file.ExpectedSize
		if file.ActualSize != nil {
			size = *file.ActualSize
		}
		return model.FileUploadDTO{FileID: file.ID, URL: stableFileURL(file.ID), FileName: file.OriginalName, FileSize: size}, nil
	}
	if file.Status != model.FileStatusPending {
		return model.FileUploadDTO{}, errFileNotReady
	}
	actualSize, err := m.storage.Stat(ctx, file.ObjectKey)
	if err != nil {
		return model.FileUploadDTO{}, err
	}
	if actualSize != file.ExpectedSize || actualSize > maxFileUploadSize {
		return model.FileUploadDTO{}, errFileSizeMismatch
	}
	prefix, err := m.storage.ReadPrefix(ctx, file.ObjectKey, 512)
	if err != nil {
		return model.FileUploadDTO{}, err
	}
	detected := http.DetectContentType(prefix)
	ready, err := m.repo.MarkReady(ctx, file.ID, actualSize, detected, time.Now().UTC())
	if err != nil {
		return model.FileUploadDTO{}, err
	}
	return model.FileUploadDTO{FileID: ready.ID, URL: stableFileURL(ready.ID), FileName: ready.OriginalName, FileSize: actualSize}, nil
}

func (m *fileManager) ResolveAttachment(ctx context.Context, senderID, receiverID, fileID int64) (model.File, error) {
	file, err := m.repo.FindByID(ctx, fileID)
	if err != nil {
		return model.File{}, err
	}
	if file.Status != model.FileStatusReady {
		return model.File{}, errFileNotReady
	}
	if file.OwnerID != senderID || file.ConversationID != conversationID(senderID, receiverID) {
		return model.File{}, errFileForbidden
	}
	return file, nil
}

func conversationContainsUser(conversation string, userID int64) bool {
	left, right, ok := strings.Cut(conversation, "_")
	if !ok {
		return false
	}
	a, errA := strconv.ParseInt(left, 10, 64)
	b, errB := strconv.ParseInt(right, 10, 64)
	return errA == nil && errB == nil && (a == userID || b == userID)
}

func safeInlineContentType(contentType string) bool {
	contentType = strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	switch contentType {
	case "image/jpeg", "image/png", "image/gif", "image/webp", "video/mp4", "video/avi":
		return true
	default:
		return false
	}
}

func downloadMetadata(file model.File) (string, string) {
	contentType := "application/octet-stream"
	inline := false
	if file.DetectedContentType != nil && safeInlineContentType(*file.DetectedContentType) {
		contentType = strings.Split(*file.DetectedContentType, ";")[0]
		inline = true
	}
	kind := "attachment"
	if inline {
		kind = "inline"
	}
	return contentType, fmt.Sprintf(`%s; filename="%s"`, kind, cleanDisplayFileName(file.OriginalName))
}

func (m *fileManager) authorizedReadyFile(ctx context.Context, userID, fileID int64) (model.File, error) {
	file, err := m.repo.FindByID(ctx, fileID)
	if err != nil {
		return model.File{}, err
	}
	if file.Status != model.FileStatusReady {
		return model.File{}, errFileNotReady
	}
	if !conversationContainsUser(file.ConversationID, userID) {
		return model.File{}, errFileForbidden
	}
	return file, nil
}

func (m *fileManager) ensureDetectedContentType(ctx context.Context, file *model.File) error {
	if file.DetectedContentType != nil && strings.TrimSpace(*file.DetectedContentType) != "" {
		return nil
	}
	prefix, err := m.storage.ReadPrefix(ctx, file.ObjectKey, 512)
	if err != nil {
		return err
	}
	detected := http.DetectContentType(prefix)
	file.DetectedContentType = &detected
	return nil
}

func (m *fileManager) presignOriginal(ctx context.Context, file model.File, expiry time.Duration) (string, error) {
	if err := m.ensureDetectedContentType(ctx, &file); err != nil {
		return "", err
	}
	contentType, disposition := downloadMetadata(file)
	return m.storage.PresignGet(ctx, file.ObjectKey, contentType, disposition, expiry)
}

func (m *fileManager) PresignDownload(ctx context.Context, userID, fileID int64, expiry time.Duration) (string, error) {
	file, err := m.authorizedReadyFile(ctx, userID, fileID)
	if err != nil {
		return "", err
	}
	return m.presignOriginal(ctx, file, expiry)
}

func (m *fileManager) PresignThumbnail(ctx context.Context, userID, fileID int64, expiry time.Duration) (string, error) {
	file, err := m.authorizedReadyFile(ctx, userID, fileID)
	if err != nil {
		return "", err
	}
	thumbnailKey := thumbnailObjectKey(file.ObjectKey)
	disposition := fmt.Sprintf(`inline; filename="%s"`, cleanDisplayFileName(file.OriginalName+".thumb.jpg"))
	return m.storage.PresignGet(ctx, thumbnailKey, "image/jpeg", disposition, expiry)
}

func (a *App) filePresignUploadHandler(c *gin.Context) {
	userID, ok := getUserID(c)
	if !ok {
		unauthorized(c)
		return
	}
	var req model.FilePresignUploadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondError(c, http.StatusBadRequest, http.StatusBadRequest, "请求参数错误")
		return
	}
	if err := a.requireContact(c.Request.Context(), userID, req.ReceiverID); err != nil {
		forbidden(c, "只能向联系人上传文件")
		return
	}
	resp, err := a.files.CreatePending(c.Request.Context(), userID, req, time.Hour)
	if errors.Is(err, errFileTooLarge) {
		respondError(c, http.StatusRequestEntityTooLarge, http.StatusRequestEntityTooLarge, "文件过大")
		return
	}
	if err != nil {
		respondError(c, http.StatusBadRequest, http.StatusBadRequest, "生成上传地址失败")
		return
	}
	respondSuccess(c, resp)
}

func (a *App) fileCompleteHandler(c *gin.Context) {
	userID, ok := getUserID(c)
	if !ok {
		unauthorized(c)
		return
	}
	fileID, err := strconv.ParseInt(c.Param("fileId"), 10, 64)
	if err != nil || fileID <= 0 {
		respondError(c, http.StatusBadRequest, http.StatusBadRequest, "文件无效")
		return
	}
	resp, err := a.files.Confirm(c.Request.Context(), userID, fileID)
	switch {
	case errors.Is(err, errFileForbidden):
		forbidden(c, "无权确认该文件")
	case errors.Is(err, errFileSizeMismatch):
		respondError(c, http.StatusUnprocessableEntity, http.StatusUnprocessableEntity, "文件大小校验失败")
	case errors.Is(err, gorm.ErrRecordNotFound):
		c.Status(http.StatusNotFound)
	case err != nil:
		respondError(c, http.StatusBadGateway, http.StatusBadGateway, "文件存储校验失败")
	default:
		respondSuccess(c, resp)
	}
}

func (a *App) fileContentHandler(c *gin.Context) {
	userID, ok := getUserID(c)
	if !ok {
		unauthorized(c)
		return
	}
	fileID, err := strconv.ParseInt(c.Param("fileId"), 10, 64)
	if err != nil || fileID <= 0 {
		c.Status(http.StatusNotFound)
		return
	}
	downloadURL, err := a.files.PresignDownload(c.Request.Context(), userID, fileID, fileDownloadExpiry)
	switch {
	case errors.Is(err, errFileForbidden):
		forbidden(c, "无权访问该文件")
	case errors.Is(err, errFileNotReady), errors.Is(err, gorm.ErrRecordNotFound):
		c.Status(http.StatusNotFound)
	case err != nil:
		respondError(c, http.StatusBadGateway, http.StatusBadGateway, "文件暂时不可用")
	default:
		c.Header("Cache-Control", filePrivateCacheValue)
		c.Redirect(http.StatusFound, downloadURL)
	}
}

func (a *App) fileThumbnailHandler(c *gin.Context) {
	userID, ok := getUserID(c)
	if !ok {
		unauthorized(c)
		return
	}
	fileID, err := strconv.ParseInt(c.Param("fileId"), 10, 64)
	if err != nil || fileID <= 0 {
		c.Status(http.StatusNotFound)
		return
	}
	downloadURL, err := a.files.PresignThumbnail(c.Request.Context(), userID, fileID, fileDownloadExpiry)
	switch {
	case errors.Is(err, errFileForbidden):
		forbidden(c, "无权访问该文件")
	case errors.Is(err, errFileNotReady), errors.Is(err, gorm.ErrRecordNotFound):
		c.Status(http.StatusNotFound)
	case err != nil:
		respondError(c, http.StatusBadGateway, http.StatusBadGateway, "文件暂时不可用")
	default:
		c.Header("Cache-Control", filePrivateCacheValue)
		c.Redirect(http.StatusFound, downloadURL)
	}
}
