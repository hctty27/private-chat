package app

import (
	"context"
	"errors"
	"fmt"

	"privatechat/internal/model"

	"gorm.io/gorm"
)

var errContactForbidden = errors.New("contact relationship required")

type relationAuthorizer interface {
	IsContact(context.Context, int64, int64) (bool, error)
	ContactIDs(context.Context, int64) ([]int64, error)
}

type gormRelationAuthorizer struct {
	db *gorm.DB
}

func newRelationAuthorizer(db *gorm.DB) relationAuthorizer {
	return &gormRelationAuthorizer{db: db}
}

func (r *gormRelationAuthorizer) IsContact(ctx context.Context, userID, targetID int64) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Model(&model.Relation{}).
		Where("user_id = ? AND target_id = ?", userID, targetID).
		Count(&count).Error
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

func (r *gormRelationAuthorizer) ContactIDs(ctx context.Context, userID int64) ([]int64, error) {
	var ids []int64
	err := r.db.WithContext(ctx).
		Model(&model.Relation{}).
		Where("user_id = ?", userID).
		Order("id ASC").
		Pluck("target_id", &ids).Error
	if err != nil {
		return nil, err
	}
	return ids, nil
}

func (a *App) requireContact(ctx context.Context, userID, targetID int64) error {
	if userID <= 0 || targetID <= 0 || userID == targetID {
		return errContactForbidden
	}
	if a.relations == nil {
		return fmt.Errorf("relation authorizer is not configured")
	}
	allowed, err := a.relations.IsContact(ctx, userID, targetID)
	if err != nil {
		return fmt.Errorf("check contact relation: %w", err)
	}
	if !allowed {
		return errContactForbidden
	}
	return nil
}

func (a *App) contactSessions(ctx context.Context, userID int64) ([]*Session, error) {
	if a.relations == nil {
		return nil, fmt.Errorf("relation authorizer is not configured")
	}
	contactIDs, err := a.relations.ContactIDs(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("list contact relations: %w", err)
	}
	if a.hub == nil {
		return nil, nil
	}

	sessions := make([]*Session, 0, len(contactIDs))
	for _, contactID := range contactIDs {
		if session := a.hub.Get(contactID); session != nil {
			sessions = append(sessions, session)
		}
	}
	return sessions, nil
}
