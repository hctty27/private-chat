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


func TestMessageDTOIncludesReplySnapshot(t *testing.T) {
	replyContent := "original"
	replyID := int64(21)
	dto := toMessageDTO(model.Message{
		ID:               42,
		ReplyToMessageID: &replyID,
		ReplyTo: &model.Message{
			ID:       replyID,
			SenderID: 2,
			MsgType:  1,
			Content:  &replyContent,
		},
	}, time.UTC)

	body, err := json.Marshal(dto)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	payload := string(body)
	if !strings.Contains(payload, `"replyToMessageId":21`) {
		t.Fatalf("expected replyToMessageId in payload, got %s", payload)
	}
	if !strings.Contains(payload, `"replyTo":{"messageId":21,"senderId":2,"msgType":1,"content":"original"`) {
		t.Fatalf("expected reply snapshot in payload, got %s", payload)
	}
}

func TestParseReplyToMessageIDAcceptsPositiveInteger(t *testing.T) {
	got, err := parseReplyToMessageID(float64(12))
	if err != nil {
		t.Fatalf("parse replyToMessageId: %v", err)
	}
	if got == nil || *got != 12 {
		t.Fatalf("expected replyToMessageId 12, got %#v", got)
	}
}

func TestParseReplyToMessageIDRejectsInvalidValue(t *testing.T) {
	if _, err := parseReplyToMessageID(float64(0)); err == nil {
		t.Fatal("expected zero replyToMessageId to be rejected")
	}
	if _, err := parseReplyToMessageID("not-a-number"); err == nil {
		t.Fatal("expected invalid replyToMessageId to be rejected")
	}
}
