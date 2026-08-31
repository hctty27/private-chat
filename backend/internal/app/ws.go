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
	token := websocketAuthTokenFromRequest(c.Request)
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
		default:
			if isCallWebSocketType(msgType) {
				if err := s.app.handleWsCall(s.userID, msgType, data); err != nil {
					log.Printf("handle call signal failed for user %d: %v", s.userID, err)
				}
			}
		}
	}
}

func (a *App) registerSession(session *Session) {
	if !a.hub.Add(session.userID, session) {
		return
	}

	ctx := context.Background()
	now := time.Now().UTC()
	_ = a.redis.Set(ctx, onlineKey(session.userID), "1", 2*time.Minute).Err()
	if a.presence != nil {
		if err := a.presence.PersistImmediate(ctx, session.userID, now); err != nil {
			log.Printf("persist last seen on connect for user %d: %v", session.userID, err)
		}
		if err := a.presence.ArmThrottle(ctx, session.userID); err != nil {
			log.Printf("arm last seen throttle for user %d: %v", session.userID, err)
		}
	}
	a.broadcastOnline(session.userID, true, nil)
}

func (a *App) unregisterSession(session *Session) {
	if a.hub.Remove(session.userID, session) {
		ctx := context.Background()
		if a.calls != nil {
			a.calls.Disconnect(ctx, session.userID)
		}
		now := time.Now().UTC()
		_ = a.redis.Del(ctx, onlineKey(session.userID)).Err()
		if a.presence != nil {
			if err := a.presence.PersistImmediate(ctx, session.userID, now); err != nil {
				log.Printf("persist last seen on disconnect for user %d: %v", session.userID, err)
			}
		}
		a.broadcastOnline(session.userID, false, &now)
	}
	session.Close()
}

func (a *App) sendToUser(userID int64, payload any) {
	for _, session := range a.hub.GetAll(userID) {
		_ = session.SendJSON(payload)
	}
}

func (a *App) kickUser(userID int64, message string) {
	payload := gin.H{
		"type": "kicked",
		"data": gin.H{"message": message},
	}
	for _, session := range a.hub.GetAll(userID) {
		_ = session.SendJSON(payload)
		session.Close()
	}
}

func isFileMessageType(msgType int) bool {
	return msgType == 2 || msgType == 3 || msgType == 5 || msgType == 6
}

type wsChatPayload struct {
	receiverID       int64
	msgType          int
	content          *string
	fileID           int64
	clientMsgID      *string
	replyToMessageID *int64
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
	replyToMessageID, err := parseReplyToMessageID(data["replyToMessageId"])
	if err != nil {
		return wsChatPayload{}, err
	}

	return wsChatPayload{
		receiverID:       receiverID,
		msgType:          int(toInt64(data["msgType"])),
		content:          toOptionalString(data["content"]),
		fileID:           toInt64(data["fileId"]),
		clientMsgID:      clientMsgID,
		replyToMessageID: replyToMessageID,
	}, nil
}

func parseReplyToMessageID(value any) (*int64, error) {
	if value == nil {
		return nil, nil
	}
	messageID := toInt64(value)
	if messageID <= 0 {
		return nil, fmt.Errorf("replyToMessageId must be a positive integer")
	}
	return &messageID, nil
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
	ctx := context.Background()
	if err := a.requireContact(ctx, senderID, payload.receiverID); err != nil {
		return err
	}

	var replyTo *model.Message
	if payload.replyToMessageID != nil {
		var original model.Message
		if err := a.db.WithContext(ctx).
			Where("id = ? AND conversation_id = ?", *payload.replyToMessageID, conversationID(senderID, payload.receiverID)).
			First(&original).Error; err != nil {
			return fmt.Errorf("reply message unavailable")
		}
		replyTo = &original
	}

	var attachment *model.File
	if isFileMessageType(payload.msgType) {
		if payload.fileID <= 0 {
			return fmt.Errorf("fileId is required for attachment messages")
		}
		if a.files == nil {
			return fmt.Errorf("file manager unavailable")
		}
		file, err := a.files.ResolveAttachment(ctx, senderID, payload.receiverID, payload.fileID)
		if err != nil {
			return fmt.Errorf("resolve attachment: %w", err)
		}
		attachment = &file
		payload.content = nil
	}

	saved, err := a.saveMessageWithReply(
		ctx,
		senderID,
		payload.receiverID,
		payload.msgType,
		payload.content,
		attachment,
		payload.clientMsgID,
		replyTo,
	)
	if err != nil {
		return fmt.Errorf("save message: %w", err)
	}

	a.sendToUser(senderID, gin.H{"type": "chat", "data": saved})
	a.sendToUser(saved.ReceiverID, gin.H{"type": "chat", "data": saved})
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

	a.sendToUser(targetID, gin.H{
		"type": "read",
		"data": gin.H{
			"readerId":       userID,
			"conversationId": conversationID(userID, targetID),
		},
	})
	return nil
}

func (a *App) handleHeartbeat(userID int64, session *Session) {
	ctx := context.Background()
	now := time.Now().UTC()
	_ = a.redis.Set(ctx, onlineKey(userID), "1", 2*time.Minute).Err()
	if a.presence != nil {
		if err := a.presence.PersistThrottled(ctx, userID, now); err != nil {
			log.Printf("persist last seen heartbeat for user %d: %v", userID, err)
		}
	}
	_ = session.SendJSON(gin.H{"type": "heartbeat_ack", "data": gin.H{}})
}

func (a *App) broadcastOnline(userID int64, online bool, lastSeenAt *time.Time) {
	payload := onlinePresencePayload(userID, online, lastSeenAt)
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
	return a.saveMessageWithReply(ctx, senderID, receiverID, msgType, content, attachment, clientMsgID, nil)
}

func (a *App) saveMessageWithReply(
	ctx context.Context,
	senderID, receiverID int64,
	msgType int,
	content *string,
	attachment *model.File,
	clientMsgID *string,
	replyTo *model.Message,
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
	if replyTo != nil {
		replyToMessageID := replyTo.ID
		msg.ReplyToMessageID = &replyToMessageID
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
		msg.ReplyTo = replyTo
		return toMessageDTO(msg, a.loc), nil
	}

	result := db.Clauses(clause.OnConflict{DoNothing: true}).Create(&msg)
	if result.Error != nil {
		return model.MessageDTO{}, result.Error
	}
	if result.RowsAffected == 1 {
		msg.ReplyTo = replyTo
		return toMessageDTO(msg, a.loc), nil
	}

	var existing model.Message
	if err := db.
		Preload("ReplyTo").
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
