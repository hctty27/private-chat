package main

import "testing"

func TestSelectCommandDefaultsToServe(t *testing.T) {
	command, err := selectCommand(nil)
	if err != nil {
		t.Fatalf("select default command: %v", err)
	}
	if command != commandServe {
		t.Fatalf("expected serve command, got %q", command)
	}
}

func TestSelectCommandRecognizesMigrate(t *testing.T) {
	command, err := selectCommand([]string{"migrate"})
	if err != nil {
		t.Fatalf("select migrate command: %v", err)
	}
	if command != commandMigrate {
		t.Fatalf("expected migrate command, got %q", command)
	}
}

func TestSelectCommandRejectsUnknownCommand(t *testing.T) {
	if _, err := selectCommand([]string{"unknown"}); err == nil {
		t.Fatal("expected unknown command to fail")
	}
}
