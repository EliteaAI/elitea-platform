package secrets

// The backfill runs on ONE replica at a time (O4).
//
// BackfillProjectSecretsHeaderValues runs on every elitea-main replica before
// its listeners bind, and the chart's default is two with an autoscaler that
// may add eight more. EnsureProjectSecretsHeaderValue is a read-modify-write of
// the WHOLE vault — decrypt, check one key, re-encrypt everything back — so
// concurrent passes do not merely duplicate work. Each generates a DIFFERENT
// random value, the last write wins, and a client that read the first is
// refused. A legitimate secret written through the secrets API between one
// replica's read and its write is clobbered outright.
//
// These tests need a real PostgreSQL because the serialisation IS a PostgreSQL
// advisory lock. A fake would assert that the code calls a lock function, which
// is the claim least worth checking.

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// seedProjectsWithVaults creates the project rows the backfill joins against
// and a vault for each, with NO header value — the state a backfill exists to
// repair.
func seedProjectsWithVaults(t *testing.T, pool *pgxpool.Pool, projectIDs ...string) {
	t.Helper()
	ctx := context.Background()

	if _, err := pool.Exec(ctx, `
CREATE TABLE IF NOT EXISTS centry.project (id INTEGER PRIMARY KEY)`); err != nil {
		t.Fatalf("create centry.project: %v", err)
	}
	handler := NewHandler(pool)
	for _, projectID := range projectIDs {
		if _, err := pool.Exec(ctx,
			`INSERT INTO centry.project (id) VALUES ($1::integer) ON CONFLICT DO NOTHING`,
			projectID); err != nil {
			t.Fatalf("seed project %s: %v", projectID, err)
		}
		if err := handler.writeVaultCtx(ctx, projectID, vaultData{
			Secrets:       map[string]string{"unrelated": "keep-me-" + projectID},
			HiddenSecrets: map[string]string{},
		}); err != nil {
			t.Fatalf("seed project %s vault: %v", projectID, err)
		}
	}
}

func TestOnlyOneReplicaRunsTheBackfill(t *testing.T) {
	pool := newSecretsPool(t)
	seedProjectsWithVaults(t, pool, "1", "2", "3")

	// Two handlers over the same database is what two replicas are. They start
	// together, which is the cold-start shape rather than an unlucky one.
	const replicas = 2
	reports := make([]SecretsHeaderBackfillReport, replicas)
	errs := make([]error, replicas)

	var start sync.WaitGroup
	var done sync.WaitGroup
	start.Add(1)
	for i := 0; i < replicas; i++ {
		done.Add(1)
		go func(i int) {
			defer done.Done()
			start.Wait()
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			reports[i], errs[i] = NewHandler(pool).BackfillProjectSecretsHeaderValues(ctx)
		}(i)
	}
	start.Done()
	done.Wait()

	for i, err := range errs {
		if err != nil {
			t.Fatalf("replica %d: %v", i, err)
		}
	}

	ran, skipped := 0, 0
	for _, report := range reports {
		if report.SkippedLocked {
			skipped++
			continue
		}
		ran++
		if report.Written != 3 {
			t.Errorf("the replica that ran wrote %d values, want 3", report.Written)
		}
	}
	if ran != 1 || skipped != replicas-1 {
		t.Fatalf("%d replicas ran the pass and %d skipped; exactly one must run", ran, skipped)
	}
}

func TestASkippedReplicaReportsWhyRatherThanReportingNothing(t *testing.T) {
	// An all-zero report is ambiguous: "another replica is doing it" and "every
	// vault already had a value" produce identical counts. Only SkippedLocked
	// separates them, and the caller logs a different line for each.
	pool := newSecretsPool(t)
	seedProjectsWithVaults(t, pool, "1")
	ctx := context.Background()

	// Hold the lock the way a peer replica would: a session lock on its own
	// pinned connection.
	holder, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer holder.Release()
	var acquired bool
	if err := holder.QueryRow(ctx,
		`SELECT pg_catalog.pg_try_advisory_lock($1)`, backfillLockKey).Scan(&acquired); err != nil {
		t.Fatal(err)
	}
	if !acquired {
		t.Fatal("could not take the lock to simulate a peer replica")
	}

	report, err := NewHandler(pool).BackfillProjectSecretsHeaderValues(ctx)
	if err != nil {
		t.Fatalf("a locked-out replica returned an error instead of skipping: %v", err)
	}
	if !report.SkippedLocked {
		t.Fatal("a locked-out replica did not report that it skipped")
	}
	if report.Written != 0 || report.Vaults != 0 {
		t.Fatalf("a locked-out replica did work: %+v", report)
	}
}

func TestTheLockIsReleasedSoTheNextStartCanRunThePass(t *testing.T) {
	// A session lock held on a pooled connection outlives the function unless
	// it is released explicitly — the connection goes back to the pool still
	// holding it, and every later pass in this process is then locked out by
	// its own predecessor.
	pool := newSecretsPool(t)
	seedProjectsWithVaults(t, pool, "1")
	ctx := context.Background()

	first, err := NewHandler(pool).BackfillProjectSecretsHeaderValues(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if first.SkippedLocked || first.Written != 1 {
		t.Fatalf("the first pass did not run: %+v", first)
	}

	// ASK POSTGRES, do not ask the next pass.
	//
	// A second pass cannot tell: advisory locks are RE-ENTRANT within a
	// session, and pgxpool hands the same connection back, so a leaked lock is
	// invisible inside one process while blocking every other replica
	// forever. The first version of this test asserted only that a second pass
	// ran, and it passed against a build whose unlock was replaced with
	// another lock call.
	var held int
	if err := pool.QueryRow(ctx, `
SELECT count(*) FROM pg_locks
WHERE locktype = 'advisory' AND objid = ($1::bigint & 4294967295)::oid`,
		backfillLockKey).Scan(&held); err != nil {
		t.Fatalf("read pg_locks: %v", err)
	}
	if held != 0 {
		t.Fatalf("the pass left %d advisory lock(s) held; every other replica is now locked out until this connection closes", held)
	}

	second, err := NewHandler(pool).BackfillProjectSecretsHeaderValues(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if second.SkippedLocked {
		t.Fatal("the second pass was locked out by the first, which never released")
	}
	// Nothing left to write, and that is the point: it RAN and found the work
	// done, rather than being blocked from looking.
	if second.Written != 0 || second.AlreadySet != 1 {
		t.Fatalf("the second pass: %+v", second)
	}
}

func TestTheBackfillDoesNotClobberOtherSecretsInTheVault(t *testing.T) {
	// The read-modify-write covers the whole vault, so a pass that rebuilt it
	// from scratch would drop every other secret while looking correct on the
	// one key it manages.
	pool := newSecretsPool(t)
	seedProjectsWithVaults(t, pool, "7")
	ctx := context.Background()

	if _, err := NewHandler(pool).BackfillProjectSecretsHeaderValues(ctx); err != nil {
		t.Fatal(err)
	}

	vault, err := NewHandler(pool).readVaultCtx(ctx, "7")
	if err != nil {
		t.Fatal(err)
	}
	if got := vault.Secrets["unrelated"]; got != "keep-me-7" {
		t.Fatalf("the backfill lost an unrelated secret: %q", got)
	}
	if vault.Secrets[SecretsHeaderValueName] == "" {
		t.Fatal("the backfill wrote no header value")
	}
}
