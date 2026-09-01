package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

type callStatus string
type callType string

const (
	callStatusRinging callStatus = "ringing"
	callStatusActive  callStatus = "active"

	callTypeAudio callType = "audio"
	callTypeVideo callType = "video"
)

func validCallType(value callType) bool {
	return value == callTypeAudio || value == callTypeVideo
}

func normalizeCallType(value callType) callType {
	if value == "" {
		return callTypeAudio
	}
	return value
}

var (
	errCallNotFound = errors.New("call not found")
	errCallBusy     = errors.New("user already has a call")
	errCallState    = errors.New("invalid call state")
	errCallRole     = errors.New("invalid call role")
)

type callRecord struct {
	ID         string     `json:"id"`
	CallerID   int64      `json:"callerId"`
	CalleeID   int64      `json:"calleeId"`
	CallType   callType   `json:"callType"`
	Status     callStatus `json:"status"`
	CreatedAt  time.Time  `json:"createdAt"`
	AcceptedAt *time.Time `json:"acceptedAt,omitempty"`
}

type callStore interface {
	CreateRinging(context.Context, callRecord, time.Duration) error
	Get(context.Context, string) (callRecord, error)
	FindByUser(context.Context, int64) (callRecord, error)
	MarkActive(context.Context, string, int64, time.Time, time.Duration) (callRecord, error)
	Delete(context.Context, string) (callRecord, error)
	DeleteIfStatus(context.Context, string, callStatus) (callRecord, error)
}

type redisCallStore struct {
	client *redis.Client
}

func newRedisCallStore(client *redis.Client) *redisCallStore {
	return &redisCallStore{client: client}
}

func callSessionKey(callID string) string {
	return "voice_call:session:" + callID
}

func callUserKey(userID int64) string {
	return "voice_call:user:" + strconv.FormatInt(userID, 10)
}

func (s *redisCallStore) CreateRinging(ctx context.Context, record callRecord, ttl time.Duration) error {
	if record.ID == "" || record.CallerID <= 0 || record.CalleeID <= 0 || record.CallerID == record.CalleeID {
		return errCallRole
	}
	if !validCallType(record.CallType) || record.Status != callStatusRinging || ttl <= 0 {
		return errCallState
	}

	raw, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("marshal call: %w", err)
	}

	callerKey := callUserKey(record.CallerID)
	calleeKey := callUserKey(record.CalleeID)
	keys := []string{callerKey, calleeKey}

	for attempt := 0; attempt < 5; attempt++ {
		err = s.client.Watch(ctx, func(tx *redis.Tx) error {
			values, err := tx.MGet(ctx, keys...).Result()
			if err != nil {
				return err
			}
			if values[0] != nil || values[1] != nil {
				return errCallBusy
			}

			_, err = tx.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
				pipe.Set(ctx, callSessionKey(record.ID), raw, ttl)
				pipe.Set(ctx, callerKey, record.ID, ttl)
				pipe.Set(ctx, calleeKey, record.ID, ttl)
				return nil
			})
			return err
		}, keys...)
		if !errors.Is(err, redis.TxFailedErr) {
			return err
		}
	}
	return errCallBusy
}

func (s *redisCallStore) Get(ctx context.Context, callID string) (callRecord, error) {
	if callID == "" {
		return callRecord{}, errCallNotFound
	}
	raw, err := s.client.Get(ctx, callSessionKey(callID)).Bytes()
	if errors.Is(err, redis.Nil) {
		return callRecord{}, errCallNotFound
	}
	if err != nil {
		return callRecord{}, err
	}

	var record callRecord
	if err := json.Unmarshal(raw, &record); err != nil {
		return callRecord{}, fmt.Errorf("unmarshal call: %w", err)
	}
	record.CallType = normalizeCallType(record.CallType)
	return record, nil
}

func (s *redisCallStore) FindByUser(ctx context.Context, userID int64) (callRecord, error) {
	callID, err := s.client.Get(ctx, callUserKey(userID)).Result()
	if errors.Is(err, redis.Nil) {
		return callRecord{}, errCallNotFound
	}
	if err != nil {
		return callRecord{}, err
	}

	record, err := s.Get(ctx, callID)
	if errors.Is(err, errCallNotFound) {
		_ = s.client.Del(ctx, callUserKey(userID)).Err()
	}
	return record, err
}

func (s *redisCallStore) MarkActive(
	ctx context.Context,
	callID string,
	actorID int64,
	acceptedAt time.Time,
	ttl time.Duration,
) (callRecord, error) {
	current, err := s.Get(ctx, callID)
	if err != nil {
		return callRecord{}, err
	}
	keys := []string{
		callSessionKey(callID),
		callUserKey(current.CallerID),
		callUserKey(current.CalleeID),
	}

	var updated callRecord
	for attempt := 0; attempt < 5; attempt++ {
		err = s.client.Watch(ctx, func(tx *redis.Tx) error {
			raw, err := tx.Get(ctx, keys[0]).Bytes()
			if errors.Is(err, redis.Nil) {
				return errCallNotFound
			}
			if err != nil {
				return err
			}

			var record callRecord
			if err := json.Unmarshal(raw, &record); err != nil {
				return fmt.Errorf("unmarshal call: %w", err)
			}
			record.CallType = normalizeCallType(record.CallType)
			if record.Status != callStatusRinging {
				return errCallState
			}
			if actorID != record.CalleeID {
				return errCallRole
			}
			if ttl <= 0 {
				return errCallState
			}

			mappings, err := tx.MGet(ctx, callUserKey(record.CallerID), callUserKey(record.CalleeID)).Result()
			if err != nil {
				return err
			}
			if mappings[0] != callID || mappings[1] != callID {
				return errCallState
			}

			acceptedUTC := acceptedAt.UTC()
			record.Status = callStatusActive
			record.AcceptedAt = &acceptedUTC
			encoded, err := json.Marshal(record)
			if err != nil {
				return err
			}

			_, err = tx.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
				pipe.Set(ctx, callSessionKey(callID), encoded, ttl)
				pipe.Set(ctx, callUserKey(record.CallerID), callID, ttl)
				pipe.Set(ctx, callUserKey(record.CalleeID), callID, ttl)
				return nil
			})
			if err == nil {
				updated = record
			}
			return err
		}, keys...)
		if !errors.Is(err, redis.TxFailedErr) {
			return updated, err
		}
	}
	return callRecord{}, errCallState
}

func (s *redisCallStore) Delete(ctx context.Context, callID string) (callRecord, error) {
	return s.delete(ctx, callID, nil)
}

func (s *redisCallStore) DeleteIfStatus(
	ctx context.Context,
	callID string,
	expected callStatus,
) (callRecord, error) {
	return s.delete(ctx, callID, &expected)
}

func (s *redisCallStore) delete(
	ctx context.Context,
	callID string,
	expected *callStatus,
) (callRecord, error) {
	current, err := s.Get(ctx, callID)
	if err != nil {
		return callRecord{}, err
	}
	sessionKey := callSessionKey(callID)
	callerKey := callUserKey(current.CallerID)
	calleeKey := callUserKey(current.CalleeID)
	keys := []string{sessionKey, callerKey, calleeKey}

	var deleted callRecord
	for attempt := 0; attempt < 5; attempt++ {
		err = s.client.Watch(ctx, func(tx *redis.Tx) error {
			raw, err := tx.Get(ctx, sessionKey).Bytes()
			if errors.Is(err, redis.Nil) {
				return errCallNotFound
			}
			if err != nil {
				return err
			}

			var record callRecord
			if err := json.Unmarshal(raw, &record); err != nil {
				return fmt.Errorf("unmarshal call: %w", err)
			}
			record.CallType = normalizeCallType(record.CallType)
			if record.ID != callID {
				return errCallState
			}
			if expected != nil && record.Status != *expected {
				return errCallState
			}

			mappings, err := tx.MGet(ctx, callerKey, calleeKey).Result()
			if err != nil {
				return err
			}
			_, err = tx.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
				pipe.Del(ctx, sessionKey)
				if mappings[0] == callID {
					pipe.Del(ctx, callerKey)
				}
				if mappings[1] == callID {
					pipe.Del(ctx, calleeKey)
				}
				return nil
			})
			if err == nil {
				deleted = record
			}
			return err
		}, keys...)
		if !errors.Is(err, redis.TxFailedErr) {
			return deleted, err
		}
	}
	return callRecord{}, errCallState
}
