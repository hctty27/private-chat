package thumbnailbackfill

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/color"
	stddraw "image/draw"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"path/filepath"
	"strings"

	"privatechat/internal/config"
	"privatechat/internal/model"
	platformdb "privatechat/internal/platform/db"

	"github.com/minio/minio-go/v7"
	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
	"gorm.io/gorm"
)

const (
	DefaultMaxEdge        = 640
	DefaultJPEGQuality    = 80
	DefaultBatchSize      = 100
	DefaultMaxSourceBytes = int64(100 << 20)
	DefaultMaxPixels      = int64(50_000_000)
)

var ErrSourceTooLarge = errors.New("source image too large")

type Options struct {
	MaxEdge        int
	JPEGQuality    int
	BatchSize      int
	MaxSourceBytes int64
	MaxPixels      int64
}

type Failure struct {
	FileID    int64
	ObjectKey string
	Err       error
}

type Result struct {
	Scanned         int
	Eligible        int
	Created         int
	SkippedExisting int
	SkippedNonImage int
	Failed          int
	Failures        []Failure
}

type fileRepository interface {
	ListReadyFiles(context.Context, int64, int) ([]model.File, error)
}

type objectStorage interface {
	Exists(context.Context, string) (bool, error)
	Read(context.Context, string, int64) ([]byte, error)
	Write(context.Context, string, []byte, string) error
}

func Run(ctx context.Context, cfg config.Config) (Result, error) {
	gormDB, err := platformdb.OpenPostgres(cfg)
	if err != nil {
		return Result{}, fmt.Errorf("open postgres: %w", err)
	}
	sqlDB, err := gormDB.DB()
	if err != nil {
		return Result{}, fmt.Errorf("get postgres handle: %w", err)
	}
	defer sqlDB.Close()

	client, err := platformdb.NewObjectStorageClient(cfg)
	if err != nil {
		return Result{}, err
	}
	if err := platformdb.EnsureBucket(ctx, client, cfg.StorageBucket); err != nil {
		return Result{}, err
	}

	result, err := Backfill(
		ctx,
		&gormFileRepository{db: gormDB},
		&minioObjectStorage{
			client: client,
			bucket: cfg.StorageBucket,
			prefix: cfg.ObjectStoragePrefix,
		},
		Options{},
	)
	if err != nil {
		return result, err
	}
	if result.Failed > 0 {
		return result, fmt.Errorf("thumbnail backfill completed with %d failed file(s)", result.Failed)
	}
	return result, nil
}

func Backfill(ctx context.Context, repo fileRepository, storage objectStorage, options Options) (Result, error) {
	options = normalizedOptions(options)
	result := Result{}
	var afterID int64

	for {
		files, err := repo.ListReadyFiles(ctx, afterID, options.BatchSize)
		if err != nil {
			return result, fmt.Errorf("list ready files after %d: %w", afterID, err)
		}
		if len(files) == 0 {
			return result, nil
		}

		for _, file := range files {
			if file.ID <= afterID {
				return result, fmt.Errorf("file repository returned non-increasing id %d after %d", file.ID, afterID)
			}
			afterID = file.ID
			result.Scanned++

			if !isLikelyImage(file) {
				result.SkippedNonImage++
				continue
			}
			result.Eligible++

			thumbnailKey := file.ObjectKey + ".thumb.jpg"
			exists, err := storage.Exists(ctx, thumbnailKey)
			if err != nil {
				result.addFailure(file, fmt.Errorf("check thumbnail: %w", err))
				continue
			}
			if exists {
				result.SkippedExisting++
				continue
			}

			source, err := storage.Read(ctx, file.ObjectKey, options.MaxSourceBytes)
			if err != nil {
				result.addFailure(file, fmt.Errorf("read source: %w", err))
				continue
			}
			thumbnail, err := makeThumbnail(source, options)
			if err != nil {
				result.addFailure(file, err)
				continue
			}
			if err := storage.Write(ctx, thumbnailKey, thumbnail, "image/jpeg"); err != nil {
				result.addFailure(file, fmt.Errorf("write thumbnail: %w", err))
				continue
			}
			result.Created++
		}

		if len(files) < options.BatchSize {
			return result, nil
		}
	}
}

func (r *Result) addFailure(file model.File, err error) {
	r.Failed++
	r.Failures = append(r.Failures, Failure{FileID: file.ID, ObjectKey: file.ObjectKey, Err: err})
}

func normalizedOptions(options Options) Options {
	if options.MaxEdge <= 0 {
		options.MaxEdge = DefaultMaxEdge
	}
	if options.JPEGQuality <= 0 || options.JPEGQuality > 100 {
		options.JPEGQuality = DefaultJPEGQuality
	}
	if options.BatchSize <= 0 {
		options.BatchSize = DefaultBatchSize
	}
	if options.MaxSourceBytes <= 0 {
		options.MaxSourceBytes = DefaultMaxSourceBytes
	}
	if options.MaxPixels <= 0 {
		options.MaxPixels = DefaultMaxPixels
	}
	return options
}

func isLikelyImage(file model.File) bool {
	if file.DetectedContentType != nil && isImageContentType(*file.DetectedContentType) {
		return true
	}
	if isImageContentType(file.ClaimedContentType) {
		return true
	}
	return isImageExtension(file.OriginalName) || isImageExtension(file.ObjectKey)
}

func isImageContentType(value string) bool {
	value = strings.ToLower(strings.TrimSpace(strings.Split(value, ";")[0]))
	return strings.HasPrefix(value, "image/")
}

func isImageExtension(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".jpg", ".jpeg", ".png", ".gif", ".webp":
		return true
	default:
		return false
	}
}

func makeThumbnail(source []byte, options Options) ([]byte, error) {
	config, _, err := image.DecodeConfig(bytes.NewReader(source))
	if err != nil {
		return nil, fmt.Errorf("decode image header: %w", err)
	}
	if config.Width <= 0 || config.Height <= 0 || int64(config.Width)*int64(config.Height) > options.MaxPixels {
		return nil, fmt.Errorf("image dimensions %dx%d exceed safety limit", config.Width, config.Height)
	}

	decoded, _, err := image.Decode(bytes.NewReader(source))
	if err != nil {
		return nil, fmt.Errorf("decode image: %w", err)
	}
	width, height := thumbnailDimensions(decoded.Bounds().Dx(), decoded.Bounds().Dy(), options.MaxEdge)
	if width <= 0 || height <= 0 {
		return nil, fmt.Errorf("invalid decoded image dimensions")
	}

	destination := image.NewRGBA(image.Rect(0, 0, width, height))
	stddraw.Draw(destination, destination.Bounds(), image.NewUniform(color.White), image.Point{}, stddraw.Src)
	xdraw.CatmullRom.Scale(destination, destination.Bounds(), decoded, decoded.Bounds(), xdraw.Over, nil)

	var output bytes.Buffer
	if err := jpeg.Encode(&output, destination, &jpeg.Options{Quality: options.JPEGQuality}); err != nil {
		return nil, fmt.Errorf("encode thumbnail: %w", err)
	}
	return output.Bytes(), nil
}

func thumbnailDimensions(width, height, maxEdge int) (int, int) {
	if width <= 0 || height <= 0 || maxEdge <= 0 {
		return 0, 0
	}
	longest := max(width, height)
	if longest <= maxEdge {
		return width, height
	}
	if width >= height {
		return maxEdge, max(1, height*maxEdge/width)
	}
	return max(1, width*maxEdge/height), maxEdge
}

type gormFileRepository struct {
	db *gorm.DB
}

func (r *gormFileRepository) ListReadyFiles(ctx context.Context, afterID int64, limit int) ([]model.File, error) {
	var files []model.File
	err := r.db.WithContext(ctx).
		Where("status = ? AND id > ?", model.FileStatusReady, afterID).
		Order("id ASC").
		Limit(limit).
		Find(&files).Error
	return files, err
}

type minioObjectStorage struct {
	client *minio.Client
	bucket string
	prefix string
}

func (s *minioObjectStorage) Exists(ctx context.Context, key string) (bool, error) {
	_, err := s.client.StatObject(ctx, s.bucket, s.key(key), minio.StatObjectOptions{})
	if err == nil {
		return true, nil
	}
	response := minio.ToErrorResponse(err)
	if response.StatusCode == http.StatusNotFound || response.Code == "NoSuchKey" || response.Code == "NoSuchObject" || response.Code == "NotFound" {
		return false, nil
	}
	return false, err
}

func (s *minioObjectStorage) Read(ctx context.Context, key string, maxBytes int64) ([]byte, error) {
	object, err := s.client.GetObject(ctx, s.bucket, s.key(key), minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	defer object.Close()

	data, err := io.ReadAll(io.LimitReader(object, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > maxBytes {
		return nil, ErrSourceTooLarge
	}
	return data, nil
}

func (s *minioObjectStorage) Write(ctx context.Context, key string, data []byte, contentType string) error {
	_, err := s.client.PutObject(
		ctx,
		s.bucket,
		s.key(key),
		bytes.NewReader(data),
		int64(len(data)),
		minio.PutObjectOptions{ContentType: contentType},
	)
	return err
}

func (s *minioObjectStorage) key(objectKey string) string {
	prefix := strings.Trim(s.prefix, "/")
	if prefix == "" {
		return objectKey
	}
	return prefix + "/" + strings.TrimLeft(objectKey, "/")
}
