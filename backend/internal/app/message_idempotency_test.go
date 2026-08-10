package app

import (
	"context"
	"os"
	"sync"
	"testing"
	"time"

	"privatechat/internal/config"
	"privatechat/internal/model"
	pdb "privatechat/internal/platform/db"
)

func TestSaveMessageIdempotencySequentialRetryReturnsCanonicalMessage(t *testing.T) {
	app := requirePostgresTestApp(t)
	clientMsgID := "idempotency-sequential-1"
	cleanupIdempotencyRows(t, app, clientMsgID)

	firstContent := "first"
	first, err := app.saveMessage(context.Background(), 910001, 910002, 1, &firstContent, nil, &clientMsgID)
	if err != nil {
		t.Fatalf("save first message: %v", err)
	}

	retryContent := "changed"
	retry, err := app.saveMessage(context.Background(), 910001, 910099, 1, &retryContent, nil, &clientMsgID)
	if err != nil {
		t.Fatalf("save retry message: %v", err)
	}

	if retry.ID != first.ID {
		t.Fatalf("expected retry to return message %d, got %d", first.ID, retry.ID)
	}
	if retry.ReceiverID != 910002 {
		t.Fatalf("expected first receiver to win, got %d", retry.ReceiverID)
	}
	if retry.Content == nil || *retry.Content != firstContent {
		t.Fatalf("expected first content to win, got %#v", retry.Content)
	}
	if retry.ClientMsgID == nil || *retry.ClientMsgID != clientMsgID {
		t.Fatalf("expected persisted clientMsgId, got %#v", retry.ClientMsgID)
	}

	assertIdempotencyRowCount(t, app, 910001, clientMsgID, 1)
}

func TestSaveMessageIdempotencyConcurrentRetryCreatesOneRow(t *testing.T) {
	app := requirePostgresTestApp(t)
	clientMsgID := "idempotency-concurrent-1"
	cleanupIdempotencyRows(t, app, clientMsgID)

	const workers = 16
	ids := make(chan int64, workers)
	errs := make(chan error, workers)
	var wg sync.WaitGroup

	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			content := "same logical message"
			saved, err := app.saveMessage(context.Background(), 920001, 920002, 1, &content, nil, &clientMsgID)
			if err != nil {
				errs <- err
				return
			}
			ids <- saved.ID
		}()
	}

	wg.Wait()
	close(ids)
	close(errs)

	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent save failed: %v", err)
		}
	}

	var canonicalID int64
	for id := range ids {
		if canonicalID == 0 {
			canonicalID = id
			continue
		}
		if id != canonicalID {
			t.Fatalf("expected all retries to return id %d, got %d", canonicalID, id)
		}
	}
	if canonicalID == 0 {
		t.Fatal("expected a persisted message id")
	}

	assertIdempotencyRowCount(t, app, 920001, clientMsgID, 1)
}

func TestSaveMessageIdempotencyAllowsDifferentSendersToReuseClientMsgID(t *testing.T) {
	app := requirePostgresTestApp(t)
	clientMsgID := "idempotency-shared-1"
	cleanupIdempotencyRows(t, app, clientMsgID)

	content := "shared id"
	first, err := app.saveMessage(context.Background(), 930001, 930003, 1, &content, nil, &clientMsgID)
	if err != nil {
		t.Fatalf("save first sender: %v", err)
	}
	second, err := app.saveMessage(context.Background(), 930002, 930003, 1, &content, nil, &clientMsgID)
	if err != nil {
		t.Fatalf("save second sender: %v", err)
	}
	if first.ID == second.ID {
		t.Fatalf("expected different senders to create distinct rows, both returned %d", first.ID)
	}

	assertIdempotencyRowCount(t, app, 930001, clientMsgID, 1)
	assertIdempotencyRowCount(t, app, 930002, clientMsgID, 1)
}

func requirePostgresTestApp(t *testing.T) *App {
	t.Helper()
	if os.Getenv("RUN_POSTGRES_TESTS") != "1" {
		t.Skip("set RUN_POSTGRES_TESTS=1 to run PostgreSQL integration tests")
	}

	db, err := pdb.OpenPostgres(config.Load())
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("resolve sql db: %v", err)
	}
	t.Cleanup(func() {
		_ = sqlDB.Close()
	})

	return &App{db: db, loc: time.UTC}
}

func cleanupIdempotencyRows(t *testing.T, app *App, clientMsgID string) {
	t.Helper()
	if err := app.db.Where("client_msg_id = ?", clientMsgID).Delete(&model.Message{}).Error; err != nil {
		t.Fatalf("cleanup idempotency rows: %v", err)
	}
	t.Cleanup(func() {
		_ = app.db.Where("client_msg_id = ?", clientMsgID).Delete(&model.Message{}).Error
	})
}

func assertIdempotencyRowCount(t *testing.T, app *App, senderID int64, clientMsgID string, want int64) {
	t.Helper()
	var count int64
	if err := app.db.Model(&model.Message{}).
		Where("sender_id = ? AND client_msg_id = ?", senderID, clientMsgID).
		Count(&count).Error; err != nil {
		t.Fatalf("count idempotency rows: %v", err)
	}
	if count != want {
		t.Fatalf("expected %d row(s), got %d", want, count)
	}
}
