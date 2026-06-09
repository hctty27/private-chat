package app

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestHealthRouteReturnsOK(t *testing.T) {
	gin.SetMode(gin.TestMode)

	app := &App{}
	r, err := app.routes()
	if err != nil {
		t.Fatalf("routes: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d with body %q", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"ok":true`) {
		t.Fatalf("expected ok=true response, got %q", w.Body.String())
	}
}

func TestReadyHandlerReturnsOKWhenChecksPass(t *testing.T) {
	gin.SetMode(gin.TestMode)

	r := gin.New()
	r.GET("/ready", newReadyHandler([]readyCheck{
		{name: "postgres", check: func(context.Context) error { return nil }},
		{name: "redis", check: func(context.Context) error { return nil }},
	}))

	req := httptest.NewRequest(http.MethodGet, "/ready", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d with body %q", w.Code, w.Body.String())
	}
	body := w.Body.String()
	if !strings.Contains(body, `"ok":true`) || !strings.Contains(body, `"postgres":"ok"`) || !strings.Contains(body, `"redis":"ok"`) {
		t.Fatalf("expected ready ok response, got %q", body)
	}
}

func TestReadyHandlerReturnsUnavailableWhenAnyCheckFails(t *testing.T) {
	gin.SetMode(gin.TestMode)

	r := gin.New()
	r.GET("/ready", newReadyHandler([]readyCheck{
		{name: "postgres", check: func(context.Context) error { return nil }},
		{name: "redis", check: func(context.Context) error { return errors.New("redis password=secret is down") }},
	}))

	req := httptest.NewRequest(http.MethodGet, "/ready", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected status 503, got %d with body %q", w.Code, w.Body.String())
	}
	body := w.Body.String()
	if !strings.Contains(body, `"ok":false`) || !strings.Contains(body, `"redis":"unavailable"`) {
		t.Fatalf("expected unavailable response, got %q", body)
	}
	if strings.Contains(body, "password=secret") {
		t.Fatalf("expected response to hide raw dependency error, got %q", body)
	}
}

func TestConfigureGinModeRejectsInvalidMode(t *testing.T) {
	gin.SetMode(gin.TestMode)

	err := configureGinMode("invalid")
	if err == nil {
		t.Fatal("expected invalid gin mode to fail")
	}
	if !strings.Contains(err.Error(), "invalid GIN_MODE") {
		t.Fatalf("expected invalid GIN_MODE error, got %v", err)
	}
}
