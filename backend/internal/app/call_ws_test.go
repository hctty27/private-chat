package app

import (
	"strings"
	"testing"
)

func TestCallIDFromDataRejectsEmptyAndOversizedValues(t *testing.T) {
	for _, value := range []string{"", strings.Repeat("a", maxCallIDLength+1)} {
		if _, err := callIDFromData(map[string]any{"callId": value}); err == nil {
			t.Fatalf("expected invalid call id for length %d", len(value))
		}
	}
}

func TestCallTypeFromDataDefaultsToAudioAndAcceptsVideo(t *testing.T) {
	kind, err := callTypeFromData(map[string]any{})
	if err != nil || kind != callTypeAudio {
		t.Fatalf("expected audio default, got %q err=%v", kind, err)
	}
	kind, err = callTypeFromData(map[string]any{"callType": "video"})
	if err != nil || kind != callTypeVideo {
		t.Fatalf("expected video, got %q err=%v", kind, err)
	}
	if _, err := callTypeFromData(map[string]any{"callType": "screen"}); err == nil {
		t.Fatal("expected invalid call type to be rejected")
	}
}

func TestSessionDescriptionFromDataRejectsOversizedSDP(t *testing.T) {
	_, err := sessionDescriptionFromData(map[string]any{
		"sdp": map[string]any{
			"type": "offer",
			"sdp":  strings.Repeat("x", maxSDPLength+1),
		},
	}, "offer")
	if err == nil {
		t.Fatal("expected oversized sdp to be rejected")
	}
}

func TestSessionDescriptionFromDataRequiresExpectedType(t *testing.T) {
	if _, err := sessionDescriptionFromData(map[string]any{
		"sdp": map[string]any{"type": "answer", "sdp": "x"},
	}, "offer"); err == nil {
		t.Fatal("expected mismatched sdp type to be rejected")
	}
}

func TestIceCandidateFromDataRejectsOversizedCandidate(t *testing.T) {
	_, err := iceCandidateFromData(map[string]any{
		"candidate": map[string]any{
			"candidate": strings.Repeat("x", maxICECandidateLength+1),
		},
	})
	if err == nil {
		t.Fatal("expected oversized candidate to be rejected")
	}
}

func TestIceCandidateFromDataPreservesSafeFields(t *testing.T) {
	candidate, err := iceCandidateFromData(map[string]any{
		"candidate": map[string]any{
			"candidate":        "candidate:1",
			"sdpMid":           "0",
			"sdpMLineIndex":    float64(0),
			"usernameFragment": "abc",
			"ignored":          "not-forwarded",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if candidate["candidate"] != "candidate:1" || candidate["sdpMLineIndex"] != 0 {
		t.Fatalf("unexpected candidate: %#v", candidate)
	}
	if _, exists := candidate["ignored"]; exists {
		t.Fatalf("unexpected forwarded field: %#v", candidate)
	}
}

func TestIsCallWebSocketType(t *testing.T) {
	for _, msgType := range []string{
		"call_invite", "call_accept", "call_reject", "call_cancel", "call_hangup",
		"webrtc_offer", "webrtc_answer", "webrtc_ice",
	} {
		if !isCallWebSocketType(msgType) {
			t.Fatalf("expected %s to be a call type", msgType)
		}
	}
	if isCallWebSocketType("chat") {
		t.Fatal("chat must not be treated as call signaling")
	}
}

func TestIceCandidateFromDataAcceptsEndOfCandidates(t *testing.T) {
	candidate, err := iceCandidateFromData(map[string]any{
		"candidate": map[string]any{
			"candidate": "",
		},
	})
	if err != nil {
		t.Fatalf("expected end-of-candidates marker to be accepted: %v", err)
	}
	if candidate["candidate"] != "" {
		t.Fatalf("unexpected candidate: %#v", candidate)
	}
}
