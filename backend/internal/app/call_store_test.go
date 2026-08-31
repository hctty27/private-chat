package app

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func newTestCallStore(t *testing.T) (*redisCallStore, *miniredis.Miniredis) {
	t.Helper()
	mini := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mini.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	return newRedisCallStore(client), mini
}

func testRingingCall(id string, callerID, calleeID int64) callRecord {
	return callRecord{
		ID:        id,
		CallerID:  callerID,
		CalleeID:  calleeID,
		Status:    callStatusRinging,
		CreatedAt: time.Unix(100, 0).UTC(),
	}
}

func TestRedisCallStoreCreateRingingClaimsBothUsers(t *testing.T) {
	store, mini := newTestCallStore(t)
	record := testRingingCall("call-1", 1, 2)

	if err := store.CreateRinging(context.Background(), record, time.Minute); err != nil {
		t.Fatalf("create ringing: %v", err)
	}

	mini.CheckGet(t, callUserKey(1), "call-1")
	mini.CheckGet(t, callUserKey(2), "call-1")
	if ttl := mini.TTL(callSessionKey("call-1")); ttl != time.Minute {
		t.Fatalf("expected session TTL 1m, got %v", ttl)
	}
}

func TestRedisCallStoreRejectsSecondCallForEitherBusyUser(t *testing.T) {
	store, _ := newTestCallStore(t)
	ctx := context.Background()

	if err := store.CreateRinging(ctx, testRingingCall("call-1", 1, 2), time.Minute); err != nil {
		t.Fatalf("create first call: %v", err)
	}

	for _, record := range []callRecord{
		testRingingCall("call-2", 1, 3),
		testRingingCall("call-3", 4, 2),
	} {
		if err := store.CreateRinging(ctx, record, time.Minute); !errors.Is(err, errCallBusy) {
			t.Fatalf("expected busy for %+v, got %v", record, err)
		}
	}
}

func TestRedisCallStoreConcurrentCrossInviteCreatesOnlyOneCall(t *testing.T) {
	store, _ := newTestCallStore(t)
	ctx := context.Background()
	calls := []callRecord{
		testRingingCall("call-a", 1, 2),
		testRingingCall("call-b", 2, 1),
	}

	start := make(chan struct{})
	results := make(chan error, len(calls))
	var wg sync.WaitGroup
	for _, record := range calls {
		record := record
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			results <- store.CreateRinging(ctx, record, time.Minute)
		}()
	}
	close(start)
	wg.Wait()
	close(results)

	successes := 0
	busy := 0
	for err := range results {
		switch {
		case err == nil:
			successes++
		case errors.Is(err, errCallBusy):
			busy++
		default:
			t.Fatalf("unexpected error: %v", err)
		}
	}
	if successes != 1 || busy != 1 {
		t.Fatalf("expected one success and one busy, got success=%d busy=%d", successes, busy)
	}
}

func TestRedisCallStoreMarkActiveRequiresCalleeAndRefreshesAllTTLs(t *testing.T) {
	store, mini := newTestCallStore(t)
	ctx := context.Background()
	if err := store.CreateRinging(ctx, testRingingCall("call-1", 1, 2), time.Minute); err != nil {
		t.Fatal(err)
	}

	if _, err := store.MarkActive(ctx, "call-1", 1, time.Unix(200, 0), 12*time.Hour); !errors.Is(err, errCallRole) {
		t.Fatalf("expected caller to be rejected, got %v", err)
	}

	record, err := store.MarkActive(ctx, "call-1", 2, time.Unix(200, 0), 12*time.Hour)
	if err != nil {
		t.Fatalf("mark active: %v", err)
	}
	if record.Status != callStatusActive || record.AcceptedAt == nil {
		t.Fatalf("unexpected active record: %+v", record)
	}

	for _, key := range []string{callSessionKey("call-1"), callUserKey(1), callUserKey(2)} {
		if ttl := mini.TTL(key); ttl != 12*time.Hour {
			t.Fatalf("expected %s TTL 12h, got %v", key, ttl)
		}
	}
}

func TestRedisCallStoreDeleteOnlyRemovesMappingsOwnedByCall(t *testing.T) {
	store, mini := newTestCallStore(t)
	ctx := context.Background()
	if err := store.CreateRinging(ctx, testRingingCall("call-1", 1, 2), time.Minute); err != nil {
		t.Fatal(err)
	}

	mini.Set(callUserKey(2), "newer-call")
	if _, err := store.Delete(ctx, "call-1"); err != nil {
		t.Fatalf("delete call: %v", err)
	}

	if mini.Exists(callSessionKey("call-1")) {
		t.Fatal("expected call session deleted")
	}
	if mini.Exists(callUserKey(1)) {
		t.Fatal("expected caller mapping deleted")
	}
	mini.CheckGet(t, callUserKey(2), "newer-call")
}

func TestRedisCallStoreFindByUserReturnsRecord(t *testing.T) {
	store, _ := newTestCallStore(t)
	ctx := context.Background()
	expected := testRingingCall("call-1", 1, 2)
	if err := store.CreateRinging(ctx, expected, time.Minute); err != nil {
		t.Fatal(err)
	}

	actual, err := store.FindByUser(ctx, 2)
	if err != nil {
		t.Fatalf("find by user: %v", err)
	}
	if actual.ID != expected.ID || actual.CallerID != 1 || actual.CalleeID != 2 {
		t.Fatalf("unexpected record: %+v", actual)
	}
}


func TestRedisCallStoreDeleteIfStatusPreservesAcceptedCall(t *testing.T) {
	store, _ := newTestCallStore(t)
	ctx := context.Background()
	if err := store.CreateRinging(ctx, testRingingCall("call-1", 1, 2), time.Minute); err != nil {
		t.Fatal(err)
	}
	if _, err := store.MarkActive(ctx, "call-1", 2, time.Unix(200, 0), time.Hour); err != nil {
		t.Fatal(err)
	}

	if _, err := store.DeleteIfStatus(ctx, "call-1", callStatusRinging); !errors.Is(err, errCallState) {
		t.Fatalf("expected state error, got %v", err)
	}
	record, err := store.Get(ctx, "call-1")
	if err != nil {
		t.Fatalf("expected active call to remain: %v", err)
	}
	if record.Status != callStatusActive {
		t.Fatalf("expected active call, got %s", record.Status)
	}
}
