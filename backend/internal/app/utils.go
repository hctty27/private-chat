package app

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"privatechat/internal/model"

	"github.com/gin-gonic/gin"
)

const authCookieName = "private_chat_session"

func authTokenFromRequest(r *http.Request) string {
	if r == nil {
		return ""
	}
	cookie, err := r.Cookie(authCookieName)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(cookie.Value)
}

func websocketAuthTokenFromRequest(r *http.Request) string {
	return authTokenFromRequest(r)
}

func newAuthCookie(token string, expiry time.Duration, secure bool) *http.Cookie {
	maxAge := int(expiry / time.Second)
	if maxAge < 1 {
		maxAge = 1
	}
	return &http.Cookie{
		Name:     authCookieName,
		Value:    token,
		Path:     "/",
		Expires:  time.Now().Add(expiry).UTC(),
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
	}
}

func expiredAuthCookie(secure bool) *http.Cookie {
	return &http.Cookie{
		Name:     authCookieName,
		Value:    "",
		Path:     "/",
		Expires:  time.Unix(1, 0).UTC(),
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
	}
}

func unauthorized(c *gin.Context) {
	c.AbortWithStatusJSON(http.StatusUnauthorized, model.APIResponse[any]{
		Code:    http.StatusUnauthorized,
		Data:    nil,
		Message: "未登录或登录已过期",
	})
}

func forbidden(c *gin.Context, message string) {
	c.AbortWithStatusJSON(http.StatusForbidden, model.APIResponse[any]{
		Code:    http.StatusForbidden,
		Data:    nil,
		Message: message,
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
	fileURL := msg.FileURL
	if msg.FileID != nil && *msg.FileID > 0 {
		stable := stableFileURL(*msg.FileID)
		fileURL = &stable
	}
	var replyTo *model.MessageReplyDTO
	if msg.ReplyTo != nil {
		replyTo = &model.MessageReplyDTO{
			MessageID: msg.ReplyTo.ID,
			SenderID:  msg.ReplyTo.SenderID,
			MsgType:   msg.ReplyTo.MsgType,
			Content:   msg.ReplyTo.Content,
			FileName:  msg.ReplyTo.FileName,
		}
	}
	return model.MessageDTO{
		ID:               msg.ID,
		ConversationID:   msg.ConversationID,
		SenderID:         msg.SenderID,
		ReceiverID:       msg.ReceiverID,
		MsgType:          msg.MsgType,
		Content:          msg.Content,
		ClientMsgID:      msg.ClientMsgID,
		FileID:           msg.FileID,
		FileURL:          fileURL,
		FileName:         msg.FileName,
		FileSize:         msg.FileSize,
		IsRead:           msg.IsRead,
		CreatedAt:        formatLocalTime(msg.CreatedAt, loc),
		ReplyToMessageID: msg.ReplyToMessageID,
		ReplyTo:          replyTo,
	}
}

func formatLocalTime(t time.Time, loc *time.Location) string {
	if loc == nil {
		loc = time.Local
	}
	return t.In(loc).Format("2006-01-02T15:04:05")
}

type messageCursor struct {
	CreatedAt time.Time
	ID        int64
	HasID     bool
}

func parseMessageCursor(raw string, loc *time.Location) (messageCursor, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return messageCursor{}, fmt.Errorf("cursor invalid")
	}

	if microsText, idText, found := strings.Cut(raw, ":"); found {
		micros, err := strconv.ParseInt(microsText, 10, 64)
		if err != nil {
			return messageCursor{}, fmt.Errorf("cursor invalid")
		}
		id, err := strconv.ParseInt(idText, 10, 64)
		if err != nil || id <= 0 {
			return messageCursor{}, fmt.Errorf("cursor invalid")
		}
		return messageCursor{
			CreatedAt: time.UnixMicro(micros).In(loc),
			ID:        id,
			HasID:     true,
		}, nil
	}

	millis, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return messageCursor{}, fmt.Errorf("cursor invalid")
	}
	return messageCursor{CreatedAt: time.UnixMilli(millis).In(loc)}, nil
}

func nextMessageCursor(messages []model.Message) string {
	if len(messages) == 0 {
		return ""
	}
	oldest := messages[0]
	for _, msg := range messages[1:] {
		if msg.CreatedAt.Before(oldest.CreatedAt) || (msg.CreatedAt.Equal(oldest.CreatedAt) && msg.ID < oldest.ID) {
			oldest = msg
		}
	}
	return fmt.Sprintf("%d:%d", oldest.CreatedAt.UTC().UnixMicro(), oldest.ID)
}

func reverseMessages(messages []model.Message) {
	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}
}

func sortMessages(messages []model.Message) {
	for i := 1; i < len(messages); i++ {
		j := i
		for j > 0 {
			previous := messages[j-1]
			current := messages[j]
			if previous.CreatedAt.Before(current.CreatedAt) {
				break
			}
			if previous.CreatedAt.Equal(current.CreatedAt) && previous.ID <= current.ID {
				break
			}
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
	c.JSON(http.StatusOK, model.APIResponse[T]{
		Code:    http.StatusOK,
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
