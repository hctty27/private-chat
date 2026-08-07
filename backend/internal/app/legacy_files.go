package app

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"privatechat/internal/model"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type legacyObjectFinder interface {
	FindByObjectKey(context.Context, string) ([]model.File, error)
}

func (r gormFileRepository) FindByObjectKey(ctx context.Context, objectKey string) ([]model.File, error) {
	var files []model.File
	err := r.db.WithContext(ctx).
		Where("object_key = ? AND status = ?", objectKey, model.FileStatusReady).
		Find(&files).Error
	return files, err
}

func (m *fileManager) LegacyObjectAllowed(ctx context.Context, userID int64, objectName string) (bool, error) {
	objectName = strings.TrimSpace(strings.TrimLeft(objectName, "/"))
	if userID <= 0 || objectName == "" || strings.Contains(objectName, "/") || strings.Contains(objectName, "\\") {
		return false, nil
	}
	finder, ok := m.repo.(legacyObjectFinder)
	if !ok {
		return false, errors.New("legacy object lookup unsupported")
	}
	files, err := finder.FindByObjectKey(ctx, objectName)
	if err != nil {
		return false, err
	}
	for _, file := range files {
		if conversationContainsUser(file.ConversationID, userID) {
			return true, nil
		}
	}
	return false, nil
}

func (a *App) requireLegacyFileAccess() gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := getUserID(c)
		if !ok {
			unauthorized(c)
			return
		}
		allowed, err := a.files.LegacyObjectAllowed(c.Request.Context(), userID, c.Param("objectName"))
		if err != nil {
			respondError(c, http.StatusBadGateway, http.StatusBadGateway, "文件授权暂时不可用")
			c.Abort()
			return
		}
		if !allowed {
			forbidden(c, "无权访问该文件")
			return
		}
		c.Next()
	}
}

var _ legacyObjectFinder = gormFileRepository{}
var _ = gorm.ErrRecordNotFound
