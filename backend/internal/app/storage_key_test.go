package app

import "testing"

func TestObjectStorageKeyAddsPrefix(t *testing.T) {
	got := objectStorageKey("private-chat", "file.png")
	if got != "private-chat/file.png" {
		t.Fatalf("expected prefixed object key, got %q", got)
	}
}

func TestObjectStorageKeyTrimsPrefixSlashes(t *testing.T) {
	got := objectStorageKey("/private-chat/", "file.png")
	if got != "private-chat/file.png" {
		t.Fatalf("expected normalized object key, got %q", got)
	}
}

func TestObjectStorageKeyReturnsNameWithoutPrefix(t *testing.T) {
	got := objectStorageKey("", "file.png")
	if got != "file.png" {
		t.Fatalf("expected bare object key, got %q", got)
	}
}
