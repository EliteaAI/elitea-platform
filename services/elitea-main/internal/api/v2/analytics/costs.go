package analytics

// analytics_costs — the LLM cost breakdown for a project.
//
//	GET /elitea_core/analytics_costs/prompt_lib/{projectID}
//	    ← legacy/plugins/elitea_core/api/v2/analytics_costs.py
//
// # Where the numbers come from, and where they do NOT
//
// gateway.llm_budget_accumulators, and nothing else. The LLM gateway publishes
// a billing delta per call onto the GATEWAY_BUDGET_DELTAS stream and
// elitea-scheduler's budgetwriteback consumer folds those deltas into that
// table (services/elitea-scheduler/internal/budgetwriteback). It is the
// platform's single accounting path, and issue 253 asked this endpoint to
// surface what that path writes rather than to resurrect the LiteLLM-era
// tables the pylon original read.
//
// It is also the same table /elitea_core/usage and /elitea_core/project_budget
// report from (issue 246). One source, three views: a figure here can never
// disagree with the one on the usage bar, because there is no second place for
// either of them to come from.
//
// # What the reference served that this cannot, and why it is ABSENT
//
// The pylon handler aggregated `centry.audit_events` rows — one row per LLM
// call, each carrying llm_cost, input_tokens, output_tokens, model_name, the
// caller and a trace_id it correlated back to an agent. So it could answer
// by_model, by_agent, by_user, a daily trend, a call count and an average cost
// per call. Those columns have no producer in this architecture: a
// GATEWAY_BUDGET_DELTAS delta carries {event_id, scope, scope_id, project_id,
// org_id, period_start, period_end, delta_nano_usd} and NOTHING else — no
// model, no user, no tokens, no call count (budgetwriteback/types.go), and the
// accumulator it lands in is one summed USD figure per (scope, scope_id,
// period_start).
//
// Those five views are therefore ABSENT from this response rather than present
// and zero. `by_model: []` renders as "this project called no models", which is
// a different and false claim; a missing key is one a client can detect and one
// a reviewer must look at. TestCostBreakdownOmitsTheDimensionsNothingProduces
// pins the absence, so the day a dimension-carrying producer lands, the test
// that fails is the one that says what this endpoint could not answer — the
// disclosure is machine-checked rather than a comment that goes stale.
//
// # Aggregation, and the double count that is deliberately not made
//
// `total_cost` sums PROJECT-scope rows only. The accumulator is keyed by
// (scope, scope_id, period_start) and the gateway bills the project scope
// today, but the table is designed to carry other scopes — a user-scope row
// for the same project would be a SUBSET of that project's spend, not an
// addition to it, so adding every row for a project would count the same
// dollars twice. Every scope present is still reported, under `by_scope`, so
// the narrower rows are visible without being summed into the headline.
// TestCostBreakdownDoesNotDoubleCountNarrowerScopes is that rule.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ViewPermission gates the route in internal/api/router.go, transcribed from
// analytics_costs.py's `check_api` — DEFAULT mode, project-scoped. The grant
// that makes it resolvable on a Go-bootstrapped database is seeded by
// migrations/shared/0063_trace_and_cost_read_permissions.sql.
//
// This is the one /analytics_* route that carries a gate, and the difference is
// not an oversight in either direction: its neighbours answer with counts and
// zero-filled KPI stubs, while this one answers with money. The reference gates
// it too.
const ViewPermission = "models.monitoring.tracing.view"

// Date-window bounds, transcribed from legacy/plugins/elitea_core/utils/
// constants.py. The clamp is what stops an unbounded window from returning an
// unbounded number of period rows.
const (
	defaultDateRangeDays = 7
	maxDateRangeDays     = 366
)

// budgetScopeProject is the accumulator scope the gateway bills against —
// llmproxy/budget_gate.go's `budgetScopeProject`. Its scope_id is the numeric
// project id as text.
const budgetScopeProject = "project"

// currency is the only currency the money path has. The gateway compares
// hard_limit_usd against a nano-USD counter and converts nowhere, so a figure
// labelled anything else would be a lie about the same number.
const currency = "USD"

// CostsHandler serves the cost breakdown straight from the pool. It is separate
// from Handler above because that one is built over an injected Repository of
// zero-filled stubs; this endpoint reads a real table and would have nothing to
// gain from being routed through it.
type CostsHandler struct {
	pool *pgxpool.Pool
	// now is the clock the default window ends at. Tests pin it; production
	// leaves it nil.
	now func() time.Time
}

// NewCostsHandler builds a CostsHandler over the shared pool.
func NewCostsHandler(pool *pgxpool.Pool) *CostsHandler { return &CostsHandler{pool: pool} }

// WithClock pins the clock the default date window is measured back from.
func (h *CostsHandler) WithClock(now func() time.Time) *CostsHandler {
	h.now = now
	return h
}

func (h *CostsHandler) clock() time.Time {
	if h.now == nil {
		return time.Now().UTC()
	}
	return h.now()
}

// costPeriod is one accumulator row: the durable tier's unit of accounting.
type costPeriod struct {
	Scope       string      `json:"scope"`
	ScopeID     string      `json:"scope_id"`
	PeriodStart time.Time   `json:"period_start"`
	PeriodEnd   time.Time   `json:"period_end"`
	TotalCost   json.Number `json:"total_cost"`
	LastUpdated time.Time   `json:"last_updated"`
	// PendingReconciliation marks a row the gateway's recovery goroutine still
	// owns (outage_mode AND NOT reconciled): the write-back consumer is barred
	// from it until reconciliation clears the flag, so the figure is the last
	// durable one and not necessarily the current one. Reporting the number
	// without the flag would present a knowingly-stale total as settled.
	PendingReconciliation bool `json:"pending_reconciliation"`
}

// scopeTotal is the per-scope roll-up.
type scopeTotal struct {
	Scope     string      `json:"scope"`
	TotalCost json.Number `json:"total_cost"`
}

// Costs serves analytics_costs.py's prompt_lib GET.
func (h *CostsHandler) Costs(w http.ResponseWriter, r *http.Request) {
	projectID, err := strconv.ParseInt(chi.URLParam(r, "projectID"), 10, 64)
	if err != nil || projectID < 1 {
		writeJSON(w, http.StatusBadRequest,
			map[string]any{"error": "project id must be a positive integer"})
		return
	}
	from, to := h.dateWindow(r)

	periods, err := h.periods(r.Context(), projectID, from, to)
	if err != nil {
		// Not an empty breakdown: "no spend" and "the query failed" must not
		// render as the same screen.
		writeJSON(w, http.StatusInternalServerError,
			map[string]any{"error": "failed to query analytics costs"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"kpis":      kpis(periods, from, to),
		"periods":   periods,
		"by_scope":  scopeTotals(periods),
		"date_from": from,
		"date_to":   to,
	})
}

// dateWindow reproduces the reference's _parse_dates: an unparseable or missing
// bound falls back, a window given by neither bound is the last
// defaultDateRangeDays, and a span wider than maxDateRangeDays is clamped from
// the far end.
func (h *CostsHandler) dateWindow(r *http.Request) (from, to time.Time) {
	query := r.URL.Query()
	parsedFrom, hasFrom := parseDate(query.Get("date_from"))
	parsedTo, hasTo := parseDate(query.Get("date_to"))

	switch {
	case !hasFrom && !hasTo:
		to = h.clock()
		from = to.AddDate(0, 0, -defaultDateRangeDays)
	case !hasFrom:
		to = parsedTo
		from = to.AddDate(0, 0, -defaultDateRangeDays)
	case !hasTo:
		from = parsedFrom
		to = h.clock()
	default:
		from, to = parsedFrom, parsedTo
	}
	if to.Sub(from) > maxDateRangeDays*24*time.Hour {
		from = to.AddDate(0, 0, -maxDateRangeDays)
	}
	return from.UTC(), to.UTC()
}

func parseDate(raw string) (time.Time, bool) {
	if raw == "" {
		return time.Time{}, false
	}
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02T15:04:05", "2006-01-02"} {
		if parsed, err := time.Parse(layout, raw); err == nil {
			return parsed, true
		}
	}
	return time.Time{}, false
}

// periods reads every accumulator row for the project whose period OVERLAPS the
// window.
//
// Overlap, not containment: an accumulator period is a whole billing month, so
// a seven-day default window is inside one rather than around it, and asking
// for rows contained in the window would answer "no spend" for every default
// request. The bounds are half-open on both sides (period_start < to AND
// period_end > from) so two adjacent periods cannot both match an instant.
func (h *CostsHandler) periods(
	ctx context.Context, projectID int64, from, to time.Time,
) ([]costPeriod, error) {
	const statement = `
SELECT scope, scope_id, period_start, period_end,
       accumulated_cost::text, last_updated,
       (outage_mode AND NOT reconciled) AS pending_reconciliation
FROM gateway.llm_budget_accumulators
WHERE project_id = $1
  AND period_start < $2
  AND period_end > $3
ORDER BY period_start ASC, scope ASC, scope_id ASC`

	rows, err := h.pool.Query(ctx, statement, projectID, to, from)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	periods := []costPeriod{}
	for rows.Next() {
		var period costPeriod
		var cost string
		if err := rows.Scan(
			&period.Scope, &period.ScopeID, &period.PeriodStart, &period.PeriodEnd,
			&cost, &period.LastUpdated, &period.PendingReconciliation,
		); err != nil {
			return nil, err
		}
		// The exact NUMERIC PostgreSQL produced, carried as a JSON number
		// without a float64 round trip: 0.10 must not come back as
		// 0.10000000000000001 on a money path.
		period.TotalCost = json.Number(cost)
		periods = append(periods, period)
	}
	return periods, rows.Err()
}

// kpis is the headline: the project-scope total over the window, and enough
// metadata for a client to tell "nothing was spent" from "nothing was
// persisted".
func kpis(periods []costPeriod, from, to time.Time) map[string]any {
	total := newDecimalSum()
	counted := 0
	for _, period := range periods {
		if period.Scope != budgetScopeProject {
			continue
		}
		total.add(period.TotalCost)
		counted++
	}
	return map[string]any{
		"total_cost": total.value(),
		"currency":   currency,
		"periods":    counted,
		// False when the write-back path has persisted nothing for this project
		// in this window. The reference had no equivalent because an audit-event
		// query cannot tell the two apart; issue 246's surface reports the same
		// distinction under the same name.
		"spend_available": counted > 0,
		"window_days":     int(to.Sub(from).Hours() / 24),
	}
}

// scopeTotals rolls the window up per scope, in the order the scopes were read.
func scopeTotals(periods []costPeriod) []scopeTotal {
	order := []string{}
	sums := map[string]*decimalSum{}
	for _, period := range periods {
		sum, seen := sums[period.Scope]
		if !seen {
			sum = newDecimalSum()
			sums[period.Scope] = sum
			order = append(order, period.Scope)
		}
		sum.add(period.TotalCost)
	}
	totals := make([]scopeTotal, 0, len(order))
	for _, scope := range order {
		totals = append(totals, scopeTotal{Scope: scope, TotalCost: sums[scope].value()})
	}
	return totals
}

/* ── exact addition ────────────────────────────────────────────────────── */

// decimalSum adds NUMERIC-shaped decimal strings without going through
// float64.
//
// The values come out of PostgreSQL as NUMERIC(20,8) text and go back onto the
// wire as JSON numbers; parsing them into a float64 to add them would reintroduce
// exactly the rounding the whole money path — nano-USD counters, NUMERIC
// columns, in-SQL conversion — exists to avoid. Scaled int64 nano-USD is the
// denomination the gateway already counts in, and the accumulator's eight
// decimal places fit inside nine.
type decimalSum struct {
	nano int64
}

func newDecimalSum() *decimalSum { return &decimalSum{} }

func (d *decimalSum) add(value json.Number) {
	d.nano += nanoUSD(value.String())
}

// value renders the running total back as a fixed-point decimal string. It is
// emitted with eight decimal places, matching the accumulator column, so a sum
// and the row it came from are the same literal.
func (d *decimalSum) value() json.Number {
	negative := d.nano < 0
	magnitude := d.nano
	if negative {
		magnitude = -magnitude
	}
	whole := magnitude / nanoPerUSD
	fraction := (magnitude % nanoPerUSD) / 10 // nano → 8 decimal places
	rendered := fmt.Sprintf("%d.%08d", whole, fraction)
	if negative {
		rendered = "-" + rendered
	}
	return json.Number(rendered)
}

const nanoPerUSD = 1000000000

// nanoUSD parses a NUMERIC-shaped decimal into scaled nano-USD. A value the
// database could not have produced parses as zero rather than panicking; every
// caller here is reading a NUMERIC column.
func nanoUSD(raw string) int64 {
	negative := false
	if len(raw) > 0 && (raw[0] == '-' || raw[0] == '+') {
		negative = raw[0] == '-'
		raw = raw[1:]
	}
	whole, fraction, _ := cutByte(raw, '.')
	units, err := strconv.ParseInt(whole, 10, 64)
	if err != nil && whole != "" {
		return 0
	}
	// Pad or truncate the fraction to nine digits so "1.5" and "1.500000000"
	// scale identically.
	for len(fraction) < 9 {
		fraction += "0"
	}
	fraction = fraction[:9]
	fractional, err := strconv.ParseInt(fraction, 10, 64)
	if err != nil {
		return 0
	}
	total := units*nanoPerUSD + fractional
	if negative {
		return -total
	}
	return total
}

func cutByte(value string, separator byte) (before, after string, found bool) {
	for index := 0; index < len(value); index++ {
		if value[index] == separator {
			return value[:index], value[index+1:], true
		}
	}
	return value, "", false
}
