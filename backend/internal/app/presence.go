package app

import (
	"context"
	"fmt"
	"time"

	"privatechat/internal/model"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"
)

const lastSeenPersistInterval = time.Minute

func lastSeenThrottleKey(userID int64) string {
	return fmt.Sprintf("presence:last_seen:persist:%d", userID)
}

type lastSeenRepository interface {
	UpdateLastSeen(context.Context, int64, time.Time) error
}

type gormLastSeenRepository struct {
	db *gorm.DB
}

func (r gormLastSeenRepository) UpdateLastSeen(ctx context.Context, userID int64, at time.Time) error {
	return r.db.WithContext(ctx).
		Model(&model.User{}).
		Where("id = ?", userID).
		Update("last_seen_at", at.UTC()).Error
}

type lastSeenThrottle interface {
	Acquire(context.Context, int64, time.Duration) (bool, error)
}

type redisLastSeenThrottle struct {
	client *redis.Client
}

func (r redisLastSeenThrottle) Acquire(ctx context.Context, userID int64, window time.Duration) (bool, error) {
	return r.client.SetNX(ctx, lastSeenThrottleKey(userID), "1", window).Result()
}

type presenceService struct {
	repo     lastSeenRepository
	throttle lastSeenThrottle
}

func newPresenceService(repo lastSeenRepository, throttle lastSeenThrottle) *presenceService {
	return &presenceService{repo: repo, throttle: throttle}
}

func (p *presenceService) PersistImmediate(ctx context.Context, userID int64, at time.Time) error {
	return p.repo.UpdateLastSeen(ctx, userID, at.UTC())
}

func (p *presenceService) PersistThrottled(ctx context.Context, userID int64, at time.Time) error {
	allowed, err := p.throttle.Acquire(ctx, userID, lastSeenPersistInterval)
	if err != nil {
		return err
	}
	if !allowed {
		return nil
	}
	return p.repo.UpdateLastSeen(ctx, userID, at.UTC())
}

func (p *presenceService) ArmThrottle(ctx context.Context, userID int64) error {
	_, err := p.throttle.Acquire(ctx, userID, lastSeenPersistInterval)
	return err
}

func formatPresenceTime(t time.Time) string {
	return t.UTC().Format(time.RFC3339)
}

func optionalPresenceTime(t *time.Time) *string {
	if t == nil {
		return nil
	}
	formatted := formatPresenceTime(*t)
	return &formatted
}

func onlinePresencePayload(userID int64, online bool, lastSeenAt *time.Time) gin.H {
	data := map[string]any{
		"userId": userID,
		"online": online,
	}
	if !online && lastSeenAt != nil {
		data["lastSeenAt"] = formatPresenceTime(*lastSeenAt)
	}
	return gin.H{"type": "online", "data": data}
}
