package app

import (
	"testing"
	"time"

	"privatechat/internal/model"
)

func TestMessageCursorRoundTripPreservesMicrosecondsAndID(t *testing.T) {
	createdAt := time.Date(2026, 8, 27, 16, 42, 11, 987654000, time.UTC)
	raw := nextMessageCursor([]model.Message{{ID: 42, CreatedAt: createdAt}})

	cursor, err := parseMessageCursor(raw, time.UTC)
	if err != nil {
		t.Fatalf("parse cursor: %v", err)
	}
	if !cursor.HasID {
		t.Fatal("expected composite cursor")
	}
	if cursor.ID != 42 {
		t.Fatalf("expected id 42, got %d", cursor.ID)
	}
	if got := cursor.CreatedAt.UTC(); !got.Equal(createdAt) {
		t.Fatalf("expected %s, got %s", createdAt, got)
	}
}

func TestParseMessageCursorAcceptsLegacyMilliseconds(t *testing.T) {
	cursor, err := parseMessageCursor("1787848931987", time.UTC)
	if err != nil {
		t.Fatalf("parse legacy cursor: %v", err)
	}
	if cursor.HasID {
		t.Fatal("legacy cursor must not claim an id")
	}
	if got := cursor.CreatedAt.UnixMilli(); got != 1787848931987 {
		t.Fatalf("unexpected legacy milliseconds: %d", got)
	}
}

func TestSortMessagesUsesIDAsTimestampTieBreaker(t *testing.T) {
	createdAt := time.Date(2026, 8, 27, 16, 42, 11, 0, time.UTC)
	messages := []model.Message{
		{ID: 9, CreatedAt: createdAt},
		{ID: 3, CreatedAt: createdAt},
		{ID: 6, CreatedAt: createdAt},
	}

	sortMessages(messages)

	got := []int64{messages[0].ID, messages[1].ID, messages[2].ID}
	want := []int64{3, 6, 9}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("unexpected order: got %v want %v", got, want)
		}
	}
}
