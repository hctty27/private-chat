# Conversation-Scoped File Security Design

## Goal

Replace client-trusted file URLs with a server-owned `fileId` model so uploaded files are bound to one conversation, verified after upload, and only retrievable by conversation participants while keeping historical image/video rendering stable.

## Confirmed product behavior

- Existing chat history must continue to render images, videos, and downloadable files after migration.
- New messages reference `fileId`; clients cannot choose an arbitrary R2 object path or file URL.
- Browser uploads continue to go directly to Cloudflare R2 through a short-lived presigned PUT URL.
- Chat media uses a stable same-origin URL (`/api/files/{fileId}/content`). The backend authenticates and authorizes the request, then redirects to a short-lived presigned R2 GET URL.
- Text/emoji messages do not carry file metadata.
- This change does not implement end-to-end encryption or antivirus/CDR scanning.

## Data model

Create `t_file`:

- `id BIGINT` primary key.
- `object_key VARCHAR(512)` unique, server-generated relative object key. The configured R2 prefix is applied at runtime.
- `owner_id BIGINT` uploader/sender user ID.
- `conversation_id VARCHAR(64)` conversation that may access the file.
- `original_name VARCHAR(255)` sanitized display/download filename.
- `expected_size BIGINT` size declared when requesting the upload; must be `0..100 MiB`.
- `actual_size BIGINT NULL` populated on confirmation from R2 metadata.
- `claimed_content_type VARCHAR(128)` normalized client-provided MIME type used to bind the presigned PUT request.
- `detected_content_type VARCHAR(128) NULL` populated by sniffing up to the first 512 object bytes with Go `http.DetectContentType`.
- `status VARCHAR(16)` with `pending` and `ready` values.
- `created_at TIMESTAMPTZ` and `confirmed_at TIMESTAMPTZ NULL`.

Add nullable `t_message.file_id BIGINT` referencing `t_file(id)`.

Existing file messages are backfilled by extracting their existing `/api/file/download/{objectName}` value, creating ready `t_file` rows using the message sender and conversation, and populating `t_message.file_id`. Legacy `file_url/file_name/file_size` columns remain during this PR for rollback/backward compatibility, but new writes derive these values from `t_file`.

## Upload flow

`POST /api/file/presign-upload`

Request:

```json
{
  "receiverId": 2,
  "fileName": "photo.jpg",
  "contentType": "image/jpeg",
  "fileSize": 12345
}
```

Server steps:

1. Require authenticated user.
2. Require uploader and `receiverId` to be contacts.
3. Validate filename and size.
4. Generate a random object key preserving only a normalized extension.
5. Insert `t_file(status='pending')` with owner/conversation/expected metadata.
6. Generate a one-hour presigned PUT URL with the normalized `Content-Type` included in the signature.
7. Return `fileId`, upload URL, required headers, display filename, and expected size.

After the PUT completes, the frontend calls `POST /api/files/{fileId}/complete`.

Server confirmation:

1. Load the file row and require `owner_id == currentUser` and `status == pending` (a second call for an already-ready file is idempotent and returns the current metadata).
2. `StatObject` the generated object key.
3. Require actual size to equal `expected_size` and remain within the server limit.
4. Read at most the first 512 bytes and detect MIME type with `http.DetectContentType`.
5. Mark the row `ready`, saving actual size, detected type, and confirmation time.
6. Return the stable content URL `/api/files/{fileId}/content`.

If validation fails, the row stays pending and cannot be attached to a message.

## Message attachment flow

For WebSocket `chat` payloads with `msgType` 2/3/5:

- `fileId` is required.
- The server loads `t_file` and requires `status=ready`, `owner_id=senderId`, and `conversation_id` equal to the sender/receiver conversation.
- The server ignores client-supplied file URL/name/size fields and derives message attachment metadata from `t_file`.
- `t_message.file_id` is persisted.
- API/WebSocket DTOs expose `fileId` and a stable `fileUrl` of `/api/files/{fileId}/content` so existing UI components can continue using `fileUrl`.

For text/emoji messages, file fields and `file_id` are null.

## Download/media flow

`GET /api/files/{fileId}/content`

1. Require authenticated session.
2. Load a ready `t_file` row.
3. Parse its `conversation_id` and require the current user to be one of the two conversation participants.
4. Generate a short-lived (10 minute) presigned GET URL for the exact object key.
5. For safely renderable detected media (`image/jpeg`, `image/png`, `image/gif`, `image/webp`, `video/mp4`, `video/avi`) request `Content-Disposition: inline` and the detected MIME type.
6. For every other type request `Content-Disposition: attachment` with a sanitized filename and `application/octet-stream` when necessary.
7. Return `302 Found` to the presigned URL and `Cache-Control: private, no-store` on the authorization response.

The old `/api/file/download/:objectName` route remains temporarily for migrated legacy references only if needed during rollout; the migration and DTO rewrite should move normal history to file IDs. It must not be used by new messages.

## Browser/R2 requirements

Cloudflare R2 presigned URLs are bearer credentials. Production uses short expirations and the bucket stays private. Browser direct PUT/GET access requires an R2 CORS policy allowing only the deployed frontend origins and the required methods/headers (`PUT`, `GET`, `HEAD`, `Content-Type`, and `Range` where applicable).

## Error handling

- Invalid parameters: HTTP 400.
- Not authenticated: HTTP 401.
- Non-contact upload target or cross-conversation file access: HTTP 403.
- Unknown file: HTTP 404.
- Oversized or size-mismatched upload: HTTP 413 or 422 as appropriate.
- Object storage failures: HTTP 502/503 without exposing backend error strings.

## Testing

Backend tests must prove:

- presign creates a pending file tied to the correct owner/conversation and rejects non-contacts/oversized files;
- completion rejects object-size mismatch and records detected content type when valid;
- only ready files owned by the sender and scoped to the target conversation can be attached;
- download authorization rejects users outside the conversation and generates a short-lived GET URL for participants;
- DTOs derive stable `/api/files/{id}/content` URLs;
- legacy migration SQL creates/backfills `t_file` and `t_message.file_id` without deleting old metadata.

Frontend build/type-check must prove:

- upload request includes `receiverId`;
- upload completion is called after R2 PUT;
- WebSocket file messages send `fileId` and keep stable media rendering through `fileUrl`.

## Rollout

1. Apply the migration before deploying the new backend.
2. Configure R2 bucket CORS for the production frontend origin.
3. Deploy backend and frontend together because new attachment messages require `fileId`.
4. Keep legacy message columns and route for one compatibility window; remove them in a separate cleanup PR after confirming migrated history renders correctly.
