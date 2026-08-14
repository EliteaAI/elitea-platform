package migrations_test

// What this file exists to catch, and why nothing else could.
//
// Every other PostgreSQL integration test in this service builds the schema it
// needs by hand — repos/configuration_validation_postgres_integration_test.go
// CREATEs its own `centry.notifications`, repos/toolkits_postgres_integration_test.go
// CREATEs its own `p_1.elitea_tools`. Both of those hand-written shapes are
// transcribed from internal/db/schema/*.sql, the sqlc COMPILER projections. So
// the generated queries are only ever executed against the schema sqlc
// type-checked them against, and never against the schema the migration corpus
// actually produces. When the two disagree the whole suite stays green and the
// server fails at runtime — twice, measured on the standalone stack:
//
//   * `column "updated_at" does not exist` (42703) reading a toolkit, which made
//     the #93 index-start route answer 500 before it could do anything at all.
//   * `there is no unique or exclusion constraint matching the ON CONFLICT
//     specification` (42P10) persisting an index run's TERMINAL output, which
//     silently swallowed `index.ingest.completed` and left the browser's
//     EventSource waiting on a finished run forever.
//
// So this test applies the REAL corpus — 001_initial.sql, then every
// migrations/shared and migrations/tenant file — and then executes the two
// statements themselves. It asserts behaviour rather than shape: the toolkit
// SELECT must return the row it was given, and the notification INSERT must
// actually deduplicate on a repeat, which a merely-parsable ON CONFLICT would
// not do.
//
// Revert either 0124 or 0065 and the corresponding subtest fails.

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	migrations "github.com/EliteaAI/elitea-platform/services/elitea-main/migrations"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/migrate"
)

const (
	databaseURLEnv    = "ELITEA_TEST_DATABASE_URL"
	bootstrapSchemaSQ = "../internal/infra/db/migrations/001_initial.sql"
)

func TestMigrationCorpusSupportsGeneratedQueries(t *testing.T) {
	pool := newMigratedPool(t)

	// The generated query, character for character from
	// internal/db/sqlcgen/toolkits.sql.go:13-27. Copied rather than called
	// through the repository so that a change to either one shows up here as a
	// diff rather than as a silent divergence.
	const getCurrentToolkit = `
SELECT id, created_at, updated_at, type, name, description,
       settings, author_id, shared_owner_id, shared_id, meta
FROM elitea_tools
WHERE id = $1::integer
LIMIT 1`

	t.Run("toolkit read", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()

		if _, err := pool.Exec(ctx, `
INSERT INTO p_1.elitea_tools (id, name, type, description, owner_id, author_id, meta, settings)
VALUES (4242, 'corpus-probe', 'artifact', 'migration corpus probe', 1, 1, '{}'::jsonb, '{}'::jsonb)`,
		); err != nil {
			t.Fatalf("seed toolkit row: %v", err)
		}

		// The query names `elitea_tools` unqualified because it only ever runs
		// inside a project transaction whose local search_path is p_<id>
		// (sqlcgen/toolkits.sql.go:30-31). SET LOCAL needs that transaction to be
		// explicit — in an implicit one the setting is discarded before the
		// SELECT.
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatalf("begin: %v", err)
		}
		defer func() { _ = tx.Rollback(ctx) }()
		if _, err := tx.Exec(ctx, "SET LOCAL search_path TO p_1"); err != nil {
			t.Fatalf("set search_path: %v", err)
		}

		var (
			id                      int32
			name                    *string
			createdAt               time.Time
			updatedAt               *time.Time
			toolkitType             string
			description             *string
			settings, meta          []byte
			authorID                int32
			sharedOwnerID, sharedID *int32
		)
		scanErr := tx.QueryRow(ctx, getCurrentToolkit, int32(4242)).Scan(
			&id, &createdAt, &updatedAt, &toolkitType, &name, &description,
			&settings, &authorID, &sharedOwnerID, &sharedID, &meta,
		)
		if scanErr != nil {
			t.Fatalf("the generated toolkit query does not run against the migrated schema: %v", scanErr)
		}
		if id != 4242 || name == nil || *name != "corpus-probe" || toolkitType != "artifact" {
			t.Fatalf("toolkit row read back wrong: id=%d name=%v type=%q", id, name, toolkitType)
		}
	})

	// The tail of InsertCurrentIndexTerminalNotification
	// (internal/db/queries/runtime_index_ingest.sql:265-295). The surrounding CTE
	// needs a whole execution graph; the clause that broke is this one, and it
	// breaks on its own.
	t.Run("notification upsert deduplicates", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()

		const insertNotification = `
INSERT INTO centry.notifications (uuid, is_seen, project_id, user_id, meta, event_type)
VALUES ($1::text::uuid, FALSE, 1, 1, '{}'::jsonb, 'index_data_changed')
ON CONFLICT (uuid) DO NOTHING`
		const notificationUUID = "00000000-0000-4000-8000-000000000042"

		for attempt := 1; attempt <= 2; attempt++ {
			if _, err := pool.Exec(ctx, insertNotification, notificationUUID); err != nil {
				t.Fatalf("attempt %d: ON CONFLICT (uuid) is not supported by the migrated schema: %v", attempt, err)
			}
		}

		var rows int
		if err := pool.QueryRow(ctx,
			"SELECT count(*) FROM centry.notifications WHERE uuid = $1::text::uuid",
			notificationUUID,
		).Scan(&rows); err != nil {
			t.Fatalf("count notifications: %v", err)
		}
		// 2 would mean the statement parsed against SOME unique index while the
		// uuid column itself stayed duplicable — which is exactly the state a
		// shape-only assertion would have accepted.
		if rows != 1 {
			t.Fatalf("uuid is not unique: the second insert produced %d rows total, want 1", rows)
		}
	})
}

// newMigratedPool builds a throwaway database holding ONLY what a real
// deployment of this repository holds: the bootstrap schema plus the embedded
// migration corpus. Nothing is created by hand.
func newMigratedPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL := os.Getenv(databaseURLEnv)
	if databaseURL == "" && os.Getenv("ELITEA_TEST_USE_SERVICE_DATABASE_URL") == "1" {
		databaseURL = os.Getenv("DATABASE_URL")
	}
	if databaseURL == "" {
		t.Skipf("set %s to run the migration-corpus integration test", databaseURLEnv)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	adminPool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open admin pool: %v", err)
	}
	defer adminPool.Close()

	databaseName := fmt.Sprintf("elitea_corpus_%d_%d", os.Getpid(), time.Now().UnixNano())
	if _, err := adminPool.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{databaseName}.Sanitize()); err != nil {
		t.Fatalf("create isolated database: %v", err)
	}

	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatalf("parse %s: %v", databaseURLEnv, err)
	}
	config.ConnConfig.Database = databaseName
	config.MaxConns = 4
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatalf("open isolated pool: %v", err)
	}
	t.Cleanup(func() {
		pool.Close()
		dropCtx, dropCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer dropCancel()
		dropPool, dropErr := pgxpool.New(dropCtx, databaseURL)
		if dropErr != nil {
			return
		}
		defer dropPool.Close()
		_, _ = dropPool.Exec(dropCtx,
			"DROP DATABASE IF EXISTS "+pgx.Identifier{databaseName}.Sanitize()+" WITH (FORCE)")
	})

	bootstrap, err := os.ReadFile(bootstrapSchemaSQ)
	if err != nil {
		t.Fatalf("read bootstrap schema: %v", err)
	}
	if _, err := pool.Exec(ctx, string(bootstrap)); err != nil {
		t.Fatalf("apply bootstrap schema: %v", err)
	}

	runner := migrate.New(pool, migrations.Files)
	if err := runner.ApplyShared(ctx); err != nil {
		t.Fatalf("apply shared migrations: %v", err)
	}
	if err := runner.ApplyTenant(ctx, 1); err != nil {
		t.Fatalf("apply tenant migrations to p_1: %v", err)
	}
	return pool
}
