package app

import (
	"context"
	"testing"
	"time"

	"privatechat/internal/model"
)

func TestGetMessagesContiguous(t *testing.T) {
	a := requirePostgresTestApp(t)
	ctx := context.Background()
	const readerID, senderID = int64(950001), int64(950002)
	conv := conversationID(readerID, senderID)
	cleanup := func() { a.db.Where("conversation_id = ?", conv).Delete(&model.Message{}) }
	cleanup()
	t.Cleanup(cleanup)

	// All messages have the same timestamp, exercising the ID tie-breaker.
	at := time.Date(2026, 8, 27, 16, 42, 11, 987654000, time.UTC)
	rows := make([]model.Message, 100)
	for i := range rows {
		rows[i] = model.Message{
			ConversationID: conv,
			SenderID:       senderID,
			ReceiverID:     readerID,
			MsgType:        1,
			CreatedAt:      at,
		}
	}
	if err := a.db.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}

	cursor, mode := "", "init"
	end := len(rows)
	for pageNumber := 0; pageNumber < 5; pageNumber++ {
		page, err := a.getMessages(ctx, readerID, senderID, cursor, 20, mode)
		if err != nil {
			t.Fatal(err)
		}
		if len(page.Messages) != 20 {
			t.Fatalf("page %d: got %d messages", pageNumber, len(page.Messages))
		}
		for i, msg := range page.Messages {
			if want := rows[end-20+i].ID; msg.ID != want {
				t.Fatalf("page %d row %d: got %d want %d", pageNumber, i, msg.ID, want)
			}
		}
		end -= 20
		if page.HasMore != (end > 0) {
			t.Fatalf("page %d: incorrect hasMore %v", pageNumber, page.HasMore)
		}
		cursor, mode = page.NextCursor, "loadMore"
	}
}

func TestMarkVisibleMessagesRead(t *testing.T) {
	a := requirePostgresTestApp(t)
	ctx := context.Background()
	const readerID, senderID, otherID = int64(950011), int64(950012), int64(950013)
	conv := conversationID(readerID, senderID)
	otherConv := conversationID(readerID, otherID)
	cleanup := func() { a.db.Where("conversation_id IN ?", []string{conv, otherConv}).Delete(&model.Message{}) }
	cleanup()
	t.Cleanup(cleanup)
	rows := []model.Message{
		{ConversationID: conv, SenderID: senderID, ReceiverID: readerID, MsgType: 1},
		{ConversationID: conv, SenderID: senderID, ReceiverID: readerID, MsgType: 1},
		{ConversationID: conv, SenderID: readerID, ReceiverID: senderID, MsgType: 1},
		{ConversationID: otherConv, SenderID: otherID, ReceiverID: readerID, MsgType: 1},
	}
	if err := a.db.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}
	for attempt := 0; attempt < 2; attempt++ {
		ids, unread, err := a.markVisibleMessagesRead(ctx, readerID, senderID, []int64{rows[0].ID, rows[2].ID, rows[3].ID})
		if err != nil {
			t.Fatal(err)
		}
		if len(ids) != 1 || ids[0] != rows[0].ID || unread != 1 {
			t.Fatalf("attempt %d: got ids=%v unread=%d", attempt, ids, unread)
		}
	}
	for i, original := range rows {
		var persisted model.Message
		if err := a.db.First(&persisted, original.ID).Error; err != nil {
			t.Fatal(err)
		}
		want := 0
		if i == 0 {
			want = 1
		}
		if int(persisted.IsRead) != want {
			t.Fatalf("row %d: got is_read=%d want %d", i, persisted.IsRead, want)
		}
	}
}

func TestParseReadMessageIDs(t *testing.T) {
	ids, err := parseReadMessageIDs([]any{float64(1), float64(1), float64(2)})
	if err != nil || len(ids) != 2 || ids[0] != 1 || ids[1] != 2 {
		t.Fatalf("unexpected parsed ids %v, err %v", ids, err)
	}
	for _, invalid := range []any{nil, []any{}, []any{float64(-1)}, []any{float64(1.5)}, []any{"1"}, make([]any, 101)} {
		if _, err := parseReadMessageIDs(invalid); err == nil {
			t.Fatalf("accepted invalid read IDs: %v", invalid)
		}
	}
}
