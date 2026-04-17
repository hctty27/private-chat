package app

import (
	"errors"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Session struct {
	userID  int64
	conn    *websocket.Conn
	writeMu sync.Mutex
	closed  sync.Once
	app     *App
}

func (s *Session) SendJSON(v any) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	if s.conn == nil {
		return errors.New("connection closed")
	}
	s.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	return s.conn.WriteJSON(v)
}

func (s *Session) Close() {
	s.closed.Do(func() {
		if s.conn != nil {
			_ = s.conn.Close()
		}
	})
}

type Hub struct {
	mu       sync.RWMutex
	sessions map[int64]*Session
}

func NewHub() *Hub {
	return &Hub{sessions: make(map[int64]*Session)}
}

func (h *Hub) Get(userID int64) *Session {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.sessions[userID]
}

func (h *Hub) Snapshot() []*Session {
	h.mu.RLock()
	defer h.mu.RUnlock()
	result := make([]*Session, 0, len(h.sessions))
	for _, s := range h.sessions {
		result = append(result, s)
	}
	return result
}

func (h *Hub) Replace(userID int64, session *Session) (old *Session) {
	h.mu.Lock()
	defer h.mu.Unlock()
	old = h.sessions[userID]
	h.sessions[userID] = session
	return old
}

func (h *Hub) RemoveIfCurrent(userID int64, session *Session) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.sessions[userID] == session {
		delete(h.sessions, userID)
		return true
	}
	return false
}
