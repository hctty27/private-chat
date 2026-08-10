# Client Message Idempotency Design

## Goal

Make a retried chat send idempotent: for a given sender, the same non-empty `clientMsgId` must resolve to the same persisted message and must never create a duplicate row, including under concurrent retries.

## Scope

This change covers WebSocket `chat` messages, message persistence, message DTOs, database migration, and tests. It does not change contact authorization, file authorization, WebSocket session policy, or the existing HTTP message-history endpoint shape beyond adding an optional `clientMsgId` field to each message DTO.

## Data model

Add nullable `client_msg_id VARCHAR(64)` to `t_message`.

Add a partial unique index:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uk_message_sender_client_msg_id
    ON t_message (sender_id, client_msg_id)
    WHERE client_msg_id IS NOT NULL;
```

The idempotency scope is deliberately `(sender_id, client_msg_id)`: two different users may generate the same client id without conflict, while one sender cannot persist the same logical client message twice.

Historical rows keep `client_msg_id = NULL` and remain unaffected.

## WebSocket input

Replace the untyped extraction of chat fields with a small typed chat payload structure at the WebSocket boundary.

Rules for `clientMsgId`:

- optional for backward compatibility during rollout;
- trim surrounding whitespace;
- empty after trimming is treated as absent;
- maximum length is 64 characters;
- invalid values reject the send before persistence.

Existing validation remains in place for receiver/contact access, message type, and attachment ownership/readiness.

## Persistence algorithm

For a chat send without `clientMsgId`, preserve current behavior and perform a normal insert.

For a chat send with `clientMsgId`:

1. Build the candidate `t_message` row including `sender_id` and `client_msg_id`.
2. Attempt an insert using PostgreSQL `ON CONFLICT` against the idempotency key.
3. If inserted, return the newly persisted row.
4. If the insert conflicts, query the existing row by `(sender_id, client_msg_id)` and return it.
5. Never rebroadcast a second logical message as a result of a retry; both sender and receiver should receive the canonical persisted message payload.

The database unique index is the final concurrency boundary. Application-level pre-checks are not relied on for correctness.

## Conflict semantics

A retry is considered the same logical message solely by `sender_id + clientMsgId`. The server returns the first persisted canonical message even if a buggy retry changes receiver, content, message type, or attachment fields.

This "first write wins" rule avoids mutating an already delivered message and keeps retry handling deterministic. Input fields on a conflicting retry are not used to overwrite the original row.

## DTO behavior

Add optional `clientMsgId` to `model.MessageDTO` and populate it from `model.Message`.

This field is returned consistently from:

- WebSocket chat acknowledgements/delivery payloads;
- HTTP history responses.

Legacy rows omit/null the field.

The existing wrapper type used only to append `clientMsgId` to WebSocket responses becomes unnecessary once `MessageDTO` carries the field directly and should be removed.

## Migration behavior

Create one new forward migration that:

1. adds `client_msg_id` if missing;
2. creates the partial unique index if missing.

The migration must be safe under the repository's automatic migration mechanism and must not require rewriting existing message rows.

`init.sql` should be updated so fresh installations start with the same schema as migrated installations.

## Testing

Add tests covering:

- DTO includes `clientMsgId` when present and omits/nulls it for legacy rows;
- trimming and maximum-length validation;
- first send inserts one row;
- sequential retry returns the same persisted message id and row count remains one;
- concurrent retries with the same `(sender_id, clientMsgId)` result in exactly one row;
- different senders may reuse the same `clientMsgId`;
- a conflicting retry with changed payload still returns the first persisted message;
- attachment messages retain existing file authorization behavior;
- migration smoke test confirms the column and unique index exist after automatic migrations.

## Compatibility and rollout

The server initially keeps `clientMsgId` optional so older deployed clients continue to work. New clients should always send it for chat messages.

No backfill is required. Idempotency applies only to messages that carry a client id after rollout.

## Non-goals

- exactly-once WebSocket transport delivery;
- cross-device generation strategy for `clientMsgId`;
- message edit/upsert semantics;
- Redis-based deduplication;
- changing the current single-session-per-user policy.
