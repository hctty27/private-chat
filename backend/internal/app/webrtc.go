package app

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"privatechat/internal/config"

	"github.com/gin-gonic/gin"
)

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
	payload, err := buildWebRTCIceConfig(a.cfg, userID, time.Now())
	if err != nil {
		respondError(c, http.StatusInternalServerError, http.StatusInternalServerError, "获取通话配置失败")
		return
	}
	respondSuccess(c, payload)
}

func (a *App) webRTCStatusHandler(c *gin.Context) {
	respondSuccess(c, gin.H{"enabled": a.cfg.WebRTCEnabled})
}
