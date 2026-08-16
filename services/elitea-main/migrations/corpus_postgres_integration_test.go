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
//
// The third subtest (issue #306) is the same shape one level up: the gateway
// budget tables were declared by a migration corpus that only the dev bootstrap
// flag ever ran, while the corpus Helm runs — this one — had never heard of
// them. Every existing test of that schema called db.GatewayMigrationSQL()
// explicitly, so all of them passed against a schema production never built.
// Delete shared/0067 and the gateway subtest fails; no other test would.

import (
	"context"
	"errors"
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

// TestMigrationCorpusBuildsGatewayBudgetSchema proves the gateway.* tables
// exist because the LEDGERED corpus made them — the corpus deploy/helm/
// elitea-main/templates/migrate-job.yaml runs through elitea-migrate — and not
// because a fixture hand-created them. newMigratedPool applies nothing but
// 001_initial.sql and the embedded histories, so if shared/0067 is missing or
// inert, these statements fail with 42P01/42703 exactly as they would in a
// Helm-deployed cluster.
//
// It asserts BEHAVIOUR, not shape. Both statements below are copied verbatim
// from the services that run them (which are separate Go modules — the gateway
// is outside go.work — so they cannot be called through). A merely-parsable
// ON CONFLICT would satisfy a shape check; these subtests only pass if the
// unique constraint the money path conflicts on actually exists and actually
// deduplicates.
func TestMigrationCorpusBuildsGatewayBudgetSchema(t *testing.T) {
	pool := newMigratedPool(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// elitea-llm-gateway/internal/failmode/store.go snapshotSQL, the read the
	// gateway performs on EVERY /llm call before dispatching to a provider.
	// Trimmed to the FROM/JOIN/WHERE that names the tables; the projection is
	// exercised by the accumulate subtest below.
	const budgetSnapshot = `
SELECT pb.is_unlimited,
       COALESCE((pb.hard_limit_usd * 1000000000::numeric)::bigint, 0)    AS hard_limit_nano,
       COALESCE((acc.accumulated_cost * 1000000000::numeric)::bigint, 0) AS accumulated_nano,
       pb.soft_alert_pct,
       pb.nats_fail_mode,
       acc.id IS NOT NULL AS acc_found
FROM gateway.project_budget pb
LEFT JOIN gateway.llm_budget_accumulators acc
    ON acc.scope = $2 AND acc.scope_id = $3 AND acc.period_start = to_timestamp($4)
WHERE pb.project_id = $1`

	// elitea-scheduler/internal/budgetwriteback/store.go upsertSQL, character
	// for character apart from the nanoUSDPerUSD constant being inlined.
	const writeBackUpsert = `
INSERT INTO gateway.llm_budget_accumulators AS acc
		(project_id, org_id, scope, scope_id, period_start, period_end,
		 accumulated_cost, outage_mode, reconciled, last_updated)
	VALUES ($1, $2, $3, $4, to_timestamp($5), to_timestamp($6),
		$7::numeric / 1000000000, false, false, now())
	ON CONFLICT (scope, scope_id, period_start) DO UPDATE SET
		accumulated_cost = acc.accumulated_cost + EXCLUDED.accumulated_cost,
		last_updated = now()
	WHERE NOT (acc.outage_mode AND NOT acc.reconciled)`

	// elitea-scheduler/internal/budgetwriteback/store.go dedupSQL.
	const dedup = `INSERT INTO gateway.processed_event_ids (event_id) VALUES ($1)
	ON CONFLICT DO NOTHING RETURNING event_id`

	const (
		projectID   = 8306
		scope       = "project"
		scopeID     = "8306"
		periodStart = 1767225600 // 2026-01-01T00:00:00Z
		periodEnd   = 1769904000 // 2026-02-01T00:00:00Z
	)

	if _, err := pool.Exec(ctx, `
INSERT INTO gateway.project_budget (project_id, hard_limit_usd, is_unlimited, enabled, soft_alert_pct, nats_fail_mode)
VALUES ($1, 25.00, false, true, 80, 'fail_closed')`, projectID); err != nil {
		t.Fatalf("seed project budget: %v", err)
	}

	t.Run("gateway admission read", func(t *testing.T) {
		var (
			isUnlimited    bool
			hardLimitNano  int64
			accumulatedNan int64
			softAlertPct   int16
			failMode       *string
			accFound       bool
		)
		if err := pool.QueryRow(ctx, budgetSnapshot, projectID, scope, scopeID, periodStart).Scan(
			&isUnlimited, &hardLimitNano, &accumulatedNan, &softAlertPct, &failMode, &accFound,
		); err != nil {
			t.Fatalf("gateway budget snapshot: %v", err)
		}
		// 25.00 USD in nano-USD. A wrong NUMERIC precision on hard_limit_usd
		// would round this, which is the denomination bug the schema exists to
		// prevent — so assert the value, not merely that the read succeeded.
		if hardLimitNano != 25_000_000_000 {
			t.Errorf("hard_limit_nano = %d, want 25000000000", hardLimitNano)
		}
		if accFound {
			t.Error("acc_found = true with no accumulator row seeded")
		}
		if failMode == nil || *failMode != "fail_closed" {
			t.Errorf("nats_fail_mode = %v, want fail_closed", failMode)
		}
	})

	t.Run("write-back accumulates on the conflict target", func(t *testing.T) {
		// Two deltas for the SAME (scope, scope_id, period_start). If the
		// UNIQUE constraint is absent the second is a second ROW rather than a
		// conflict — spend silently splits in two and the gateway reads half of
		// it. Without the constraint Postgres would reject the statement with
		// 42P10 instead, which is the failure this catches on a fresh database.
		for _, deltaNano := range []int64{1_500_000_000, 2_500_000_000} {
			if _, err := pool.Exec(ctx, writeBackUpsert,
				projectID, nil, scope, scopeID, periodStart, periodEnd, deltaNano,
			); err != nil {
				t.Fatalf("write-back upsert: %v", err)
			}
		}

		var rows int
		var accumulated string
		if err := pool.QueryRow(ctx, `
SELECT count(*), COALESCE(max(accumulated_cost)::text, '')
FROM gateway.llm_budget_accumulators
WHERE scope = $1 AND scope_id = $2 AND period_start = to_timestamp($3)`,
			scope, scopeID, periodStart,
		).Scan(&rows, &accumulated); err != nil {
			t.Fatalf("read accumulator: %v", err)
		}
		if rows != 1 {
			t.Fatalf("accumulator rows = %d, want 1 — the UPSERT did not conflict, so spend is split across rows", rows)
		}
		// 1.5 + 2.5 USD. A summed 4.00 proves the DO UPDATE ran; 2.50 would
		// mean the second write replaced rather than accumulated.
		if accumulated != "4.00000000" {
			t.Errorf("accumulated_cost = %q, want %q", accumulated, "4.00000000")
		}
	})

	t.Run("dedup ledger actually deduplicates", func(t *testing.T) {
		const eventID = "6f1d0a3e-1c22-4f7a-9a41-3f0c5f7a1b20"
		var returned string
		if err := pool.QueryRow(ctx, dedup, eventID).Scan(&returned); err != nil {
			t.Fatalf("first dedup insert: %v", err)
		}
		// A redelivery MUST return no row. If event_id were not the primary key
		// the insert would succeed again and the consumer would double-apply
		// the delta onto the accumulator.
		err := pool.QueryRow(ctx, dedup, eventID).Scan(&returned)
		if !errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("redelivery err = %v, want pgx.ErrNoRows — the event was not deduplicated", err)
		}
	})

	t.Run("re-applying is inert", func(t *testing.T) {
		// Every dev and dump-loaded database already carries these tables from
		// the deleted unledgered corpus and has no ledger row for 0067, so
		// elitea-migrate WILL apply this file over an existing schema holding
		// live rows. That must neither error nor disturb the data — the whole
		// reason every statement in it is guarded. Re-executing the real file
		// here is that exact sequence.
		sql, err := migrations.Files.ReadFile("shared/0067_gateway_budget_schema.sql")
		if err != nil {
			t.Fatalf("read 0067: %v", err)
		}
		if _, err := pool.Exec(ctx, string(sql)); err != nil {
			t.Fatalf("re-apply 0067 over an existing schema: %v", err)
		}
		// The accumulated spend written by the subtest above must survive.
		var accumulated string
		if err := pool.QueryRow(ctx, `
SELECT accumulated_cost::text FROM gateway.llm_budget_accumulators
WHERE scope = $1 AND scope_id = $2 AND period_start = to_timestamp($3)`,
			scope, scopeID, periodStart,
		).Scan(&accumulated); err != nil {
			t.Fatalf("read accumulator after re-apply: %v", err)
		}
		if accumulated != "4.00000000" {
			t.Errorf("accumulated_cost = %q after re-apply, want %q", accumulated, "4.00000000")
		}
	})

	t.Run("remaining gateway tables are present", func(t *testing.T) {
		// The three tables no statement above touches. to_regclass returns NULL
		// rather than raising when the relation is absent, so one query covers
		// all of them and names the missing one.
		for _, table := range []string{
			"gateway.llm_credentials",
			"gateway.gateway_models",
			"gateway.governance_config",
			"gateway.user_budget",
		} {
			var oid *string
			if err := pool.QueryRow(ctx, "SELECT to_regclass($1)::text", table).Scan(&oid); err != nil {
				t.Fatalf("to_regclass(%s): %v", table, err)
			}
			if oid == nil {
				t.Errorf("%s does not exist after the ledgered corpus applied", table)
			}
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
		// 120 s, not the old 20 s to 30 s. This DROP queues behind the
		// CREATE DATABASE calls of every package that `go test ./...` runs at
		// the same time, so the wait is server load and not a hang. Two full
		// runs failed here with "drop isolated ... database: timeout" (#409).
		dropCtx, dropCancel := context.WithTimeout(context.Background(), 120*time.Second)
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
