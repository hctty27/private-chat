# Security Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden authentication and authorization boundaries for HTTP and WebSocket access without changing the existing chat protocol or database schema.

**Architecture:** Add a small relation authorization component backed by GORM and inject it into `App`. Apply authorization before message history, chat send, read receipts, and online notifications. Tighten configuration/JWT/WebSocket validation, protect file downloads with authentication, and add CI so the branch is continuously verified.

**Tech Stack:** Go 1.22/1.23, Gin, GORM, PostgreSQL, Redis, Gorilla WebSocket, GitHub Actions.

## Global Constraints

- Do not change the cover-page behavior.
- Do not introduce a database schema migration in this PR.
- Preserve the current client WebSocket message shapes.
- Keep same-origin WebSocket connections working without extra configuration.
- Run `go test ./...` and `go vet ./...` for the backend.
- Run `npm ci` and `npm run build` for the frontend in CI.

---

### Task 1: Configuration and JWT validation

**Files:**
- Modify: `backend/internal/config/config.go`
- Modify: `backend/internal/config/config_test.go`
- Modify: `backend/internal/app/app.go`
- Modify: `backend/internal/auth/jwt.go`
- Create: `backend/internal/auth/jwt_test.go`

**Interfaces:**
- Produces: `func (Config) Validate() error`
- Produces: `AllowedOrigins []string` populated from `WS_ALLOWED_ORIGINS`

- [ ] **Step 1: Write failing tests**

Add tests that require `Validate` to reject blank JWT secrets, reject secrets shorter than 32 characters, and accept a valid configuration. Add a JWT test proving a token signed with HS384 is rejected even when it uses the same secret.

- [ ] **Step 2: Verify tests fail**

Run: `cd backend && go test ./internal/config ./internal/auth`

Expected: FAIL because `Validate` and strict HS256 validation do not exist.

- [ ] **Step 3: Implement minimal validation**

Remove hard-coded JWT and Redis password defaults, add `WS_ALLOWED_ORIGINS`, implement `Config.Validate`, call it at the start of `NewApp`, and require `jwt.SigningMethodHS256` exactly when parsing.

- [ ] **Step 4: Verify tests pass**

Run: `cd backend && go test ./internal/config ./internal/auth`

Expected: PASS.

### Task 2: Relation authorization boundary

**Files:**
- Create: `backend/internal/app/relations.go`
- Create: `backend/internal/app/relations_test.go`
- Modify: `backend/internal/app/app.go`
- Modify: `backend/internal/app/handlers.go`
- Modify: `backend/internal/app/ws.go`

**Interfaces:**
- Produces: `type relationAuthorizer interface { IsContact(context.Context, int64, int64) (bool, error); ContactIDs(context.Context, int64) ([]int64, error) }`
- Produces: `func (a *App) requireContact(context.Context, int64, int64) error`

- [ ] **Step 1: Write failing tests**

Use a fake authorizer to verify denied users cannot fetch message history, send chat messages, or mark messages read. Verify online notifications resolve only contact user IDs.

- [ ] **Step 2: Verify tests fail**

Run: `cd backend && go test ./internal/app`

Expected: FAIL because relation authorization is not wired into these operations.

- [ ] **Step 3: Implement minimal authorization**

Create the GORM-backed authorizer, initialize it in `NewApp`, validate the relation before history/chat/read operations, and broadcast online state only to contacts currently connected to the local Hub.

- [ ] **Step 4: Verify tests pass**

Run: `cd backend && go test ./internal/app`

Expected: PASS.

### Task 3: HTTP and WebSocket hardening

**Files:**
- Modify: `backend/internal/app/app.go`
- Modify: `backend/internal/app/handlers.go`
- Modify: `backend/internal/app/ws.go`
- Create: `backend/internal/app/security_test.go`

**Interfaces:**
- Produces: `func websocketOriginAllowed(*http.Request, []string) bool`
- Produces: authenticated `POST /api/auth/logout`

- [ ] **Step 1: Write failing tests**

Verify unauthenticated file downloads return 401. Verify same-origin WebSocket requests are allowed, unlisted cross-origin requests are denied, configured origins are allowed, and oversized WebSocket messages are rejected by the configured read limit.

- [ ] **Step 2: Verify tests fail**

Run: `cd backend && go test ./internal/app`

Expected: FAIL because file download is public and the WebSocket upgrader accepts every origin.

- [ ] **Step 3: Implement minimal hardening**

Move file download into the authenticated route group, add a logout handler that deletes the active Redis token and closes the local session, enforce same-origin/allowlisted WebSocket origins, and set a 64 KiB connection read limit.

- [ ] **Step 4: Verify tests pass**

Run: `cd backend && go test ./internal/app`

Expected: PASS.

### Task 4: Continuous verification and documentation

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Add CI workflow**

Run backend formatting checks, `go test ./...`, `go vet ./...`, frontend `npm ci`, and frontend `npm run build` on pushes and pull requests.

- [ ] **Step 2: Document configuration and security semantics**

Document `WS_ALLOWED_ORIGINS`, authenticated downloads, logout, and clarify that the current implementation is transport-secured rather than end-to-end encrypted.

- [ ] **Step 3: Verify the complete change**

Run:

```bash
cd backend && gofmt -w . && go test ./... && go vet ./...
cd ../frontend && npm ci && npm run build
```

Expected: all commands pass.
