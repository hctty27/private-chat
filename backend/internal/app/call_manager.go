package app

import (
	"context"
	"errors"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const (
	defaultCallRingingTTL = 60 * time.Second
	defaultCallActiveTTL  = 12 * time.Hour
)

type callManager struct {
	store          callStore
	requireContact func(context.Context, int64, int64) error
	isConnected    func(int64) bool
	send           func(int64, any)
	newID          func() string
	now            func() time.Time
	schedule       func(time.Duration, func())
	ringingTTL     time.Duration
	activeTTL      time.Duration
}

func newCallManager(
	store callStore,
	requireContact func(context.Context, int64, int64) error,
	isConnected func(int64) bool,
	send func(int64, any),
) *callManager {
	return &callManager{
		store:          store,
		requireContact: requireContact,
		isConnected:    isConnected,
		send:           send,
		newID:          uuid.NewString,
		now:            func() time.Time { return time.Now().UTC() },
		schedule: func(delay time.Duration, fn func()) {
			time.AfterFunc(delay, fn)
		},
		ringingTTL: defaultCallRingingTTL,
		activeTTL:  defaultCallActiveTTL,
	}
}

func callMessage(msgType string, data gin.H) gin.H {
	return gin.H{"type": msgType, "data": data}
}

func (m *callManager) Invite(ctx context.Context, callerID, calleeID int64, kind callType) error {
	if callerID <= 0 || calleeID <= 0 || callerID == calleeID {
		return errCallRole
	}
	if !validCallType(kind) {
		return errCallState
	}
	if err := m.requireContact(ctx, callerID, calleeID); err != nil {
		return err
	}
	if !m.isConnected(calleeID) {
		m.send(callerID, callMessage("call_unavailable", gin.H{
			"userId": calleeID,
			"reason": "offline",
		}))
		return nil
	}

	record := callRecord{
		ID:        m.newID(),
		CallerID:  callerID,
		CalleeID:  calleeID,
		CallType:  kind,
		Status:    callStatusRinging,
		CreatedAt: m.now().UTC(),
	}
	if err := m.store.CreateRinging(ctx, record, m.ringingTTL); err != nil {
		if errors.Is(err, errCallBusy) {
			m.send(callerID, callMessage("call_busy", gin.H{"userId": calleeID}))
			return nil
		}
		return err
	}

	m.send(callerID, callMessage("call_ringing", gin.H{
		"callId":   record.ID,
		"userId":   calleeID,
		"callType": record.CallType,
	}))
	m.send(calleeID, callMessage("call_incoming", gin.H{
		"callId":   record.ID,
		"callerId": callerID,
		"callType": record.CallType,
	}))

	m.schedule(m.ringingTTL, func() {
		m.timeoutRinging(record.ID)
	})
	return nil
}

func (m *callManager) timeoutRinging(callID string) {
	ctx := context.Background()
	record, err := m.store.DeleteIfStatus(ctx, callID, callStatusRinging)
	if err != nil {
		return
	}
	payload := callMessage("call_timeout", gin.H{"callId": callID})
	m.send(record.CallerID, payload)
	m.send(record.CalleeID, payload)
}

func (m *callManager) Accept(ctx context.Context, userID int64, callID string) error {
	record, err := m.store.MarkActive(ctx, callID, userID, m.now().UTC(), m.activeTTL)
	if err != nil {
		return err
	}
	payload := callMessage("call_accepted", gin.H{
		"callId":   callID,
		"callType": record.CallType,
	})
	m.send(record.CallerID, payload)
	m.send(record.CalleeID, payload)
	return nil
}

func (m *callManager) Reject(ctx context.Context, userID int64, callID, reason string) error {
	record, err := m.store.Get(ctx, callID)
	if err != nil {
		return err
	}
	if record.Status != callStatusRinging {
		return errCallState
	}
	if userID != record.CalleeID {
		return errCallRole
	}
	if reason == "" {
		reason = "rejected"
	}
	if reason != "rejected" && reason != "media_unavailable" {
		return errCallState
	}
	if _, err := m.store.DeleteIfStatus(ctx, callID, callStatusRinging); err != nil {
		return err
	}
	m.send(record.CallerID, callMessage("call_rejected", gin.H{
		"callId": callID,
		"reason": reason,
	}))
	return nil
}

func (m *callManager) Cancel(ctx context.Context, userID int64, callID string) error {
	record, err := m.store.Get(ctx, callID)
	if err != nil {
		return err
	}
	if userID != record.CallerID {
		return errCallRole
	}

	switch record.Status {
	case callStatusRinging:
		if _, err := m.store.DeleteIfStatus(ctx, callID, callStatusRinging); err != nil {
			return err
		}
		m.send(record.CalleeID, callMessage("call_cancelled", gin.H{"callId": callID}))
		return nil
	case callStatusActive:
		if _, err := m.store.DeleteIfStatus(ctx, callID, callStatusActive); err != nil {
			return err
		}
		m.send(record.CalleeID, callMessage("call_ended", gin.H{
			"callId": callID,
			"reason": "hangup",
		}))
		return nil
	default:
		return errCallState
	}
}

func (m *callManager) Hangup(ctx context.Context, userID int64, callID, reason string) error {
	record, err := m.store.Get(ctx, callID)
	if err != nil {
		return err
	}
	if record.Status != callStatusActive {
		return errCallState
	}
	peerID, ok := callPeer(record, userID)
	if !ok {
		return errCallRole
	}
	if reason == "" {
		reason = "hangup"
	}
	if reason != "hangup" && reason != "failed" {
		return errCallState
	}
	if _, err := m.store.DeleteIfStatus(ctx, callID, callStatusActive); err != nil {
		return err
	}
	m.send(peerID, callMessage("call_ended", gin.H{
		"callId": callID,
		"reason": reason,
	}))
	return nil
}

func callPeer(record callRecord, userID int64) (int64, bool) {
	switch userID {
	case record.CallerID:
		return record.CalleeID, true
	case record.CalleeID:
		return record.CallerID, true
	default:
		return 0, false
	}
}

func (m *callManager) RelayOffer(ctx context.Context, userID int64, callID string, sdp map[string]any) error {
	record, err := m.store.Get(ctx, callID)
	if err != nil {
		return err
	}
	if record.Status != callStatusActive {
		return errCallState
	}
	if userID != record.CallerID {
		return errCallRole
	}
	m.send(record.CalleeID, callMessage("webrtc_offer", gin.H{"callId": callID, "sdp": sdp}))
	return nil
}

func (m *callManager) RelayAnswer(ctx context.Context, userID int64, callID string, sdp map[string]any) error {
	record, err := m.store.Get(ctx, callID)
	if err != nil {
		return err
	}
	if record.Status != callStatusActive {
		return errCallState
	}
	if userID != record.CalleeID {
		return errCallRole
	}
	m.send(record.CallerID, callMessage("webrtc_answer", gin.H{"callId": callID, "sdp": sdp}))
	return nil
}

func (m *callManager) RelayICE(ctx context.Context, userID int64, callID string, candidate map[string]any) error {
	record, err := m.store.Get(ctx, callID)
	if err != nil {
		return err
	}
	if record.Status != callStatusActive {
		return errCallState
	}
	peerID, ok := callPeer(record, userID)
	if !ok {
		return errCallRole
	}
	m.send(peerID, callMessage("webrtc_ice", gin.H{"callId": callID, "candidate": candidate}))
	return nil
}

func (m *callManager) Disconnect(ctx context.Context, userID int64) {
	record, err := m.store.FindByUser(ctx, userID)
	if err != nil {
		return
	}
	peerID, ok := callPeer(record, userID)
	if !ok {
		return
	}
	if _, err := m.store.Delete(ctx, record.ID); err != nil {
		return
	}
	m.send(peerID, callMessage("call_ended", gin.H{
		"callId": record.ID,
		"reason": "disconnected",
	}))
}
