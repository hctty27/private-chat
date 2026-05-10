package app

import (
	"context"
	"fmt"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"privatechat/internal/model"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"golang.org/x/crypto/bcrypt"
)

func (a *App) loginHandler(c *gin.Context) {
	var req model.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondError(c, http.StatusOK, 500, "请求参数错误")
		return
	}

	username := strings.TrimSpace(req.Username)
	var user model.User
	if err := a.db.Where("username = ?", username).First(&user).Error; err != nil {
		respondError(c, http.StatusOK, 500, "用户名或密码错误")
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
		respondError(c, http.StatusOK, 500, "用户名或密码错误")
		return
	}

	token, err := a.jwt.Generate(user.ID, user.Nickname)
	if err != nil {
		respondError(c, http.StatusOK, 500, "登录失败")
		return
	}
	if err := a.redis.Set(c.Request.Context(), userTokenKey(user.ID), token, a.cfg.JWTExpiration).Err(); err != nil {
		respondError(c, http.StatusOK, 500, "登录失败")
		return
	}

	a.kickUser(user.ID, "您的账号在其他地方登录")
	respondSuccess(c, model.LoginResponse{
		Token:    token,
		UserID:   user.ID,
		Nickname: user.Nickname,
	})
}

func (a *App) authMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		token := bearerToken(c.GetHeader("Authorization"))
		if token == "" {
			unauthorized(c)
			return
		}

		userID, _, err := a.jwt.Parse(token)
		if err != nil {
			unauthorized(c)
			return
		}

		stored, err := a.redis.Get(c.Request.Context(), userTokenKey(userID)).Result()
		if err != nil || stored != token {
			unauthorized(c)
			return
		}

		c.Set("userID", userID)
		c.Next()
	}
}

func (a *App) contactsHandler(c *gin.Context) {
	userID, ok := getUserID(c)
	if !ok {
		unauthorized(c)
		return
	}

	var relations []model.Relation
	if err := a.db.Where("user_id = ?", userID).Find(&relations).Error; err != nil {
		respondError(c, http.StatusOK, 500, err.Error())
		return
	}
	if len(relations) == 0 {
		respondSuccess(c, []model.ContactDTO{})
		return
	}

	targetIDs := make([]int64, 0, len(relations))
	conversationIDs := make([]string, 0, len(relations))
	for _, relation := range relations {
		targetIDs = append(targetIDs, relation.TargetID)
		conversationIDs = append(conversationIDs, conversationID(userID, relation.TargetID))
	}

	var users []model.User
	if err := a.db.Where("id IN ?", targetIDs).Find(&users).Error; err != nil {
		respondError(c, http.StatusOK, 500, err.Error())
		return
	}
	userMap := make(map[int64]model.User, len(users))
	for _, u := range users {
		userMap[u.ID] = u
	}

	onlineMap := make(map[int64]bool, len(targetIDs))
	for _, targetID := range targetIDs {
		onlineMap[targetID] = a.isOnline(c.Request.Context(), targetID)
	}

	lastMessages := make(map[string]model.Message, len(conversationIDs))
	var messages []model.Message
	if err := a.db.Where("conversation_id IN ?", conversationIDs).Order("created_at desc").Find(&messages).Error; err != nil {
		respondError(c, http.StatusOK, 500, err.Error())
		return
	}
	for _, msg := range messages {
		if _, ok := lastMessages[msg.ConversationID]; !ok {
			lastMessages[msg.ConversationID] = msg
		}
	}

	unreadCounts := make(map[string]int)
	type unreadRow struct {
		ConversationID string `gorm:"column:conversation_id"`
		UnreadCount    int    `gorm:"column:unread_count"`
	}
	var rows []unreadRow
	if err := a.db.Model(&model.Message{}).
		Select("conversation_id, COUNT(*) as unread_count").
		Where("conversation_id IN ? AND receiver_id = ? AND is_read = 0", conversationIDs, userID).
		Group("conversation_id").
		Scan(&rows).Error; err != nil {
		respondError(c, http.StatusOK, 500, err.Error())
		return
	}
	for _, row := range rows {
		unreadCounts[row.ConversationID] = row.UnreadCount
	}

	result := make([]model.ContactDTO, 0, len(relations))
	for _, relation := range relations {
		targetID := relation.TargetID
		targetUser, ok := userMap[targetID]
		if !ok {
			continue
		}
		convID := conversationID(userID, targetID)
		var lastMessage *string
		var lastMessageTime *string
		if msg, ok := lastMessages[convID]; ok {
			content := messagePreview(msg)
			lastMessage = &content
			formatted := formatLocalTime(msg.CreatedAt, a.loc)
			lastMessageTime = &formatted
		}
		result = append(result, model.ContactDTO{
			UserID:        targetID,
			Nickname:      targetUser.Nickname,
			Online:        onlineMap[targetID],
			LastMessage:   lastMessage,
			LastMessageAt: lastMessageTime,
			UnreadCount:   unreadCounts[convID],
		})
	}

	respondSuccess(c, result)
}

func (a *App) messagesHandler(c *gin.Context) {
	userID, ok := getUserID(c)
	if !ok {
		unauthorized(c)
		return
	}

	targetID, err := strconv.ParseInt(c.Param("targetId"), 10, 64)
	if err != nil || targetID <= 0 {
		respondError(c, http.StatusOK, 500, "目标用户无效")
		return
	}

	cursorStr := strings.TrimSpace(c.Query("cursor"))
	mode := strings.TrimSpace(c.Query("mode"))
	size := a.cfg.MessagePageSize
	if v := strings.TrimSpace(c.Query("size")); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil && parsed > 0 {
			size = parsed
		}
	}

	page, err := a.getMessages(c.Request.Context(), userID, targetID, cursorStr, size, mode)
	if err != nil {
		respondError(c, http.StatusOK, 500, err.Error())
		return
	}
	respondSuccess(c, page)
}

func (a *App) getMessages(ctx context.Context, userID, targetID int64, cursorStr string, size int, mode string) (model.MessagePageDTO, error) {
	_ = ctx
	convID := conversationID(userID, targetID)

	if mode == "loadMore" && cursorStr != "" {
		cursorMs, err := strconv.ParseInt(cursorStr, 10, 64)
		if err != nil {
			return model.MessagePageDTO{}, fmt.Errorf("cursor invalid")
		}
		cutoff := time.UnixMilli(cursorMs).In(a.loc)
		var messages []model.Message
		if err := a.db.Where("conversation_id = ? AND created_at < ?", convID, cutoff).
			Order("created_at desc").
			Limit(size + 1).
			Find(&messages).Error; err != nil {
			return model.MessagePageDTO{}, err
		}
		hasMore := len(messages) > size
		if hasMore {
			messages = messages[:size]
		}
		reverseMessages(messages)
		return model.MessagePageDTO{Messages: toMessageDTOs(messages, a.loc), HasMore: hasMore}, nil
	}

	var latest []model.Message
	if err := a.db.Where("conversation_id = ?", convID).
		Order("created_at desc").
		Limit(size + 1).
		Find(&latest).Error; err != nil {
		return model.MessagePageDTO{}, err
	}
	hasMore := len(latest) > size
	if hasMore {
		latest = latest[:size]
	}

	var unread []model.Message
	if err := a.db.Where("conversation_id = ? AND receiver_id = ? AND is_read = 0", convID, userID).
		Order("created_at asc").
		Find(&unread).Error; err != nil {
		return model.MessagePageDTO{}, err
	}

	seen := make(map[int64]struct{}, len(latest))
	merged := make([]model.Message, 0, len(latest)+len(unread))
	for _, msg := range latest {
		seen[msg.ID] = struct{}{}
		merged = append(merged, msg)
	}
	for _, msg := range unread {
		if _, ok := seen[msg.ID]; !ok {
			merged = append(merged, msg)
		}
	}
	sortMessages(merged)
	return model.MessagePageDTO{Messages: toMessageDTOs(merged, a.loc), HasMore: hasMore}, nil
}

const maxFileUploadSize = 100 * 1024 * 1024

func (a *App) presignUploadHandler(c *gin.Context) {
	_, ok := getUserID(c)
	if !ok {
		unauthorized(c)
		return
	}

	var req model.FilePresignUploadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondError(c, http.StatusOK, 500, "请求参数错误")
		return
	}
	resp, err := a.presignUpload(c.Request.Context(), req, time.Hour)
	if err != nil {
		respondError(c, http.StatusOK, 500, "生成上传地址失败")
		return
	}
	respondSuccess(c, resp)
}

func (a *App) presignUpload(ctx context.Context, req model.FilePresignUploadRequest, expiry time.Duration) (model.FilePresignUploadDTO, error) {
	fileName := strings.TrimSpace(req.FileName)
	if fileName == "" {
		return model.FilePresignUploadDTO{}, fmt.Errorf("file name is empty")
	}
	if req.FileSize > maxFileUploadSize {
		return model.FilePresignUploadDTO{}, fmt.Errorf("file too large")
	}

	ext := filepath.Ext(fileName)
	objectName := uuid.NewString() + ext
	contentType := strings.TrimSpace(req.ContentType)
	if contentType == "" {
		contentType = mime.TypeByExtension(strings.ToLower(ext))
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	storageKey := objectStorageKey(a.cfg.ObjectStoragePrefix, objectName)
	uploadURL, err := a.storage.PresignedPutObject(ctx, a.cfg.StorageBucket, storageKey, expiry)
	if err != nil {
		return model.FilePresignUploadDTO{}, err
	}

	return model.FilePresignUploadDTO{
		UploadURL: uploadURL.String(),
		URL:       "/api/file/download/" + objectName,
		FileName:  fileName,
		FileSize:  req.FileSize,
		Headers:   map[string]string{"Content-Type": contentType},
	}, nil
}

func (a *App) uploadHandler(c *gin.Context) {
	_, ok := getUserID(c)
	if !ok {
		unauthorized(c)
		return
	}

	fileHeader, err := c.FormFile("file")
	if err != nil {
		respondError(c, http.StatusOK, 500, "文件上传失败")
		return
	}

	file, err := fileHeader.Open()
	if err != nil {
		respondError(c, http.StatusOK, 500, "文件上传失败")
		return
	}
	defer file.Close()

	objectName := uuid.NewString() + filepath.Ext(fileHeader.Filename)
	contentType := fileHeader.Header.Get("Content-Type")
	if contentType == "" {
		contentType = mime.TypeByExtension(strings.ToLower(filepath.Ext(fileHeader.Filename)))
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	storageKey := objectStorageKey(a.cfg.ObjectStoragePrefix, objectName)
	_, err = a.storage.PutObject(c.Request.Context(), a.cfg.StorageBucket, storageKey, file, fileHeader.Size, minio.PutObjectOptions{
		ContentType: contentType,
	})
	if err != nil {
		respondError(c, http.StatusOK, 500, "文件上传失败")
		return
	}

	respondSuccess(c, model.FileUploadDTO{
		URL:      "/api/file/download/" + objectName,
		FileName: fileHeader.Filename,
		FileSize: fileHeader.Size,
	})
}

func parseSingleRange(header string, size int64) (int64, int64, error) {
	if size <= 0 || !strings.HasPrefix(header, "bytes=") {
		return 0, 0, fmt.Errorf("invalid range")
	}
	spec := strings.TrimPrefix(header, "bytes=")
	if strings.Contains(spec, ",") {
		return 0, 0, fmt.Errorf("multiple ranges are not supported")
	}
	startText, endText, ok := strings.Cut(spec, "-")
	if !ok {
		return 0, 0, fmt.Errorf("invalid range")
	}
	if startText == "" {
		suffix, err := strconv.ParseInt(endText, 10, 64)
		if err != nil || suffix <= 0 {
			return 0, 0, fmt.Errorf("invalid range")
		}
		if suffix > size {
			suffix = size
		}
		return size - suffix, size - 1, nil
	}
	start, err := strconv.ParseInt(startText, 10, 64)
	if err != nil || start < 0 || start >= size {
		return 0, 0, fmt.Errorf("invalid range")
	}
	end := size - 1
	if endText != "" {
		end, err = strconv.ParseInt(endText, 10, 64)
		if err != nil || end < start {
			return 0, 0, fmt.Errorf("invalid range")
		}
		if end >= size {
			end = size - 1
		}
	}
	return start, end, nil
}

func (a *App) downloadHandler(c *gin.Context) {
	objectName := c.Param("objectName")
	storageKey := objectStorageKey(a.cfg.ObjectStoragePrefix, objectName)

	stat, err := a.storage.StatObject(c.Request.Context(), a.cfg.StorageBucket, storageKey, minio.StatObjectOptions{})
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}

	opts := minio.GetObjectOptions{}
	status := http.StatusOK
	contentLength := stat.Size
	if rangeHeader := c.GetHeader("Range"); rangeHeader != "" {
		start, end, err := parseSingleRange(rangeHeader, stat.Size)
		if err != nil {
			c.Header("Content-Range", fmt.Sprintf("bytes */%d", stat.Size))
			c.Status(http.StatusRequestedRangeNotSatisfiable)
			return
		}
		if err := opts.SetRange(start, end); err != nil {
			c.Status(http.StatusRequestedRangeNotSatisfiable)
			return
		}
		status = http.StatusPartialContent
		contentLength = end - start + 1
		c.Header("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, stat.Size))
	}

	obj, err := a.storage.GetObject(c.Request.Context(), a.cfg.StorageBucket, storageKey, opts)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	defer obj.Close()

	contentType := stat.ContentType
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	c.Header("Accept-Ranges", "bytes")
	c.Header("Content-Type", contentType)
	c.Header("Content-Length", strconv.FormatInt(contentLength, 10))
	c.Header("Content-Disposition", fmt.Sprintf(`inline; filename="%s"`, objectName))
	c.Status(status)
	if _, err := io.Copy(c.Writer, obj); err != nil {
		return
	}
}
