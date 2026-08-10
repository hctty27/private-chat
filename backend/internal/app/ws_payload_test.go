package app

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"privatechat/internal/model"
)

func TestMessageDTOIncludesClientMsgID(t *testing.T) {
	clientMsgID := "client-abc-123"
	dto := toMessageDTO(model.Message{
		ID:          42,
		ClientMsgID: &clientMsgID,
	}, time.UTC)

	body, err := json.Marshal(dto)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	if !strings.Contains(string(body), `"clientMsgId":"client-abc-123"`) {
		t.Fatalf("expected clientMsgId in payload, got %s", body)
	}
	if !strings.Contains(string(body), `"id":42`) {
		t.Fatalf("expected message fields in payload, got %s", body)
	}
}

func TestMessageDTOOmitsClientMsgIDForLegacyMessage(t *testing.T) {
	dto := toMessageDTO(model.Message{ID: 7}, time.UTC)

	body, err := json.Marshal(dto)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	if strings.Contains(string(body), "clientMsgId") {
		t.Fatalf("expected legacy clientMsgId to be omitted, got %s", body)
	}
}

func TestNormalizeClientMsgIDTrimsWhitespace(t *testing.T) {
	value := "  client-123  "
	got, err := normalizeClientMsgID(&value)
	if err != nil {
		t.Fatalf("normalize clientMsgId: %v", err)
	}
	if got == nil || *got != "client-123" {
		t.Fatalf("expected trimmed clientMsgId, got %#v", got)
	}
}

func TestNormalizeClientMsgIDTreatsBlankAsAbsent(t *testing.T) {
	value := "   "
	got, err := normalizeClientMsgID(&value)
	if err != nil {
		t.Fatalf("normalize clientMsgId: %v", err)
	}
	if got != nil {
		t.Fatalf("expected blank clientMsgId to be absent, got %q", *got)
	}
}

func TestNormalizeClientMsgIDAccepts64Characters(t *testing.T) {
	value := strings.Repeat("x", 64)
	got, err := normalizeClientMsgID(&value)
	if err != nil {
		t.Fatalf("normalize clientMsgId: %v", err)
	}
	if got == nil || *got != value {
		t.Fatalf("expected 64-character clientMsgId to be accepted")
	}
}

func TestNormalizeClientMsgIDRejects65Characters(t *testing.T) {
	value := strings.Repeat("x", 65)
	if _, err := normalizeClientMsgID(&value); err == nil {
		t.Fatal("expected 65-character clientMsgId to be rejected")
	}
}

func TestParseWsChatPayloadRejectsNonStringClientMsgID(t *testing.T) {
	_, err := parseWsChatPayload(map[string]any{
		"receiverId":  2,
		"msgType":     1,
		"content":     "hello",
		"clientMsgId": float64(123),
	})
	if err == nil {
		t.Fatal("expected non-string clientMsgId to be rejected")
	}
}
