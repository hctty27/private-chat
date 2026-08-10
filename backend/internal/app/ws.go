package app

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"gorm.io/gorm/clause"

	"privatechat/internal/model"
)

const (
	maxWebSocketMessageSize int64 = 64 * 1024
	maxClientMsgIDLength          = 64
)

type websocketReadLimiter interface {
	SetReadLimit(int64)
}

func configureWebSocketReadLimit(conn websocketReadLimiter) {
	conn.SetReadLimit(maxWebSocketMessageSize)
}

func normalizeOrigin(raw string) (string, bool) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", false
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", false
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", false
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return "", false
	}
	return strings.ToLower(parsed.Scheme) + "://" + strings.ToLower(parsed.Host), true
}

func websocketOriginAllowed(r *http.Request, allowedOrigins []string) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	normalizedOrigin, ok := normalizeOrigin(origin)
	if !ok {
		return false
	}
	parsedOrigin, err := url.Parse(normalizedOrigin)
	if err == nil && strings.EqualFold(parsedOrigin.Host, r.Host) {
		return true
	}
	for _, allowed := range allowedOrigins {
		normalizedAllowed, ok := normalizeOrigin(allowed)
		if ok && normalizedAllowed == normalizedOrigin {
			return true
		}
	}
	return false
}

func (a *App) wsHandler(c *gin.Context) {
	token := authTokenFromRequest(c.Request)
	if token == "" {
		// Backward compatibility for already deployed clients. New sessions use the HttpOnly cookie.
		token = strings.TrimSpace(c.Query("token"))
	}
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

	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return websocketOriginAllowed(r, a.cfg.AllowedOrigins)
		},
	}
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	configureWebSocketReadLimit(conn)

	const (
		pongWait   = 120 * time.Second
		pingPeriod = 40 * time.Second
	)
	conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	session := &Session{
		userID: userID,
		conn:   conn,
		app:    a,
	}
	a.registerSession(session)
	go session.pingLoop(pingPeriod)
	session.readLoop()
}

func (s *Session) pingLoop(period time.Duration) {
	ticker := time.NewTicker(period)
	defer ticker.Stop()
	for range ticker.C {
		s.writeMu.Lock()
		if s.conn == nil {
			s.writeMu.Unlock()
			return
		}
		err := s.conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(10*time.Second))
		s.writeMu.Unlock()
		if err != nil {
			return
		}
	}
}

func (s *Session) readLoop() {
	defer s.app.unregisterSession(s)

	for {
		_, payload, err := s.conn.ReadMessage()
		if err != nil {
			return
		}
		var msg map[string]any
		if err := json.Unmarshal(payload, &msg); err != nil {
			continue
		}
		msgType, _ := msg["type"].(string)
		data, _ := msg["data"].(map[string]any)
		switch msgType {
		case "chat":
			if err := s.app.handleWsChat(s.userID, data); err != nil {
				log.Printf("handle chat failed for user %d: %v", s.userID, err)
			}
		case "read":
			if err := s.app.handleWsRead(s.userID, data); err != nil {
				log.Printf("handle read failed for user %d: %v", s.userID, err)
			}
		case "heartbeat":
			s.app.handleHeartbeat(s.userID, s)
		}
	}
}

func (a *App) registerSession(session *Session) {
	old := a.hub.Replace(session.userID, session)
	if old != nil && old != session {
		_ = old.SendJSON(gin.H{
			"type": "kicked",
			"data": gin.H{"message": "您的账号在其他地方登录"},
		})
		old.Close()
	}
	_ = a.redis.Set(context.Background(), onlineKey(session.userID), "1", 2*time.Minute).Err()
	a.broadcastOnline(session.userID, true)
}

func (a *App) unregisterSession(session *Session) {
	if a.hub.RemoveIfCurrent(session.userID, session) {
		_ = a.redis.Del(context.Background(), onlineKey(session.userID)).Err()
		a.broadcastOnline(session.userID, false)
	}
	session.Close()
}

func (a *App) kickUser(userID int64, message string) {
	if session := a.hub.Get(userID); session != nil {
		_ = session.SendJSON(gin.H{
			"type": "kicked",
			"data": gin.H{"message": message},
		})
		session.Close()
	}
}

func isFileMessageType(msgType int) bool {
	return msgType == 2 || msgType == 3 || msgType == 5
}

type wsChatPayload struct {
	receiverID  int64
	msgType     int
	content     *string
	fileID      int64
	clientMsgID *string
}

func parseWsChatPayload(data map[string]any) (wsChatPayload, error) {
	receiverID := toInt64(data["receiverId"])
	if receiverID <= 0 {
		return wsChatPayload{}, fmt.Errorf("invalid receiver")
	}

	clientMsgID, err := parseClientMsgID(data["clientMsgId"])
	if err != nil {
		return wsChatPayload{}, err
	}

	return wsChatPayload{
		receiverID:  receiverID,
		msgType:     int(toInt64(data["msgType"])),
		content:     toOptionalString(data["content"]),
		fileID:      toInt64(data["fileId"]),
		clientMsgID: clientMsgID,
	}, nil
}

func parseClientMsgID(value any) (*string, error) {
	if value == nil {
		return nil, nil
	}
	text, ok := value.(string)
	if !ok {
		return nil, fmt.Errorf("clientMsgId must be a string")
	}
	return normalizeClientMsgID(&text)
}

func normalizeClientMsgID(value *string) (*string, error) {
	if value == nil {
		return nil, nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil, nil
	}
	if utf8.RuneCountInString(trimmed) > maxClientMsgIDLength {
		return nil, fmt.Errorf("clientMsgId exceeds %d characters", maxClientMsgIDLength)
	}
	return &trimmed, nil
}

func (a *App) handleWsChat(senderID int64, data map[string]any) error {
	payload, err := parseWsChatPayload(data)
	if err != nil {
		return err
	}
	if err := a.requireContact(context.Background(), senderID, payload.receiverID); err != nil {
		return err
	}

	var attachment *model.File
	if isFileMessageType(payload.msgType) {
		if payload.fileID <= 0 {
			return fmt.Errorf("fileId is required for attachment messages")
		}
		if a.files == nil {
			return fmt.Errorf("file manager unavailable")
		}
		file, err := a.files.ResolveAttachment(context.Background(), senderID, payload.receiverID, payload.fileID)
		if err != nil {
			return fmt.Errorf("resolve attachment: %w", err)
		}
		attachment = &file
		payload.content = nil
	}

	saved, err := a.saveMessage(
		context.Background(),
		senderID,
		payload.receiverID,
		payload.msgType,
		payload.content,
		attachment,
		payload.clientMsgID,
	)
	if err != nil {
		return fmt.Errorf("save message: %w", err)
	}

	if senderSession := a.hub.Get(senderID); senderSession != nil {
		_ = senderSession.SendJSON(gin.H{"type": "chat", "data": saved})
	}
	if receiverSession := a.hub.Get(saved.ReceiverID); receiverSession != nil {
		_ = receiverSession.SendJSON(gin.H{"type": "chat", "data": saved})
	}
	return nil
}

func (a *App) handleWsRead(userID int64, data map[string]any) error {
	targetID := toInt64(data["targetId"])
	if targetID <= 0 {
		return fmt.Errorf("invalid read target")
	}
	if err := a.requireContact(context.Background(), userID, targetID); err != nil {
		return err
	}
	if err := a.markAsRead(userID, targetID); err != nil {
		return fmt.Errorf("mark as read: %w", err)
	}

	if targetSession := a.hub.Get(targetID); targetSession != nil {
		_ = targetSession.SendJSON(gin.H{
			"type": "read",
			"data": gin.H{
				"readerId":       userID,
				"conversationId": conversationID(userID, targetID),
			},
		})
	}
	return nil
}

func (a *App) handleHeartbeat(userID int64, session *Session) {
	_ = a.redis.Set(context.Background(), onlineKey(userID), "1", 2*time.Minute).Err()
	_ = session.SendJSON(gin.H{"type": "heartbeat_ack", "data": gin.H{}})
}

func (a *App) broadcastOnline(userID int64, online bool) {
	payload := gin.H{
		"type": "online",
		"data": gin.H{
			"userId": userID,
			"online": online,
		},
	}
	sessions, err := a.contactSessions(context.Background(), userID)
	if err != nil {
		log.Printf("resolve online recipients for user %d: %v", userID, err)
		return
	}
	for _, session := range sessions {
		_ = session.SendJSON(payload)
	}
}

func (a *App) saveMessage(
	ctx context.Context,
	senderID, receiverID int64,
	msgType int,
	content *string,
	attachment *model.File,
	clientMsgID *string,
) (model.MessageDTO, error) {
	msg := model.Message{
		ConversationID: conversationID(senderID, receiverID),
		SenderID:       senderID,
		ReceiverID:     receiverID,
		MsgType:        msgType,
		Content:        content,
		ClientMsgID:    clientMsgID,
		IsRead:         0,
	}
	if attachment != nil {
		fileID := attachment.ID
		fileURL := stableFileURL(fileID)
		fileName := attachment.OriginalName
		fileSize := attachment.ExpectedSize
		if attachment.ActualSize != nil {
			fileSize = *attachment.ActualSize
		}
		msg.FileID = &fileID
		msg.FileURL = &fileURL
		msg.FileName = &fileName
		msg.FileSize = &fileSize
	}

	db := a.db.WithContext(ctx)
	if clientMsgID == nil {
		if err := db.Create(&msg).Error; err != nil {
			return model.MessageDTO{}, err
		}
		return toMessageDTO(msg, a.loc), nil
	}

	result := db.Clauses(clause.OnConflict{DoNothing: true}).Create(&msg)
	if result.Error != nil {
		return model.MessageDTO{}, result.Error
	}
	if result.RowsAffected == 1 {
		return toMessageDTO(msg, a.loc), nil
	}

	var existing model.Message
	if err := db.
		Where("sender_id = ? AND client_msg_id = ?", senderID, *clientMsgID).
		First(&existing).Error; err != nil {
		return model.MessageDTO{}, err
	}
	return toMessageDTO(existing, a.loc), nil
}

func (a *App) markAsRead(userID, targetID int64) error {
	return a.db.Model(&model.Message{}).
		Where("conversation_id = ? AND receiver_id = ? AND sender_id = ? AND is_read = 0", conversationID(userID, targetID), userID, targetID).
		Update("is_read", 1).Error
}

func (a *App) isOnline(ctx context.Context, userID int64) bool {
	ok, err := a.redis.Exists(ctx, onlineKey(userID)).Result()
	return err == nil && ok > 0
}
