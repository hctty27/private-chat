package app

import "testing"

func TestVoiceMessagesUseAttachmentPipeline(t *testing.T) {
	if !isFileMessageType(6) {
		t.Fatal("voice message type must be handled as an attachment")
	}
}

func TestVoiceContentTypesAreInline(t *testing.T) {
	for _, contentType := range []string{"audio/mp4", "audio/webm", "audio/ogg", "audio/mpeg", "audio/aac"} {
		if !safeInlineContentType(contentType) {
			t.Fatalf("expected %s to be served inline", contentType)
		}
	}
}
