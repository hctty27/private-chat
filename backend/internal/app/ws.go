package app

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"

	"privatechat/internal/model"
)

var wsUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func (a *App) wsHandler(c *gin.Context) {
	token := strings.TrimSpace(c.Query("token"))
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

	conn, err := wsUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}

	const (
		pongWait   = 90 * time.Second
		pingPeriod = 30 * time.Second
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
			s.app.handleWsChat(s.userID, data)
		case "read":
			s.app.handleWsRead(s.userID, data)
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

func (a *App) handleWsChat(senderID int64, data map[string]any) {
	receiverID := toInt64(data["receiverId"])
	if receiverID <= 0 {
		return
	}
	msgType := int(toInt64(data["msgType"]))
	content := toOptionalString(data["content"])
	fileURL := toOptionalString(data["fileUrl"])
	fileName := toOptionalString(data["fileName"])
	fileSize := toOptionalInt64(data["fileSize"])

	saved, err := a.saveMessage(senderID, receiverID, msgType, content, fileURL, fileName, fileSize)
	if err != nil {
		log.Printf("save message failed: %v", err)
		return
	}

	if senderSession := a.hub.Get(senderID); senderSession != nil {
		_ = senderSession.SendJSON(gin.H{"type": "chat", "data": saved})
	}
	if receiverSession := a.hub.Get(receiverID); receiverSession != nil {
		_ = receiverSession.SendJSON(gin.H{"type": "chat", "data": saved})
	}
}

func (a *App) handleWsRead(userID int64, data map[string]any) {
	targetID := toInt64(data["targetId"])
	if targetID <= 0 {
		return
	}
	if err := a.markAsRead(userID, targetID); err != nil {
		log.Printf("mark as read failed: %v", err)
		return
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
	for _, session := range a.hub.Snapshot() {
		if session.userID == userID {
			continue
		}
		_ = session.SendJSON(payload)
	}
}

func (a *App) saveMessage(senderID, receiverID int64, msgType int, content, fileURL, fileName *string, fileSize *int64) (model.MessageDTO, error) {
	msg := model.Message{
		ConversationID: conversationID(senderID, receiverID),
		SenderID:       senderID,
		ReceiverID:     receiverID,
		MsgType:        msgType,
		Content:        content,
		FileURL:        fileURL,
		FileName:       fileName,
		FileSize:       fileSize,
		IsRead:         0,
	}
	if err := a.db.Create(&msg).Error; err != nil {
		return model.MessageDTO{}, err
	}
	return toMessageDTO(msg, a.loc), nil
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
