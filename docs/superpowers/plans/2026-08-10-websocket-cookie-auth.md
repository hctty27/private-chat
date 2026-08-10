# WebSocket Cookie-Only Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove long-lived JWTs from WebSocket URLs and make the browser WebSocket handshake authenticate only with the existing `private_chat_session` HttpOnly cookie, while preserving ordinary HTTP Bearer/cookie authentication.

**Architecture:** Keep the generic HTTP token extractor unchanged. Add a WebSocket-specific cookie-only extractor used by `wsHandler`, remove query-token fallback, and change the Vue frontend to open `/ws/chat` without authentication query parameters. Existing JWT parsing, Redis active-session validation, Origin checks, heartbeat, reconnect, kick-out, and message handling remain unchanged.

**Tech Stack:** Go 1.23, Gin, Gorilla WebSocket, Redis, Vue 3, Pinia, TypeScript, GitHub Actions.

## Global Constraints

- WebSocket authentication accepts only the `private_chat_session` cookie.
- Query-string JWT and `Authorization` header must not authenticate WebSocket handshakes.
- Ordinary HTTP APIs retain current `Authorization: Bearer` and cookie behavior.
- Existing Origin allowlist behavior remains unchanged.
- No database migration or new dependency.
- No logging of JWT/session-cookie values.

---

### Task 1: WebSocket credential boundary

**Files:**
- Modify: `backend/internal/app/security_test.go`
- Modify: `backend/internal/app/utils.go`
- Modify: `backend/internal/app/ws.go`

**Interfaces:**
- Consumes: existing `authCookieName`, `authTokenFromRequest(*http.Request) string`.
- Produces: `websocketAuthTokenFromRequest(*http.Request) string`, used only by `wsHandler`.

- [ ] **Step 1: Write failing credential-extraction tests**

Add unit tests that assert:

```go
func TestWebSocketAuthTokenUsesSessionCookie(t *testing.T)
func TestWebSocketAuthTokenIgnoresQueryToken(t *testing.T)
func TestWebSocketAuthTokenIgnoresAuthorizationHeader(t *testing.T)
func TestWebSocketAuthTokenPrefersCookieOverOtherCredentials(t *testing.T)
func TestAuthTokenFromRequestStillAcceptsBearerForHTTP(t *testing.T)
```

Expected assertions:

```go
request := httptest.NewRequest(http.MethodGet, "https://chat.example.com/ws/chat?token=query-token", nil)
request.Header.Set("Authorization", "Bearer header-token")
request.AddCookie(&http.Cookie{Name: authCookieName, Value: "cookie-token"})

if got := websocketAuthTokenFromRequest(request); got != "cookie-token" {
    t.Fatalf("expected cookie token, got %q", got)
}
```

Query-only and header-only requests must return `""`.

- [ ] **Step 2: Run the focused backend tests and verify RED**

Run:

```bash
cd backend
go test ./internal/app -run 'Test(WebSocketAuthToken|AuthTokenFromRequestStillAcceptsBearerForHTTP)' -count=1
```

Expected: FAIL because `websocketAuthTokenFromRequest` does not exist.

- [ ] **Step 3: Implement the cookie-only extractor**

Add to `backend/internal/app/utils.go`:

```go
func websocketAuthTokenFromRequest(r *http.Request) string {
    if r == nil {
        return ""
    }
    cookie, err := r.Cookie(authCookieName)
    if err != nil {
        return ""
    }
    return strings.TrimSpace(cookie.Value)
}
```

Do not change `authTokenFromRequest`.

- [ ] **Step 4: Switch `wsHandler` to the new boundary**

Replace:

```go
token := authTokenFromRequest(c.Request)
if token == "" {
    token = strings.TrimSpace(c.Query("token"))
}
```

with:

```go
token := websocketAuthTokenFromRequest(c.Request)
```

Keep the existing 401, JWT parse, Redis comparison, Origin validation, and upgrade path unchanged.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
cd backend
go test ./internal/app -run 'Test(WebSocketAuthToken|AuthTokenFromRequestStillAcceptsBearerForHTTP|WebSocketOrigin|ConfigureWebSocketReadLimit)' -count=1
```

Expected: PASS.

- [ ] **Step 6: Commit backend boundary**

```bash
git add backend/internal/app/security_test.go backend/internal/app/utils.go backend/internal/app/ws.go
git commit -m "fix: require cookie for websocket auth"
```

---

### Task 2: Browser WebSocket URL

**Files:**
- Modify: `frontend/src/stores/chat.ts`

**Interfaces:**
- Consumes: existing `connectWs()` reconnect/session lifecycle.
- Produces: WebSocket URL `${protocol}//${host}/ws/chat` with no JWT query parameter.

- [ ] **Step 1: Establish the failing repository assertion**

Before editing, verify the legacy URL is present:

```bash
grep -R "ws/chat?token=" -n frontend/src
```

Expected: match in `frontend/src/stores/chat.ts`.

- [ ] **Step 2: Remove JWT from the browser WebSocket URL**

Change:

```ts
const socket = new WebSocket(`${protocol}//${host}/ws/chat?token=${userStore.token}`)
```

into:

```ts
const socket = new WebSocket(`${protocol}//${host}/ws/chat`)
```

Do not otherwise change reconnect, heartbeat, queued-message replay, visibility recovery, or kick-out behavior.

- [ ] **Step 3: Verify tokenized WebSocket URLs are absent**

Run:

```bash
! grep -R "ws/chat?token=" -n frontend/src
```

Expected: exit 0 with no matches.

- [ ] **Step 4: Build the frontend**

Run:

```bash
cd frontend
npm ci
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit frontend URL change**

```bash
git add frontend/src/stores/chat.ts
git commit -m "fix: remove jwt from websocket url"
```

---

### Task 3: Full regression and PR readiness

**Files:**
- Verify: `.github/workflows/ci.yml`
- Verify: `backend/internal/app/security_test.go`
- Verify: `backend/internal/app/ws.go`
- Verify: `frontend/src/stores/chat.ts`

**Interfaces:**
- Consumes: Tasks 1-2.
- Produces: a review-ready PR closing Issue #4.

- [ ] **Step 1: Run backend formatting/tests/vet**

```bash
cd backend
test -z "$(gofmt -l .)"
go test ./...
go vet ./...
```

Expected: all commands exit 0.

- [ ] **Step 2: Run frontend build**

```bash
cd frontend
npm ci
npm run build
```

Expected: exit 0.

- [ ] **Step 3: Verify security invariants in the diff**

Confirm:

```text
- wsHandler calls websocketAuthTokenFromRequest.
- websocketAuthTokenFromRequest reads only private_chat_session.
- no c.Query("token") remains in WebSocket authentication.
- frontend WebSocket URL contains no ?token=.
- authTokenFromRequest still supports Bearer for ordinary HTTP.
- websocketOriginAllowed is unchanged.
```

- [ ] **Step 4: Push branch and let complete CI run**

Expected CI jobs:

```text
backend: formatting + go test + go vet
frontend: npm build
compose: docker compose config
migrations: PostgreSQL regression suite
```

All must pass.

- [ ] **Step 5: Open PR**

Title:

```text
security: remove jwt from websocket urls
```

Body must summarize cookie-only handshake, query/header rejection, unchanged HTTP Bearer support, full CI result, and include `Closes #4`.

## Self-Review

- Spec coverage: credential transport, frontend URL, HTTP compatibility, Origin preservation, testing, CI, deployment scope are all represented.
- Placeholder scan: no `TODO`, `TBD`, or unspecified implementation steps.
- Type consistency: helper signature is consistently `websocketAuthTokenFromRequest(*http.Request) string`; frontend target remains `connectWs()`.
