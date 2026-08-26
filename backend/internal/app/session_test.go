package app

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"privatechat/internal/config"
)

func TestSessionEndpointRequiresAuthentication(t *testing.T) {
	a := &App{cfg: config.Config{TrustedProxies: nil}}
	router, err := a.routes()
	if err != nil {
		t.Fatalf("create routes: %v", err)
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/auth/session", nil)
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected status 401, got %d", recorder.Code)
	}
}
