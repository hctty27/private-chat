package app

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"privatechat/internal/auth"
	"privatechat/internal/config"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func newSessionKeepAliveTestApp(t *testing.T, redisTTL time.Duration) (*App, string, *miniredis.Miniredis) {
	t.Helper()

	mini := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mini.Addr()})
	t.Cleanup(func() { _ = client.Close() })

	cfg := config.Config{
		TrustedProxies:        nil,
		AuthCookieSecure:      false,
		JWTSecret:             "this-is-a-valid-test-secret-with-32-characters",
		JWTExpiration:         time.Hour,
		JWTAbsoluteExpiration: 30 * 24 * time.Hour,
		SessionRenewWindow:    15 * time.Minute,
	}
	manager := auth.NewJWTManager(cfg.JWTSecret, cfg.JWTAbsoluteExpiration)
	token, err := manager.Generate(42, "Tester")
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}
	if err := client.Set(t.Context(), userTokenKey(42), token, redisTTL).Err(); err != nil {
		t.Fatalf("seed redis session: %v", err)
	}

	return &App{
		cfg:   cfg,
		redis: client,
		jwt:   manager,
		hub:   NewHub(),
	}, token, mini
}

func TestKeepAliveRenewsSessionToOneHourInsideWindow(t *testing.T) {
	a, token, mini := newSessionKeepAliveTestApp(t, 10*time.Minute)
	router, err := a.routes()
	if err != nil {
		t.Fatalf("create routes: %v", err)
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/auth/keepalive", nil)
	request.AddCookie(&http.Cookie{Name: authCookieName, Value: token})
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", recorder.Code)
	}

	ttl := mini.TTL(userTokenKey(42))
	if ttl != time.Hour {
		t.Fatalf("expected redis TTL 1h, got %v", ttl)
	}

	response := recorder.Result()
	defer response.Body.Close()
	cookies := response.Cookies()
	if len(cookies) != 1 {
		t.Fatalf("expected refreshed auth cookie, got %d cookies", len(cookies))
	}
	if cookies[0].Name != authCookieName {
		t.Fatalf("expected auth cookie %q, got %q", authCookieName, cookies[0].Name)
	}
	if cookies[0].MaxAge != int(time.Hour/time.Second) {
		t.Fatalf("expected cookie max-age 1h, got %d", cookies[0].MaxAge)
	}
}

func TestKeepAliveDoesNotRenewOutsideWindow(t *testing.T) {
	a, token, mini := newSessionKeepAliveTestApp(t, 30*time.Minute)
	router, err := a.routes()
	if err != nil {
		t.Fatalf("create routes: %v", err)
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/auth/keepalive", nil)
	request.AddCookie(&http.Cookie{Name: authCookieName, Value: token})
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", recorder.Code)
	}
	if ttl := mini.TTL(userTokenKey(42)); ttl != 30*time.Minute {
		t.Fatalf("expected redis TTL unchanged at 30m, got %v", ttl)
	}
	if cookies := recorder.Result().Cookies(); len(cookies) != 0 {
		t.Fatalf("expected no Set-Cookie outside renewal window, got %d", len(cookies))
	}
}
