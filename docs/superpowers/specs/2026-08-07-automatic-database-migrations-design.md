# Automatic Database Migrations Design

## Goal

Make `docker compose up -d --build` apply only pending PostgreSQL migrations before the backend starts, with version tracking and safe failure behavior.

## Confirmed behavior

- Existing `POSTGRES_*` configuration remains the single database configuration source; deployment does not require a second `DATABASE_URL` secret.
- Database migration runs in a one-shot Compose service built from the same backend image.
- The backend service starts only after the migration service exits successfully.
- Migration failures stop the deployment gate: the backend must not start against an incompatible schema.
- Re-running the migration command is idempotent: already-applied versions are skipped.
- Existing databases that already received `20260807_file_security_up.sql` manually must be adoptable without destructive changes.
- Fresh databases whose schema already comes from `init.sql` must also tolerate the first versioned migration run.

## Architecture

Use `github.com/golang-migrate/migrate/v4` as a library inside the backend binary. The project already opens PostgreSQL with pgx and custom IPv4 lookup/dial behavior, so the migration runner will reuse the same database connection construction instead of constructing a URL from credentials.

Add a `migrate` subcommand to `/app/private-chat-backend`:

```text
private-chat-backend          -> normal HTTP/WebSocket server
private-chat-backend migrate  -> apply all pending embedded migrations and exit
```

Versioned SQL files live under `backend/internal/migration/sql/` and are embedded with `go:embed`, so the production image does not need bind-mounted SQL files.

The Compose dependency graph becomes:

```text
migrate (one-shot)
   |
   | service_completed_successfully
   v
backend

frontend starts independently as today
```

Docker Compose documents `service_completed_successfully` specifically for one-shot dependencies that must finish successfully before a dependent service starts.

## Migration versions

The first managed version is:

```text
202608070001_file_security.up.sql
202608070001_file_security.down.sql
```

It is based on the already-shipped `migrations/20260807_file_security_up.sql`, but must be safe when the file-security schema already exists. In particular:

- `CREATE TABLE/INDEX` and `ADD COLUMN` operations remain guarded with `IF NOT EXISTS`.
- Historical backfill remains conflict-safe.
- Foreign-key creation checks whether `t_message.file_id` already has a foreign key to `t_file(id)`, not only whether a specific constraint name exists. This prevents a duplicate FK when `init.sql` created the equivalent constraint under PostgreSQL's generated name.

`golang-migrate` owns the `schema_migrations` table and migration version/dirty state. No custom migration bookkeeping is added.

## PostgreSQL connection reuse

Refactor `backend/internal/platform/db/db.go` so connection construction is shared:

- `OpenPostgresSQL(cfg config.Config) (*sql.DB, error)` builds the pgx `database/sql` connection with the existing DNS lookup and IPv4 dial functions, pool settings, and ping.
- `OpenPostgres(cfg)` calls `OpenPostgresSQL` and wraps it with GORM.
- the migration runner calls `OpenPostgresSQL`, then creates a golang-migrate PostgreSQL driver with `postgres.WithInstance`.

This avoids URL-encoding hazards in database passwords and keeps migrations subject to the same SSL mode and network behavior as the application.

## CLI behavior

`cmd/privatechat/main.go` will dispatch on the first argument.

- no arguments: create and run the application exactly as today.
- `migrate`: load config, validate the PostgreSQL fields needed for a connection, run migrations, print a concise success message, and exit 0.
- unknown command: return an error and exit non-zero.

The migration command must not connect to Redis or R2 and must not require JWT/R2/Redis secrets.

## Compose behavior

Add a `migrate` service:

- `build: ./backend`
- `command: ["migrate"]`
- `restart: "no"`
- same external `my-network`
- only PostgreSQL and timezone environment variables

Add to backend:

```yaml
depends_on:
  migrate:
    condition: service_completed_successfully
```

A new backend image causes the one-shot service to be recreated during normal `docker compose up -d --build`; if no new migration exists, `Up()` returns `migrate.ErrNoChange` and the command exits successfully.

## Error handling

- PostgreSQL connection failure: migration command exits non-zero.
- Invalid/dirty migration state: exits non-zero; do not automatically `Force` a version.
- Migration SQL failure: exits non-zero and backend stays gated.
- `migrate.ErrNoChange`: treated as success.
- Unknown CLI command: exits non-zero.

No automatic rollback is attempted on deployment failure. Rollback remains an explicit operator action because schema down migrations can be destructive.

## Testing

Backend/unit tests:

- CLI dispatch defaults to server mode and recognizes `migrate`.
- migration runner treats `ErrNoChange` as success and propagates real failures through a small injectable runner seam.

PostgreSQL CI integration:

1. Start PostgreSQL 16 service.
2. Load the legacy schema fixture.
3. Build the backend binary.
4. Run `private-chat-backend migrate` with only `POSTGRES_*` variables.
5. Assert `schema_migrations.version = 202608070001` and `dirty = false`.
6. Assert file-security schema/backfill state.
7. Run `private-chat-backend migrate` a second time and require exit 0.

Existing explicit up/down SQL smoke tests remain to validate rollback behavior.

## Dependency/toolchain

Use `github.com/golang-migrate/migrate/v4` v4.18.3. That release declares Go 1.23, matching the current backend Docker builder (`golang:1.23-alpine`). Update the module `go` directive from 1.22 to 1.23 so CI and Docker use one consistent floor.

Do not upgrade to migrate v4.19.x in this change because v4.19.1 declares Go 1.24 and would expand this task into a toolchain upgrade.

## Rollout

After merge, normal deployment becomes:

```bash
git pull
docker compose up -d --build
```

The operator no longer needs to run the file-security SQL manually. For a database where that SQL was already applied, the first managed migration safely reconciles the existing schema and records version `202608070001`; later deploys only apply newer versions.
