package app

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
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
