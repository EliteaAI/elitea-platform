package failmode

import (
	"context"
	"errors"
	"expvar"
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

// countOutageRowsSQL counts every accumulator row the recovery pass still owns
// (issue #515). It is the observability read behind MetricBudgetOutageRows, and
// it is deliberately NOT the enumerate query: it takes no lock and no SKIP
// LOCKED, so every replica reports the same fleet-wide number instead of the
// subset it happened to lock. The predicate matches the partial index
// idx_accumulators_outage_unreconciled, so the count is an index-only probe.
const countOutageRowsSQL = `SELECT count(*) FROM gateway.llm_budget_accumulators
	WHERE outage_mode = true AND reconciled = false`

// RecoverySweepInterval is how often each replica runs a recovery pass that no
// breaker edge asked for (issue #515).
//
// The breaker edge alone is not enough, and that is the whole defect: a single
// NATS operation timeout maps to ErrUnavailable, takes the outage branch and
// marks the row outage-owned, but ONE failure is below the breaker's
// consecutive-failure threshold. The breaker never opens, so it never closes,
// so the edge never fires and nothing clears the row. The same gap opens after
// a restart: a replica that inherits outage rows written by a previous process
// starts with a CLOSED breaker and sees no edge either.
//
// It is a compiled constant rather than a setting, for the reason
// budgetwriteback.RetentionWindow is one: no deployment can set it to a value
// that never sweeps, and no values file can drift from it. 30 s bounds how long
// a wedged row can hold back durable spend, and a pass over zero outage rows is
// one indexed probe.
const RecoverySweepInterval = 30 * time.Second

// Metric names published by this package and served on GET /metrics through the
// composition root's allowlist (issue #465). The names live here, in the
// package that publishes them, so the scrape surface reaches them through one
// named path instead of a string copied into a second file.
const (
	// MetricBudgetOutageRows is the count of accumulator rows the gateway
	// recovery pass still owns. A row is counted while outage_mode is true and
	// reconciled is false: the write-back consumer is barred from it, so the
	// durable spend for that scope does not advance. A value that stays above
	// zero across several scrapes is the wedge of issue #515.
	MetricBudgetOutageRows = "gateway_budget_outage_rows"
	// MetricBudgetRecoveryFailuresTotal counts the scopes a recovery pass could
	// not reconcile. It rises while NATS or Postgres refuses the replay, which
	// is the correct behaviour (the row must stay outage-owned until the spend
	// is on the authoritative counter) and the condition an operator must see.
	MetricBudgetRecoveryFailuresTotal = "gateway_budget_recovery_failures_total"
)

var (
	outageRowsGauge        = expvar.NewInt(MetricBudgetOutageRows)
	recoveryFailuresMetric = expvar.NewInt(MetricBudgetRecoveryFailuresTotal)
)

// RecoveryMetricNames returns the names above in a fixed order. The composition
// root reads this list to build the /metrics allowlist.
func RecoveryMetricNames() []string {
	return []string{MetricBudgetOutageRows, MetricBudgetRecoveryFailuresTotal}
}

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

	// sweepInterval is the cadence of the breaker-independent recovery sweep
	// (issue #515). Start launches the ticker; tests set it directly.
	sweepInterval time.Duration

	// baseCtx is the service-lifetime context the pass derives from; set by Start.
	mu      sync.Mutex
	baseCtx context.Context
	running bool
	// sweepStarted stops a second Start from launching a second ticker.
	sweepStarted bool
	// natsHealthy reports whether the authoritative counter is reachable. It is
	// wired from the NATS breaker state by the GovernanceStore. Nil means
	// "always attempt", which is what the unit tests and the offline harness
	// want.
	natsHealthy func() bool
}

// NewReconciler builds a Reconciler over the given seams. A nil logger is
// replaced with a discard logger so callers need not guard every log call.
func NewReconciler(db DB, counter Counter, degraded *DegradedCounters, log *slog.Logger) *Reconciler {
	if log == nil {
		log = slog.New(slog.NewTextHandler(discard{}, nil))
	}
	return &Reconciler{
		db:            db,
		counter:       counter,
		degraded:      degraded,
		log:           log,
		scopeTimeout:  5 * time.Second,
		sweepInterval: RecoverySweepInterval,
	}
}

// SetHealthCheck wires the predicate the sweep consults before it attempts a
// recovery pass (issue #515). The GovernanceStore supplies the NATS breaker
// state: while the breaker is not closed the replay phase would fail on every
// row, and the row MUST stay outage-owned until the outage spend is on the
// authoritative counter. Skipping the pass is therefore the correct answer, not
// a shortcut — and it also keeps the sweep from writing the crash marker on
// every tick of a long outage.
func (r *Reconciler) SetHealthCheck(fn func() bool) {
	r.mu.Lock()
	r.natsHealthy = fn
	r.mu.Unlock()
}

// Start binds the service-lifetime context the reconciliation passes derive
// from and launches the recovery sweep (issue #515). It MUST be called before
// the breaker can fire (i.e. before serving). A second call rebinds the context
// but does not launch a second sweep.
func (r *Reconciler) Start(ctx context.Context) {
	r.mu.Lock()
	r.baseCtx = ctx
	launch := !r.sweepStarted && r.sweepInterval > 0
	r.sweepStarted = r.sweepStarted || launch
	interval := r.sweepInterval
	r.mu.Unlock()
	if launch {
		go r.sweepLoop(ctx, interval)
	}
}

// sweepLoop runs a recovery pass every interval until ctx is done. It is the
// path that clears an outage row when no breaker edge occurs — the defect of
// issue #515 — and it reuses the SAME three-phase reconcile the edge uses, so
// the durable tier keeps its one recovery implementation.
func (r *Reconciler) sweepLoop(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.SweepOnce(ctx)
		}
	}
}

// SweepOnce runs one breaker-independent recovery pass and then refreshes the
// outage-row gauge. sweepLoop calls it on every tick; it is exported so a test
// can drive one deterministic pass without waiting on a timer.
//
// It does NOT call DegradedCounters.ResetAll, which the breaker-edge pass does.
// ResetAll is the "NATS just came back, stand the per-replica cap down" step,
// and it belongs to the edge. On a timer it would run on every quiet tick and
// could zero a degraded counter that a request added microseconds earlier,
// between this pass enumerating zero rows and the request's outage row landing.
// reconcileAll still resets each scope it actually reconciles.
//
// The gauge is refreshed whether or not the pass ran, so a gateway that skips
// recovery because NATS is down still reports how many rows are held.
func (r *Reconciler) SweepOnce(ctx context.Context) {
	defer func() {
		if rec := recover(); rec != nil {
			buf := make([]byte, 4096)
			n := runtimeStack(buf, false)
			r.log.Error("failmode recovery: panic in recovery sweep",
				slog.Any("panic", rec),
				slog.String("stack", string(buf[:n])))
		}
	}()
	if r.natsUp() && r.acquire() {
		// The lease is returned by a deferred release inside this closure, not
		// by the next statement: a panic in reconcileAll would otherwise leave
		// running set for the life of the process, and every later pass — sweep
		// and breaker edge alike — would coalesce onto a pass that had already
		// died.
		reconciled, failed := func() (int, int) {
			defer r.release()
			return r.reconcileAll(ctx)
		}()
		recoveryFailuresMetric.Add(int64(failed))
		if reconciled > 0 || failed > 0 {
			r.log.Info("failmode recovery: sweep pass complete",
				slog.Int("scopes_reconciled", reconciled),
				slog.Int("scopes_failed", failed))
		}
	}
	r.refreshOutageGauge(ctx)
}

// natsUp reports the wired health predicate, defaulting to true when none is set.
func (r *Reconciler) natsUp() bool {
	r.mu.Lock()
	fn := r.natsHealthy
	r.mu.Unlock()
	return fn == nil || fn()
}

// acquire takes the single-pass lease shared by the breaker edge and the sweep,
// so the two never reconcile at the same time on one replica. It reports false
// when a pass is already in flight.
//
// It does NOT require Start. Start owns the ticker and binds the context the
// breaker edge derives from; SweepOnce is handed its own context, and gating it
// on a bound baseCtx would make it a silent no-op for any caller that drives one
// deterministic pass.
func (r *Reconciler) acquire() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.running {
		return false
	}
	r.running = true
	return true
}

// release returns the single-pass lease.
func (r *Reconciler) release() {
	r.mu.Lock()
	r.running = false
	r.mu.Unlock()
}

// refreshOutageGauge publishes the current count of outage-owned rows
// (issue #515). It is the operator's view of the wedge, served on GET /metrics
// through the allowlist issue #465 added; it is not a second mechanism.
//
// A failed read leaves the previous value rather than writing 0: a gauge that
// falls to zero because Postgres is unreachable reads exactly like a gauge that
// falls to zero because the rows recovered, and this repository has lost
// controls to that confusion before.
func (r *Reconciler) refreshOutageGauge(ctx context.Context) {
	cctx, cancel := context.WithTimeout(ctx, r.scopeTimeout)
	defer cancel()
	var rows int64
	if err := r.db.QueryRow(cctx, countOutageRowsSQL).Scan(&rows); err != nil {
		r.log.Warn("failmode recovery: count outage rows", slog.Any("err", err))
		return
	}
	outageRowsGauge.Set(rows)
}

// HandleBreakerChange is registered with Client.OnBreakerStateChange. It fires a
// recovery pass on the edge back to CLOSED (open/half-open → closed), which is
// the "NATS recovered" signal (design §8.5: driven by breaker state, not a
// timer). Transitions that are not a recovery edge are ignored.
func (r *Reconciler) HandleBreakerChange(from, to gobreaker.State) {
	if to != gobreaker.StateClosed || from == gobreaker.StateClosed {
		return
	}
	// Coalesce: a pass is already in flight (or we are not started yet). The
	// in-flight pass drains every outstanding outage row, so a flurry of
	// breaker flaps needs only one pass. Unlike SweepOnce, this entry point
	// carries no context of its own, so it also needs Start to have bound one.
	r.mu.Lock()
	if r.running || r.baseCtx == nil {
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
			r.release()
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
