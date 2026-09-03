package app

import (
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	sessionSendBuffer = 256
	sessionWriteWait  = 10 * time.Second
)

var (
	errSessionClosed        = errors.New("connection closed")
	errSessionSendQueueFull = errors.New("websocket send queue full")
)

type outboundFrame struct {
	payload    []byte
	closeAfter bool
}

type Session struct {
	userID   int64
	conn     *websocket.Conn
	send     chan outboundFrame
	done     chan struct{}
	initOnce sync.Once
	closed   sync.Once
	app      *App
}

func (s *Session) ensureChannels() {
	s.initOnce.Do(func() {
		s.send = make(chan outboundFrame, sessionSendBuffer)
		s.done = make(chan struct{})
	})
}

func (s *Session) enqueueJSON(v any, closeAfter bool) error {
	payload, err := json.Marshal(v)
	if err != nil {
		return err
	}

	s.ensureChannels()
	frame := outboundFrame{payload: payload, closeAfter: closeAfter}
	select {
	case <-s.done:
		return errSessionClosed
	default:
	}

	select {
	case s.send <- frame:
		return nil
	case <-s.done:
		return errSessionClosed
	default:
		return errSessionSendQueueFull
	}
}

func (s *Session) SendJSON(v any) error {
	return s.enqueueJSON(v, false)
}

func (s *Session) SendJSONAndClose(v any) error {
	return s.enqueueJSON(v, true)
}

func (s *Session) writePump(period time.Duration) {
	s.ensureChannels()
	if s.conn == nil {
		s.Close()
		return
	}

	ticker := time.NewTicker(period)
	defer ticker.Stop()

	for {
		select {
		case frame := <-s.send:
			_ = s.conn.SetWriteDeadline(time.Now().Add(sessionWriteWait))
			if err := s.conn.WriteMessage(websocket.TextMessage, frame.payload); err != nil {
				s.Close()
				return
			}
			if frame.closeAfter {
				s.Close()
				return
			}
		case <-ticker.C:
			_ = s.conn.SetWriteDeadline(time.Now().Add(sessionWriteWait))
			if err := s.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				s.Close()
				return
			}
		case <-s.done:
			return
		}
	}
}

func (s *Session) Close() {
	s.ensureChannels()
	s.closed.Do(func() {
		close(s.done)
		if s.conn != nil {
			_ = s.conn.Close()
		}
	})
}

type Hub struct {
	mu       sync.RWMutex
	sessions map[int64]map[*Session]struct{}
}

func NewHub() *Hub {
	return &Hub{sessions: make(map[int64]map[*Session]struct{})}
}

func (h *Hub) Add(userID int64, session *Session) bool {
	h.mu.Lock()
	defer h.mu.Unlock()

	userSessions := h.sessions[userID]
	first := len(userSessions) == 0
	if userSessions == nil {
		userSessions = make(map[*Session]struct{})
		h.sessions[userID] = userSessions
	}
	userSessions[session] = struct{}{}
	return first
}

func (h *Hub) Remove(userID int64, session *Session) bool {
	h.mu.Lock()
	defer h.mu.Unlock()

	userSessions := h.sessions[userID]
	if userSessions == nil {
		return false
	}
	if _, ok := userSessions[session]; !ok {
		return false
	}
	delete(userSessions, session)
	if len(userSessions) != 0 {
		return false
	}
	delete(h.sessions, userID)
	return true
}

func (h *Hub) GetAll(userID int64) []*Session {
	h.mu.RLock()
	defer h.mu.RUnlock()

	userSessions := h.sessions[userID]
	result := make([]*Session, 0, len(userSessions))
	for session := range userSessions {
		result = append(result, session)
	}
	return result
}

func (h *Hub) Snapshot() []*Session {
	h.mu.RLock()
	defer h.mu.RUnlock()

	count := 0
	for _, userSessions := range h.sessions {
		count += len(userSessions)
	}
	result := make([]*Session, 0, count)
	for _, userSessions := range h.sessions {
		for session := range userSessions {
			result = append(result, session)
		}
	}
	return result
}
