package app

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"privatechat/internal/model"

	"github.com/gin-gonic/gin"
)

const (
	availabilityMinDuration = 15 * time.Minute
	availabilityMaxDuration = 12 * time.Hour
	availabilityMaxAdvance  = 30 * 24 * time.Hour
	availabilityPastGrace   = time.Minute
	availabilityNoteLimit   = 80
)

func (a *App) getAvailabilityHandler(c *gin.Context) {
	userID, ok := getUserID(c)
	if !ok {
		unauthorized(c)
		return
	}

	var user model.User
	if err := a.db.First(&user, userID).Error; err != nil {
		respondError(c, http.StatusInternalServerError, http.StatusInternalServerError, "读取计划上线时间失败")
		return
	}
	respondSuccess(c, availabilityDTOForUser(user, time.Now().UTC(), a.loc))
}

func (a *App) updateAvailabilityHandler(c *gin.Context) {
	userID, ok := getUserID(c)
	if !ok {
		unauthorized(c)
		return
	}

	var req model.AvailabilityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondError(c, http.StatusBadRequest, http.StatusBadRequest, "请求参数错误")
		return
	}

	startAt, endAt, note, err := parseAvailabilityRequest(req, time.Now().UTC())
	if err != nil {
		respondError(c, http.StatusBadRequest, http.StatusBadRequest, err.Error())
		return
	}

	if err := a.db.Model(&model.User{}).
		Where("id = ?", userID).
		Updates(map[string]any{
			"availability_start_at": startAt,
			"availability_end_at":   endAt,
			"availability_note":     note,
		}).Error; err != nil {
		respondError(c, http.StatusInternalServerError, http.StatusInternalServerError, "保存计划上线时间失败")
		return
	}

	var user model.User
	if err := a.db.First(&user, userID).Error; err != nil {
		respondError(c, http.StatusInternalServerError, http.StatusInternalServerError, "读取计划上线时间失败")
		return
	}
	availability := availabilityDTOForUser(user, time.Now().UTC(), a.loc)
	a.broadcastAvailability(userID, availability)
	respondSuccess(c, availability)
}

func (a *App) clearAvailabilityHandler(c *gin.Context) {
	userID, ok := getUserID(c)
	if !ok {
		unauthorized(c)
		return
	}

	if err := a.db.Model(&model.User{}).
		Where("id = ?", userID).
		Updates(map[string]any{
			"availability_start_at": nil,
			"availability_end_at":   nil,
			"availability_note":     nil,
		}).Error; err != nil {
		respondError(c, http.StatusInternalServerError, http.StatusInternalServerError, "清除计划上线时间失败")
		return
	}

	a.broadcastAvailability(userID, nil)
	respondSuccess(c, any(nil))
}

func parseAvailabilityRequest(req model.AvailabilityRequest, now time.Time) (time.Time, time.Time, *string, error) {
	startAt, err := time.Parse(time.RFC3339, strings.TrimSpace(req.StartAt))
	if err != nil {
		return time.Time{}, time.Time{}, nil, fmt.Errorf("上线时间格式错误")
	}
	endAt, err := time.Parse(time.RFC3339, strings.TrimSpace(req.EndAt))
	if err != nil {
		return time.Time{}, time.Time{}, nil, fmt.Errorf("结束时间格式错误")
	}

	now = now.UTC()
	startAt = startAt.UTC()
	endAt = endAt.UTC()
	if startAt.Before(now.Add(-availabilityPastGrace)) {
		return time.Time{}, time.Time{}, nil, fmt.Errorf("上线时间不能早于当前时间")
	}
	if startAt.After(now.Add(availabilityMaxAdvance)) {
		return time.Time{}, time.Time{}, nil, fmt.Errorf("最多只能设置未来 30 天")
	}
	duration := endAt.Sub(startAt)
	if duration < availabilityMinDuration {
		return time.Time{}, time.Time{}, nil, fmt.Errorf("预计在线时间至少 15 分钟")
	}
	if duration > availabilityMaxDuration {
		return time.Time{}, time.Time{}, nil, fmt.Errorf("预计在线时间不能超过 12 小时")
	}

	var note *string
	if req.Note != nil {
		trimmed := strings.TrimSpace(*req.Note)
		if utf8.RuneCountInString(trimmed) > availabilityNoteLimit {
			return time.Time{}, time.Time{}, nil, fmt.Errorf("备注不能超过 %d 个字符", availabilityNoteLimit)
		}
		if trimmed != "" {
			note = &trimmed
		}
	}
	return startAt, endAt, note, nil
}

func availabilityDTOForUser(user model.User, now time.Time, loc *time.Location) *model.AvailabilityDTO {
	if user.AvailabilityStartAt == nil || user.AvailabilityEndAt == nil {
		return nil
	}
	if !user.AvailabilityEndAt.After(now) {
		return nil
	}
	if loc == nil {
		loc = time.Local
	}
	return &model.AvailabilityDTO{
		StartAt: user.AvailabilityStartAt.In(loc).Format(time.RFC3339),
		EndAt:   user.AvailabilityEndAt.In(loc).Format(time.RFC3339),
		Note:    user.AvailabilityNote,
	}
}

func (a *App) broadcastAvailability(userID int64, availability *model.AvailabilityDTO) {
	data := gin.H{
		"userId":  userID,
		"startAt": nil,
		"endAt":   nil,
		"note":    nil,
	}
	if availability != nil {
		data["startAt"] = availability.StartAt
		data["endAt"] = availability.EndAt
		data["note"] = availability.Note
	}
	payload := gin.H{"type": "availability", "data": data}

	sessions, err := a.contactSessions(context.Background(), userID)
	if err != nil {
		log.Printf("resolve availability recipients for user %d: %v", userID, err)
		return
	}
	for _, session := range sessions {
		_ = session.SendJSON(payload)
	}
}
