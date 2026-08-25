package main

import "testing"

func TestSelectCommandRecognizesBackfillThumbnails(t *testing.T) {
	command, err := selectCommand([]string{"backfill-thumbnails"})
	if err != nil {
		t.Fatalf("select backfill-thumbnails command: %v", err)
	}
	if command != commandBackfillThumbnails {
		t.Fatalf("expected backfill-thumbnails command, got %q", command)
	}
}
