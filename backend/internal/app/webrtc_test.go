package app

import (
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"privatechat/internal/config"
)

func TestGenerateTurnCredentialUsesExpiryAndUserID(t *testing.T) {
	now := time.Unix(1_788_166_800, 0).UTC()
	username, credential := generateTurnCredential("shared-secret", 7, now, 10*time.Minute)
	if username != "1788167400:7" {
		t.Fatalf("unexpected username %q", username)
	}
	mac := hmac.New(sha1.New, []byte("shared-secret"))
	_, _ = mac.Write([]byte(username))
	expected := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	if credential != expected {
		t.Fatal("credential mismatch")
	}
}

func TestBuildWebRTCIceConfigDoesNotExposeSharedSecret(t *testing.T) {
	cfg := config.Config{
		WebRTCEnabled:           true,
		WebRTCICEPolicy:         "all",
		WebRTCStunURL:           "stun:turn.example.com:3478",
		WebRTCTurnURLs:          []string{"turn:turn.example.com:3478?transport=udp", "turn:turn.example.com:3478?transport=tcp"},
		WebRTCTurnSecret:        "server-only-secret",
		WebRTCTurnCredentialTTL: 10 * time.Minute,
	}
	result, err := buildWebRTCIceConfig(cfg, 7, time.Unix(100, 0))
	if err != nil {
		t.Fatal(err)
	}
	if result.IceTransportPolicy != "all" || len(result.IceServers) != 2 {
		t.Fatalf("unexpected ICE config: %+v", result)
	}
	for _, server := range result.IceServers {
		if server.Credential == cfg.WebRTCTurnSecret {
			t.Fatal("shared secret must never be returned to client")
		}
	}
}

func TestBuildWebRTCIceConfigRelayOmitsStunServer(t *testing.T) {
	cfg := config.Config{
		WebRTCEnabled:           true,
		WebRTCICEPolicy:         "relay",
		WebRTCStunURL:           "stun:turn.example.com:3478",
		WebRTCTurnURLs:          []string{"turn:turn.example.com:3478?transport=udp"},
		WebRTCTurnSecret:        "server-only-secret",
		WebRTCTurnCredentialTTL: 10 * time.Minute,
	}
	result, err := buildWebRTCIceConfig(cfg, 1, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(result.IceServers) != 1 || result.IceServers[0].Username == "" {
		t.Fatalf("expected only authenticated TURN server, got %+v", result)
	}
}

func TestFetchCloudflareIceServersUsesShortLivedCredentialsAndFiltersPort53(t *testing.T) {
	var receivedTTL int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("expected POST, got %s", r.Method)
		}
		if r.URL.Path != "/v1/turn/keys/key-id/credentials/generate-ice-servers" {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer api-token" {
			t.Fatalf("unexpected authorization header %q", r.Header.Get("Authorization"))
		}
		var body struct {
			TTL int64 `json:"ttl"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		receivedTTL = body.TTL
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{
			"iceServers": [
				{"urls": ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"]},
				{
					"urls": [
						"turn:turn.cloudflare.com:3478?transport=udp",
						"turn:turn.cloudflare.com:53?transport=udp",
						"turns:turn.cloudflare.com:443?transport=tcp"
					],
					"username": "short-user",
					"credential": "short-credential"
				}
			]
		}`))
	}))
	defer server.Close()

	servers, err := fetchCloudflareIceServers(
		context.Background(),
		server.Client(),
		server.URL,
		"key-id",
		"api-token",
		10*time.Minute,
	)
	if err != nil {
		t.Fatal(err)
	}
	if receivedTTL != 600 {
		t.Fatalf("expected 600 second TTL, got %d", receivedTTL)
	}
	if len(servers) != 2 {
		t.Fatalf("expected two ICE servers, got %+v", servers)
	}
	for _, iceServer := range servers {
		for _, url := range iceServer.URLs {
			if strings.Contains(url, ":53") {
				t.Fatalf("browser-blocked port 53 URL should be filtered: %q", url)
			}
		}
	}
	if servers[1].Username != "short-user" || servers[1].Credential != "short-credential" {
		t.Fatalf("unexpected Cloudflare TURN credentials: %+v", servers[1])
	}
}

func TestFetchCloudflareIceServersRejectsProviderFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "provider unavailable", http.StatusServiceUnavailable)
	}))
	defer server.Close()

	_, err := fetchCloudflareIceServers(
		context.Background(),
		server.Client(),
		server.URL,
		"key-id",
		"api-token",
		10*time.Minute,
	)
	if err == nil {
		t.Fatal("expected Cloudflare provider error")
	}
}
