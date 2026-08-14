package scheduler

// What these tests pin, and why the obvious test would not have caught it.
//
// The defect (issue #305) was not that the scheduler failed to publish. It
// published fine: Redis PUBLISH to zero subscribers returns 0 and no error, so
// `Call` succeeded, `last_run` was stamped, and the schedule history recorded a
// run that nothing performed. A test that asserted "the dispatcher was called"
// would have passed against the broken code and against the fixed code alike.
//
// So both tests below assert the STORED STATE instead: what the scheduler wrote
// to centry.schedule. TestDispatchDoesNotStampLastRunWithoutAConsumer does it
// against a recording store (always runs); TestDispatchLastRunAgainstPostgres
// does it against the real table created by the real bootstrap DDL, reading
// last_run back out of PostgreSQL (runs when ELITEA_TEST_DATABASE_URL is set,
// which is how CI runs this module — see .github/workflows/ci-go.yml).

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-scheduler/internal/config"
)

// ── recording doubles ───────────────────────────────────────────────────────

type recordedExec struct {
	sql  string
	args []any
}

// recordingStore implements scheduleStore. Query is never reached by dispatch;
// it fails loudly rather than returning a zero value, so a future caller that
// starts using it cannot mistake silence for an empty result set.
type recordingStore struct{ execs []recordedExec }

func (s *recordingStore) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, fmt.Errorf("recordingStore.Query is not implemented; dispatch must not query")
}

func (s *recordingStore) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	s.execs = append(s.execs, recordedExec{sql: sql, args: args})
	return pgconn.NewCommandTag("UPDATE 1"), nil
}

// fixedDispatcher answers every Call with a chosen subscriber count, which is
// the one variable the defect turned on.
type fixedDispatcher struct {
	receivers int64
	err       error
	calls     int
}

func (d *fixedDispatcher) Call(context.Context, string, map[string]any) (int64, error) {
	d.calls++
	return d.receivers, d.err
}

func newTestScheduler(store scheduleStore, disp dispatcher) *Scheduler {
	return newWithDeps(store, nil, disp, config.Config{RPCChannel: "elitea_rpc"})
}

func dueSchedule() Schedule {
	return Schedule{ID: 77, Name: "index_scheduling", Cron: "* * * * *", RPCFunc: "index_scan"}
}

// ── the discriminating unit test ────────────────────────────────────────────

func TestDispatchDoesNotStampLastRunWithoutAConsumer(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name      string
		receivers int64
		err       error
		wantRun   bool
		wantStamp bool
	}{
		// The whole issue: publish succeeded, nobody was listening.
		{name: "zero subscribers", receivers: 0, wantRun: false, wantStamp: false},
		// The hybrid deployment, where legacy Pylon subscribes. Must keep working.
		{name: "one subscriber", receivers: 1, wantRun: true, wantStamp: true},
		{name: "several subscribers", receivers: 3, wantRun: true, wantStamp: true},
		// A Redis-level failure was already handled; pinned so the rewrite
		// cannot regress it.
		{name: "publish error", receivers: 0, err: fmt.Errorf("redis down"), wantRun: false, wantStamp: false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			store := &recordingStore{}
			disp := &fixedDispatcher{receivers: tc.receivers, err: tc.err}
			s := newTestScheduler(store, disp)

			got := s.dispatch(context.Background(), dueSchedule(), time.Now().UTC())

			if got != tc.wantRun {
				t.Fatalf("dispatch reported %v, want %v", got, tc.wantRun)
			}
			// The dispatcher is always consulted — not stamping must be a
			// decision taken AFTER publishing, not a refusal to publish. A
			// scheduler that stopped publishing would also pass the last_run
			// assertion below while breaking the hybrid deployment.
			if tc.err == nil && disp.calls != 1 {
				t.Fatalf("dispatcher called %d times, want exactly 1", disp.calls)
			}

			stamped := false
			for _, e := range store.execs {
				if strings.Contains(e.sql, "SET last_run") {
					stamped = true
				}
			}
			if stamped != tc.wantStamp {
				t.Fatalf("last_run stamped = %v, want %v (writes: %+v)", stamped, tc.wantStamp, store.execs)
			}
		})
	}
}

// ── the same claim, against the real table ──────────────────────────────────

func TestDispatchLastRunAgainstPostgres(t *testing.T) {
	pool := newSchedulePool(t)
	ctx := context.Background()

	seed := func(t *testing.T, name string) int {
		t.Helper()
		var id int
		if err := pool.QueryRow(ctx, `
INSERT INTO centry.schedule (name, project_id, cron, active, rpc_func, rpc_kwargs, last_run)
VALUES ($1, NULL, '* * * * *', true, 'dispatch_probe', '{}'::jsonb, NULL)
RETURNING id`, name).Scan(&id); err != nil {
			t.Fatalf("seed schedule: %v", err)
		}
		return id
	}

	lastRun := func(t *testing.T, id int) *time.Time {
		t.Helper()
		var got *time.Time
		if err := pool.QueryRow(ctx,
			`SELECT last_run FROM centry.schedule WHERE id = $1`, id).Scan(&got); err != nil {
			t.Fatalf("read last_run: %v", err)
		}
		return got
	}

	now := time.Now().UTC().Truncate(time.Second)

	t.Run("no consumer leaves last_run NULL", func(t *testing.T) {
		id := seed(t, "probe_no_consumer")
		s := newWithDeps(pool, nil, &fixedDispatcher{receivers: 0}, config.Config{RPCChannel: "elitea_rpc"})

		if s.dispatch(ctx, Schedule{ID: id, Name: "probe", Cron: "* * * * *", RPCFunc: "dispatch_probe"}, now) {
			t.Fatal("dispatch reported success with zero subscribers")
		}
		// NULL, not "some older timestamp": the row must be untouched, so the
		// next tick still considers this schedule due.
		if got := lastRun(t, id); got != nil {
			t.Fatalf("last_run = %v, want NULL — a schedule nothing consumed was recorded as run", *got)
		}
	})

	t.Run("a consumer stamps last_run", func(t *testing.T) {
		id := seed(t, "probe_with_consumer")
		s := newWithDeps(pool, nil, &fixedDispatcher{receivers: 1}, config.Config{RPCChannel: "elitea_rpc"})

		if !s.dispatch(ctx, Schedule{ID: id, Name: "probe", Cron: "* * * * *", RPCFunc: "dispatch_probe"}, now) {
			t.Fatal("dispatch reported failure with a subscriber present")
		}
		got := lastRun(t, id)
		if got == nil {
			t.Fatal("last_run is NULL after a delivered dispatch — the hybrid deployment would never advance")
		}
		if !got.UTC().Equal(now) {
			t.Fatalf("last_run = %v, want %v", got.UTC(), now)
		}
	})
}

// newSchedulePool builds a throwaway database holding the REAL centry.schedule
// definition, lifted out of elitea-main's bootstrap DDL rather than retyped
// here: a hand-written copy is exactly how a test comes to pass against a shape
// no deployment has (see services/elitea-main/migrations/corpus_postgres_integration_test.go's
// header for the two runtime failures that pattern produced).
//
// Only the one statement is applied. The rest of 001_initial.sql is elitea-main's
// concern and pulls in a schema graph this module has no business creating.
func newSchedulePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL := os.Getenv("ELITEA_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set ELITEA_TEST_DATABASE_URL to run the last_run integration test")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	adminPool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open admin pool: %v", err)
	}
	defer adminPool.Close()

	databaseName := fmt.Sprintf("elitea_sched_%d_%d", os.Getpid(), time.Now().UnixNano())
	if _, err := adminPool.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{databaseName}.Sanitize()); err != nil {
		t.Fatalf("create isolated database: %v", err)
	}

	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatalf("parse ELITEA_TEST_DATABASE_URL: %v", err)
	}
	cfg.ConnConfig.Database = databaseName
	cfg.MaxConns = 4
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
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

	if _, err := pool.Exec(ctx, "CREATE SCHEMA IF NOT EXISTS centry"); err != nil {
		t.Fatalf("create centry schema: %v", err)
	}
	if _, err := pool.Exec(ctx, scheduleDDL(t)); err != nil {
		t.Fatalf("apply centry.schedule DDL: %v", err)
	}
	return pool
}

// bootstrapDDLPath points across module boundaries on purpose. centry.schedule
// is created by elitea-main's bootstrap migration and read/written by this
// service (001_initial.sql says so in its own header); pointing at the real
// file means a column rename there fails this test instead of silently
// diverging.
const bootstrapDDLPath = "../../../elitea-main/internal/infra/db/migrations/001_initial.sql"

var scheduleDDLRe = regexp.MustCompile(`(?is)CREATE TABLE IF NOT EXISTS centry\.schedule \(.*?\n\);`)

func scheduleDDL(t *testing.T) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Clean(bootstrapDDLPath))
	if err != nil {
		t.Fatalf("read %s: %v", bootstrapDDLPath, err)
	}
	stmt := scheduleDDLRe.FindString(string(raw))
	// "not found" must fail, never quietly skip the table: a bootstrap file
	// that stopped creating centry.schedule is the very thing worth screaming
	// about, and a test that shrugged at it would go green on an empty schema.
	if stmt == "" {
		t.Fatalf("no CREATE TABLE ... centry.schedule statement found in %s", bootstrapDDLPath)
	}
	return stmt
}
