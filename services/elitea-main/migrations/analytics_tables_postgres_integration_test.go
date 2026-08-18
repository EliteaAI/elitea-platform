package migrations_test

// The premise of issue #303, checked against the real corpus rather than
// against a grep.
//
// internal/infra/db/repos/analytics.go used to SELECT from `usage_records` and
// `tool_usage_records`. A repository-wide search found no migration creating
// them — but this repository has a standing way for that search to be wrong:
// internal/db/schema/*.sql are sqlc COMPILER projections, and a shape declared
// there satisfies sqlc and type-checks the generated queries while no migration
// produces it. corpus_postgres_integration_test.go's header records two runtime
// failures caused by exactly that gap.
//
// So this applies the same real corpus and asks PostgreSQL. It is the evidence
// behind deleting those queries, and it is a live tripwire in both directions:
//
//   - if the tables are still absent, the deletion stands;
//   - if someone ADDS them, this test fails and points at the repository that
//     must be wired back up — a new table with no reader would otherwise be as
//     silent as the reader with no table was.

import (
	"context"
	"testing"
	"time"
)

func TestAnalyticsTablesAreAbsentFromTheCorpus(t *testing.T) {
	pool := newMigratedPool(t)

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	// to_regclass answers NULL for a name that does not resolve, and does it
	// without raising — the only way to ask "does this exist" that does not
	// abort the surrounding transaction when the answer is no.
	for _, table := range []string{"usage_records", "tool_usage_records"} {
		var regclass *string
		if err := pool.QueryRow(ctx, "SELECT to_regclass($1)::text", table).Scan(&regclass); err != nil {
			t.Fatalf("to_regclass(%s): %v", table, err)
		}
		if regclass != nil {
			t.Fatalf("%s now exists as %s. internal/infra/db/repos/analytics.go was emptied "+
				"because nothing created it (issue #303) — wire the repository back up to this "+
				"table and delete this assertion, or the analytics routes will keep answering 500 "+
				"over a table that is being populated.", table, *regclass)
		}
	}

	// And the search path really was searched: a table that DOES exist must be
	// found by the same query. Without this, a to_regclass that silently
	// answered NULL for everything would make the assertions above vacuous —
	// the "nothing found → OK" shape this PR has been bitten by before.
	var control *string
	if err := pool.QueryRow(ctx, "SELECT to_regclass('centry.schedule')::text").Scan(&control); err != nil {
		t.Fatalf("control to_regclass: %v", err)
	}
	if control == nil {
		t.Fatal("centry.schedule not found either — the existence probe resolves nothing, so this test proves nothing")
	}
}
