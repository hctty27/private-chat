package app

import (
	"context"
	"testing"

	"privatechat/internal/model"
)

func TestSaveMessageWithReplyPersistsRelationAndSnapshot(t *testing.T) {
	app := requirePostgresTestApp(t)
	originalClientID := "reply-original-1"
	replyClientID := "reply-child-1"
	cleanupReplyRows(t, app, originalClientID, replyClientID)

	originalContent := "original message"
	originalDTO, err := app.saveMessage(context.Background(), 940001, 940002, 1, &originalContent, nil, &originalClientID)
	if err != nil {
		t.Fatalf("save original message: %v", err)
	}

	var original model.Message
	if err := app.db.First(&original, originalDTO.ID).Error; err != nil {
		t.Fatalf("load original message: %v", err)
	}

	replyContent := "reply message"
	replyDTO, err := app.saveMessageWithReply(
		context.Background(),
		940002,
		940001,
		1,
		&replyContent,
		nil,
		&replyClientID,
		&original,
	)
	if err != nil {
		t.Fatalf("save reply message: %v", err)
	}

	if replyDTO.ReplyToMessageID == nil || *replyDTO.ReplyToMessageID != original.ID {
		t.Fatalf("expected replyToMessageId %d, got %#v", original.ID, replyDTO.ReplyToMessageID)
	}
	if replyDTO.ReplyTo == nil || replyDTO.ReplyTo.MessageID != original.ID {
		t.Fatalf("expected reply snapshot for message %d, got %#v", original.ID, replyDTO.ReplyTo)
	}

	var persisted model.Message
	if err := app.db.First(&persisted, replyDTO.ID).Error; err != nil {
		t.Fatalf("load persisted reply: %v", err)
	}
	if persisted.ReplyToMessageID == nil || *persisted.ReplyToMessageID != original.ID {
		t.Fatalf("expected persisted reply relation to %d, got %#v", original.ID, persisted.ReplyToMessageID)
	}
}

func cleanupReplyRows(t *testing.T, app *App, clientMsgIDs ...string) {
	t.Helper()
	if err := app.db.Where("client_msg_id IN ?", clientMsgIDs).Delete(&model.Message{}).Error; err != nil {
		t.Fatalf("cleanup reply rows: %v", err)
	}
	t.Cleanup(func() {
		_ = app.db.Where("client_msg_id IN ?", clientMsgIDs).Delete(&model.Message{}).Error
	})
}
