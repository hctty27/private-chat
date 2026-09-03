package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestJoinAdministrativeAreaDeduplicatesMunicipality(t *testing.T) {
	got := joinAdministrativeArea("北京市", "北京市")
	if got != "北京市" {
		t.Fatalf("expected municipality without duplicate city, got %q", got)
	}
}

func TestAmapIPLocationResolverReturnsCityLevelArea(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("key") != "test-key" {
			t.Fatalf("unexpected key")
		}
		if r.URL.Query().Get("ip") != "203.0.113.10" {
			t.Fatalf("unexpected ip %q", r.URL.Query().Get("ip"))
		}
		if r.URL.Query().Get("output") != "json" {
			t.Fatalf("unexpected output %q", r.URL.Query().Get("output"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"1","info":"OK","province":"浙江省","city":"杭州市","adcode":"330100"}`))
	}))
	defer server.Close()

	resolver := &amapIPLocationResolver{
		apiKey:   "test-key",
		endpoint: server.URL,
		client:   server.Client(),
	}

	got, err := resolver.Resolve(context.Background(), "203.0.113.10")
	if err != nil {
		t.Fatalf("resolve location: %v", err)
	}
	if got != "浙江省杭州市" {
		t.Fatalf("expected city-level area, got %q", got)
	}
}

func TestAmapIPLocationResolverRejectsPrivateIP(t *testing.T) {
	resolver := &amapIPLocationResolver{
		apiKey:   "test-key",
		endpoint: "https://example.invalid",
		client:   http.DefaultClient,
	}

	if _, err := resolver.Resolve(context.Background(), "172.16.0.10"); err == nil {
		t.Fatal("expected private IP to be rejected")
	}
}

func TestAmapIPLocationResolverRejectsIPv6(t *testing.T) {
	resolver := &amapIPLocationResolver{
		apiKey:   "test-key",
		endpoint: "https://example.invalid",
		client:   http.DefaultClient,
	}

	if _, err := resolver.Resolve(context.Background(), "2001:db8::1"); err == nil {
		t.Fatal("expected IPv6 to be rejected")
	}
}
