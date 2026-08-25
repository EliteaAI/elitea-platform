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
			t.Fatalf("%s now exists as %s. internal/infra/db/repos/analytics.go's queries against "+
				"it were deleted because nothing created it (issue #303), and the repository was "+
				"later rebuilt over gateway.llm_request_logs instead — decide which of the two is "+
				"the source and wire it up, or this table will be populated with no reader.",
				table, *regclass)
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

// The positive counterpart, and the reason the repository could be rebuilt at
// all: gateway.llm_request_logs, created by shared migration 0099, is the
// producer behind llm_calls, total_tokens, the per-model split, the daily
// series and the user leaderboard.
//
// It is asserted HERE, beside the absence check, because the two are one
// statement about the corpus: the figures this endpoint reports come from that
// table and from nowhere else. Drop 0099 from the ledgered set — or from
// db.GatewayMigrationSQL's concatenation, which is how a test database gets it
// — and the analytics reads fall back to refusing on a deployment that has
// every other gateway table. That failure is recoverable but obscure; this
// makes it a migration-level red instead.
func TestGatewayRequestLogIsInTheCorpus(t *testing.T) {
	pool := newMigratedPool(t)

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	var regclass *string
	if err := pool.QueryRow(ctx, "SELECT to_regclass('gateway.llm_request_logs')::text").Scan(&regclass); err != nil {
		t.Fatalf("to_regclass(gateway.llm_request_logs): %v", err)
	}
	if regclass == nil {
		t.Fatal("gateway.llm_request_logs is absent. internal/infra/db/repos/analytics.go reads it " +
			"for every figure the Overview and Users tabs report, and internal/api/gateway/" +
			"llm_proxy_logs.go reads it for the admin request log — both refuse without it.")
	}

	// The columns the analytics queries actually group and sum by. A rename
	// here type-checks nothing on the Go side (the queries are string literals),
	// so without this the first sign would be a 500 in production.
	for _, column := range []string{
		"project_id", "user_id", "occurred_at", "model", "provider",
		"prompt_tokens", "completion_tokens",
	} {
		var exists bool
		const query = `
SELECT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'gateway' AND table_name = 'llm_request_logs' AND column_name = $1
)`
		if err := pool.QueryRow(ctx, query, column).Scan(&exists); err != nil {
			t.Fatalf("column probe %s: %v", column, err)
		}
		if !exists {
			t.Errorf("gateway.llm_request_logs has no %s column — the analytics queries name it "+
				"in a string literal, so nothing else would catch this before production.", column)
		}
	}
}
