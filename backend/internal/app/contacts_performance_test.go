package app

import (
	"context"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestOnlineStatusMapReturnsPresenceForAllTargets(t *testing.T) {
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() { _ = client.Close() })

	server.Set(onlineKey(2), "1")
	server.Set(onlineKey(4), "1")

	a := &App{redis: client}
	statuses := a.onlineStatusMap(context.Background(), []int64{2, 3, 4})

	if !statuses[2] || statuses[3] || !statuses[4] {
		t.Fatalf("unexpected online statuses: %#v", statuses)
	}
}

func TestOnlineStatusMapTreatsRedisFailureAsOffline(t *testing.T) {
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	server.Close()

	a := &App{redis: client}
	statuses := a.onlineStatusMap(context.Background(), []int64{2, 3})

	if statuses[2] || statuses[3] {
		t.Fatalf("expected Redis failure to fall back to offline, got %#v", statuses)
	}
}
