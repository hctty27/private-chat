package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

type websocketPairResult struct {
	conn *websocket.Conn
	err  error
}

func newWebSocketPair(t *testing.T) (*websocket.Conn, *websocket.Conn) {
	t.Helper()

	resultCh := make(chan websocketPairResult, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := (&websocket.Upgrader{
			CheckOrigin: func(*http.Request) bool { return true },
		}).Upgrade(w, r, nil)
		resultCh <- websocketPairResult{conn: conn, err: err}
	}))
	t.Cleanup(server.Close)

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")
	clientConn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial websocket test server: %v", err)
	}

	result := <-resultCh
	if result.err != nil {
		_ = clientConn.Close()
		t.Fatalf("upgrade websocket test connection: %v", result.err)
	}

	t.Cleanup(func() {
		_ = clientConn.Close()
		_ = result.conn.Close()
	})
	return result.conn, clientConn
}

func readWebSocketJSON(t *testing.T, conn *websocket.Conn) map[string]any {
	t.Helper()
	if err := conn.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatalf("set read deadline: %v", err)
	}
	var payload map[string]any
	if err := conn.ReadJSON(&payload); err != nil {
		t.Fatalf("read websocket json: %v", err)
	}
	return payload
}

func newWritableTestSession(t *testing.T, userID int64, conn *websocket.Conn) *Session {
	t.Helper()
	session := &Session{userID: userID, conn: conn}
	go session.writePump(time.Hour)
	t.Cleanup(session.Close)
	return session
}

func TestRegisterSessionAllowsAdditionalTab(t *testing.T) {
	a := &App{hub: NewHub()}
	first := &Session{userID: 7}
	second := &Session{userID: 7}
	a.hub.Add(7, first)

	a.registerSession(second)

	sessions := a.hub.GetAll(7)
	if len(sessions) != 2 {
		t.Fatalf("expected both tabs to remain registered, got %d sessions", len(sessions))
	}
	foundFirst := false
	foundSecond := false
	for _, session := range sessions {
		foundFirst = foundFirst || session == first
		foundSecond = foundSecond || session == second
	}
	if !foundFirst || !foundSecond {
		t.Fatalf("expected both websocket sessions, got %#v", sessions)
	}
}

func TestSendToUserReachesEverySession(t *testing.T) {
	firstServer, firstClient := newWebSocketPair(t)
	secondServer, secondClient := newWebSocketPair(t)

	a := &App{hub: NewHub()}
	a.hub.Add(7, newWritableTestSession(t, 7, firstServer))
	a.hub.Add(7, newWritableTestSession(t, 7, secondServer))

	a.sendToUser(7, gin.H{"type": "test"})

	if got := readWebSocketJSON(t, firstClient)["type"]; got != "test" {
		t.Fatalf("first session received unexpected type: %v", got)
	}
	if got := readWebSocketJSON(t, secondClient)["type"]; got != "test" {
		t.Fatalf("second session received unexpected type: %v", got)
	}
}

func TestKickUserReachesEverySession(t *testing.T) {
	firstServer, firstClient := newWebSocketPair(t)
	secondServer, secondClient := newWebSocketPair(t)

	a := &App{hub: NewHub()}
	a.hub.Add(7, newWritableTestSession(t, 7, firstServer))
	a.hub.Add(7, newWritableTestSession(t, 7, secondServer))

	a.kickUser(7, "relogin")

	for index, clientConn := range []*websocket.Conn{firstClient, secondClient} {
		payload := readWebSocketJSON(t, clientConn)
		if got := payload["type"]; got != "kicked" {
			t.Fatalf("session %d received unexpected type: %v", index, got)
		}
		data, ok := payload["data"].(map[string]any)
		if !ok || data["message"] != "relogin" {
			t.Fatalf("session %d received unexpected data: %#v", index, payload["data"])
		}
	}
}

func TestSessionSendQueueRejectsSlowClientWithoutBlocking(t *testing.T) {
	session := &Session{}
	for i := 0; i < sessionSendBuffer; i++ {
		if err := session.SendJSON(gin.H{"type": "queued", "index": i}); err != nil {
			t.Fatalf("fill send queue at %d: %v", i, err)
		}
	}

	started := time.Now()
	err := session.SendJSON(gin.H{"type": "overflow"})
	if err != errSessionSendQueueFull {
		t.Fatalf("expected queue-full error, got %v", err)
	}
	if elapsed := time.Since(started); elapsed > 100*time.Millisecond {
		t.Fatalf("queue overflow blocked for %s", elapsed)
	}
}
