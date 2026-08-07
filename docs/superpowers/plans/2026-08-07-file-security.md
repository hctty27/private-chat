# Conversation-Scoped File Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind uploaded files to a conversation-owned `fileId`, verify the R2 object before use, authorize every media access, and preserve historical image/video rendering.

**Architecture:** Add `t_file` metadata and `t_message.file_id`, move file lifecycle logic into a focused backend file service with a testable storage gateway, and keep the UI-compatible `fileUrl` as a server-derived stable `/api/files/{id}/content` URL. Browser bytes flow directly between the client and private R2 via short-lived presigned URLs after backend authorization.

**Tech Stack:** Go 1.23, Gin, GORM/PostgreSQL, MinIO Go S3 client / Cloudflare R2, Vue 3 + TypeScript + Axios, GitHub Actions.

## Global Constraints

- New attachment messages MUST reference `fileId`; never trust client-supplied object paths or file URLs.
- Existing chat history MUST remain renderable after migration.
- Max file size remains 100 MiB.
- R2 bucket remains private.
- Stable media entrypoint is `/api/files/{fileId}/content`.
- Download presigned GET lifetime is 10 minutes; upload presigned PUT lifetime remains 1 hour.
- Keep legacy message file columns for rollback in this PR.

---

### Task 1: Database model and migration

**Files:**
- Modify: `backend/internal/model/model.go`
- Modify: `init.sql`
- Create: `migrations/20260807_file_security_up.sql`
- Create: `migrations/20260807_file_security_down.sql`
- Test: `backend/internal/app/file_model_test.go`

**Interfaces:**
- Produces: `model.File`, `model.FileStatusPending`, `model.FileStatusReady`, `Message.FileID *int64`, `MessageDTO.FileID *int64`.

- [ ] **Step 1: Write failing model/DTO tests**

Assert that a `model.File` exposes owner, conversation, expected/actual size, detected type and state, and that `toMessageDTO` emits `fileId` plus `/api/files/{id}/content` when `FileID` is present.

- [ ] **Step 2: Run `go test ./internal/app/...` and verify RED**

Expected failure: missing `model.File`, `Message.FileID`, or DTO mapping.

- [ ] **Step 3: Add model fields and migration SQL**

Use the schema from `docs/superpowers/specs/2026-08-07-file-security-design.md`. The forward migration creates `t_file`, adds `t_message.file_id`, backfills existing `/api/file/download/{objectName}` rows with `owner_id=sender_id` and `conversation_id=t_message.conversation_id`, then sets the FK. The rollback drops the FK/column and `t_file` without deleting legacy message file columns.

- [ ] **Step 4: Run backend tests and verify GREEN**

- [ ] **Step 5: Commit**

`feat: add conversation file metadata model`

---

### Task 2: Testable R2 file lifecycle

**Files:**
- Create: `backend/internal/app/files.go`
- Create: `backend/internal/app/files_test.go`
- Modify: `backend/internal/app/app.go`
- Modify: `backend/internal/app/handlers.go`

**Interfaces:**
- Produces:
  - `type fileStorage interface { PresignPut(...); PresignGet(...); Stat(...); ReadPrefix(...) }`
  - `func (a *App) createPendingFile(ctx context.Context, ownerID int64, req model.FilePresignUploadRequest, expiry time.Duration) (model.FilePresignUploadDTO, error)`
  - `func (a *App) confirmFile(ctx context.Context, userID, fileID int64) (model.FileUploadDTO, error)`
  - `func stableFileURL(fileID int64) string`

- [ ] **Step 1: Write failing lifecycle tests**

Cover: size >100 MiB rejected; target must be a contact; pending row uses server-generated object key; confirmation rejects actual-size mismatch; successful confirmation records `http.DetectContentType` result and sets status `ready`; repeated confirmation of a ready row is idempotent.

- [ ] **Step 2: Run backend tests and verify RED**

- [ ] **Step 3: Implement storage gateway and lifecycle**

`ReadPrefix` must read at most 512 bytes. `PresignPut` binds `Content-Type`. `confirmFile` compares storage size to `expected_size`, sniffs content, and only then transitions pending → ready.

- [ ] **Step 4: Run backend tests and verify GREEN**

- [ ] **Step 5: Commit**

`feat: verify presigned uploads before use`

---

### Task 3: Attachment authorization and stable media access

**Files:**
- Modify: `backend/internal/app/ws.go`
- Modify: `backend/internal/app/app.go`
- Modify: `backend/internal/app/files.go`
- Create: `backend/internal/app/file_authorization_test.go`
- Modify: `backend/internal/app/ws_payload_test.go`

**Interfaces:**
- Produces:
  - file chat payload accepts `fileId` for msgType 2/3/5;
  - `func (a *App) resolveAttachment(ctx context.Context, senderID, receiverID, fileID int64) (model.File, error)`;
  - `GET /api/files/:fileId/content`.

- [ ] **Step 1: Write failing authorization tests**

Prove a file message is rejected when file is pending, owned by another user, or scoped to another conversation. Prove participants can request content and outsiders receive 403. Prove generated download URL expires in 10 minutes and uses inline disposition only for detected safe media; other types use attachment.

- [ ] **Step 2: Run backend tests and verify RED**

- [ ] **Step 3: Implement attachment resolution and download redirect**

For file messages, ignore client `fileUrl/fileName/fileSize`; load the ready file by `fileId`, persist `Message.FileID`, and derive display metadata. The content handler authenticates, verifies conversation membership, sets `Cache-Control: private, no-store`, and redirects to the exact presigned R2 GET URL.

- [ ] **Step 4: Keep legacy `/api/file/download/:objectName` route for one rollout window**

Do not use it for new DTOs/messages. Document it as compatibility-only.

- [ ] **Step 5: Run backend tests and verify GREEN**

- [ ] **Step 6: Commit**

`feat: authorize conversation file access`

---

### Task 4: Frontend fileId upload/send flow

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/api/index.ts`
- Modify: `frontend/src/stores/chat.ts`

**Interfaces:**
- `FilePresignUploadResponse.fileId: number`
- `Message.fileId: number | null`
- `WsClientChat.data.fileId: number | null`
- `uploadFile(file, receiverId, onProgress)` uploads to R2 then calls `/api/files/{fileId}/complete` and returns confirmed stable metadata.

- [ ] **Step 1: Make TypeScript contract changes first**

The existing store should fail type-check until every file send path supplies `receiverId` to `uploadFile` and `fileId` to the WebSocket payload.

- [ ] **Step 2: Run `npm run build` and verify RED**

- [ ] **Step 3: Update upload flow**

Presign with `receiverId`; PUT to R2 using required headers; POST complete; set local `fileId/fileUrl/fileName/fileSize`; send `fileId` with the chat message. Preserve `fileUrl` for `<img>`/`<video>` rendering.

- [ ] **Step 4: Run `npm run build` and verify GREEN**

- [ ] **Step 5: Commit**

`feat: send verified file ids from frontend`

---

### Task 5: Docs, compatibility and full verification

**Files:**
- Modify: `README.md`
- Modify: `.env.example` only if a new runtime option is introduced
- Modify: Issue #2 / PR description through GitHub metadata, not repository files

- [ ] **Step 1: Document deployment order and R2 CORS**

Include an example restricted CORS policy for the deployed frontend origin with `PUT`, `GET`, `HEAD`, `Content-Type`, and `Range`; state that presigned URLs are bearer credentials and the bucket must remain private.

- [ ] **Step 2: Run full backend verification**

`gofmt` check, `go test ./...`, `go vet ./...`.

- [ ] **Step 3: Run full frontend verification**

`npm ci`, `npm run build`.

- [ ] **Step 4: Open a PR linked to Issue #2 and wait for GitHub Actions**

The PR must remain unmerged until CI is green and the user explicitly asks to merge.
