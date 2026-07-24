package failmode

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"runtime"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/sony/gobreaker/v2"
)

// runtimeStack is an alias for runtime.Stack used by the panic-recovery handler.
var runtimeStack = runtime.Stack

// Counter is the recovered-NATS side the reconciler replays onto (design §8.5
// step 2). It is the subset of the gateway NATS client the recovery path needs;
// tests inject a fake so the three-phase reconciliation is verifiable offline.
type Counter interface {
	// ReadBudget returns the authoritative running total (nano-USD) for subject.
	ReadBudget(ctx context.Context, subject string) (int64, error)
	// IncrBudgetIdempotent adds deltaNano with a reused Nats-Msg-Id so a retry
	// after a crash is deduped inside the stream duplicate window. applied is
	// false when the increment was a suppressed duplicate.
	IncrBudgetIdempotent(ctx context.Context, subject, eventID string, deltaNano int64) (total int64, applied bool, err error)
	// BudgetSubject builds the counter subject for a scope/period; the reconciler
	// uses the client's own formatter so the subject matches the request path.
	BudgetSubject(scope, scopeID string, periodStartUnix int64) string
}

// selectOutageRowsSQL locks the outage-window rows this recovery pass will
// reconcile (design §8.5 step 1). SKIP LOCKED lets each replica that recovers
// grab a disjoint, non-blocking subset; because there is exactly one accumulator
// row per (scope, scope_id, period_start), whichever replica wins the lock
// reconciles that scope's entire shared outage spend, and the losers no-op.
// reconciliation_in_progress is the crash marker set under the lock.
//
// accumulated_cost (USD NUMERIC) is scaled to nano-USD in SQL so the replay
// arithmetic stays int64 and matches the NATS counter denomination.
//
// $1 = NanoUSD scale factor.
const selectOutageRowsSQL = `SELECT
		id,
		scope,
		scope_id,
		EXTRACT(EPOCH FROM period_start)::bigint       AS period_start_unix,
		(accumulated_cost * $1)::bigint                AS accumulated_nano
	FROM gateway.llm_budget_accumulators
	WHERE outage_mode = true AND reconciled = false
	FOR UPDATE SKIP LOCKED`

// markInProgressSQL sets the crash marker on a locked row (design §8.5 step 1).
const markInProgressSQL = `UPDATE gateway.llm_budget_accumulators
	SET reconciliation_in_progress = true
	WHERE id = $1`

// finalizeRowSQL closes out a reconciled row in the SAME transaction as the lock
// (design §8.5 step 3): the row rejoins the healthy write-back path
// (outage_mode=false) and is flagged reconciled so a later recovery pass skips
// it and the write-back consumer resumes owning it.
const finalizeRowSQL = `UPDATE gateway.llm_budget_accumulators
	SET reconciled = true,
	    outage_mode = false,
	    reconciliation_in_progress = false,
	    last_updated = now()
	WHERE id = $1`

// Reconciler runs the breaker-driven recovery reconciliation (design §8.5). It
// is wired to the NATS client's OnBreakerStateChange; on the transition back to
// CLOSED it launches a single one-shot pass that replays outage spend onto the
// recovered counter and resets the per-replica degraded counters.
type Reconciler struct {
	db       DB
	counter  Counter
	degraded *DegradedCounters
	log      *slog.Logger

	// scopeTimeout bounds each per-scope three-phase reconcile so a slow
	// Postgres or NATS cannot wedge the recovery goroutine.
	scopeTimeout time.Duration

	// baseCtx is the service-lifetime context the pass derives from; set by Start.
	mu      sync.Mutex
	baseCtx context.Context
	running bool
}

// NewReconciler builds a Reconciler over the given seams. A nil logger is
// replaced with a discard logger so callers need not guard every log call.
func NewReconciler(db DB, counter Counter, degraded *DegradedCounters, log *slog.Logger) *Reconciler {
	if log == nil {
		log = slog.New(slog.NewTextHandler(discard{}, nil))
	}
	return &Reconciler{
		db:           db,
		counter:      counter,
		degraded:     degraded,
		log:          log,
		scopeTimeout: 5 * time.Second,
	}
}

// Start binds the service-lifetime context the reconciliation passes derive
// from. It MUST be called before the breaker can fire (i.e. before serving).
func (r *Reconciler) Start(ctx context.Context) {
	r.mu.Lock()
	r.baseCtx = ctx
	r.mu.Unlock()
}

// HandleBreakerChange is registered with Client.OnBreakerStateChange. It fires a
// recovery pass on the edge back to CLOSED (open/half-open → closed), which is
// the "NATS recovered" signal (design §8.5: driven by breaker state, not a
// timer). Transitions that are not a recovery edge are ignored.
func (r *Reconciler) HandleBreakerChange(from, to gobreaker.State) {
	if to != gobreaker.StateClosed || from == gobreaker.StateClosed {
		return
	}
	r.mu.Lock()
	if r.running || r.baseCtx == nil {
		// Coalesce: a pass is already in flight (or we are not started yet). The
		// in-flight pass drains every outstanding outage row, so a flurry of
		// breaker flaps needs only one pass.
		r.mu.Unlock()
		return
	}
	r.running = true
	ctx := r.baseCtx
	r.mu.Unlock()

	go func() {
		defer func() {
			if rec := recover(); rec != nil {
				// A panic in runPass/reconcileScope must not crash the gateway.
				// Log with stack and return — the running flag is cleared below so a
				// subsequent breaker edge can launch a fresh pass.
				buf := make([]byte, 4096)
				n := runtimeStack(buf, false)
				r.log.Error("failmode recovery: panic in recovery goroutine",
					slog.Any("panic", rec),
					slog.String("stack", string(buf[:n])))
			}
			r.mu.Lock()
			r.running = false
			r.mu.Unlock()
		}()
		r.runPass(ctx)
	}()
}

// runPass reconciles every outstanding outage scope, then resets the per-replica
// degraded counters (design §8.5: reset AFTER the replay is confirmed so the cap
// keeps gating until the authoritative counter is current). If any scope fails
// to reconcile, the degraded counters are left intact so this replica keeps
// enforcing the cap until a later recovery edge retries.
func (r *Reconciler) runPass(ctx context.Context) {
	reconciled, failed := r.reconcileAll(ctx)
	if failed == 0 {
		// All outstanding outage spend is now on the authoritative counter; the
		// per-replica overspend cap can stand down.
		r.degraded.ResetAll()
		r.log.Info("failmode recovery: reconciliation complete",
			slog.Int("scopes_reconciled", reconciled))
		return
	}
	r.log.Warn("failmode recovery: reconciliation incomplete; degraded caps retained",
		slog.Int("scopes_reconciled", reconciled),
		slog.Int("scopes_failed", failed))
}

// outageRow is one locked outage-window accumulator row.
type outageRow struct {
	id              string
	scope           string
	scopeID         string
	periodStartUnix int64
	accumulatedNano int64
}

// reconcileAll drains and reconciles every currently-lockable outage row,
// returning the counts of reconciled and failed scopes. Each scope is processed
// in its own bounded transaction so one slow/failed scope does not abort the
// others.
func (r *Reconciler) reconcileAll(ctx context.Context) (reconciled, failed int) {
	rows, err := r.lockOutageRows(ctx)
	if err != nil {
		r.log.Error("failmode recovery: lock outage rows", slog.Any("err", err))
		// Could not even enumerate; treat as one failure so caps are retained.
		return 0, 1
	}
	for _, row := range rows {
		if err := r.reconcileScope(ctx, row); err != nil {
			r.log.Error("failmode recovery: reconcile scope failed",
				slog.String("scope", row.scope),
				slog.String("scope_id", row.scopeID),
				slog.Any("err", err))
			failed++
			continue
		}
		// Reset this scope's per-replica counter now that its outage spend is on
		// the authoritative counter (design §8.5, per-scope confirmation).
		r.degraded.Reset(r.counter.BudgetSubject(row.scope, row.scopeID, row.periodStartUnix))
		reconciled++
	}
	return reconciled, failed
}

// lockOutageRows opens a short-lived transaction, SELECT … FOR UPDATE SKIP
// LOCKED the outage rows, sets the in-progress marker on each, and commits so
// the enumeration itself does not hold locks across the (slower) per-scope NATS
// replay. Each scope re-locks its own row in reconcileScope. Committing the
// marker here is safe: a crash after this commit leaves marked-but-unreconciled
// rows, which the next recovery edge re-selects (the marker is advisory, not a
// skip predicate).
func (r *Reconciler) lockOutageRows(ctx context.Context) ([]outageRow, error) {
	cctx, cancel := context.WithTimeout(ctx, r.scopeTimeout)
	defer cancel()

	tx, err := r.db.Begin(cctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(cctx) }()

	rs, err := tx.Query(cctx, selectOutageRowsSQL, NanoUSD)
	if err != nil {
		return nil, fmt.Errorf("select outage rows: %w", err)
	}
	var out []outageRow
	for rs.Next() {
		var row outageRow
		if err := rs.Scan(&row.id, &row.scope, &row.scopeID, &row.periodStartUnix, &row.accumulatedNano); err != nil {
			rs.Close()
			return nil, fmt.Errorf("scan outage row: %w", err)
		}
		out = append(out, row)
	}
	rs.Close()
	if err := rs.Err(); err != nil {
		return nil, fmt.Errorf("iterate outage rows: %w", err)
	}

	for _, row := range out {
		if _, err := tx.ExecAffected(cctx, markInProgressSQL, row.id); err != nil {
			return nil, fmt.Errorf("mark in-progress: %w", err)
		}
	}
	if err := tx.Commit(cctx); err != nil {
		return nil, fmt.Errorf("commit markers: %w", err)
	}
	return out, nil
}

// reconcileScope performs the crash-safe three-phase reconcile for one scope
// (design §8.5):
//
//  1. Re-lock the row (FOR UPDATE) and re-read its authoritative accumulated
//     nano so the replay amount reflects the latest durable spend.
//  2. Read the recovered NATS counter and replay ONLY the outage delta
//     (accumulated − counter) with a reused, amount-derived event_id. Because
//     NATS was frozen at the pre-outage total while down, this delta is exactly
//     the outage-window spend; recomputing it from live state each attempt makes
//     the replay naturally idempotent (a re-run after a committed increment reads
//     the higher counter and computes 0), and the reused Nats-Msg-Id covers the
//     lost-ack case.
//  3. In the SAME transaction, finalize the row (reconciled=true,
//     outage_mode=false) and commit.
//
// A negative delta (PG behind NATS due to write-back lag) is clamped to zero and
// the row is still finalized — there is nothing to add, and leaving it in the
// outage state would strand it.
func (r *Reconciler) reconcileScope(ctx context.Context, row outageRow) error {
	cctx, cancel := context.WithTimeout(ctx, r.scopeTimeout)
	defer cancel()

	tx, err := r.db.Begin(cctx)
	if err != nil {
		return err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(cctx)
		}
	}()

	// Phase 1: re-lock and re-read the authoritative accumulated nano.
	var accumulatedNano int64
	if err := tx.QueryRow(cctx,
		`SELECT (accumulated_cost * $2)::bigint
		   FROM gateway.llm_budget_accumulators
		  WHERE id = $1 AND outage_mode = true AND reconciled = false
		  FOR UPDATE`, row.id, NanoUSD,
	).Scan(&accumulatedNano); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Row already reconciled by a concurrent replica between the enumerate
			// and here (its predicate no longer matches) — nothing to do.
			return nil
		}
		return fmt.Errorf("relock outage row: %w", err)
	}

	subject := r.counter.BudgetSubject(row.scope, row.scopeID, row.periodStartUnix)

	// Phase 2: read the recovered counter and replay only the outage delta.
	counterNano, err := r.counter.ReadBudget(cctx, subject)
	if err != nil {
		return fmt.Errorf("read recovered counter: %w", err)
	}
	replayNano := accumulatedNano - counterNano
	if replayNano > 0 {
		// Fix #3: include counterNano (the pre-recovery NATS baseline) in the
		// event ID so two distinct outages with the same delta within one
		// RecoveryDedupeWindow produce different IDs and are not dedup-collapsed.
		eventID := recoveryEventID(row.scope, row.scopeID, row.periodStartUnix, counterNano, replayNano)
		if _, _, err := r.counter.IncrBudgetIdempotent(cctx, subject, eventID, replayNano); err != nil {
			return fmt.Errorf("replay outage delta: %w", err)
		}
	}

	// Phase 3: finalize in the same transaction and commit.
	if _, err := tx.ExecAffected(cctx, finalizeRowSQL, row.id); err != nil {
		return fmt.Errorf("finalize reconciled row: %w", err)
	}
	if err := tx.Commit(cctx); err != nil {
		return fmt.Errorf("commit reconciliation: %w", err)
	}
	committed = true
	return nil
}

// recoveryEventID builds the reused Nats-Msg-Id for a scope's replay (design
// §8.5 step 2). It is stable across retries of the SAME replay attempt (so a
// lost-ack retry is deduped) because the counterNano baseline is fixed for the
// duration of the reconcile attempt. It is distinct across two DIFFERENT outages
// with the same delta within one RecoveryDedupeWindow because their pre-recovery
// NATS baselines (counterNano) differ — preventing the second outage's recovery
// increment from being silently suppressed as a duplicate (Fix #3).
//
// Format: recovery.<scope>.<scopeID>.<period>.<base>.<delta>
func recoveryEventID(scope, scopeID string, periodStartUnix, counterNano, replayNano int64) string {
	return fmt.Sprintf("recovery.%s.%s.%d.base%d.delta%d", scope, scopeID, periodStartUnix, counterNano, replayNano)
}

// discard is an io.Writer sink for the fallback no-op logger.
type discard struct{}

func (discard) Write(p []byte) (int, error) { return len(p), nil }
