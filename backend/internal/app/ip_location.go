package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"privatechat/internal/model"
)

const amapIPLocationEndpoint = "https://restapi.amap.com/v3/ip"

type cityResolver interface {
	Resolve(context.Context, string) (string, error)
}

type amapIPLocationResolver struct {
	apiKey   string
	endpoint string
	client   *http.Client
}

type amapIPLocationResponse struct {
	Status   string `json:"status"`
	Info     string `json:"info"`
	Province string `json:"province"`
	City     string `json:"city"`
}

func newAmapIPLocationResolver(apiKey string) cityResolver {
	key := strings.TrimSpace(apiKey)
	if key == "" {
		return nil
	}
	return &amapIPLocationResolver{
		apiKey:   key,
		endpoint: amapIPLocationEndpoint,
		client:   &http.Client{Timeout: 3 * time.Second},
	}
}

func (r *amapIPLocationResolver) Resolve(ctx context.Context, rawIP string) (string, error) {
	ip := net.ParseIP(strings.TrimSpace(rawIP))
	if ip == nil {
		return "", fmt.Errorf("invalid client ip")
	}
	if ip.IsPrivate() || ip.IsLoopback() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return "", fmt.Errorf("client ip is not publicly routable")
	}

	ipv4 := ip.To4()
	if ipv4 == nil {
		return "", fmt.Errorf("Amap basic IP location only supports IPv4")
	}

	endpoint, err := url.Parse(r.endpoint)
	if err != nil {
		return "", fmt.Errorf("parse Amap endpoint: %w", err)
	}
	query := endpoint.Query()
	query.Set("key", r.apiKey)
	query.Set("ip", ipv4.String())
	query.Set("output", "json")
	endpoint.RawQuery = query.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return "", fmt.Errorf("build Amap IP location request: %w", err)
	}

	resp, err := r.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("request Amap IP location: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("Amap IP location returned HTTP %d", resp.StatusCode)
	}

	var payload amapIPLocationResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&payload); err != nil {
		return "", fmt.Errorf("decode Amap IP location response: %w", err)
	}
	if payload.Status != "1" {
		return "", fmt.Errorf("Amap IP location failed: %s", strings.TrimSpace(payload.Info))
	}

	city := joinAdministrativeArea(payload.Province, payload.City)
	if city == "" {
		return "", fmt.Errorf("Amap IP location returned no administrative area")
	}
	return city, nil
}

func joinAdministrativeArea(parts ...string) string {
	seen := make(map[string]struct{}, len(parts))
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		value := strings.TrimSpace(part)
		if value == "" || value == "[]" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return strings.Join(result, "")
}

func (a *App) refreshUserCityOnLogin(userID int64, clientIP string) {
	if a.city == nil {
		return
	}

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		defer cancel()

		city, err := a.city.Resolve(ctx, clientIP)
		if err != nil {
			log.Printf("refresh user city skipped for user %d: %v", userID, err)
			return
		}
		if err := a.db.WithContext(ctx).
			Model(&model.User{}).
			Where("id = ?", userID).
			Update("city", city).Error; err != nil {
			log.Printf("refresh user city failed for user %d: %v", userID, err)
		}
	}()
}
