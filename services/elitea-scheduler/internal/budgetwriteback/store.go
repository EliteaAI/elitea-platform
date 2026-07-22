package budgetwriteback

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// dedupSQL records the delta's event_id in the SAME transaction as the
// accumulator UPSERT (§8.6). ON CONFLICT DO NOTHING RETURNING event_id: a
// returned row means the event is new (apply it); pgx.ErrNoRows means it was
// already applied by an earlier (committed) delivery and MUST be skipped so the
// UPSERT is not double-applied.
const dedupSQL = `INSERT INTO gateway.processed_event_ids (event_id) VALUES ($1)
	ON CONFLICT DO NOTHING RETURNING event_id`

// upsertSQL is the guarded delta-UPSERT into the durable accumulator. It adds
// the coalesced nano-USD delta (converted to USD NUMERIC exactly, in SQL) to
// the row for (scope, scope_id, period_start).
//
// The WHERE guard on DO UPDATE enforces the §8.5/§8.6 disjointness invariant:
// the write-back consumer MUST NOT touch a row still in the un-reconciled outage
// state (outage_mode=true AND reconciled=false) — those rows are owned
// exclusively by the gateway's recovery-reconciliation goroutine until it resets
// outage_mode=false. When the guard fails the DO UPDATE matches no row and
// RowsAffected()==0, which the consumer reads as "deferred": it rolls the whole
// transaction back (so the dedup rows are NOT persisted) and redelivers later.
// A fresh INSERT (new period) writes outage_mode=false and always affects 1 row.
//
// The $7::numeric / nanoUSDPerUSD is the ONE nano-USD → USD conversion point,
// done in Postgres NUMERIC (never float64) so the money path stays exact.
var upsertSQL = fmt.Sprintf(`INSERT INTO gateway.llm_budget_accumulators AS acc
		(project_id, org_id, scope, scope_id, period_start, period_end,
		 accumulated_cost, outage_mode, reconciled, last_updated)
	VALUES ($1, $2, $3, $4, to_timestamp($5), to_timestamp($6),
		$7::numeric / %d, false, false, now())
	ON CONFLICT (scope, scope_id, period_start) DO UPDATE SET
		accumulated_cost = acc.accumulated_cost + EXCLUDED.accumulated_cost,
		last_updated = now()
	WHERE NOT (acc.outage_mode AND NOT acc.reconciled)`, nanoUSDPerUSD)

// applyOutcome is the result of persisting one coalesced key-group.
type applyOutcome int

const (
	// outcomeApplied: the transaction committed. Either the summed delta was
	// applied to the accumulator, or every event in the group was already
	// applied (a no-op commit). Either way the messages are safe to ACK.
	outcomeApplied applyOutcome = iota
	// outcomeDeferred: the target accumulator row is in the un-reconciled outage
	// state, so the UPSERT matched no row. The transaction was rolled back
	// (nothing persisted, including dedup rows); the messages MUST be redelivered
	// later, after the gateway's recovery goroutine clears outage_mode.
	outcomeDeferred
)

// Store applies coalesced budget deltas to the durable accumulator tier.
type Store struct {
	db DB
}

// NewStore builds a Store over the given DB seam.
func NewStore(db DB) *Store { return &Store{db: db} }

// Apply persists one coalesced key-group in a single transaction (design §8.6):
//
//  1. For each delta, INSERT its event_id into processed_event_ids
//     (ON CONFLICT DO NOTHING RETURNING). Only events whose id is newly inserted
//     contribute to the summed delta — an already-applied event contributes 0,
//     so a partial redelivery of a coalesced group is never double-counted.
//  2. If at least one event is new, run the guarded delta-UPSERT for the summed
//     nano-USD delta. RowsAffected==0 ⇒ the row is outage-owned ⇒ roll back and
//     report deferred.
//  3. Commit only after the UPSERT (and dedup rows) are staged in the same
//     transaction; a crash before commit leaves neither, so redelivery re-runs
//     both idempotently.
//
// All deltas in group MUST share the same (scope, scope_id, period_start) key
// (the caller coalesces by key). group must be non-empty and pre-validated.
func (s *Store) Apply(ctx context.Context, group []BudgetDelta) (applyOutcome, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return outcomeApplied, err
	}
	// Rollback is a no-op after a successful Commit; safe to always defer.
	defer func() { _ = tx.Rollback(ctx) }()

	var sumNano int64
	var newEvents int
	for _, d := range group {
		var gotID string
		err := tx.QueryRow(ctx, dedupSQL, d.EventID).Scan(&gotID)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			// Already applied by an earlier committed delivery — contributes 0.
			continue
		case err != nil:
			return outcomeApplied, err
		}
		newEvents++
		sumNano += d.DeltaNanoUSD
	}

	if newEvents == 0 {
		// Every event already applied. Nothing to UPSERT; commit the (empty)
		// transaction and ACK — a benign no-op redelivery.
		if err := tx.Commit(ctx); err != nil {
			return outcomeApplied, err
		}
		return outcomeApplied, nil
	}

	head := group[0]
	affected, err := tx.ExecAffected(ctx, upsertSQL,
		head.ProjectID, head.OrgID, head.Scope, head.ScopeID,
		head.PeriodStart, head.PeriodEnd, sumNano,
	)
	if err != nil {
		return outcomeApplied, err
	}
	if affected == 0 {
		// Outage-owned row: the guard blocked the DO UPDATE. Roll back so the
		// dedup rows staged above are discarded, then signal deferral so the
		// caller redelivers after recovery clears the outage flag.
		_ = tx.Rollback(ctx)
		return outcomeDeferred, nil
	}

	if err := tx.Commit(ctx); err != nil {
		return outcomeApplied, err
	}
	return outcomeApplied, nil
}
