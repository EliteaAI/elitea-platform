package failmode

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
)

// snapshotSQL point-reads the applicable budget scope from the durable tier
// (design §8.5). It LEFT JOINs the accumulator for the current period onto the
// project's budget config so a project with a config but no spend this period
// still returns its limit/fail-mode with a zero, fresh accumulated cost.
//
// accumulated_cost is USD NUMERIC in the durable tier; it is scaled to nano-USD
// in SQL ((accumulated_cost * NanoUSD)::bigint) so the money path stays exact
// and the FSM compares like-for-like int64 nano-USD. The snapshot age is
// computed as EXTRACT(EPOCH FROM now() - last_updated) seconds.
//
// $1 project_id, $2 scope, $3 scope_id, $4 period_start (unix seconds).
const snapshotSQL = `SELECT
		pb.is_unlimited,
		COALESCE((pb.hard_limit_usd * $5::numeric)::bigint, 0)      AS hard_limit_nano,
		COALESCE((acc.accumulated_cost * $5::numeric)::bigint, 0)   AS accumulated_nano,
		pb.soft_alert_pct,
		pb.nats_fail_mode,
		acc.id IS NOT NULL                                          AS acc_found,
		COALESCE(EXTRACT(EPOCH FROM (now() - acc.last_updated)), 0) AS age_seconds
	FROM gateway.project_budget pb
	LEFT JOIN gateway.llm_budget_accumulators acc
		ON acc.scope = $2 AND acc.scope_id = $3
		AND acc.period_start = to_timestamp($4)
	WHERE pb.project_id = $1`

// outageUpsertSQL is the delta-accumulating outage-window UPSERT (design §8.5).
// It writes outage_mode=true so the write-back consumer (§8.6) skips the row
// (its guard is NOT (outage_mode AND NOT reconciled)); the outage and healthy
// deltas for the same period then accumulate on the same row without either
// writer clobbering the other. A fresh INSERT sets reconciled=false.
//
// The nano-USD delta is converted to USD NUMERIC exactly in SQL, mirroring the
// write-back consumer's single conversion point.
//
// $1 project_id, $2 org_id, $3 scope, $4 scope_id, $5 period_start,
// $6 period_end, $7 delta_nano, $8 NanoUSD divisor.
var outageUpsertSQL = fmt.Sprintf(`INSERT INTO gateway.llm_budget_accumulators AS acc
		(project_id, org_id, scope, scope_id, period_start, period_end,
		 accumulated_cost, outage_mode, reconciled, last_updated)
	VALUES ($1, $2, $3, $4, to_timestamp($5), to_timestamp($6),
		$7::numeric / %d, true, false, now())
	ON CONFLICT (scope, scope_id, period_start) DO UPDATE SET
		accumulated_cost = acc.accumulated_cost + (EXCLUDED.accumulated_cost),
		outage_mode = true,
		reconciled = false,
		reconciliation_in_progress = false,
		last_updated = now()`, NanoUSD)

// ErrNoBudgetRow is returned by ReadSnapshot when the project has no
// project_budget config row at all. The caller treats a project with no budget
// config as unlimited (there is nothing to enforce).
var ErrNoBudgetRow = errors.New("failmode: no project_budget row")

// Store reads budget snapshots and persists outage-window deltas against the
// durable accumulator tier. It is the FSM's Postgres side.
type Store struct {
	db DB
}

// NewStore builds a Store over the given DB seam.
func NewStore(db DB) *Store { return &Store{db: db} }

// ReadSnapshot point-reads the applicable budget scope for a project/period.
// It runs off a transaction (a single hot-path read must not hold a tx) and is
// intended to be wrapped in the caller's OpTimeout-bounded context.
func (s *Store) ReadSnapshot(ctx context.Context, projectID int, scope, scopeID string, periodStartUnix int64) (Snapshot, error) {
	row := s.db.QueryRow(ctx, snapshotSQL, projectID, scope, scopeID, periodStartUnix, NanoUSD)

	var (
		isUnlimited   bool
		hardLimitNano int64
		accumNano     int64
		softAlertPct  int
		natsFailMode  *string
		accFound      bool
		ageSeconds    float64
	)
	if err := row.Scan(&isUnlimited, &hardLimitNano, &accumNano, &softAlertPct, &natsFailMode, &accFound, &ageSeconds); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Snapshot{}, ErrNoBudgetRow
		}
		return Snapshot{}, fmt.Errorf("failmode: read snapshot: %w", err)
	}

	snap := Snapshot{
		IsUnlimited:     isUnlimited,
		HardLimitNano:   hardLimitNano,
		AccumulatedNano: accumNano,
		SoftAlertPct:    softAlertPct,
		Found:           accFound,
	}
	// A missing accumulator row (no spend yet this period) is a fresh zero
	// snapshot; age is only meaningful when the row exists.
	if accFound {
		snap.Age = durationFromSeconds(ageSeconds)
	}
	// Populate the per-project fail-mode override so the caller can apply it
	// without a second round-trip. An empty / NULL column means "inherit baseline".
	if natsFailMode != nil {
		snap.NatsFailMode = FailMode(*natsFailMode)
	}
	return snap, nil
}

// PerProjectFailMode reads only the per-project nats_fail_mode override for a
// project, returning "" when unset (inherit the baseline). It is a thin read
// used where the caller has not already loaded a full snapshot.
func (s *Store) PerProjectFailMode(ctx context.Context, projectID int) (string, error) {
	row := s.db.QueryRow(ctx,
		`SELECT nats_fail_mode FROM gateway.project_budget WHERE project_id = $1`, projectID)
	var mode *string
	if err := row.Scan(&mode); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrNoBudgetRow
		}
		return "", fmt.Errorf("failmode: read fail-mode: %w", err)
	}
	if mode == nil {
		return "", nil
	}
	return *mode, nil
}

// PersistOutageDelta records a billed delta directly to the durable accumulator
// as an outage-window row (outage_mode=true) — the §8.5 "outage-window
// persistence" step. It runs off the response path (the caller spawns it in a
// short-lived goroutine) so a slow Postgres does not stall the /llm stream.
//
// It opens its own transaction: the UPSERT is idempotent under redelivery only
// via the event stream, so this direct write is intentionally at-least-once —
// the recovery reconciliation sums whatever landed. A commit failure is
// returned for the caller to log; the in-process degraded counter remains the
// authoritative per-replica bound while degraded.
func (s *Store) PersistOutageDelta(ctx context.Context, d OutageDelta) error {
	if err := d.validate(); err != nil {
		return err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.ExecAffected(ctx, outageUpsertSQL,
		d.ProjectID, d.OrgID, d.Scope, d.ScopeID,
		d.PeriodStart, d.PeriodEnd, d.DeltaNanoUSD,
	); err != nil {
		return fmt.Errorf("failmode: persist outage delta: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failmode: commit outage delta: %w", err)
	}
	return nil
}

// OutageDelta is a billed increment persisted to the durable tier while NATS is
// down (§8.5). It mirrors the write-behind BudgetDelta's key fields so the same
// accumulator row is targeted; the write-back guard keeps the two writers off
// each other's rows.
type OutageDelta struct {
	ProjectID    int
	OrgID        *int
	Scope        string
	ScopeID      string
	PeriodStart  int64
	PeriodEnd    int64
	DeltaNanoUSD int64
}

func (d OutageDelta) validate() error {
	switch {
	case d.ProjectID < 1:
		return fmt.Errorf("failmode: non-positive project_id %d", d.ProjectID)
	case d.Scope == "":
		return errors.New("failmode: empty scope")
	case d.ScopeID == "":
		return errors.New("failmode: empty scope_id")
	case d.PeriodStart <= 0:
		return fmt.Errorf("failmode: non-positive period_start %d", d.PeriodStart)
	case d.PeriodEnd <= d.PeriodStart:
		return fmt.Errorf("failmode: period_end %d not after period_start %d", d.PeriodEnd, d.PeriodStart)
	}
	return nil
}

// durationFromSeconds converts a fractional-seconds age to a time.Duration,
// guarding against a NaN/Inf from a NULL last_updated slipping through.
func durationFromSeconds(sec float64) time.Duration {
	if math.IsNaN(sec) || math.IsInf(sec, 0) || sec < 0 {
		return 0
	}
	return time.Duration(sec * float64(time.Second))
}
