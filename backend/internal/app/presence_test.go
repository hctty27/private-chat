package app

import (
	"context"
	"errors"
	"testing"
	"time"
)

type lastSeenWrite struct {
	userID int64
	at     time.Time
}

type fakeLastSeenRepository struct {
	writes []lastSeenWrite
	err    error
}

func (f *fakeLastSeenRepository) UpdateLastSeen(_ context.Context, userID int64, at time.Time) error {
	if f.err != nil {
		return f.err
	}
	f.writes = append(f.writes, lastSeenWrite{userID: userID, at: at})
	return nil
}

type fakeLastSeenThrottle struct {
	allow  bool
	err    error
	calls  int
	userID int64
	window time.Duration
}

func (f *fakeLastSeenThrottle) Acquire(_ context.Context, userID int64, window time.Duration) (bool, error) {
	f.calls++
	f.userID = userID
	f.window = window
	if f.err != nil {
		return false, f.err
	}
	return f.allow, nil
}

func TestPresencePersistImmediateWritesExactUTCInstant(t *testing.T) {
	repo := &fakeLastSeenRepository{}
	service := newPresenceService(repo, &fakeLastSeenThrottle{})
	at := time.Date(2026, 8, 10, 14, 32, 15, 0, time.FixedZone("UTC+8", 8*60*60))

	if err := service.PersistImmediate(context.Background(), 7, at); err != nil {
		t.Fatal(err)
	}
	if len(repo.writes) != 1 {
		t.Fatalf("expected one write, got %d", len(repo.writes))
	}
	write := repo.writes[0]
	if write.userID != 7 {
		t.Fatalf("expected user 7, got %d", write.userID)
	}
	if !write.at.Equal(at) || write.at.Location() != time.UTC {
		t.Fatalf("expected exact UTC instant, got %v", write.at)
	}
}

func TestPresencePersistThrottledWritesWhenThrottleAcquired(t *testing.T) {
	repo := &fakeLastSeenRepository{}
	throttle := &fakeLastSeenThrottle{allow: true}
	service := newPresenceService(repo, throttle)
	at := time.Date(2026, 8, 10, 6, 32, 15, 0, time.UTC)

	if err := service.PersistThrottled(context.Background(), 9, at); err != nil {
		t.Fatal(err)
	}
	if throttle.calls != 1 || throttle.userID != 9 || throttle.window != time.Minute {
		t.Fatalf("unexpected throttle call: %#v", throttle)
	}
	if len(repo.writes) != 1 || !repo.writes[0].at.Equal(at) {
		t.Fatalf("unexpected writes: %#v", repo.writes)
	}
}

func TestPresencePersistThrottledSkipsWhenThrottleHeld(t *testing.T) {
	repo := &fakeLastSeenRepository{}
	throttle := &fakeLastSeenThrottle{allow: false}
	service := newPresenceService(repo, throttle)

	if err := service.PersistThrottled(context.Background(), 9, time.Now()); err != nil {
		t.Fatal(err)
	}
	if len(repo.writes) != 0 {
		t.Fatalf("expected no writes, got %#v", repo.writes)
	}
}

func TestPresencePersistThrottledReturnsThrottleErrorWithoutWriting(t *testing.T) {
	repo := &fakeLastSeenRepository{}
	expected := errors.New("redis unavailable")
	service := newPresenceService(repo, &fakeLastSeenThrottle{err: expected})

	err := service.PersistThrottled(context.Background(), 9, time.Now())
	if !errors.Is(err, expected) {
		t.Fatalf("expected throttle error, got %v", err)
	}
	if len(repo.writes) != 0 {
		t.Fatalf("expected no writes, got %#v", repo.writes)
	}
}

func TestPresencePersistThrottledReturnsRepositoryError(t *testing.T) {
	expected := errors.New("postgres unavailable")
	repo := &fakeLastSeenRepository{err: expected}
	service := newPresenceService(repo, &fakeLastSeenThrottle{allow: true})

	err := service.PersistThrottled(context.Background(), 9, time.Now())
	if !errors.Is(err, expected) {
		t.Fatalf("expected repository error, got %v", err)
	}
}

func TestPresenceArmThrottleUsesOneMinuteWindow(t *testing.T) {
	throttle := &fakeLastSeenThrottle{allow: true}
	service := newPresenceService(&fakeLastSeenRepository{}, throttle)

	if err := service.ArmThrottle(context.Background(), 11); err != nil {
		t.Fatal(err)
	}
	if throttle.calls != 1 || throttle.userID != 11 || throttle.window != time.Minute {
		t.Fatalf("unexpected throttle call: %#v", throttle)
	}
}

func TestFormatPresenceTimeUsesRFC3339UTC(t *testing.T) {
	at := time.Date(2026, 8, 10, 14, 32, 15, 0, time.FixedZone("UTC+8", 8*60*60))

	if got := formatPresenceTime(at); got != "2026-08-10T06:32:15Z" {
		t.Fatalf("unexpected formatted time %q", got)
	}
}

func TestContactLastSeenFormattingReturnsNilForMissingValue(t *testing.T) {
	if got := optionalPresenceTime(nil); got != nil {
		t.Fatalf("expected nil, got %q", *got)
	}
}

func TestContactLastSeenFormattingReturnsRFC3339UTC(t *testing.T) {
	at := time.Date(2026, 8, 10, 14, 32, 15, 0, time.FixedZone("UTC+8", 8*60*60))
	got := optionalPresenceTime(&at)
	if got == nil || *got != "2026-08-10T06:32:15Z" {
		t.Fatalf("unexpected last seen value %#v", got)
	}
}

func TestOfflinePresencePayloadCarriesCapturedTimestamp(t *testing.T) {
	at := time.Date(2026, 8, 10, 14, 32, 15, 0, time.FixedZone("UTC+8", 8*60*60))
	payload := onlinePresencePayload(7, false, &at)

	if payload["type"] != "online" {
		t.Fatalf("unexpected event type %#v", payload["type"])
	}
	data, ok := payload["data"].(map[string]any)
	if !ok {
		t.Fatalf("unexpected payload data %#v", payload["data"])
	}
	if data["userId"] != int64(7) || data["online"] != false || data["lastSeenAt"] != "2026-08-10T06:32:15Z" {
		t.Fatalf("unexpected presence data %#v", data)
	}
}
