package app

import "strings"

const (
	maxImageUploadSize   int64 = 50 * 1024 * 1024
	maxVideoUploadSize   int64 = 500 * 1024 * 1024
	maxGenericUploadSize int64 = 500 * 1024 * 1024

	multipartUploadThreshold int64 = 100 * 1024 * 1024
	multipartUploadPartSize  int64 = 16 * 1024 * 1024
)

func maxUploadSizeFor(contentType string) int64 {
	contentType = strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	switch {
	case strings.HasPrefix(contentType, "image/"):
		return maxImageUploadSize
	case strings.HasPrefix(contentType, "video/"):
		return maxVideoUploadSize
	default:
		return maxGenericUploadSize
	}
}

func shouldUseMultipartUpload(fileSize int64) bool {
	return fileSize > multipartUploadThreshold
}
