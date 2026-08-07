package migration

import (
	"errors"
	"testing"

	migrate "github.com/golang-migrate/migrate/v4"
)

type stubUpRunner struct {
	err error
}

func (s stubUpRunner) Up() error { return s.err }

func TestRunUpTreatsNoChangeAsSuccess(t *testing.T) {
	if err := runUp(stubUpRunner{err: migrate.ErrNoChange}); err != nil {
		t.Fatalf("expected ErrNoChange to succeed, got %v", err)
	}
}

func TestRunUpPropagatesMigrationFailure(t *testing.T) {
	want := errors.New("migration failed")
	if err := runUp(stubUpRunner{err: want}); !errors.Is(err, want) {
		t.Fatalf("expected migration failure to propagate, got %v", err)
	}
}

func TestRunUpReturnsNilOnSuccessfulMigration(t *testing.T) {
	if err := runUp(stubUpRunner{}); err != nil {
		t.Fatalf("expected successful migration, got %v", err)
	}
}
