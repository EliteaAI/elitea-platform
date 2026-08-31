package budgetwriteback

// usage_ledger_test.go — the per-request usage ledger the write-back consumer
// writes beside the accumulator (issue #320).
//
// The property under test is not "a row is written". It is that the ledger and
// the accumulator carry the SAME money exactly once each: one accumulator
// UPSERT for the coalesced group, one ledger row per new event, and neither
// duplicated by a redelivery. Getting that wrong makes the Usage page disagree
// with the budget it reports against, which is worse than the missing chart
// #320 is about.

import (
	"context"
	"strings"
	"testing"
)

// occurredAt is the gateway's billing instant carried on every delta. It is
// deliberately DIFFERENT from any write time in these tests, so a writer that
// fell back to now() would produce a visibly wrong value.
const occurredAt int64 = 1_767_312_000 // 2026-01-02T00:00:00Z

func dims(userID *int, model string, prompt, completion int64) *UsageDimensions {
	return &UsageDimensions{
		UserID: userID, Provider: "openai", Model: model,
		PromptTokens: prompt, CompletionTokens: completion,
		OccurredAtUnix: occurredAt,
	}
}

func intPtr(v int) *int { return &v }

func delta(eventID string, nano int64, usage *UsageDimensions) BudgetDelta {
	return BudgetDelta{
		EventID:      eventID,
		Scope:        "project",
		ScopeID:      "42",
		ProjectID:    42,
		PeriodStart:  1000,
		PeriodEnd:    2000,
		DeltaNanoUSD: nano,
		Usage:        usage,
	}
}

// TestApply_WritesOneLedgerRowPerEvent is the coalescing property: the group
// produces ONE accumulator UPSERT for the summed money and one ledger row per
// request, because a per-model table cannot be reconstructed from a sum.
func TestApply_WritesOneLedgerRowPerEvent(t *testing.T) {
	tx := &fakeTx{upsertAffected: 1}
	store := NewStore(&fakeDB{tx: tx})

	outcome, err := store.Apply(context.Background(), []BudgetDelta{
		delta("e1", 1_000_000_000, dims(intPtr(7), "gpt-4o", 10, 20)),
		delta("e2", 2_000_000_000, dims(intPtr(9), "gpt-4o-mini", 30, 40)),
	})
	if err != nil || outcome != outcomeApplied {
		t.Fatalf("Apply = (%v, %v), want (applied, nil)", outcome, err)
	}
	if len(tx.usageInserts) != 2 {
		t.Fatalf("wrote %d ledger rows, want 2 (one per request)", len(tx.usageInserts))
	}
	if !tx.upsertRan {
		t.Fatal("the accumulator UPSERT did not run")
	}
	// The accumulator got the SUM; the ledger rows keep their own amounts.
	if got := tx.upsertArgs[6]; got != int64(3_000_000_000) {
		t.Fatalf("accumulator delta = %v, want the coalesced 3e9", got)
	}
	if got := tx.usageInserts[0][7]; got != int64(1_000_000_000) {
		t.Fatalf("first ledger cost = %v, want its own 1e9, not the group sum", got)
	}
	if got := tx.usageInserts[1][7]; got != int64(2_000_000_000) {
		t.Fatalf("second ledger cost = %v, want its own 2e9", got)
	}
	if !tx.committed {
		t.Fatal("transaction was not committed")
	}
}

// TestApply_RedeliveryWritesNoSecondLedgerRow is the double-count control. The
// ledger insert sits inside the SAME dedup gate as the money, so an event whose
// id is already in processed_event_ids contributes neither.
func TestApply_RedeliveryWritesNoSecondLedgerRow(t *testing.T) {
	tx := &fakeTx{upsertAffected: 1, alreadyApplied: map[string]bool{"e1": true}}
	store := NewStore(&fakeDB{tx: tx})

	if _, err := store.Apply(context.Background(), []BudgetDelta{
		delta("e1", 1_000_000_000, dims(intPtr(7), "gpt-4o", 10, 20)),
		delta("e2", 2_000_000_000, dims(intPtr(7), "gpt-4o", 30, 40)),
	}); err != nil {
		t.Fatal(err)
	}
	if len(tx.usageInserts) != 1 {
		t.Fatalf("wrote %d ledger rows, want 1 — the redelivered event must not be recorded twice",
			len(tx.usageInserts))
	}
	if got := tx.usageInserts[0][0]; got != "e2" {
		t.Fatalf("recorded event %v, want the new one (e2)", got)
	}
	// And the money agrees: only the new event's delta reached the accumulator.
	if got := tx.upsertArgs[6]; got != int64(2_000_000_000) {
		t.Fatalf("accumulator delta = %v, want 2e9 (only the new event)", got)
	}
}

// TestApply_FullRedeliveryWritesNothing pins the group-level no-op: every event
// already applied means no ledger row and no UPSERT, and the messages are still
// safe to ACK.
func TestApply_FullRedeliveryWritesNothing(t *testing.T) {
	tx := &fakeTx{upsertAffected: 1, alreadyApplied: map[string]bool{"e1": true}}
	store := NewStore(&fakeDB{tx: tx})

	outcome, err := store.Apply(context.Background(), []BudgetDelta{
		delta("e1", 1_000_000_000, dims(intPtr(7), "gpt-4o", 10, 20)),
	})
	if err != nil || outcome != outcomeApplied {
		t.Fatalf("Apply = (%v, %v), want (applied, nil)", outcome, err)
	}
	if len(tx.usageInserts) != 0 {
		t.Fatalf("wrote %d ledger rows for a fully redelivered group, want 0", len(tx.usageInserts))
	}
	if tx.upsertRan {
		t.Fatal("the accumulator UPSERT ran for a fully redelivered group")
	}
}

// TestApply_NoDimensionsWritesNoLedgerRow is the negative control for the
// member-scope delta: it carries the same money under a different scope, and
// its dimensions are already recorded by the project delta.
func TestApply_NoDimensionsWritesNoLedgerRow(t *testing.T) {
	tx := &fakeTx{upsertAffected: 1}
	store := NewStore(&fakeDB{tx: tx})

	memberDelta := delta("m1", 1_000_000_000, nil)
	memberDelta.Scope = "user"
	memberDelta.ScopeID = "42:7"

	if _, err := store.Apply(context.Background(), []BudgetDelta{memberDelta}); err != nil {
		t.Fatal(err)
	}
	if len(tx.usageInserts) != 0 {
		t.Fatalf("wrote %d ledger rows for a member-scope delta, want 0 — the ledger would double-count",
			len(tx.usageInserts))
	}
	if !tx.upsertRan {
		t.Fatal("the member accumulator was not updated")
	}
}

// TestApply_OutageDeferralWritesNothing: when the accumulator row is
// outage-owned the whole transaction rolls back, so the ledger rows staged
// alongside it are discarded and redelivered with the money.
func TestApply_OutageDeferralWritesNothing(t *testing.T) {
	tx := &fakeTx{upsertAffected: 0} // guard blocked the DO UPDATE
	store := NewStore(&fakeDB{tx: tx})

	outcome, err := store.Apply(context.Background(), []BudgetDelta{
		delta("e1", 1_000_000_000, dims(intPtr(7), "gpt-4o", 10, 20)),
	})
	if err != nil {
		t.Fatal(err)
	}
	if outcome != outcomeDeferred {
		t.Fatalf("outcome = %v, want deferred", outcome)
	}
	if !tx.rolledBack {
		t.Fatal("the transaction was not rolled back, so a ledger row survived a deferred group")
	}
	if tx.committed {
		t.Fatal("a deferred group committed")
	}
}

// TestApply_LedgerRowCarriesDimensions checks the column order of the insert.
// A silently transposed model and provider would produce a per-model table that
// looks populated and names the wrong things.
func TestApply_LedgerRowCarriesDimensions(t *testing.T) {
	tx := &fakeTx{upsertAffected: 1}
	store := NewStore(&fakeDB{tx: tx})

	if _, err := store.Apply(context.Background(), []BudgetDelta{
		delta("e1", 5_000_000_000, dims(intPtr(7), "gpt-4o", 11, 22)),
	}); err != nil {
		t.Fatal(err)
	}
	args := tx.usageInserts[0]
	// The trailing nil is execution_id: this delta carries no runtime execution,
	// and "not made from an execution" has to reach the column as NULL rather
	// than as an empty string — the agent breakdown GROUPs on it, so '' would
	// become a nameless agent collecting every unattributable request.
	want := []any{"e1", 42, intPtr(7), "openai", "gpt-4o", int64(11), int64(22),
		int64(5_000_000_000), int64(1000), int64(2000), occurredAt, nil}
	if len(args) != len(want) {
		t.Fatalf("ledger insert took %d args, want %d", len(args), len(want))
	}
	for i, w := range want {
		if i == 2 {
			got, ok := args[i].(*int)
			if !ok || got == nil || *got != 7 {
				t.Fatalf("arg %d (user_id) = %v, want a *int holding 7", i, args[i])
			}
			continue
		}
		if args[i] != w {
			t.Fatalf("arg %d = %v (%T), want %v (%T)", i, args[i], args[i], w, w)
		}
	}
}

// TestApply_NilUserIDStaysNull proves "no member" is recorded as NULL rather
// than as member 0, which the per-member views would otherwise attribute to a
// real user.
func TestApply_NilUserIDStaysNull(t *testing.T) {
	tx := &fakeTx{upsertAffected: 1}
	store := NewStore(&fakeDB{tx: tx})

	if _, err := store.Apply(context.Background(), []BudgetDelta{
		delta("e1", 1_000_000_000, dims(nil, "gpt-4o", 1, 2)),
	}); err != nil {
		t.Fatal(err)
	}
	userArg, ok := tx.usageInserts[0][2].(*int)
	if !ok {
		t.Fatalf("user_id arg is %T, want *int", tx.usageInserts[0][2])
	}
	if userArg != nil {
		t.Fatalf("user_id = %d, want NULL for a call with no member", *userArg)
	}
}

// TestApply_LedgerCarriesTheGatewaysBillingInstant pins the column that a
// `now()` default would have filled in. The consumer runs behind the stream, so
// its write time is not the time of the call, and the per-day series buckets on
// this value.
func TestApply_LedgerCarriesTheGatewaysBillingInstant(t *testing.T) {
	tx := &fakeTx{upsertAffected: 1}
	if _, err := NewStore(&fakeDB{tx: tx}).Apply(context.Background(), []BudgetDelta{
		delta("e1", 1_000_000_000, dims(intPtr(7), "gpt-4o", 1, 2)),
	}); err != nil {
		t.Fatal(err)
	}
	if got := tx.usageInserts[0][10]; got != occurredAt {
		t.Fatalf("occurred_at = %v, want the gateway's billing instant %d", got, occurredAt)
	}
}

// TestPruneUsageEvents_BoundedAndLedgerOnly pins the two properties that keep
// retention from becoming a money bug: it touches only the ledger, and it is
// bounded per pass.
func TestPruneUsageEvents_BoundedAndLedgerOnly(t *testing.T) {
	if strings.Contains(pruneUsageEventsSQL, "llm_budget_accumulators") {
		t.Fatal("the retention prune references the accumulator; it must never rewrite billed spend")
	}
	if !strings.Contains(pruneUsageEventsSQL, "LIMIT $2") {
		t.Fatal("the retention prune is unbounded; a first pass could lock millions of rows")
	}

	tx := &fakeTx{}
	deleted, err := NewStore(&fakeDB{tx: tx}).PruneUsageEvents(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if deleted != 1 {
		t.Fatalf("deleted = %d, want the fake's 1", deleted)
	}
	if !tx.committed {
		t.Fatal("the prune did not commit")
	}
	// The window must reach Postgres as seconds, not as Go's "9600h0m0s",
	// which Postgres does not accept as an interval.
	if got := tx.usageInserts; len(got) != 1 {
		t.Fatalf("prune ran %d statements, want 1", len(got))
	}
	if got := tx.usageInserts[0][0]; got != RetentionWindow.Seconds() {
		t.Fatalf("retention arg = %v, want %v seconds", got, RetentionWindow.Seconds())
	}
}
