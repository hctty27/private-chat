package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"privatechat/internal/model"
)

func TestIsLoginAlertUser(t *testing.T) {
	if !isLoginAlertUser([]string{"2", " 5 "}, 5) {
		t.Fatal("expected configured user to match")
	}
	if isLoginAlertUser([]string{"2", "5"}, 7) {
		t.Fatal("expected unconfigured user not to match")
	}
}

func TestLoginAlertClientDetails(t *testing.T) {
	device, browser, osName := loginAlertClientDetails("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1")
	if device != "手机" || browser != "Safari" || osName != "iOS" {
		t.Fatalf("unexpected iPhone details: %q %q %q", device, browser, osName)
	}

	device, browser, osName = loginAlertClientDetails("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36")
	if device != "电脑" || browser != "Chrome" || osName != "Windows" {
		t.Fatalf("unexpected desktop details: %q %q %q", device, browser, osName)
	}
}

func TestBuildLoginAlertEmailEscapesHTML(t *testing.T) {
	city := "<img src=x onerror=alert(1)>"
	content := buildLoginAlertEmail(
		model.User{ID: 2, Username: "<script>alert(1)</script>", Nickname: "tester", City: &city},
		"203.0.113.10",
		"test-agent",
		city,
		time.Date(2026, 9, 9, 16, 0, 0, 0, time.UTC),
		time.UTC,
	)

	if strings.Contains(content.HTML, "<script>alert(1)</script>") {
		t.Fatal("expected username to be HTML escaped")
	}
	if strings.Contains(content.HTML, "<img src=x onerror=alert(1)>") {
		t.Fatal("expected city to be HTML escaped")
	}
	if !strings.Contains(content.Text, "203.0.113.10") {
		t.Fatal("expected plain text to include client IP")
	}
}

func TestSendLoginAlertViaResend(t *testing.T) {
	var received resendEmailRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("unexpected method: %s", r.Method)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer re_test" {
			t.Fatalf("unexpected authorization header: %q", got)
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"email_test"}`))
	}))
	defer server.Close()

	err := sendLoginAlertViaResend(
		context.Background(),
		server.Client(),
		server.URL,
		"re_test",
		"Private Chat <login@example.com>",
		"owner@example.com",
		loginAlertEmail{Subject: "subject", Text: "text", HTML: "<strong>html</strong>"},
	)
	if err != nil {
		t.Fatalf("send login alert: %v", err)
	}
	if received.From != "Private Chat <login@example.com>" {
		t.Fatalf("unexpected from: %q", received.From)
	}
	if len(received.To) != 1 || received.To[0] != "owner@example.com" {
		t.Fatalf("unexpected recipients: %#v", received.To)
	}
	if received.Subject != "subject" {
		t.Fatalf("unexpected subject: %q", received.Subject)
	}
}
