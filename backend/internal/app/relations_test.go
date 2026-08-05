package app

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"privatechat/internal/config"

	"github.com/gin-gonic/gin"
)

type fakeRelationAuthorizer struct {
	allowed    bool
	contactIDs []int64
	err        error
}

func (f fakeRelationAuthorizer) IsContact(context.Context, int64, int64) (bool, error) {
	return f.allowed, f.err
}

func (f fakeRelationAuthorizer) ContactIDs(context.Context, int64) ([]int64, error) {
	return append([]int64(nil), f.contactIDs...), f.err
}

func TestMessagesRouteRejectsNonContact(t *testing.T) {
	gin.SetMode(gin.TestMode)
	a := &App{
		cfg:       config.Config{MessagePageSize: 20},
		relations: fakeRelationAuthorizer{allowed: false},
	}
	r := gin.New()
	r.GET(
		"/api/messages/:targetId",
		func(c *gin.Context) { c.Set("userID", int64(1)) },
		a.requireContactParam("targetId"),
		a.messagesHandler,
	)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/messages/2", nil)
	r.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("expected status 403, got %d", recorder.Code)
	}
}

func TestHandleWsChatRejectsNonContact(t *testing.T) {
	a := &App{relations: fakeRelationAuthorizer{allowed: false}}

	err := a.handleWsChat(1, map[string]any{
		"receiverId": float64(2),
		"msgType":    float64(1),
		"content":    "hello",
	})

	if !errors.Is(err, errContactForbidden) {
		t.Fatalf("expected contact forbidden error, got %v", err)
	}
}

func TestHandleWsReadRejectsNonContact(t *testing.T) {
	a := &App{relations: fakeRelationAuthorizer{allowed: false}}

	err := a.handleWsRead(1, map[string]any{"targetId": float64(2)})

	if !errors.Is(err, errContactForbidden) {
		t.Fatalf("expected contact forbidden error, got %v", err)
	}
}

func TestContactSessionsOnlyReturnsContacts(t *testing.T) {
	hub := NewHub()
	hub.Replace(2, &Session{userID: 2})
	hub.Replace(3, &Session{userID: 3})
	hub.Replace(4, &Session{userID: 4})
	a := &App{
		hub:       hub,
		relations: fakeRelationAuthorizer{contactIDs: []int64{2, 4}},
	}

	sessions, err := a.contactSessions(context.Background(), 1)
	if err != nil {
		t.Fatalf("resolve contact sessions: %v", err)
	}
	if len(sessions) != 2 {
		t.Fatalf("expected 2 contact sessions, got %d", len(sessions))
	}
	if sessions[0].userID != 2 || sessions[1].userID != 4 {
		t.Fatalf("unexpected contact sessions: %d, %d", sessions[0].userID, sessions[1].userID)
	}
}
