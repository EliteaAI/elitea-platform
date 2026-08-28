package llmproxy

// budget_plane.go — the atomic indirection that lets budget enforcement be
// installed on a handler that ALREADY serves requests (issue #315).
//
// Why it exists. server.New dials NATS exactly once. nats.go only resurrects a
// connection that succeeded at least once, so a gateway that starts while NATS
// is unreachable has no budget gate for the whole life of the process. Issue
// #304 made that state visible (the pod reports not ready); it did not make the
// gateway recover. Recovery needs the gate to reach a request path that is
// already running, and the gate was a plain struct field that the money path
// read with no synchronisation. A late write to that field was a data race on
// billing — a non-deterministic failure that lands on money, which is worse
// than never recovering.
//
// The whole NATS budget path is therefore published as ONE immutable value
// behind ONE atomic pointer:
//
//   - A reader calls h.budget() once, then uses the fields of the snapshot it
//     gets back. It never re-reads inside the same operation, so it can never
//     mix a gate with a calculator that never shipped with it.
//   - A writer builds a NEW value and stores the pointer. It never mutates a
//     value that a reader can hold.
//
// No lock reaches the request path.
//
// The install is MONOTONIC: InstallBudgetEnforcement publishes a gate exactly
// once and refuses to replace or remove one. That invariant is load-bearing —
// it is what makes the per-function snapshots above safe for a request that
// spans several functions (admission, then billing, then the soft alert). An
// operation that starts with no gate and ends with one bills spend that really
// happened; an operation that could lose its gate half way would not.

// budgetPlane is the immutable set of collaborators the NATS budget path
// supplies. A nil field means that one part is not wired, and every read site
// tests the field it uses. The zero value is the posture of a gateway with no
// enforcement at all.
type budgetPlane struct {
	// gate is the pre-LLM admission gate (design §8.5, BF0.9b). nil means the
	// gate is disabled — skip all budget enforcement. This keeps existing tests
	// that build a Handler without governance wired up passing.
	gate BudgetChecker
	// calc converts the response's token counts into a billed amount in
	// nano-USD. Post-completion only — admission passes no estimate (issue
	// #10). Required when gate is non-nil; ignored (and may be nil) otherwise.
	calc CostEstimator
	// alerts publishes budget.soft_alert to gateway.events.* when the 80% soft
	// alert fires (spec §8.3). nil = publishing disabled.
	alerts AlertEventPublisher
	// ops publishes operator-only events (budget.unbilled_stream) onto
	// gateway.events.ops.*. Deliberately NOT alerts: the loss record must not
	// reach the tenant-facing project channel, where it would tell a project in
	// real time which of its streams went unbilled (gateway-review).
	// nil = publishing disabled (the WARN log remains).
	ops OpsEventPublisher
	// usage supplies the CEL `budget_used` variable to routing rules. nil
	// resolves it to 0.
	usage BudgetUsageReader
}

// noBudgetPlane is what a handler with nothing wired reads. h.budget() returns
// it instead of nil, so every call site stays a plain field test — `p.gate ==
// nil` reads exactly like the field it replaces.
var noBudgetPlane = &budgetPlane{}

// budget returns the budget path in force at this instant.
//
// Call it ONCE per operation and use the returned snapshot. Two loads in one
// operation can straddle an install, which is the one way this indirection
// could still produce an inconsistent pair.
func (h *Handler) budget() *budgetPlane {
	if p := h.budgetRef.Load(); p != nil {
		return p
	}
	return noBudgetPlane
}

// mutateBudget publishes a MODIFIED COPY of the current plane. The copy is what
// keeps the published value immutable: a reader that already holds the old
// pointer keeps a consistent view for its whole operation.
//
// The HandlerOption functions use it at construction, where nothing else runs.
// installMu is for the post-construction writer.
func (h *Handler) mutateBudget(fn func(*budgetPlane)) {
	h.installMu.Lock()
	defer h.installMu.Unlock()
	next := *h.budget()
	fn(&next)
	h.budgetRef.Store(&next)
}

// BudgetEnforcement is the NATS budget path a late install publishes. It is the
// same set of collaborators the HandlerOption functions wire at construction,
// named as one value because a re-dial produces all of them together.
//
// Gate is required. Every other field is optional and a nil one leaves whatever
// is already published in place, which is what a gateway with a database but no
// NATS needs: the authored governance plane wires itself at construction and
// must not be dropped by a later budget install.
type BudgetEnforcement struct {
	// Gate is the pre-LLM admission gate. Install refuses a nil Gate.
	Gate BudgetChecker
	// Calc prices a completed request. It is required for billing to happen;
	// a nil Calc leaves the gate admitting requests that bill nothing.
	Calc CostEstimator
	// Alerts publishes budget.soft_alert (tenant-facing).
	Alerts AlertEventPublisher
	// Ops publishes budget.unbilled_stream (operator-only).
	Ops OpsEventPublisher
	// Usage supplies the CEL budget_used variable to authored routing rules.
	Usage BudgetUsageReader
}

// InstallBudgetEnforcement publishes budget enforcement onto a handler that is
// already serving requests. It answers the recovery half of issue #315: a
// gateway that booted while NATS was unreachable installs the gate here when a
// later dial succeeds.
//
// It returns true when this call published the gate. It returns false, and
// changes nothing, in two cases:
//
//   - e.Gate is nil. This method NEVER removes enforcement. Turning the gate
//     off on a running gateway is a fail-open change of policy, and it is not
//     something a transport error may decide.
//   - A gate is already installed. Enforcement is installed ONCE. A second
//     install would swap the gate under in-flight requests, and the caller
//     that loses the race must stop retrying rather than keep replacing.
//
// It is safe to call from any goroutine, and safe to call concurrently with
// live request traffic. That is the whole point of it.
func (h *Handler) InstallBudgetEnforcement(e BudgetEnforcement) bool {
	if e.Gate == nil {
		return false
	}
	h.installMu.Lock()
	defer h.installMu.Unlock()
	cur := h.budget()
	if cur.gate != nil {
		return false
	}
	next := *cur
	next.gate = e.Gate
	next.calc = e.Calc
	if e.Alerts != nil {
		next.alerts = e.Alerts
	}
	if e.Ops != nil {
		next.ops = e.Ops
	}
	if e.Usage != nil {
		next.usage = e.Usage
	}
	h.budgetRef.Store(&next)
	return true
}

// BudgetEnforcementInstalled reports whether a budget gate is in force. The
// composition root reads it to stop a recovery loop and to re-arm the readiness
// probe; a test reads it to tell "installed" from "refused".
func (h *Handler) BudgetEnforcementInstalled() bool {
	return h.budget().gate != nil
}
