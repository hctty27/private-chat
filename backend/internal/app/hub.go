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
		s.writeMu.Lock()
		defer s.writeMu.Unlock()
		if s.conn != nil {
			_ = s.conn.Close()
			s.conn = nil
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

// Get is retained temporarily while websocket callers migrate to GetAll.
func (h *Hub) Get(userID int64) *Session {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for session := range h.sessions[userID] {
		return session
	}
	return nil
}

// Replace is retained temporarily while registration migrates to Add.
func (h *Hub) Replace(userID int64, session *Session) (old *Session) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for current := range h.sessions[userID] {
		old = current
		break
	}
	h.sessions[userID] = map[*Session]struct{}{session: {}}
	return old
}

// RemoveIfCurrent is retained temporarily while unregistration migrates to Remove.
func (h *Hub) RemoveIfCurrent(userID int64, session *Session) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	userSessions := h.sessions[userID]
	if _, ok := userSessions[session]; !ok {
		return false
	}
	delete(userSessions, session)
	if len(userSessions) == 0 {
		delete(h.sessions, userID)
		return true
	}
	return false
}
