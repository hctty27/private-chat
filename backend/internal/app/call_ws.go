package app

import (
	"context"
	"fmt"
	"strings"
)

const (
	maxCallIDLength       = 128
	maxSDPLength          = 48 * 1024
	maxICECandidateLength = 8 * 1024
)

func isCallWebSocketType(msgType string) bool {
	switch msgType {
	case "call_invite", "call_accept", "call_reject", "call_cancel", "call_hangup",
		"webrtc_offer", "webrtc_answer", "webrtc_ice":
		return true
	default:
		return false
	}
}

func callIDFromData(data map[string]any) (string, error) {
	callID, _ := data["callId"].(string)
	callID = strings.TrimSpace(callID)
	if callID == "" || len(callID) > maxCallIDLength {
		return "", fmt.Errorf("invalid call id")
	}
	return callID, nil
}

func receiverIDFromData(data map[string]any) (int64, error) {
	value, ok := data["receiverId"].(float64)
	if !ok || value <= 0 || value != float64(int64(value)) {
		return 0, fmt.Errorf("invalid receiver id")
	}
	return int64(value), nil
}

func callTypeFromData(data map[string]any) (callType, error) {
	raw, exists := data["callType"]
	if !exists || raw == nil {
		return callTypeAudio, nil
	}
	value, ok := raw.(string)
	if !ok {
		return "", fmt.Errorf("invalid call type")
	}
	kind := callType(strings.TrimSpace(value))
	if kind == "" {
		return callTypeAudio, nil
	}
	if !validCallType(kind) {
		return "", fmt.Errorf("invalid call type")
	}
	return kind, nil
}

func sessionDescriptionFromData(data map[string]any, expectedType string) (map[string]any, error) {
	raw, ok := data["sdp"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("invalid sdp")
	}
	sdpType, _ := raw["type"].(string)
	sdp, _ := raw["sdp"].(string)
	if sdpType != expectedType || sdp == "" || len(sdp) > maxSDPLength {
		return nil, fmt.Errorf("invalid sdp")
	}
	return map[string]any{"type": sdpType, "sdp": sdp}, nil
}

func iceCandidateFromData(data map[string]any) (map[string]any, error) {
	raw, ok := data["candidate"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("invalid ice candidate")
	}
	candidate, ok := raw["candidate"].(string)
	if !ok || len(candidate) > maxICECandidateLength {
		return nil, fmt.Errorf("invalid ice candidate")
	}

	result := map[string]any{"candidate": candidate}
	if mid, ok := raw["sdpMid"].(string); ok {
		if len(mid) > 128 {
			return nil, fmt.Errorf("invalid ice sdpMid")
		}
		result["sdpMid"] = mid
	}
	if index, ok := raw["sdpMLineIndex"].(float64); ok {
		if index < 0 || index > 65535 || index != float64(int(index)) {
			return nil, fmt.Errorf("invalid ice sdpMLineIndex")
		}
		result["sdpMLineIndex"] = int(index)
	}
	if fragment, ok := raw["usernameFragment"].(string); ok {
		if len(fragment) > 256 {
			return nil, fmt.Errorf("invalid ice usernameFragment")
		}
		result["usernameFragment"] = fragment
	}
	return result, nil
}

func (a *App) handleWsCall(userID int64, msgType string, data map[string]any) error {
	if !a.cfg.WebRTCEnabled {
		return fmt.Errorf("webrtc disabled")
	}
	if a.calls == nil {
		return fmt.Errorf("call manager unavailable")
	}
	ctx := context.Background()

	switch msgType {
	case "call_invite":
		receiverID, err := receiverIDFromData(data)
		if err != nil {
			return err
		}
		kind, err := callTypeFromData(data)
		if err != nil {
			return err
		}
		return a.calls.Invite(ctx, userID, receiverID, kind)
	case "call_accept":
		callID, err := callIDFromData(data)
		if err != nil {
			return err
		}
		return a.calls.Accept(ctx, userID, callID)
	case "call_reject":
		callID, err := callIDFromData(data)
		if err != nil {
			return err
		}
		reason, _ := data["reason"].(string)
		return a.calls.Reject(ctx, userID, callID, reason)
	case "call_cancel":
		callID, err := callIDFromData(data)
		if err != nil {
			return err
		}
		return a.calls.Cancel(ctx, userID, callID)
	case "call_hangup":
		callID, err := callIDFromData(data)
		if err != nil {
			return err
		}
		reason, _ := data["reason"].(string)
		return a.calls.Hangup(ctx, userID, callID, reason)
	case "webrtc_offer":
		callID, err := callIDFromData(data)
		if err != nil {
			return err
		}
		sdp, err := sessionDescriptionFromData(data, "offer")
		if err != nil {
			return err
		}
		return a.calls.RelayOffer(ctx, userID, callID, sdp)
	case "webrtc_answer":
		callID, err := callIDFromData(data)
		if err != nil {
			return err
		}
		sdp, err := sessionDescriptionFromData(data, "answer")
		if err != nil {
			return err
		}
		return a.calls.RelayAnswer(ctx, userID, callID, sdp)
	case "webrtc_ice":
		callID, err := callIDFromData(data)
		if err != nil {
			return err
		}
		candidate, err := iceCandidateFromData(data)
		if err != nil {
			return err
		}
		return a.calls.RelayICE(ctx, userID, callID, candidate)
	default:
		return fmt.Errorf("unsupported call websocket type %q", msgType)
	}
}
