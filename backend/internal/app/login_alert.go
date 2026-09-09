package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"log"
	"net/http"
	"net/mail"
	"strconv"
	"strings"
	"time"

	"privatechat/internal/model"
)

const (
	loginAlertDedupTTL    = 5 * time.Minute
	loginAlertSendTimeout = 10 * time.Second
	resendEmailEndpoint   = "https://api.resend.com/emails"
)

var loginAlertHTTPClient = &http.Client{Timeout: loginAlertSendTimeout}

type loginAlertEmail struct {
	Subject string
	Text    string
	HTML    string
}

type resendEmailRequest struct {
	From    string   `json:"from"`
	To      []string `json:"to"`
	Subject string   `json:"subject"`
	HTML    string   `json:"html"`
	Text    string   `json:"text"`
}

func (a *App) notifyLoginAlertAsync(user model.User, clientIP, userAgent string) {
	if a == nil || a.redis == nil || user.ID <= 0 || !isLoginAlertUser(a.cfg.LoginAlertUserIDs, user.ID) {
		return
	}

	apiKey := strings.TrimSpace(a.cfg.ResendAPIKey)
	from := strings.TrimSpace(a.cfg.ResendFrom)
	to := strings.TrimSpace(a.cfg.LoginAlertEmail)
	clientIP = strings.TrimSpace(clientIP)
	userAgent = strings.TrimSpace(userAgent)
	location := ""
	if user.City != nil {
		location = strings.TrimSpace(*user.City)
	}
	loc := a.loc
	if loc == nil {
		loc = time.Local
	}

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), loginAlertSendTimeout)
		defer cancel()

		dedupKey := loginAlertDedupKey(user.ID, clientIP)
		reserved, err := a.redis.SetNX(ctx, dedupKey, "1", loginAlertDedupTTL).Result()
		if err != nil {
			log.Printf("login alert dedup failed for user %d: %v", user.ID, err)
			return
		}
		if !reserved {
			return
		}

		sent := false
		defer func() {
			if sent {
				return
			}
			releaseCtx, releaseCancel := context.WithTimeout(context.Background(), time.Second)
			defer releaseCancel()
			if err := a.redis.Del(releaseCtx, dedupKey).Err(); err != nil {
				log.Printf("login alert dedup release failed for user %d: %v", user.ID, err)
			}
		}()

		if a.city != nil {
			if resolved, resolveErr := a.city.Resolve(ctx, clientIP); resolveErr == nil && strings.TrimSpace(resolved) != "" {
				location = strings.TrimSpace(resolved)
			}
		}

		content := buildLoginAlertEmail(user, clientIP, userAgent, location, time.Now(), loc)
		if err := sendLoginAlertViaResend(
			ctx,
			loginAlertHTTPClient,
			resendEmailEndpoint,
			apiKey,
			from,
			to,
			content,
		); err != nil {
			log.Printf("send login alert failed for user %d: %v", user.ID, err)
			return
		}
		sent = true
	}()
}

func isLoginAlertUser(configured []string, userID int64) bool {
	if userID <= 0 {
		return false
	}
	for _, raw := range configured {
		id, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
		if err == nil && id == userID {
			return true
		}
	}
	return false
}

func loginAlertDedupKey(userID int64, clientIP string) string {
	fingerprint := sha256.Sum256([]byte(strings.TrimSpace(clientIP)))
	return fmt.Sprintf("login_alert:%d:%x", userID, fingerprint[:8])
}

func buildLoginAlertEmail(
	user model.User,
	clientIP string,
	userAgent string,
	location string,
	loginAt time.Time,
	loc *time.Location,
) loginAlertEmail {
	if loc == nil {
		loc = time.Local
	}

	device, browser, osName := loginAlertClientDetails(userAgent)
	fields := []struct {
		label string
		value string
	}{
		{label: "用户 ID", value: strconv.FormatInt(user.ID, 10)},
		{label: "用户名", value: loginAlertDisplayValue(user.Username)},
		{label: "昵称", value: loginAlertDisplayValue(user.Nickname)},
		{label: "登录时间", value: loginAt.In(loc).Format("2006-01-02 15:04:05 MST")},
		{label: "IP", value: loginAlertDisplayValue(clientIP)},
		{label: "地区", value: loginAlertDisplayValue(location)},
		{label: "设备", value: loginAlertDisplayValue(device)},
		{label: "浏览器", value: loginAlertDisplayValue(browser)},
		{label: "系统", value: loginAlertDisplayValue(osName)},
		{label: "User-Agent", value: loginAlertDisplayValue(userAgent)},
	}

	var plain strings.Builder
	plain.WriteString("Private Chat 登录提醒\n\n")
	for _, field := range fields {
		plain.WriteString(field.label)
		plain.WriteString("：")
		plain.WriteString(field.value)
		plain.WriteByte('\n')
	}

	var rows strings.Builder
	for _, field := range fields {
		fmt.Fprintf(
			&rows,
			`<tr><td style="padding:8px 12px;color:#777;vertical-align:top;white-space:nowrap;">%s</td><td style="padding:8px 12px;color:#222;word-break:break-word;">%s</td></tr>`,
			html.EscapeString(field.label),
			html.EscapeString(field.value),
		)
	}

	title := "Private Chat 登录提醒"
	htmlBody := fmt.Sprintf(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>%s</title>
</head>
<body style="margin:0;background:#f6f6f4;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;">
  <div style="max-width:620px;margin:0 auto;padding:40px 16px;">
    <div style="background:#fff;border:1px solid #e7e7e3;border-radius:12px;padding:28px;">
      <h1 style="margin:0 0 20px;font-size:20px;color:#222;">%s</h1>
      <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;">%s</table>
      <p style="margin:22px 0 0;color:#999;font-size:12px;line-height:1.6;">这是系统自动发送的登录通知。</p>
    </div>
  </div>
</body>
</html>`, html.EscapeString(title), html.EscapeString(title), rows.String())

	username := strings.TrimSpace(user.Username)
	if username == "" {
		username = strconv.FormatInt(user.ID, 10)
	}
	return loginAlertEmail{
		Subject: "Private Chat 登录提醒：" + username,
		Text:    plain.String(),
		HTML:    htmlBody,
	}
}

func loginAlertDisplayValue(value string) string {
	normalized := strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	if normalized == "" {
		return "未知"
	}
	runes := []rune(normalized)
	if len(runes) <= 500 {
		return normalized
	}
	return string(runes[:500]) + "…"
}

func loginAlertClientDetails(userAgent string) (device, browser, osName string) {
	ua := strings.TrimSpace(userAgent)
	if ua == "" {
		return "", "", ""
	}

	switch {
	case strings.Contains(ua, "Edg/"):
		browser = "Edge"
	case strings.Contains(ua, "OPR/"), strings.Contains(ua, "Opera/"):
		browser = "Opera"
	case strings.Contains(ua, "Chrome/"), strings.Contains(ua, "CriOS/"):
		browser = "Chrome"
	case strings.Contains(ua, "Firefox/"), strings.Contains(ua, "FxiOS/"):
		browser = "Firefox"
	case strings.Contains(ua, "Safari/"):
		browser = "Safari"
	}

	switch {
	case strings.Contains(ua, "iPhone"), strings.Contains(ua, "iPad"), strings.Contains(ua, "iPod"):
		osName = "iOS"
	case strings.Contains(ua, "Android"):
		osName = "Android"
	case strings.Contains(ua, "Windows NT"):
		osName = "Windows"
	case strings.Contains(ua, "Macintosh"), strings.Contains(ua, "Mac OS X"):
		osName = "macOS"
	case strings.Contains(ua, "Linux"):
		osName = "Linux"
	}

	switch {
	case strings.Contains(ua, "iPad"), strings.Contains(ua, "Tablet"):
		device = "平板"
	case strings.Contains(ua, "Mobile"), strings.Contains(ua, "iPhone"), strings.Contains(ua, "iPod"), strings.Contains(ua, "Android"):
		device = "手机"
	default:
		device = "电脑"
	}

	return device, browser, osName
}

func sendLoginAlertViaResend(
	ctx context.Context,
	client *http.Client,
	endpoint string,
	apiKey string,
	from string,
	to string,
	content loginAlertEmail,
) error {
	apiKey = strings.TrimSpace(apiKey)
	from = strings.TrimSpace(from)
	to = strings.TrimSpace(to)
	if apiKey == "" {
		return fmt.Errorf("resend api key is empty")
	}
	if _, err := mail.ParseAddress(from); err != nil {
		return fmt.Errorf("invalid resend from address: %w", err)
	}
	parsedTo, err := mail.ParseAddress(to)
	if err != nil {
		return fmt.Errorf("invalid login alert recipient: %w", err)
	}
	if client == nil {
		client = loginAlertHTTPClient
	}
	if strings.TrimSpace(endpoint) == "" {
		endpoint = resendEmailEndpoint
	}

	payload, err := json.Marshal(resendEmailRequest{
		From:    from,
		To:      []string{parsedTo.Address},
		Subject: content.Subject,
		HTML:    content.HTML,
		Text:    content.Text,
	})
	if err != nil {
		return fmt.Errorf("marshal resend request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("build resend request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("send resend request: %w", err)
	}
	defer resp.Body.Close()

	responseBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf(
			"resend returned status %d: %s",
			resp.StatusCode,
			strings.TrimSpace(string(responseBody)),
		)
	}
	return nil
}
