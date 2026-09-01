package app

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"privatechat/internal/config"

	"github.com/gin-gonic/gin"
)

const cloudflareTurnAPIBaseURL = "https://rtc.live.cloudflare.com"

var cloudflareTurnHTTPClient = &http.Client{Timeout: 5 * time.Second}

type webRTCIceServer struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}

type webRTCIceConfig struct {
	IceServers         []webRTCIceServer `json:"iceServers"`
	IceTransportPolicy string            `json:"iceTransportPolicy"`
}

func generateTurnCredential(secret string, userID int64, now time.Time, ttl time.Duration) (string, string) {
	expiry := now.Add(ttl).Unix()
	username := strconv.FormatInt(expiry, 10) + ":" + strconv.FormatInt(userID, 10)
	mac := hmac.New(sha1.New, []byte(secret))
	_, _ = mac.Write([]byte(username))
	return username, base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

func buildWebRTCIceConfig(cfg config.Config, userID int64, now time.Time) (webRTCIceConfig, error) {
	if !cfg.WebRTCEnabled {
		return webRTCIceConfig{}, fmt.Errorf("webrtc disabled")
	}
	if userID <= 0 {
		return webRTCIceConfig{}, fmt.Errorf("invalid user")
	}

	servers := make([]webRTCIceServer, 0, 2)
	if cfg.WebRTCICEPolicy == "all" && cfg.WebRTCStunURL != "" {
		servers = append(servers, webRTCIceServer{URLs: []string{cfg.WebRTCStunURL}})
	}
	username, credential := generateTurnCredential(
		cfg.WebRTCTurnSecret,
		userID,
		now.UTC(),
		cfg.WebRTCTurnCredentialTTL,
	)
	servers = append(servers, webRTCIceServer{
		URLs:       append([]string(nil), cfg.WebRTCTurnURLs...),
		Username:   username,
		Credential: credential,
	})
	return webRTCIceConfig{
		IceServers:         servers,
		IceTransportPolicy: cfg.WebRTCICEPolicy,
	}, nil
}

func fetchCloudflareIceServers(
	ctx context.Context,
	client *http.Client,
	apiBaseURL string,
	keyID string,
	apiToken string,
	ttl time.Duration,
) ([]webRTCIceServer, error) {
	ttlSeconds := int64(ttl / time.Second)
	if ttlSeconds <= 0 {
		return nil, fmt.Errorf("cloudflare turn credential TTL must be at least one second")
	}

	body, err := json.Marshal(struct {
		TTL int64 `json:"ttl"`
	}{TTL: ttlSeconds})
	if err != nil {
		return nil, fmt.Errorf("encode cloudflare turn request: %w", err)
	}

	endpoint := strings.TrimRight(apiBaseURL, "/") +
		"/v1/turn/keys/" + url.PathEscape(keyID) +
		"/credentials/generate-ice-servers"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create cloudflare turn request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request cloudflare turn credentials: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("cloudflare turn credential request returned status %d", resp.StatusCode)
	}

	var payload struct {
		IceServers []webRTCIceServer `json:"iceServers"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode cloudflare turn credentials: %w", err)
	}

	servers := filterBrowserSafeIceServers(payload.IceServers)
	if len(servers) == 0 {
		return nil, fmt.Errorf("cloudflare turn returned no browser-safe ICE servers")
	}
	return servers, nil
}

func filterBrowserSafeIceServers(servers []webRTCIceServer) []webRTCIceServer {
	filtered := make([]webRTCIceServer, 0, len(servers))
	for _, server := range servers {
		urls := make([]string, 0, len(server.URLs))
		for _, iceURL := range server.URLs {
			base := strings.SplitN(iceURL, "?", 2)[0]
			if strings.HasSuffix(base, ":53") {
				continue
			}
			urls = append(urls, iceURL)
		}
		if len(urls) == 0 {
			continue
		}
		server.URLs = urls
		filtered = append(filtered, server)
	}
	return filtered
}

func webRTCTurnProvider(cfg config.Config) string {
	provider := strings.TrimSpace(cfg.WebRTCTurnProvider)
	if provider == "" {
		return "coturn"
	}
	return provider
}

func (a *App) iceConfigHandler(c *gin.Context) {
	if !a.cfg.WebRTCEnabled {
		respondError(c, http.StatusServiceUnavailable, http.StatusServiceUnavailable, "语音通话未启用")
		return
	}
	userID, ok := getUserID(c)
	if !ok {
		unauthorized(c)
		return
	}

	var payload webRTCIceConfig
	var err error

	switch webRTCTurnProvider(a.cfg) {
	case "cloudflare":
		var servers []webRTCIceServer
		servers, err = fetchCloudflareIceServers(
			c.Request.Context(),
			cloudflareTurnHTTPClient,
			cloudflareTurnAPIBaseURL,
			a.cfg.CloudflareTurnKeyID,
			a.cfg.CloudflareTurnAPIToken,
			a.cfg.WebRTCTurnCredentialTTL,
		)
		if err == nil {
			payload = webRTCIceConfig{
				IceServers:         servers,
				IceTransportPolicy: a.cfg.WebRTCICEPolicy,
			}
		}
	case "coturn":
		payload, err = buildWebRTCIceConfig(a.cfg, userID, time.Now())
	default:
		err = fmt.Errorf("unsupported TURN provider")
	}

	if err != nil {
		respondError(c, http.StatusServiceUnavailable, http.StatusServiceUnavailable, "获取通话配置失败")
		return
	}
	respondSuccess(c, payload)
}

func (a *App) webRTCStatusHandler(c *gin.Context) {
	respondSuccess(c, gin.H{"enabled": a.cfg.WebRTCEnabled})
}
