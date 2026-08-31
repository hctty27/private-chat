package app

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

type memoryCallStore struct {
	mu     sync.Mutex
	calls  map[string]callRecord
	byUser map[int64]string
}

func newMemoryCallStore() *memoryCallStore {
	return &memoryCallStore{calls: map[string]callRecord{}, byUser: map[int64]string{}}
}

func (s *memoryCallStore) CreateRinging(_ context.Context, record callRecord, _ time.Duration) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.byUser[record.CallerID] != "" || s.byUser[record.CalleeID] != "" {
		return errCallBusy
	}
	s.calls[record.ID] = record
	s.byUser[record.CallerID] = record.ID
	s.byUser[record.CalleeID] = record.ID
	return nil
}

func (s *memoryCallStore) Get(_ context.Context, id string) (callRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.calls[id]
	if !ok {
		return callRecord{}, errCallNotFound
	}
	return record, nil
}

func (s *memoryCallStore) FindByUser(ctx context.Context, userID int64) (callRecord, error) {
	s.mu.Lock()
	id := s.byUser[userID]
	s.mu.Unlock()
	if id == "" {
		return callRecord{}, errCallNotFound
	}
	return s.Get(ctx, id)
}

func (s *memoryCallStore) MarkActive(_ context.Context, id string, actorID int64, acceptedAt time.Time, _ time.Duration) (callRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.calls[id]
	if !ok {
		return callRecord{}, errCallNotFound
	}
	if record.Status != callStatusRinging {
		return callRecord{}, errCallState
	}
	if actorID != record.CalleeID {
		return callRecord{}, errCallRole
	}
	record.Status = callStatusActive
	at := acceptedAt.UTC()
	record.AcceptedAt = &at
	s.calls[id] = record
	return record, nil
}

func (s *memoryCallStore) Delete(_ context.Context, id string) (callRecord, error) {
	return s.delete(id, nil)
}

func (s *memoryCallStore) DeleteIfStatus(_ context.Context, id string, expected callStatus) (callRecord, error) {
	return s.delete(id, &expected)
}

func (s *memoryCallStore) delete(id string, expected *callStatus) (callRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.calls[id]
	if !ok {
		return callRecord{}, errCallNotFound
	}
	if expected != nil && record.Status != *expected {
		return callRecord{}, errCallState
	}
	delete(s.calls, id)
	if s.byUser[record.CallerID] == id {
		delete(s.byUser, record.CallerID)
	}
	if s.byUser[record.CalleeID] == id {
		delete(s.byUser, record.CalleeID)
	}
	return record, nil
}

type sentCallMessage struct {
	userID  int64
	payload map[string]any
}

func newTestCallManager(store callStore) (*callManager, *[]sentCallMessage, *func()) {
	sent := []sentCallMessage{}
	var scheduled func()
	manager := newCallManager(
		store,
		func(context.Context, int64, int64) error { return nil },
		func(int64) bool { return true },
		func(userID int64, payload any) {
			sent = append(sent, sentCallMessage{userID: userID, payload: payload.(map[string]any)})
		},
	)
	manager.newID = func() string { return "call-1" }
	manager.now = func() time.Time { return time.Unix(100, 0).UTC() }
	manager.schedule = func(_ time.Duration, fn func()) { scheduled = fn }
	return manager, &sent, &scheduled
}

func messageType(t *testing.T, message sentCallMessage) string {
	t.Helper()
	value, ok := message.payload["type"].(string)
	if !ok {
		t.Fatalf("missing message type: %#v", message.payload)
	}
	return value
}

func TestCallManagerInviteRejectsSelf(t *testing.T) {
	manager, _, _ := newTestCallManager(newMemoryCallStore())
	if err := manager.Invite(context.Background(), 1, 1); !errors.Is(err, errCallRole) {
		t.Fatalf("expected role error, got %v", err)
	}
}

func TestCallManagerInviteRequiresContact(t *testing.T) {
	manager, _, _ := newTestCallManager(newMemoryCallStore())
	manager.requireContact = func(context.Context, int64, int64) error { return errContactForbidden }

	if err := manager.Invite(context.Background(), 1, 2); !errors.Is(err, errContactForbidden) {
		t.Fatalf("expected contact error, got %v", err)
	}
}

func TestCallManagerInviteReturnsUnavailableWhenPeerDisconnected(t *testing.T) {
	manager, sent, _ := newTestCallManager(newMemoryCallStore())
	manager.isConnected = func(int64) bool { return false }

	if err := manager.Invite(context.Background(), 1, 2); err != nil {
		t.Fatal(err)
	}
	if len(*sent) != 1 || (*sent)[0].userID != 1 || messageType(t, (*sent)[0]) != "call_unavailable" {
		t.Fatalf("unexpected messages: %#v", *sent)
	}
}

func TestCallManagerInviteSendsRingingAndIncoming(t *testing.T) {
	store := newMemoryCallStore()
	manager, sent, scheduled := newTestCallManager(store)

	if err := manager.Invite(context.Background(), 1, 2); err != nil {
		t.Fatal(err)
	}
	if len(*sent) != 2 {
		t.Fatalf("expected two messages, got %#v", *sent)
	}
	if (*sent)[0].userID != 1 || messageType(t, (*sent)[0]) != "call_ringing" {
		t.Fatalf("unexpected caller message: %#v", (*sent)[0])
	}
	if (*sent)[1].userID != 2 || messageType(t, (*sent)[1]) != "call_incoming" {
		t.Fatalf("unexpected callee message: %#v", (*sent)[1])
	}
	if *scheduled == nil {
		t.Fatal("expected timeout to be scheduled")
	}
}

func TestCallManagerInviteReturnsBusyWhenStoreIsBusy(t *testing.T) {
	store := newMemoryCallStore()
	if err := store.CreateRinging(context.Background(), testRingingCall("existing", 2, 3), time.Minute); err != nil {
		t.Fatal(err)
	}
	manager, sent, _ := newTestCallManager(store)
	manager.newID = func() string { return "call-2" }

	if err := manager.Invite(context.Background(), 1, 2); err != nil {
		t.Fatal(err)
	}
	if len(*sent) != 1 || messageType(t, (*sent)[0]) != "call_busy" {
		t.Fatalf("unexpected messages: %#v", *sent)
	}
}

func TestCallManagerAcceptOnlyAllowsCallee(t *testing.T) {
	store := newMemoryCallStore()
	_ = store.CreateRinging(context.Background(), testRingingCall("call-1", 1, 2), time.Minute)
	manager, sent, _ := newTestCallManager(store)

	if err := manager.Accept(context.Background(), 1, "call-1"); !errors.Is(err, errCallRole) {
		t.Fatalf("expected role error, got %v", err)
	}
	if err := manager.Accept(context.Background(), 2, "call-1"); err != nil {
		t.Fatal(err)
	}
	if len(*sent) != 2 || messageType(t, (*sent)[0]) != "call_accepted" || messageType(t, (*sent)[1]) != "call_accepted" {
		t.Fatalf("unexpected messages: %#v", *sent)
	}
}

func TestCallManagerRejectOnlyAllowsCallee(t *testing.T) {
	store := newMemoryCallStore()
	_ = store.CreateRinging(context.Background(), testRingingCall("call-1", 1, 2), time.Minute)
	manager, sent, _ := newTestCallManager(store)

	if err := manager.Reject(context.Background(), 1, "call-1", "rejected"); !errors.Is(err, errCallRole) {
		t.Fatalf("expected role error, got %v", err)
	}
	if err := manager.Reject(context.Background(), 2, "call-1", "media_unavailable"); err != nil {
		t.Fatal(err)
	}
	if len(*sent) != 1 || (*sent)[0].userID != 1 || messageType(t, (*sent)[0]) != "call_rejected" {
		t.Fatalf("unexpected messages: %#v", *sent)
	}
}

func TestCallManagerCancelOnlyAllowsCallerWhileRinging(t *testing.T) {
	store := newMemoryCallStore()
	_ = store.CreateRinging(context.Background(), testRingingCall("call-1", 1, 2), time.Minute)
	manager, sent, _ := newTestCallManager(store)

	if err := manager.Cancel(context.Background(), 2, "call-1"); !errors.Is(err, errCallRole) {
		t.Fatalf("expected role error, got %v", err)
	}
	if err := manager.Cancel(context.Background(), 1, "call-1"); err != nil {
		t.Fatal(err)
	}
	if len(*sent) != 1 || (*sent)[0].userID != 2 || messageType(t, (*sent)[0]) != "call_cancelled" {
		t.Fatalf("unexpected messages: %#v", *sent)
	}
}

func TestCallManagerHangupAllowsEitherActiveParticipant(t *testing.T) {
	for _, userID := range []int64{1, 2} {
		store := newMemoryCallStore()
		_ = store.CreateRinging(context.Background(), testRingingCall("call-1", 1, 2), time.Minute)
		_, _ = store.MarkActive(context.Background(), "call-1", 2, time.Now(), time.Hour)
		manager, sent, _ := newTestCallManager(store)

		if err := manager.Hangup(context.Background(), userID, "call-1", "hangup"); err != nil {
			t.Fatalf("user %d hangup: %v", userID, err)
		}
		if len(*sent) != 1 || messageType(t, (*sent)[0]) != "call_ended" {
			t.Fatalf("unexpected messages for user %d: %#v", userID, *sent)
		}
	}
}

func TestCallManagerOfferAnswerAndICEEnforceRoles(t *testing.T) {
	store := newMemoryCallStore()
	_ = store.CreateRinging(context.Background(), testRingingCall("call-1", 1, 2), time.Minute)
	_, _ = store.MarkActive(context.Background(), "call-1", 2, time.Now(), time.Hour)
	manager, sent, _ := newTestCallManager(store)

	if err := manager.RelayOffer(context.Background(), 2, "call-1", map[string]any{"type": "offer", "sdp": "x"}); !errors.Is(err, errCallRole) {
		t.Fatalf("expected offer role error, got %v", err)
	}
	if err := manager.RelayOffer(context.Background(), 1, "call-1", map[string]any{"type": "offer", "sdp": "x"}); err != nil {
		t.Fatal(err)
	}
	if err := manager.RelayAnswer(context.Background(), 1, "call-1", map[string]any{"type": "answer", "sdp": "y"}); !errors.Is(err, errCallRole) {
		t.Fatalf("expected answer role error, got %v", err)
	}
	if err := manager.RelayAnswer(context.Background(), 2, "call-1", map[string]any{"type": "answer", "sdp": "y"}); err != nil {
		t.Fatal(err)
	}
	if err := manager.RelayICE(context.Background(), 1, "call-1", map[string]any{"candidate": "c"}); err != nil {
		t.Fatal(err)
	}
	if len(*sent) != 3 {
		t.Fatalf("expected three relayed messages, got %#v", *sent)
	}
}

func TestCallManagerTimeoutDeletesOnlyStillRingingCall(t *testing.T) {
	store := newMemoryCallStore()
	manager, sent, scheduled := newTestCallManager(store)
	if err := manager.Invite(context.Background(), 1, 2); err != nil {
		t.Fatal(err)
	}
	*sent = nil
	(*scheduled)()

	if len(*sent) != 2 || messageType(t, (*sent)[0]) != "call_timeout" || messageType(t, (*sent)[1]) != "call_timeout" {
		t.Fatalf("unexpected timeout messages: %#v", *sent)
	}
	if _, err := store.Get(context.Background(), "call-1"); !errors.Is(err, errCallNotFound) {
		t.Fatalf("expected deleted call, got %v", err)
	}
}

func TestCallManagerDisconnectEndsCurrentCall(t *testing.T) {
	store := newMemoryCallStore()
	_ = store.CreateRinging(context.Background(), testRingingCall("call-1", 1, 2), time.Minute)
	manager, sent, _ := newTestCallManager(store)

	manager.Disconnect(context.Background(), 2)

	if len(*sent) != 1 || (*sent)[0].userID != 1 || messageType(t, (*sent)[0]) != "call_ended" {
		t.Fatalf("unexpected messages: %#v", *sent)
	}
}


func TestCallManagerTimeoutDoesNotDeleteAcceptedCall(t *testing.T) {
	store := newMemoryCallStore()
	manager, sent, scheduled := newTestCallManager(store)
	if err := manager.Invite(context.Background(), 1, 2); err != nil {
		t.Fatal(err)
	}
	if err := manager.Accept(context.Background(), 2, "call-1"); err != nil {
		t.Fatal(err)
	}
	*sent = nil

	(*scheduled)()

	if len(*sent) != 0 {
		t.Fatalf("accepted call must not emit timeout: %#v", *sent)
	}
	record, err := store.Get(context.Background(), "call-1")
	if err != nil {
		t.Fatalf("expected accepted call to remain: %v", err)
	}
	if record.Status != callStatusActive {
		t.Fatalf("expected active call, got %s", record.Status)
	}
}
