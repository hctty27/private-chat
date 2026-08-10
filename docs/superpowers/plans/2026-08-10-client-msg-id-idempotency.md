# Client Message Idempotency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist `clientMsgId` and make repeated WebSocket chat sends from the same sender idempotent, including concurrent retries.

**Architecture:** PostgreSQL is the concurrency boundary. `t_message` stores an optional `client_msg_id` and a partial unique index on `(sender_id, client_msg_id)` prevents duplicates. The Go layer validates the client id, uses `ON CONFLICT DO NOTHING`, then returns the canonical persisted row; DTOs expose the persisted id consistently in WebSocket and history responses.

**Tech Stack:** Go 1.23, Gin, GORM v1.25.12, PostgreSQL, golang-migrate, GitHub Actions.

## Global Constraints

- `clientMsgId` remains optional during rollout.
- Trim surrounding whitespace; blank becomes absent.
- Maximum persisted `clientMsgId` length is 64 characters.
- Idempotency scope is exactly `(sender_id, client_msg_id)`.
- First persisted message wins; retries never overwrite receiver/content/type/file fields.
- Historical rows remain valid with `client_msg_id = NULL`.
- The database unique index is the final concurrency boundary.
- Do not modify the already-applied `202608070001_file_security` migration.

---

### Task 1: Schema and DTO contract

**Files:**
- Create: `backend/internal/migration/sql/202608100001_client_msg_id.up.sql`
- Create: `backend/internal/migration/sql/202608100001_client_msg_id.down.sql`
- Modify: `init.sql`
- Modify: `backend/internal/model/model.go`
- Modify: `backend/internal/app/utils.go`
- Modify: `backend/internal/app/ws_payload_test.go`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `model.Message.ClientMsgID *string`, `model.MessageDTO.ClientMsgID *string`.
- Produces database uniqueness: `(sender_id, client_msg_id) WHERE client_msg_id IS NOT NULL`.

- [ ] **Step 1: Change payload tests first**

Replace wrapper-oriented tests with DTO-oriented expectations:

```go
func TestMessageDTOIncludesClientMsgID(t *testing.T) {
    clientMsgID := "client-abc-123"
    dto := toMessageDTO(model.Message{ID: 42, ClientMsgID: &clientMsgID}, time.UTC)
    body, err := json.Marshal(dto)
    if err != nil { t.Fatalf("marshal payload: %v", err) }
    if !strings.Contains(string(body), `"clientMsgId":"client-abc-123"`) {
        t.Fatalf("expected clientMsgId in payload, got %s", body)
    }
}
```

Add a legacy-row test asserting `clientMsgId` is absent when nil.

- [ ] **Step 2: Verify RED**

Run `cd backend && go test ./internal/app -run 'TestMessageDTO.*ClientMsgID'`.
Expected: compile/test failure because `Message.ClientMsgID` / `MessageDTO.ClientMsgID` do not exist yet.

- [ ] **Step 3: Add schema and model fields**

Migration up:

```sql
BEGIN;
ALTER TABLE t_message ADD COLUMN IF NOT EXISTS client_msg_id VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS uk_message_sender_client_msg_id
    ON t_message (sender_id, client_msg_id)
    WHERE client_msg_id IS NOT NULL;
COMMIT;
```

Migration down:

```sql
BEGIN;
DROP INDEX IF EXISTS uk_message_sender_client_msg_id;
ALTER TABLE t_message DROP COLUMN IF EXISTS client_msg_id;
COMMIT;
```

Add `client_msg_id VARCHAR(64)` plus the same partial unique index to `init.sql`.

Add to both Go structs:

```go
ClientMsgID *string `gorm:"column:client_msg_id" json:"clientMsgId,omitempty"`
```

For `Message`, omit the JSON tag if the struct does not otherwise expose JSON directly. Update `toMessageDTO` to copy `ClientMsgID`.

- [ ] **Step 4: Extend migration smoke test**

In `.github/workflows/ci.yml`, after managed migrations assert version `202608100001:false`, assert `information_schema.columns` contains `t_message.client_msg_id`, and assert `pg_indexes` contains `uk_message_sender_client_msg_id`.

- [ ] **Step 5: Verify GREEN**

Run `cd backend && gofmt -w internal/model/model.go internal/app/utils.go internal/app/ws_payload_test.go && go test ./internal/app`.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/migration/sql/202608100001_client_msg_id.* init.sql backend/internal/model/model.go backend/internal/app/utils.go backend/internal/app/ws_payload_test.go .github/workflows/ci.yml
git commit -m "feat: persist client message ids"
```

---

### Task 2: Validate WebSocket chat payload

**Files:**
- Modify: `backend/internal/app/ws.go`
- Create or Modify: `backend/internal/app/ws_payload_test.go`

**Interfaces:**
- Produces: `normalizeClientMsgID(value any) (*string, error)`.
- Consumes: `model.Message.ClientMsgID` from Task 1.

- [ ] **Step 1: Add validation tests first**

Add tests covering whitespace trimming, blank-as-nil, 64-character acceptance, and 65-character rejection.

```go
func TestNormalizeClientMsgIDRejectsTooLong(t *testing.T) {
    _, err := normalizeClientMsgID(strings.Repeat("x", 65))
    if err == nil { t.Fatal("expected validation error") }
}
```

- [ ] **Step 2: Verify RED**

Run `cd backend && go test ./internal/app -run TestNormalizeClientMsgID`.
Expected: compile failure because `normalizeClientMsgID` does not exist.

- [ ] **Step 3: Implement minimal validation**

```go
const maxClientMsgIDLength = 64

func normalizeClientMsgID(v any) (*string, error) {
    value, ok := v.(string)
    if !ok {
        if v == nil { return nil, nil }
        return nil, fmt.Errorf("clientMsgId must be a string")
    }
    value = strings.TrimSpace(value)
    if value == "" { return nil, nil }
    if len(value) > maxClientMsgIDLength {
        return nil, fmt.Errorf("clientMsgId too long")
    }
    return &value, nil
}
```

Call it from `handleWsChat` before persistence and return the error without writing a message.

- [ ] **Step 4: Verify GREEN**

Run `cd backend && gofmt -w internal/app/ws.go internal/app/ws_payload_test.go && go test ./internal/app -run 'TestNormalizeClientMsgID|TestMessageDTO'`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/app/ws.go backend/internal/app/ws_payload_test.go
git commit -m "feat: validate websocket client message ids"
```

---

### Task 3: Idempotent message persistence

**Files:**
- Modify: `backend/internal/app/ws.go`
- Create: `backend/internal/app/message_idempotency_test.go`

**Interfaces:**
- Produces: `saveMessage(..., clientMsgID *string) (model.MessageDTO, error)` with first-write-wins behavior.
- Uses: GORM `clause.OnConflict{DoNothing: true}` and lookup by `(sender_id, client_msg_id)` when the insert affects zero rows.

- [ ] **Step 1: Add persistence tests first**

Add PostgreSQL-backed tests for:

1. first send inserts one row;
2. sequential retry returns the same persisted ID and row count stays one;
3. concurrent retries result in exactly one row;
4. different senders may reuse the same `clientMsgId`;
5. retry with changed payload returns the first persisted row.

Use a test database created by the repository's PostgreSQL CI job; skip with a clear message when no test DSN/environment is available locally.

- [ ] **Step 2: Verify RED in PostgreSQL CI/local environment**

Run `cd backend && go test ./internal/app -run TestSaveMessageIdempotency`.
Expected: failure because `saveMessage` still always inserts and does not persist `clientMsgId`.

- [ ] **Step 3: Implement minimal idempotent insert**

Change the signature to accept `clientMsgID *string`, set it on `model.Message`, and use:

```go
result := a.db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&msg)
if result.Error != nil { return model.MessageDTO{}, result.Error }
if result.RowsAffected == 1 { return toMessageDTO(msg, a.loc), nil }

var existing model.Message
if err := a.db.WithContext(ctx).
    Where("sender_id = ? AND client_msg_id = ?", senderID, *clientMsgID).
    First(&existing).Error; err != nil {
    return model.MessageDTO{}, err
}
return toMessageDTO(existing, a.loc), nil
```

For `clientMsgID == nil`, keep a plain `Create` so unrelated future uniqueness rules are not silently treated as idempotency conflicts.

Pass `c.Request.Context()`/session request-derived context where available instead of `context.Background()` for the persistence operation.

- [ ] **Step 4: Prevent duplicate logical broadcast**

`handleWsChat` must always broadcast the canonical returned message. A retry may re-ACK the sender; receiver duplicate UI suppression is now possible because the canonical payload has the same persisted `id` and `clientMsgId`. Do not insert or mutate a second row.

- [ ] **Step 5: Verify GREEN**

Run `cd backend && gofmt -w internal/app/ws.go internal/app/message_idempotency_test.go && go test ./...`.
Expected: PASS with PostgreSQL-backed idempotency tests enabled in CI.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/app/ws.go backend/internal/app/message_idempotency_test.go
git commit -m "fix: make chat sends idempotent"
```

---

### Task 4: Full regression and migration verification

**Files:**
- Modify if needed: `.github/workflows/ci.yml`
- Modify if needed: `README.md`

**Interfaces:**
- Verifies all preceding tasks as one deployable change.

- [ ] **Step 1: Run backend quality gates**

```bash
cd backend
test -z "$(gofmt -l .)"
go test ./...
go vet ./...
```

- [ ] **Step 2: Run migration smoke path**

Against PostgreSQL 16:

```bash
./private-chat-backend migrate
./private-chat-backend migrate
```

Assert migration state is exactly `202608100001:false`, `t_message.client_msg_id` exists, the partial unique index exists, and down SQL removes both cleanly in the rollback smoke database.

- [ ] **Step 3: Run frontend compatibility build**

```bash
cd frontend
npm ci
npm run build
```

No frontend protocol change is required because `clientMsgId` was already sent and accepted; the server simply persists and returns it consistently.

- [ ] **Step 4: Update README only if contract documentation is missing**

Document that clients should send a stable unique `clientMsgId` per logical message and that duplicate retries return the canonical persisted message.

- [ ] **Step 5: Commit any verification/docs adjustments**

```bash
git add .github/workflows/ci.yml README.md
git commit -m "test: cover client message idempotency"
```
