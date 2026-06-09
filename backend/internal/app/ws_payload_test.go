package app

import (
	"encoding/json"
	"strings"
	"testing"

	"privatechat/internal/model"
)

func TestChatResponsePayloadIncludesClientMsgID(t *testing.T) {
	clientMsgID := "client-abc-123"
	payload := chatResponsePayload(model.MessageDTO{
		ID:             42,
		ConversationID: "1_2",
		SenderID:       1,
		ReceiverID:     2,
		MsgType:        1,
		IsRead:         0,
		CreatedAt:      "2026-06-08T10:00:00",
	}, &clientMsgID)

	body, err := json.Marshal(payload)
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

func TestChatResponsePayloadOmitsBlankClientMsgID(t *testing.T) {
	blank := "   "
	payload := chatResponsePayload(model.MessageDTO{ID: 7}, &blank)

	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	if strings.Contains(string(body), "clientMsgId") {
		t.Fatalf("expected blank clientMsgId to be omitted, got %s", body)
	}
}
