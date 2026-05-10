package app

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"privatechat/internal/model"

	"github.com/gin-gonic/gin"
)

func bearerToken(header string) string {
	header = strings.TrimSpace(header)
	if strings.HasPrefix(header, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
	}
	return ""
}

func unauthorized(c *gin.Context) {
	c.AbortWithStatusJSON(401, model.APIResponse[any]{
		Code:    401,
		Data:    nil,
		Message: "未登录或登录已过期",
	})
}

func getUserID(c *gin.Context) (int64, bool) {
	v, ok := c.Get("userID")
	if !ok {
		return 0, false
	}
	userID, ok := v.(int64)
	return userID, ok
}

func conversationID(a, b int64) string {
	if a < b {
		return fmt.Sprintf("%d_%d", a, b)
	}
	return fmt.Sprintf("%d_%d", b, a)
}

func userTokenKey(userID int64) string {
	return fmt.Sprintf("user:token:%d", userID)
}

func onlineKey(userID int64) string {
	return fmt.Sprintf("online:%d", userID)
}

func toMessageDTOs(messages []model.Message, loc *time.Location) []model.MessageDTO {
	result := make([]model.MessageDTO, 0, len(messages))
	for _, msg := range messages {
		result = append(result, toMessageDTO(msg, loc))
	}
	return result
}

func toMessageDTO(msg model.Message, loc *time.Location) model.MessageDTO {
	return model.MessageDTO{
		ID:             msg.ID,
		ConversationID: msg.ConversationID,
		SenderID:       msg.SenderID,
		ReceiverID:     msg.ReceiverID,
		MsgType:        msg.MsgType,
		Content:        msg.Content,
		FileURL:        msg.FileURL,
		FileName:       msg.FileName,
		FileSize:       msg.FileSize,
		IsRead:         msg.IsRead,
		CreatedAt:      formatLocalTime(msg.CreatedAt, loc),
	}
}

func formatLocalTime(t time.Time, loc *time.Location) string {
	if loc == nil {
		loc = time.Local
	}
	return t.In(loc).Format("2006-01-02T15:04:05")
}

func reverseMessages(messages []model.Message) {
	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}
}

func sortMessages(messages []model.Message) {
	for i := 1; i < len(messages); i++ {
		j := i
		for j > 0 && messages[j-1].CreatedAt.After(messages[j].CreatedAt) {
			messages[j-1], messages[j] = messages[j], messages[j-1]
			j--
		}
	}
}

func messagePreview(msg model.Message) string {
	switch msg.MsgType {
	case 1:
		if msg.Content != nil {
			return *msg.Content
		}
	case 2:
		return "[图片]"
	case 3:
		if msg.FileName != nil {
			return "[文件] " + *msg.FileName
		}
		return "[文件]"
	case 4:
		if msg.Content != nil {
			return *msg.Content
		}
	case 5:
		return "[视频]"
	}
	return "[消息]"
}

func toOptionalString(v any) *string {
	switch x := v.(type) {
	case nil:
		return nil
	case string:
		if x == "null" {
			return nil
		}
		return &x
	default:
		s := fmt.Sprint(x)
		if s == "" || s == "<nil>" || s == "null" {
			return nil
		}
		return &s
	}
}

func toOptionalInt64(v any) *int64 {
	switch x := v.(type) {
	case nil:
		return nil
	case float64:
		n := int64(x)
		return &n
	case int64:
		return &x
	case int:
		n := int64(x)
		return &n
	case string:
		if x == "" || x == "null" {
			return nil
		}
		if n, err := strconv.ParseInt(x, 10, 64); err == nil {
			return &n
		}
		return nil
	default:
		return nil
	}
}

func toInt64(v any) int64 {
	switch x := v.(type) {
	case float64:
		return int64(x)
	case int64:
		return x
	case int:
		return int64(x)
	case string:
		n, _ := strconv.ParseInt(x, 10, 64)
		return n
	default:
		return 0
	}
}

func respondSuccess[T any](c *gin.Context, data T) {
	c.JSON(200, model.APIResponse[T]{
		Code:    200,
		Data:    data,
		Message: "",
	})
}

func respondError(c *gin.Context, status int, code int, message string) {
	c.JSON(status, model.APIResponse[any]{
		Code:    code,
		Data:    nil,
		Message: message,
	})
}
