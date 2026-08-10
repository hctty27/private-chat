package app

import "testing"

func TestHubAllowsMultipleSessionsPerUser(t *testing.T) {
	hub := NewHub()
	first := &Session{userID: 7}
	second := &Session{userID: 7}

	if !hub.Add(7, first) {
		t.Fatal("expected first session to report first connection")
	}
	if hub.Add(7, second) {
		t.Fatal("expected second session not to report first connection")
	}

	sessions := hub.GetAll(7)
	if len(sessions) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(sessions))
	}
}

func TestHubRemoveReportsOnlyLastSession(t *testing.T) {
	hub := NewHub()
	first := &Session{userID: 7}
	second := &Session{userID: 7}
	notRegistered := &Session{userID: 7}
	hub.Add(7, first)
	hub.Add(7, second)

	if hub.Remove(7, notRegistered) {
		t.Fatal("expected unregistered session removal not to report final disconnect")
	}
	if hub.Remove(7, first) {
		t.Fatal("expected first removal not to report final disconnect")
	}
	if !hub.Remove(7, second) {
		t.Fatal("expected last removal to report final disconnect")
	}
	if got := hub.GetAll(7); len(got) != 0 {
		t.Fatalf("expected no remaining sessions, got %d", len(got))
	}
}

func TestHubGetAllReturnsSnapshot(t *testing.T) {
	hub := NewHub()
	first := &Session{userID: 7}
	hub.Add(7, first)

	snapshot := hub.GetAll(7)
	snapshot[0] = &Session{userID: 99}

	current := hub.GetAll(7)
	if len(current) != 1 || current[0] != first {
		t.Fatal("GetAll exposed mutable hub state")
	}
}

func TestHubSnapshotIncludesEveryConnection(t *testing.T) {
	hub := NewHub()
	hub.Add(7, &Session{userID: 7})
	hub.Add(7, &Session{userID: 7})
	hub.Add(8, &Session{userID: 8})

	if got := len(hub.Snapshot()); got != 3 {
		t.Fatalf("expected 3 sessions, got %d", got)
	}
}
