package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"privatechat/internal/config"
)

func TestUnauthenticatedFileDownloadIsRejected(t *testing.T) {
	a := &App{cfg: config.Config{TrustedProxies: nil}}
	router, err := a.routes()
	if err != nil {
		t.Fatalf("create routes: %v", err)
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/file/download/example.txt", nil)
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected status 401, got %d", recorder.Code)
	}
}

func TestWebSocketOriginAllowsRequestsWithoutOrigin(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "http://chat.example.com/ws/chat", nil)

	if !websocketOriginAllowed(request, nil) {
		t.Fatal("expected request without Origin to be allowed")
	}
}

func TestWebSocketOriginAllowsSameOrigin(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "https://chat.example.com/ws/chat", nil)
	request.Header.Set("Origin", "https://chat.example.com")

	if !websocketOriginAllowed(request, nil) {
		t.Fatal("expected same-origin request to be allowed")
	}
}

func TestWebSocketOriginAllowsConfiguredOrigin(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "https://chat.example.com/ws/chat", nil)
	request.Header.Set("Origin", "https://admin.example.com")

	if !websocketOriginAllowed(request, []string{"https://admin.example.com"}) {
		t.Fatal("expected configured origin to be allowed")
	}
}

func TestWebSocketOriginRejectsUnlistedCrossOrigin(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "https://chat.example.com/ws/chat", nil)
	request.Header.Set("Origin", "https://evil.example.com")

	if websocketOriginAllowed(request, nil) {
		t.Fatal("expected unlisted cross-origin request to be rejected")
	}
}

type fakeReadLimiter struct {
	limit int64
}

func (f *fakeReadLimiter) SetReadLimit(limit int64) {
	f.limit = limit
}

func TestConfigureWebSocketReadLimitUses64KiB(t *testing.T) {
	limiter := &fakeReadLimiter{}

	configureWebSocketReadLimit(limiter)

	if limiter.limit != 64*1024 {
		t.Fatalf("expected 64 KiB read limit, got %d", limiter.limit)
	}
}

func TestAuthTokenFallsBackToHttpOnlyCookie(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "https://chat.example.com/api/file/download/example.txt", nil)
	request.AddCookie(&http.Cookie{Name: authCookieName, Value: "cookie-token"})

	if token := authTokenFromRequest(request); token != "cookie-token" {
		t.Fatalf("expected cookie token, got %q", token)
	}
}

func TestAuthCookieUsesSecureBrowserDefaults(t *testing.T) {
	cookie := newAuthCookie("token", time.Hour, true)

	if !cookie.HttpOnly {
		t.Fatal("expected auth cookie to be HttpOnly")
	}
	if !cookie.Secure {
		t.Fatal("expected auth cookie to be Secure")
	}
	if cookie.SameSite != http.SameSiteStrictMode {
		t.Fatalf("expected SameSite=Strict, got %v", cookie.SameSite)
	}
	if cookie.Path != "/" {
		t.Fatalf("expected cookie path /, got %q", cookie.Path)
	}
	if !strings.Contains(cookie.Name, "session") {
		t.Fatalf("expected session cookie name, got %q", cookie.Name)
	}
}
