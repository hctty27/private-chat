# Multi-Tab WebSocket Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow multiple WebSocket connections for the same active login token while preserving single-login token invalidation and kicking every connection from the previous login.

**Architecture:** Keep Redis/JWT authentication unchanged and replace the in-memory `Hub` single-session map with a per-user set of `Session` pointers. WebSocket lifecycle code reacts only to first-connect and last-disconnect transitions, while user-addressed events fan out to snapshots of every active connection so Hub locks are never held during network writes.

**Tech Stack:** Go 1.23, Gin, Gorilla WebSocket 1.5.3, Redis, GORM.

## Global Constraints

- Keep one active JWT per user in Redis at `user_token:{userID}`.
- A new login must continue to invalidate the previous token and disconnect all old WebSocket connections.
- Do not add `deviceId`, `sessionId`, JWT claims, Redis schema, database schema, or migrations.
- Do not change the frontend or disguise/cover-page behavior.
- Do not hold Hub locks while writing WebSocket frames.
- Preserve Gorilla WebSocket's one-concurrent-writer rule through the existing per-`Session` `writeMu`.

---

### Task 1: Make Hub support multiple sessions per user

**Files:**
- Modify: `backend/internal/app/hub.go`
- Create: `backend/internal/app/hub_test.go`

**Interfaces:**
- Produces: `func (h *Hub) Add(userID int64, session *Session) bool`
- Produces: `func (h *Hub) Remove(userID int64, session *Session) bool`
- Produces: `func (h *Hub) GetAll(userID int64) []*Session`
- Preserves: `func (h *Hub) Snapshot() []*Session`

- [ ] **Step 1: Write failing Hub tests**

Create `backend/internal/app/hub_test.go` with tests covering coexistence, first/last transition semantics, snapshot isolation, and global snapshot fan-out:

```go
package app

import "testing"

func TestHubAllowsMultipleSessionsPerUser(t *testing.T) {
	hub := NewHub()
	first := &Session{userID: 7}
	second := &Session{userID: 7}

	if !hub.Add(7, first) {
		t.Fatal("expected first session to report first connection")
	}
	if hub.Add(7, second) {
		t.Fatal("expected second session not to report first connection")
	}

	sessions := hub.GetAll(7)
	if len(sessions) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(sessions))
	}
}

func TestHubRemoveReportsOnlyLastSession(t *testing.T) {
	hub := NewHub()
	first := &Session{userID: 7}
	second := &Session{userID: 7}
	hub.Add(7, first)
	hub.Add(7, second)

	if hub.Remove(7, first) {
		t.Fatal("expected first removal not to report final disconnect")
	}
	if !hub.Remove(7, second) {
		t.Fatal("expected last removal to report final disconnect")
	}
	if got := hub.GetAll(7); len(got) != 0 {
		t.Fatalf("expected no remaining sessions, got %d", len(got))
	}
}

func TestHubGetAllReturnsSnapshot(t *testing.T) {
	hub := NewHub()
	first := &Session{userID: 7}
	hub.Add(7, first)

	snapshot := hub.GetAll(7)
	snapshot[0] = &Session{userID: 99}

	current := hub.GetAll(7)
	if len(current) != 1 || current[0] != first {
		t.Fatal("GetAll exposed mutable hub state")
	}
}

func TestHubSnapshotIncludesEveryConnection(t *testing.T) {
	hub := NewHub()
	hub.Add(7, &Session{userID: 7})
	hub.Add(7, &Session{userID: 7})
	hub.Add(8, &Session{userID: 8})

	if got := len(hub.Snapshot()); got != 3 {
		t.Fatalf("expected 3 sessions, got %d", got)
	}
}
```

- [ ] **Step 2: Run the Hub tests and verify they fail**

Run:

```bash
cd backend
go test ./internal/app -run '^TestHub' -count=1
```

Expected: build/test failure because `Add`, `Remove`, and `GetAll` do not exist and the existing Hub stores only one session per user.

- [ ] **Step 3: Implement the multi-session Hub**

Replace the single session map with a set per user:

```go
type Hub struct {
	mu       sync.RWMutex
	sessions map[int64]map[*Session]struct{}
}

func NewHub() *Hub {
	return &Hub{sessions: make(map[int64]map[*Session]struct{})}
}

func (h *Hub) Add(userID int64, session *Session) bool {
	h.mu.Lock()
	defer h.mu.Unlock()

	userSessions := h.sessions[userID]
	first := len(userSessions) == 0
	if userSessions == nil {
		userSessions = make(map[*Session]struct{})
		h.sessions[userID] = userSessions
	}
	userSessions[session] = struct{}{}
	return first
}

func (h *Hub) Remove(userID int64, session *Session) bool {
	h.mu.Lock()
	defer h.mu.Unlock()

	userSessions := h.sessions[userID]
	if userSessions == nil {
		return false
	}
	if _, ok := userSessions[session]; !ok {
		return false
	}
	delete(userSessions, session)
	if len(userSessions) != 0 {
		return false
	}
	delete(h.sessions, userID)
	return true
}

func (h *Hub) GetAll(userID int64) []*Session {
	h.mu.RLock()
	defer h.mu.RUnlock()

	userSessions := h.sessions[userID]
	result := make([]*Session, 0, len(userSessions))
	for session := range userSessions {
		result = append(result, session)
	}
	return result
}

func (h *Hub) Snapshot() []*Session {
	h.mu.RLock()
	defer h.mu.RUnlock()

	count := 0
	for _, userSessions := range h.sessions {
		count += len(userSessions)
	}
	result := make([]*Session, 0, count)
	for _, userSessions := range h.sessions {
		for session := range userSessions {
			result = append(result, session)
		}
	}
	return result
}
```

Remove the obsolete `Get`, `Replace`, and `RemoveIfCurrent` methods after all callers are migrated in later tasks.

- [ ] **Step 4: Run Hub tests**

Run:

```bash
cd backend
go test ./internal/app -run '^TestHub' -count=1
```

Expected: PASS after callers/tests are migrated in the same working tree.

- [ ] **Step 5: Commit Task 1**

```bash
git add backend/internal/app/hub.go backend/internal/app/hub_test.go
git commit -m "refactor: support multiple websocket sessions"
```

---

### Task 2: Fan out user-addressed events to every active tab

**Files:**
- Modify: `backend/internal/app/relations.go`
- Modify: `backend/internal/app/relations_test.go`
- Modify: `backend/internal/app/ws.go`
- Create: `backend/internal/app/ws_fanout_test.go`

**Interfaces:**
- Consumes: `Hub.GetAll(userID int64) []*Session`
- Produces: `func (a *App) sendToUser(userID int64, payload any)`
- Preserves: `func (a *App) contactSessions(ctx context.Context, userID int64) ([]*Session, error)`
- Preserves: `func (a *App) kickUser(userID int64, message string)`

- [ ] **Step 1: Extend contact-session test for multiple tabs**

Update `TestContactSessionsOnlyReturnsContacts` so contact `2` has two sessions, contact `4` has one, and non-contact `3` has one. Expect three returned sessions and none from user `3`.

Use `hub.Add(...)` instead of `hub.Replace(...)`.

- [ ] **Step 2: Write failing fan-out tests using real Gorilla WebSocket pairs**

Create `backend/internal/app/ws_fanout_test.go` with a small `httptest.Server` helper that upgrades a connection and returns the server-side `*websocket.Conn`. Add tests that:

1. register two sessions for one user in `Hub`;
2. call `a.sendToUser(7, gin.H{"type": "test"})`;
3. assert both client sockets read the payload;
4. call `a.kickUser(7, "relogin")` and assert both clients receive a `kicked` message before closure.

The helper should set read deadlines so failures terminate rather than hang.

- [ ] **Step 3: Run focused tests and verify failure**

Run:

```bash
cd backend
go test ./internal/app -run 'Test(ContactSessions|SendToUser|KickUser)' -count=1
```

Expected: FAIL because callers still use the single-session Hub API and `sendToUser` does not exist.

- [ ] **Step 4: Implement contact and event fan-out**

Change `contactSessions` to append every session for each contact:

```go
sessions := make([]*Session, 0, len(contactIDs))
for _, contactID := range contactIDs {
	sessions = append(sessions, a.hub.GetAll(contactID)...)
}
return sessions, nil
```

Add a user fan-out helper in `ws.go`:

```go
func (a *App) sendToUser(userID int64, payload any) {
	for _, session := range a.hub.GetAll(userID) {
		_ = session.SendJSON(payload)
	}
}
```

Use it in `handleWsChat` for both sender and receiver, and in `handleWsRead` for the target user.

Change `kickUser` to snapshot all sessions, send `kicked` to each, then close each:

```go
func (a *App) kickUser(userID int64, message string) {
	payload := gin.H{
		"type": "kicked",
		"data": gin.H{"message": message},
	}
	for _, session := range a.hub.GetAll(userID) {
		_ = session.SendJSON(payload)
		session.Close()
	}
}
```

Do not remove sessions directly in `kickUser`; each WebSocket read loop continues to own unregister cleanup.

- [ ] **Step 5: Run fan-out tests**

Run:

```bash
cd backend
go test ./internal/app -run 'Test(ContactSessions|SendToUser|KickUser)' -count=1
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add backend/internal/app/relations.go backend/internal/app/relations_test.go backend/internal/app/ws.go backend/internal/app/ws_fanout_test.go
git commit -m "feat: fan out websocket events to all tabs"
```

---

### Task 3: Preserve correct online/offline transitions with multiple tabs

**Files:**
- Modify: `backend/internal/app/ws.go`
- Modify: `backend/internal/app/hub_test.go`

**Interfaces:**
- Consumes: `Hub.Add(userID int64, session *Session) bool`, where `true` means zero-to-one transition.
- Consumes: `Hub.Remove(userID int64, session *Session) bool`, where `true` means one-to-zero transition.
- Preserves: `registerSession`, `unregisterSession`, Redis online key, presence persistence/throttle, and contact presence payloads.

- [ ] **Step 1: Add transition assertions to Hub tests**

Ensure tests explicitly prove:

- first `Add` returns `true`;
- subsequent `Add` returns `false`;
- removing one of multiple sessions returns `false`;
- removing the last session returns `true`;
- removing a session that was never registered returns `false`.

- [ ] **Step 2: Migrate registration lifecycle**

Replace `Replace` behavior in `registerSession` with:

```go
if !a.hub.Add(session.userID, session) {
	return
}
```

Only the first connection executes the existing online Redis write, immediate last-seen persistence, throttle arm, and `online=true` broadcast.

This intentionally removes the old behavior where opening another tab sent `kicked` to the first tab.

- [ ] **Step 3: Migrate unregistration lifecycle**

Replace `RemoveIfCurrent` in `unregisterSession` with:

```go
last := a.hub.Remove(session.userID, session)
if last {
	// existing Redis online-key deletion,
	// last-seen persistence,
	// and online=false broadcast
}
session.Close()
```

Closing one tab while another is active must not delete the Redis online key or broadcast offline.

- [ ] **Step 4: Run the full backend test suite**

Run:

```bash
cd backend
go test ./... -count=1
```

Expected: PASS.

- [ ] **Step 5: Run formatting and static analysis**

Run:

```bash
cd backend
gofmt -w internal/app/hub.go internal/app/hub_test.go internal/app/relations.go internal/app/relations_test.go internal/app/ws.go internal/app/ws_fanout_test.go
gofmt -l .
go vet ./...
```

Expected: `gofmt -l .` prints nothing and `go vet ./...` exits successfully.

- [ ] **Step 6: Verify authentication behavior remains unchanged**

Inspect `backend/internal/app/handlers.go` and confirm login still performs these operations in order:

```go
redis.Set(userTokenKey(user.ID), token, ...)
a.kickUser(user.ID, "您的账号在其他地方登录")
```

Confirm `wsHandler` still rejects a token when Redis contains a different token.

No authentication code change is required.

- [ ] **Step 7: Commit Task 3**

```bash
git add backend/internal/app/hub.go backend/internal/app/hub_test.go backend/internal/app/relations.go backend/internal/app/relations_test.go backend/internal/app/ws.go backend/internal/app/ws_fanout_test.go
git commit -m "fix: preserve presence across multiple websocket tabs"
```

---

### Task 4: Final verification and PR readiness

**Files:**
- Verify only; no planned production-file changes.

**Interfaces:**
- Verifies all interfaces and constraints from Tasks 1-3.

- [ ] **Step 1: Run complete backend verification**

```bash
cd backend
gofmt -l .
go test ./... -count=1
go vet ./...
```

Expected: formatting output empty, all tests PASS, vet PASS.

- [ ] **Step 2: Review diff for scope control**

Expected changed implementation/test files:

```text
backend/internal/app/hub.go
backend/internal/app/hub_test.go
backend/internal/app/relations.go
backend/internal/app/relations_test.go
backend/internal/app/ws.go
backend/internal/app/ws_fanout_test.go
```

Expected documentation files:

```text
docs/superpowers/specs/2026-08-10-multi-tab-websocket-design.md
docs/superpowers/plans/2026-08-10-multi-tab-websocket.md
```

There must be no frontend, JWT, database migration, Redis-key-format, or dependency changes.

- [ ] **Step 3: Confirm behavioral acceptance cases**

Verify the implementation satisfies:

```text
Same token, Tab A + Tab B        -> both WebSockets remain connected
Close Tab A, Tab B remains       -> user remains online
Open second tab                  -> no kicked event to first tab
Message to user with two tabs    -> both tabs receive the event
Read receipt to user with tabs   -> all tabs receive the event
New login issues a new token     -> every old WebSocket receives kicked/close
Old token reconnect attempt      -> wsHandler rejects it
```

- [ ] **Step 4: Prepare the branch for review/merge**

Create or update the pull request from `feature/multi-tab-websocket` to `master`, include the acceptance cases above, and rely on repository CI if configured before merge.
