# WebSocket Cookie-Only Authentication Design

## Context

Issue #4 tracks removal of long-lived JWTs from WebSocket query parameters. The browser frontend currently opens `/ws/chat?token=<JWT>`, and the backend still falls back to `c.Query("token")` when normal request authentication does not yield a token.

The application already issues an HttpOnly session cookie and validates WebSocket origins. Browser WebSocket handshakes automatically carry matching cookies, while the standard browser `WebSocket` constructor does not provide an API for arbitrary request headers. Keeping JWTs in the URL therefore adds exposure without providing a browser-side capability that the application still needs.

## Goals

- Remove JWTs from browser WebSocket URLs.
- Make browser WebSocket authentication cookie-only.
- Reject WebSocket authentication supplied only through query parameters.
- Reject WebSocket authentication supplied only through an `Authorization` header.
- Preserve existing JWT validation and Redis-backed active-session validation after the cookie is extracted.
- Preserve existing WebSocket origin validation, read limits, heartbeat, reconnect, kick-out, and message behavior.
- Preserve `Authorization: Bearer` support for normal HTTP APIs.

## Non-Goals

- Replacing JWT sessions with opaque server-side sessions.
- Adding one-time WebSocket tickets.
- Changing login/logout semantics.
- Changing HTTP API authentication behavior.
- Changing WebSocket message authorization, rate limiting, or multi-instance delivery.
- Refactoring unrelated frontend connection state logic.

## Chosen Approach

Use the existing `private_chat_session` HttpOnly cookie as the only WebSocket handshake credential.

The backend will introduce a WebSocket-specific token extraction helper rather than reusing the generic HTTP helper. The generic helper will continue to accept `Authorization: Bearer` and the session cookie for HTTP APIs. The WebSocket helper will read only the session cookie.

The WebSocket authentication flow becomes:

1. Browser opens `/ws/chat` with no token query parameter.
2. Browser automatically attaches the matching session cookie.
3. Backend extracts only `private_chat_session` from the request cookie jar.
4. Missing/blank cookie returns HTTP 401 before upgrade.
5. Backend parses the JWT from the cookie.
6. Backend compares the token with the current Redis token for the user.
7. Invalid, expired, superseded, or missing Redis session returns HTTP 401 before upgrade.
8. Origin allowlist validation remains part of the Gorilla WebSocket upgrade.
9. Successful requests upgrade and keep the existing session lifecycle.

## Backend Design

### Authentication boundary

Keep `authTokenFromRequest(*http.Request)` unchanged for ordinary HTTP routes.

Add a focused helper, conceptually:

```go
func websocketAuthTokenFromRequest(r *http.Request) string
```

It will:

- return an empty string for a nil request;
- read `private_chat_session` only;
- trim cookie whitespace;
- ignore `Authorization` entirely;
- ignore query parameters entirely.

`wsHandler` will call this helper and delete the `c.Query("token")` compatibility fallback.

### Session validation

The rest of the current WebSocket authentication path remains unchanged:

- JWT parse validates token format/signature/expiry;
- Redis `user:token:<userID>` remains the active-session authority;
- a token that is valid cryptographically but no longer current in Redis is rejected;
- `registerSession` continues to replace/kick an older active WebSocket session.

This keeps the scope limited to credential transport rather than changing session semantics.

### Origin validation

Existing `websocketOriginAllowed` logic remains unchanged. Cookie-authenticated WebSockets are vulnerable to cross-site WebSocket hijacking if origin validation is weak, so the existing same-origin/configured-origin allowlist remains mandatory.

Requests without an `Origin` header continue to be allowed for compatibility with non-browser tooling, but such tooling must still possess the session cookie; query/header JWT shortcuts are not accepted.

## Frontend Design

Change WebSocket construction from:

```ts
new WebSocket(`${protocol}//${host}/ws/chat?token=${userStore.token}`)
```

to:

```ts
new WebSocket(`${protocol}//${host}/ws/chat`)
```

The frontend may continue to use `userStore.token` as local authenticated-state bookkeeping for existing HTTP/session flows in this PR; removing client-visible token state is a separate change.

Reconnect, visibility recovery, heartbeat, queued-message replay, and kick-out handling remain unchanged because browser cookies are automatically attached on every reconnect handshake.

## Security Properties

After this change:

- WebSocket URLs no longer contain long-lived JWTs.
- Nginx/CDN/browser URL logging cannot capture the WebSocket JWT through the query string because no JWT is sent there.
- JavaScript does not need access to the session cookie because it is HttpOnly.
- Query-string JWT replay no longer authenticates a WebSocket connection.
- `Authorization` headers do not form a hidden alternate WebSocket authentication path.
- SameSite=Strict plus explicit Origin validation continue to provide defense in depth against cross-site WebSocket hijacking.

This change does not make an already stolen session token harmless; TLS, cookie flags, session invalidation, and Redis-backed single-session validation remain necessary.

## Error Handling

Before upgrade:

- missing cookie -> 401;
- blank cookie -> 401;
- invalid/expired JWT -> 401;
- Redis lookup failure -> 401;
- Redis token mismatch -> 401;
- rejected origin -> Gorilla upgrade rejection using the existing origin check.

After upgrade, existing behavior is unchanged.

The server must not log the cookie value or JWT.

## Testing Strategy

### Backend unit tests

Add tests proving WebSocket-specific credential extraction:

- valid session cookie is accepted;
- no credential returns empty;
- query-only `?token=...` is ignored;
- `Authorization: Bearer ...` without the cookie is ignored;
- when cookie and query/header values conflict, the cookie is the only accepted WebSocket credential;
- generic `authTokenFromRequest` still accepts Bearer tokens for normal HTTP routes.

Keep the existing origin tests and WebSocket read-limit tests as regressions.

### Handler/session tests

Where practical with the current test harness, exercise the pre-upgrade authentication boundary so requests without a valid cookie receive 401. If full handler construction would require unrelated infrastructure, keep the authentication helper independently unit-tested and rely on existing JWT/Redis/session tests for downstream validation rather than broadening this PR.

### Frontend verification

- Type-check/build must pass.
- Repository search/diff must show no WebSocket construction containing `?token=`.
- Existing reconnect and queued-message code remains unchanged except for the URL.

### CI

Run the existing complete CI suite:

- backend formatting;
- `go test ./...`;
- `go vet ./...`;
- frontend build;
- Compose validation;
- PostgreSQL migration regression suite.

No database migration is required.

## Deployment and Compatibility

This is a coordinated frontend/backend deployment.

Recommended order:

1. Deploy backend that requires the cookie.
2. Deploy frontend that opens `/ws/chat` without query JWT in the same release window.

Because the current production frontend still sends a query token, deploying the strict backend substantially earlier than the frontend could break WebSocket reconnects for clients that have not refreshed. Keep the rollout window short or deploy both artifacts atomically where possible.

Users with a valid HttpOnly session cookie do not need to log in again. Existing open WebSocket connections remain established until they disconnect; new/reconnected handshakes use the new cookie-only path.

## Acceptance Criteria

- Browser WebSocket URL is exactly `/ws/chat` apart from scheme/host, with no authentication query parameter.
- A query-string JWT alone cannot authenticate a WebSocket handshake.
- An Authorization-header JWT alone cannot authenticate a WebSocket handshake.
- A valid `private_chat_session` cookie proceeds through existing JWT and Redis session validation.
- Missing or invalid session cookie is rejected before WebSocket upgrade.
- HTTP APIs retain their existing Bearer/cookie behavior.
- Existing origin validation and reconnect/session lifecycle behavior remain intact.
- Full CI passes.

## References

- MDN WebSocket constructor documentation: browser WebSocket construction accepts a URL and optional subprotocols, not arbitrary request headers.
- OWASP WebSocket Security Cheat Sheet: browsers attach cookies to WebSocket handshakes; explicit Origin validation and SameSite cookies are important defenses; authentication material should not be exposed through logs.
