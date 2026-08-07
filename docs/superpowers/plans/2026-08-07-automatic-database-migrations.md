# Automatic Database Migrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically apply only pending PostgreSQL migrations before the backend starts during Docker Compose deployment.

**Architecture:** Add a `migrate` subcommand to the existing backend binary using `golang-migrate` with embedded SQL migrations and the existing pgx database configuration. Add a one-shot Compose `migrate` service and gate backend startup with `service_completed_successfully`.

**Tech Stack:** Go 1.23, pgx v5, golang-migrate v4.18.3, PostgreSQL 16, Docker Compose, GitHub Actions.

## Global Constraints

- Keep `POSTGRES_*` as the only required database configuration.
- Migration command must not require Redis, JWT, or R2 connectivity.
- Already-applied migrations must be skipped through `schema_migrations`.
- Existing manually migrated and `init.sql`-created databases must be safe on first managed migration run.
- Do not automatically force dirty migration versions or automatically roll back failed deployments.
- Backend must not start if migrations fail.

---

### Task 1: Create versioned embedded migration

**Files:**
- Create: `backend/internal/migration/sql/202608070001_file_security.up.sql`
- Create: `backend/internal/migration/sql/202608070001_file_security.down.sql`
- Create: `backend/internal/migration/migrations.go`
- Test: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `migration.Files fs.FS` containing golang-migrate-compatible `*.up.sql` / `*.down.sql` files.

- [ ] **Step 1: Add the versioned SQL pair**

Copy the shipped file-security migration into version `202608070001`, retaining idempotent table/index/column/backfill operations. Change FK creation to detect an existing FK from `t_message.file_id` to `t_file.id`, independent of constraint name.

- [ ] **Step 2: Embed migration SQL**

```go
package migration

import "embed"

//go:embed sql/*.sql
var Files embed.FS
```

- [ ] **Step 3: Add PostgreSQL CI expectations before implementing the runner**

Extend the migrations job so it eventually builds the backend and runs:

```bash
./private-chat-backend migrate
./private-chat-backend migrate
```

Then assert:

```sql
SELECT CASE WHEN version = 202608070001 AND dirty = false THEN 1 ELSE 0 END
FROM schema_migrations;
```

Expected initial result: RED because the backend does not yet implement the `migrate` command.

---

### Task 2: Reuse PostgreSQL database/sql connection

**Files:**
- Modify: `backend/internal/platform/db/db.go`
- Test: `backend/internal/platform/db/db_test.go` if connection-construction seams exist; otherwise rely on PostgreSQL integration job.

**Interfaces:**
- Produces: `func OpenPostgresSQL(cfg config.Config) (*sql.DB, error)`.
- Consumes: existing `config.Config` and custom `postgresLookupFunc` / `postgresDialFunc`.

- [ ] **Step 1: Extract SQL connection creation**

Move pgx parsing, lookup/dial hooks, pool configuration, and ping into:

```go
func OpenPostgresSQL(cfg config.Config) (*sql.DB, error)
```

- [ ] **Step 2: Keep GORM behavior unchanged**

Implement `OpenPostgres` as:

```go
sqlDB, err := OpenPostgresSQL(cfg)
if err != nil { return nil, err }
gormDB, err := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB}), ...)
```

Close `sqlDB` if GORM wrapping fails.

- [ ] **Step 3: Run backend tests**

Run `go test ./...` and verify existing database tests remain green.

---

### Task 3: Add migration runner and CLI command

**Files:**
- Create: `backend/internal/migration/run.go`
- Create: `backend/internal/migration/run_test.go`
- Modify: `backend/cmd/privatechat/main.go`
- Create: `backend/cmd/privatechat/main_test.go`
- Modify: `backend/go.mod`
- Modify: `backend/go.sum`

**Interfaces:**
- Produces: `func migration.Run(ctx context.Context, cfg config.Config) error`.
- Produces CLI modes `serve` and `migrate`.
- Consumes `migration.Files` and `db.OpenPostgresSQL`.

- [ ] **Step 1: Write runner behavior tests**

Use a small internal interface:

```go
type upRunner interface { Up() error }
```

Test helper behavior:

```go
func runUp(r upRunner) error
```

Assertions:
- `migrate.ErrNoChange` -> nil.
- arbitrary error -> same error.
- nil -> nil.

- [ ] **Step 2: Write CLI dispatch tests**

Refactor command selection into a pure helper and test:

```text
[]             -> serve
["migrate"]    -> migrate
["unknown"]    -> error
```

- [ ] **Step 3: Add golang-migrate v4.18.3**

Update the module Go floor to 1.23 and add:

```text
github.com/golang-migrate/migrate/v4 v4.18.3
```

Use the PostgreSQL database driver and `iofs` source driver.

- [ ] **Step 4: Implement `migration.Run`**

Open the shared SQL connection, create the postgres migrate driver with `postgres.WithInstance`, create an `iofs` source rooted at `sql`, then call `Up()`. Treat only `migrate.ErrNoChange` as success. Always close migrate/source/database resources where applicable.

- [ ] **Step 5: Implement CLI dispatch**

Normal invocation continues to call `app.NewApp()` / `Run()`. `migrate` loads config and calls `migration.Run`; it must not call `app.NewApp()`.

- [ ] **Step 6: Run tests and CI integration**

Verify the migration command works with only PostgreSQL environment variables and succeeds twice.

---

### Task 4: Gate backend startup in Docker Compose

**Files:**
- Modify: `compose.yml`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Produces one-shot Compose service `migrate`.
- Backend consumes successful completion through `depends_on.migrate.condition`.

- [ ] **Step 1: Add migrate service**

Use the backend image/build with:

```yaml
migrate:
  build: ./backend
  command: ["migrate"]
  restart: "no"
  networks:
    - my-network
```

Pass only timezone and `POSTGRES_*` values.

- [ ] **Step 2: Gate backend**

Add:

```yaml
depends_on:
  migrate:
    condition: service_completed_successfully
```

- [ ] **Step 3: Update deployment documentation**

Replace the manual `psql ... 20260807_file_security_up.sql` deployment requirement with:

```bash
docker compose up -d --build
```

Document that migrations run automatically, failures block backend startup, and dirty states require operator intervention.

---

### Task 5: Full verification and PR

**Files:**
- Modify: `.github/workflows/ci.yml` as needed for deterministic integration assertions.

- [ ] **Step 1: Backend verification**

Run through GitHub Actions:

```bash
test -z "$(gofmt -l .)"
go test ./...
go vet ./...
```

- [ ] **Step 2: Migration integration verification**

On PostgreSQL 16:
- load legacy fixture;
- run backend migration command once;
- assert schema and `schema_migrations` version/dirty state;
- run migration command a second time and require success;
- keep explicit down-migration smoke coverage.

- [ ] **Step 3: Frontend verification**

```bash
npm ci
npm run build
```

- [ ] **Step 4: Open PR**

Open a PR from `feat/automatic-migrations` to `master`, keep it unmerged, and report CI evidence. Merge only on explicit user instruction.
