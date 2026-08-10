# Multi-Tab WebSocket Sessions Design

## Goal

Allow one authenticated login session to keep multiple browser tabs/WebSocket connections online at the same time, while preserving the current single-login behavior where a new login invalidates the previous token and disconnects all old WebSocket connections.

## Current behavior

- Redis stores one active JWT per user at `user_token:{userID}`.
- A new login overwrites that token, so old HTTP/WebSocket authentication becomes invalid.
- `Hub` stores only `map[userID]*Session`.
- `registerSession` replaces the existing WebSocket for the user, so a second tab using the same valid token kicks the first tab.

## Approaches considered

### 1. Add explicit `deviceId` / `sessionId`

Track a device/session identifier in JWT claims and Redis, then group WebSockets by that identifier.

Trade-off: precise device semantics, but adds client persistence, JWT changes, Redis schema changes, and migration/compatibility work that is unnecessary for the current requirement.

### 2. Treat the active JWT as the login session and allow multiple WebSockets per user — recommended

Keep Redis single-token authentication unchanged. Change only the in-memory WebSocket hub from one session per user to a set of sessions per user.

All tabs that share the current JWT are part of the same login session. A new login still overwrites Redis and calls `kickUser`, which closes every existing WebSocket for that user. New WebSocket handshakes still verify that their JWT matches the Redis token.

Trade-off: this intentionally treats all clients sharing the same JWT as one login session. That matches the current frontend/browser behavior and avoids unnecessary protocol changes.

### 3. Allow multiple independent device logins

Store multiple active tokens per user.

Trade-off: enables true multi-device login, but changes the current single-point-login security behavior and is outside scope.

## Design

### Hub

Replace:

```go
map[int64]*Session
```

with a per-user session set:

```go
map[int64]map[*Session]struct{}
```

Expose operations with clear semantics:

- `Add(userID, session) bool`: add a connection and return whether it is the user's first active connection.
- `Remove(userID, session) bool`: remove exactly that connection and return whether it was the user's last active connection.
- `GetAll(userID) []*Session`: return a snapshot of every active connection for one user.
- `Snapshot() []*Session`: return all active WebSocket sessions across users.

No caller should hold hub locks while sending WebSocket frames.

### Registration and presence

`registerSession` adds the new session instead of replacing an old one.

Only the transition from zero sessions to one session should:

- mark the user online in Redis,
- persist the immediate online/last-seen state,
- arm the presence throttle,
- broadcast `online=true` to contacts.

Opening an additional tab must not produce another online transition.

### Unregistration and presence

`unregisterSession` removes only the closing WebSocket.

Only the transition from one session to zero sessions should:

- delete the Redis online key,
- persist the disconnect timestamp,
- broadcast `online=false`.

Closing one tab while another remains connected must leave the user online.

### Kicking an old login

`kickUser(userID, message)` sends `kicked` to every active session for that user and closes every one of them.

The existing login flow remains unchanged:

1. generate a new JWT,
2. overwrite `user_token:{userID}` in Redis,
3. call `kickUser`,
4. return the new token.

Therefore a login from another browser/device invalidates the old token and disconnects all tabs belonging to the previous login session.

### Message fan-out

Events addressed to a user must be sent to all of that user's active sessions:

- saved `chat` events to all sender sessions and all receiver sessions,
- `read` events to all target-user sessions,
- contact presence events to all sessions of every online contact.

The server should continue to send the canonical saved message back to sender sessions so every open tab converges on the same state.

### Authentication

No JWT, cookie, Redis-key, database, or migration changes are required.

The WebSocket handshake must continue to verify that the presented token equals the user's current Redis token. This prevents an invalidated old token from opening a new WebSocket after a newer login.

## Testing

Add focused backend tests for the hub and WebSocket session lifecycle:

1. two sessions for one user can coexist;
2. removing one of two sessions does not report the user as fully offline;
3. removing the last session reports the final transition;
4. `GetAll` returns a snapshot rather than exposing internal mutable state;
5. `kickUser` closes all sessions for a user;
6. chat/read fan-out reaches every active session;
7. contact-session resolution includes every tab of each online contact.

Run the existing backend checks after implementation:

```bash
cd backend
gofmt -l .
go test ./...
go vet ./...
```

No frontend change should be necessary for this feature.

## Non-goals

- true simultaneous multi-device login with independent tokens;
- device management UI;
- JWT claim/schema changes;
- database migrations;
- changes to the disguise/cover-page behavior.
