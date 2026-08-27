package app

import (
	"testing"
	"time"

	"privatechat/internal/model"
)

func TestParseAvailabilityRequest(t *testing.T) {
	now := time.Date(2026, 8, 27, 10, 0, 0, 0, time.UTC)
	note := "  晚上聊一会儿  "
	startAt, endAt, parsedNote, err := parseAvailabilityRequest(model.AvailabilityRequest{
		StartAt: "2026-08-27T12:00:00Z",
		EndAt:   "2026-08-27T13:00:00Z",
		Note:    &note,
	}, now)
	if err != nil {
		t.Fatalf("parse availability: %v", err)
	}
	if !startAt.Equal(time.Date(2026, 8, 27, 12, 0, 0, 0, time.UTC)) {
		t.Fatalf("unexpected start: %v", startAt)
	}
	if !endAt.Equal(time.Date(2026, 8, 27, 13, 0, 0, 0, time.UTC)) {
		t.Fatalf("unexpected end: %v", endAt)
	}
	if parsedNote == nil || *parsedNote != "晚上聊一会儿" {
		t.Fatalf("unexpected note: %v", parsedNote)
	}
}

func TestParseAvailabilityRequestRejectsPastAndLongWindows(t *testing.T) {
	now := time.Date(2026, 8, 27, 10, 0, 0, 0, time.UTC)
	cases := []model.AvailabilityRequest{
		{StartAt: "2026-08-27T09:00:00Z", EndAt: "2026-08-27T10:00:00Z"},
		{StartAt: "2026-08-27T11:00:00Z", EndAt: "2026-08-28T00:00:01Z"},
	}
	for _, req := range cases {
		if _, _, _, err := parseAvailabilityRequest(req, now); err == nil {
			t.Fatalf("expected validation error for %#v", req)
		}
	}
}

func TestAvailabilityDTOForUserHidesExpiredPlan(t *testing.T) {
	start := time.Date(2026, 8, 27, 8, 0, 0, 0, time.UTC)
	end := time.Date(2026, 8, 27, 9, 0, 0, 0, time.UTC)
	user := model.User{AvailabilityStartAt: &start, AvailabilityEndAt: &end}
	if dto := availabilityDTOForUser(user, time.Date(2026, 8, 27, 10, 0, 0, 0, time.UTC), time.UTC); dto != nil {
		t.Fatalf("expected expired availability to be hidden, got %#v", dto)
	}
}
