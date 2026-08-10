# Last Seen Presence Design

## Context

The application already exposes real-time presence through Redis-backed `online:<userId>` keys with a short TTL and WebSocket `online` broadcasts. Contacts currently receive an `online` boolean, while desktop and mobile chat headers render either `在线` or `离线`.

The requested feature adds a durable "last online" timestamp for offline contacts. The timestamp must not be shown in the contact list. It is shown only in the active chat header on desktop and mobile.

## Goals

- Preserve Redis as the source of truth for current online/offline state.
- Persist a durable last-active timestamp in PostgreSQL.
- Define `lastSeenAt` as the most recent confirmed active WebSocket session time, not generic HTTP activity.
- Keep database writes bounded instead of updating PostgreSQL on every heartbeat.
- Return `lastSeenAt` with contact data so the selected contact already has the value without a new API endpoint.
- Update `lastSeenAt` in real time when an online contact goes offline.
- Display last-seen text only in desktop and mobile chat headers.
- Keep `ContactList.vue` visually unchanged: it continues to show only `在线` / `离线`.

## Non-goals

- No privacy controls for hiding last-seen information in this iteration.
- No separate presence/history API.
- No per-device last-seen tracking.
- No "x minutes ago" continuously updating relative timer.
- No update from ordinary HTTP requests, file uploads, or message-history reads.
- No change to WebSocket authentication, contact authorization, or Redis online-key semantics.

## User-visible behavior

### Contact list

The contact list stays unchanged:

```text
张三  在线
李四  离线
```

It must not render `lastSeenAt`.

### Desktop and mobile chat headers

For an online contact:

```text
张三
在线
```

For an offline contact with a known timestamp:

```text
李四
最后上线 今天 14:32
```

Formatting rules:

- same local calendar day: `最后上线 今天 HH:mm`
- previous local calendar day: `最后上线 昨天 HH:mm`
- other date in current year: `最后上线 MM-DD HH:mm`
- different year: `最后上线 YYYY-MM-DD HH:mm`
- no historical value: `离线`

The frontend performs this presentation formatting. The backend returns a timestamp value, not localized words such as `今天` or `昨天`.

## Data model

Add a nullable column to `t_user`:

```sql
ALTER TABLE t_user
ADD COLUMN last_seen_at TIMESTAMPTZ NULL;
```

The Go model adds:

```go
LastSeenAt *time.Time `gorm:"column:last_seen_at"`
```

Existing users remain `NULL` until the first qualifying WebSocket activity is persisted.

The change is delivered through a new managed migration with matching down migration. Existing applied migrations must not be edited. `init.sql` is updated so new databases start with the current schema.

## Presence semantics

`lastSeenAt` means:

> The most recent time at which the server confirmed the user had an active authenticated WebSocket session.

Qualifying events:

- successful WebSocket registration: persist immediately
- heartbeat received: refresh Redis online TTL and persist at most once per throttle window
- current WebSocket session disconnects: persist immediately before/while broadcasting offline

Non-qualifying events:

- login succeeds but no WebSocket is established
- contacts/messages HTTP requests
- file presign, upload, completion, or download
- background API traffic without a live WebSocket session

This keeps "last online" tied specifically to chat presence.

## Persistence throttling

The frontend heartbeat interval is significantly shorter than the desired database-write cadence, so PostgreSQL must not be updated on every heartbeat.

Use a Redis throttle key per user:

```text
presence:last_seen:persist:<userId>
```

On heartbeat, attempt an atomic Redis `SET` with both NX and an expiry of 60 seconds. Only the caller that successfully creates the throttle key writes `t_user.last_seen_at`.

Conceptually:

```text
heartbeat
  -> refresh online:<userId> TTL
  -> SET presence:last_seen:persist:<userId> 1 NX EX 60
       -> set succeeded: UPDATE t_user.last_seen_at
       -> key exists: skip PostgreSQL write
```

This limits normal heartbeat persistence to approximately one write per online user per minute while retaining a recent durable value if the client disappears abnormally.

A Redis error during throttle acquisition must not disconnect the user or break heartbeat acknowledgement. Presence availability is more important than perfect persistence. The server should log the persistence/throttle failure and continue the existing heartbeat path.

A PostgreSQL update failure must likewise not terminate a healthy WebSocket session. It is logged and retried naturally on a later eligible heartbeat or disconnect.

## Connect and disconnect behavior

### WebSocket registration

After an authenticated WebSocket has successfully upgraded and becomes the current session:

1. register/replace the in-memory session as today
2. set the Redis online key as today
3. persist `last_seen_at` immediately
4. establish/refresh the 60-second persistence throttle key
5. broadcast `online=true` using the existing contact-scoped broadcast behavior

The `online=true` event does not need a last-seen value because the UI displays `在线` while the contact is online.

### Disconnect

Only the session that successfully wins the existing `RemoveIfCurrent` check may mark the user offline. This is important when a newer session has replaced an older one.

For the current session disconnect path:

1. capture one server timestamp
2. delete `online:<userId>`
3. persist that timestamp to `t_user.last_seen_at`
4. broadcast `online=false` with the same timestamp as `lastSeenAt`
5. close the session as today

If persistence fails, the broadcast may still carry the captured server timestamp so connected contacts immediately display a sensible offline time. The next contact-list fetch will reflect the most recently persisted value.

A stale/replaced session must not overwrite the newer session's presence or broadcast an offline event.

## API contract

Extend `ContactDTO`:

```go
LastSeenAt *string `json:"lastSeenAt"`
```

The existing contacts handler already loads all target `t_user` rows in one query. It can populate `lastSeenAt` from `targetUser.LastSeenAt` without introducing per-contact SQL queries.

If `LastSeenAt == nil`, return JSON `null`.

`online` remains authoritative for current presence. Consumers must prefer `online=true` over any historical timestamp.

## WebSocket contract

Extend the existing online event from:

```json
{
  "type": "online",
  "data": {
    "userId": 2,
    "online": false
  }
}
```

to support:

```json
{
  "type": "online",
  "data": {
    "userId": 2,
    "online": false,
    "lastSeenAt": "2026-08-10T14:32:15"
  }
}
```

For `online=true`, `lastSeenAt` may be omitted.

The frontend `WsOnlineMessage` type gains optional `lastSeenAt?: string`.

When an offline event arrives, the chat store updates both:

- `contact.online = false`
- `contact.lastSeenAt = event.data.lastSeenAt` when present

The same update applies to `currentContact` when it refers to that user.

When an online event arrives, only the online flag needs to change; the previous historical value may remain cached but is not displayed while online.

## Frontend data model and presentation

Extend `Contact`:

```ts
lastSeenAt: string | null
```

Add a reusable time formatter in the existing frontend time utility module, for example:

```ts
formatLastSeen(time: string | null): string
```

It returns the full status text (`最后上线 ...`) or `离线` when no usable timestamp exists.

Desktop `ChatPage.vue` and mobile `MobileChat.vue` use:

```text
currentContact.online ? '在线' : formatLastSeen(currentContact.lastSeenAt)
```

`ContactList.vue` remains functionally unchanged and continues to use only the `online` boolean for its visible status.

## Time handling

Persist absolute instants using PostgreSQL `TIMESTAMPTZ`. API output continues to use the application's existing time serialization conventions unless implementation review finds that they cannot represent an unambiguous instant. Frontend day-boundary calculations use the browser's local time so `今天` and `昨天` match the user's displayed calendar day.

The implementation must avoid comparing raw timestamp strings to decide today/yesterday; parse into `Date` values and compare local calendar components.

## Failure handling

- Redis online-state failure: preserve current best-effort behavior; do not disconnect solely because the presence key could not refresh.
- Redis throttle failure: log and skip that heartbeat's PostgreSQL persistence rather than writing unthrottled on every heartbeat.
- PostgreSQL last-seen write failure: log and keep the WebSocket alive.
- Missing/null last-seen value: frontend displays `离线`.
- Invalid timestamp delivered to the frontend: formatter falls back to `离线` rather than rendering `Invalid Date`.

## Testing

### Migration

- legacy schema upgrades and gains nullable `last_seen_at`
- managed migration version advances correctly
- repeated migration is idempotent through the migration runner
- current `init.sql` can be adopted by managed migrations
- down migration removes the column cleanly

### Backend

- user model maps `last_seen_at`
- contact DTO returns formatted/non-null last-seen value when present
- contact DTO returns null when absent
- successful WebSocket registration persists presence immediately
- heartbeat refreshes online TTL
- first eligible heartbeat persists last seen and establishes throttle
- heartbeat inside the throttle window does not trigger another DB update
- heartbeat after throttle expiry can persist again
- Redis throttle failure does not break heartbeat handling
- DB persistence failure does not close a healthy session
- current-session disconnect persists immediately and broadcasts `online=false` with the captured `lastSeenAt`
- stale/replaced session disconnect cannot mark the user offline or overwrite last seen

### Frontend

- `Contact` supports nullable `lastSeenAt`
- WebSocket offline event updates the cached contact and current contact
- online contact renders `在线`
- offline with today timestamp renders `最后上线 今天 HH:mm`
- yesterday timestamp renders `最后上线 昨天 HH:mm`
- same-year older timestamp renders `最后上线 MM-DD HH:mm`
- prior-year timestamp renders `最后上线 YYYY-MM-DD HH:mm`
- null/invalid timestamp renders `离线`
- `ContactList.vue` continues to render only `在线` / `离线` and does not render last-seen text
- desktop and mobile builds pass

## Deployment and compatibility

The database migration must run before the new backend starts, using the project's existing automatic migration gate. The new field is nullable, so existing rows and old data remain valid.

The API change is additive. A newer frontend understands `lastSeenAt`; older frontends ignore the extra JSON field. The WebSocket event change is also additive because `lastSeenAt` is an additional data property.

Backend and frontend may therefore be deployed together through the existing pipeline without a destructive compatibility window.

## Acceptance criteria

- Current online status remains driven by Redis and existing WebSocket presence semantics.
- Offline users have a durable `last_seen_at` once they have had a qualifying WebSocket session.
- Heartbeats do not write PostgreSQL more than approximately once per user per 60-second throttle window.
- Current-session disconnect persists and broadcasts the offline timestamp immediately.
- Contact-list UI remains unchanged and never displays last-seen text.
- Desktop and mobile active chat headers display the agreed last-seen format when the contact is offline.
- Existing authentication, authorization, message reliability, file security, reconnect, heartbeat acknowledgement, and kick-out behavior continue to pass regression tests.
