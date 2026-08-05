package llmproxy

// budget_gate.go — pre-LLM admission check and post-completion billing hooks
// wired into the /llm handler layer (design §8.5, BF0.9b).
//
// The gate is nil-safe: when Handler.budgetGate is nil every helper returns
// immediately so existing call sites that build a Handler without governance
// continue to work unchanged.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/maximhq/bifrost/core/schemas"

	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/failmode"
)

// billingCtxTimeout is the deadline for the background billing context used
// in updateUsage (FIX #18). A client disconnect must not cancel the billing
// increment, so we detach from the request context. 10 s is generous for a
// NATS KV operation but bounded so a stuck NATS connection does not hold the
// goroutine forever.
const billingCtxTimeout = 10 * time.Second

// budgetGateTimeout bounds the pre-LLM admission read. It exists because the
// streaming path passes a context.WithoutCancel-derived context (issue #9): the
// gate must stay bounded even when nothing upstream can cancel it.
const budgetGateTimeout = 10 * time.Second

// budgetScopeProject is the scope string used for project-level budget checks.
const budgetScopeProject = "project"

// perImageFallbackNano is the fixed per-image billing cost in nano-USD used
// when an image-generation response carries no token-based Usage field.
// $0.040 per image (40_000_000 nano-USD) matches the DALL·E 3 Standard
// 1024×1024 list price and is a conservative floor for image models that do
// not report token usage. This constant is intentionally NOT a catalog lookup:
// image models whose pricing is token-based will report Usage and go through
// the normal cost.Calculator path; this path only fires when Usage==nil.
const perImageFallbackNano int64 = 40_000_000

// inflightKey builds the sync.Map key for the per-project in-flight reservation
// counter (Fix round-3 #7). The key identifies a unique (scope, scopeID,
// billing-period) triple so concurrent requests in the same project+period
// share one counter.
func inflightKey(scopeID string, periodStart int64) string {
	return budgetScopeProject + ":" + scopeID + ":" + strconv.FormatInt(periodStart, 10)
}

// addInflight atomically adds delta to the per-project in-flight reservation
// and returns the new total. Uses a load-or-store idiom on a *atomic.Int64
// stored in h.inflightNano so no external lock is needed.
func (h *Handler) addInflight(scopeID string, periodStart, delta int64) int64 {
	key := inflightKey(scopeID, periodStart)
	v, _ := h.inflightNano.LoadOrStore(key, new(atomic.Int64))
	return v.(*atomic.Int64).Add(delta)
}

// billingPeriodStart returns the first second of the current calendar month in
// UTC as a Unix timestamp. Budget counters are keyed by this value (design §8,
// NATS counter subject format). A monthly period is a safe conservative
// assumption that aligns with the pylon accumulator design.
func billingPeriodStart(now time.Time) int64 {
	y, m, _ := now.UTC().Date()
	return time.Date(y, m, 1, 0, 0, 0, 0, time.UTC).Unix()
}

// billingPeriodEnd returns the last second of the current calendar month in UTC.
func billingPeriodEnd(now time.Time) int64 {
	y, m, _ := now.UTC().Date()
	// First second of the next month, minus one second.
	next := time.Date(y, m+1, 1, 0, 0, 0, 0, time.UTC)
	return next.Unix() - 1
}

// parseProjectID converts the string project ID from the identity headers into
// an int required by GovernanceStore. Returns -1 if the value is empty or
// non-numeric.
func parseProjectID(s string) int {
	if s == "" {
		return -1
	}
	n, err := strconv.Atoi(s)
	if err != nil || n <= 0 {
		return -1
	}
	return n
}

// checkBudget performs the pre-LLM admission check (design §8.5). It:
//  1. Returns (true, nil) immediately when the gate is disabled (nil).
//  2. Parses the project identity from the request; skips enforcement for
//     anonymous/unresolved projects (no ID ⇒ no budget row ⇒ treat as
//     unlimited, consistent with GovernanceStore's ErrNoBudgetRow path).
//  3. Estimates reqCostNano from prompt tokens via the cost Calculator.
//     Pre-flight: output tokens are unknown so we pass 0 — the FSM uses the
//     estimate for the FRESH_NEAR per-replica cap only, so passing 0 is
//     conservative (never over-gates). The actual cost is billed after the
//     response arrives.
//  4. Calls BudgetChecker.CheckBudget; on Block402 → writes HTTP 402; on
//     Block503 → writes HTTP 503; on Allow → returns (true, nil).
//
// Returns (proceed=true) when the caller should continue; (proceed=false) means
// the response has already been written and the caller must return immediately.
func (h *Handler) checkBudget(
	w http.ResponseWriter,
	ctx context.Context,
	provider string,
	model string,
	promptTokenEst int64,
) bool {
	// Circular-routing guard #2 (spec §2.6) runs BEFORE the budget gate and
	// regardless of whether budget enforcement is wired: a routing loop must
	// be contained even on a deployment without governance. The tuple key is
	// the caller-visible project + model; requests without a resolvable
	// project are not tracked (they cannot form a stable loop tuple).
	if h.loopGuard != nil && model != "" {
		if projectID := identityProjectFromCtx(ctx); projectID != "" {
			if ok, retryAfter := h.loopGuard.allow(projectID, model); !ok {
				h.logger.Warn("loop breaker: circuit open for (project, model) tuple — possible circular routing",
					"project_id", projectID, "model", model, "retry_after", retryAfter)
				w.Header().Set("Retry-After", strconv.FormatInt(int64(retryAfter/time.Second)+1, 10))
				writeError(w, http.StatusTooManyRequests, "rate_limit_error",
					"Too many requests for this (project, model) pair; possible circular routing. Retry later.",
					"rate_limit_exceeded")
				return false
			}
		}
	}

	if h.budgetGate == nil {
		return true
	}

	pid := parseProjectID(identityProjectFromCtx(ctx))
	if pid < 0 {
		// No resolvable project — treat as unlimited (no row = no cap).
		return true
	}
	scopeID := strconv.Itoa(pid)

	now := time.Now()
	periodStart := billingPeriodStart(now)

	// Pre-flight cost estimate: input tokens only (output unknown before call).
	// Passing 0 for output is intentional — see doc comment above.
	var reqCostNano int64
	if h.costCalc != nil && promptTokenEst > 0 {
		reqCostNano = h.costCalc.Cost(ctx, provider, model, promptTokenEst, 0).TotalNanoUSD
	}

	// Fix round-3 #7: include the cumulative in-flight reservation in the
	// admission check to bound the concurrent-admission window overshoot.
	//
	// Without this, N requests can pass admission simultaneously before any
	// async billing increment reaches NATS (each sees the same NATS counter
	// and is individually admitted). By adding the previous in-flight amount
	// to reqCostNano, CheckBudget sees the effective pending spend including
	// any concurrent admits that have not yet been billed.
	//
	// Concurrency protocol:
	//   1. Read the previous inflight total (before adding this request).
	//   2. Add this request's estimated cost to the in-flight counter.
	//   3. Pass (reqCostNano + prevInflight) to CheckBudget so the FSM's
	//      per-replica NEAR cap accounts for the full pending spend.
	//   4. Decrement the counter when billing completes (or is skipped).
	//
	// This is a best-effort local bound, not a distributed lock. The NATS
	// authoritative counter remains the ground truth.
	var prevInflight int64
	if reqCostNano > 0 {
		// Capture the pre-reservation total: add our cost, then subtract it to
		// get what was already in-flight before this request.
		newTotal := h.addInflight(scopeID, periodStart, reqCostNano)
		prevInflight = newTotal - reqCostNano
	}
	effectiveCostNano := reqCostNano + prevInflight

	// Bound the admission read. Streaming requests now hand this function a
	// context that is deliberately decoupled from the client (issue #9), so it
	// has neither a deadline nor a cancellation path: without this timeout a
	// stalled Postgres pool would park the handler goroutine forever, where it
	// previously unwound on client hangup. Fail-closed semantics are preserved
	// — a timeout surfaces as the existing 503 branch below.
	gateCtx, gateCancel := context.WithTimeout(ctx, budgetGateTimeout)
	dec, err := h.budgetGate.CheckBudget(gateCtx, pid, budgetScopeProject, scopeID, periodStart, effectiveCostNano)
	gateCancel()
	if err != nil {
		// A hard error from the gate is unexpected (the gate is designed to
		// degrade gracefully); treat it as a 503 to avoid silently bypassing
		// enforcement. Decrement the reservation since the request is blocked.
		if reqCostNano > 0 {
			h.addInflight(scopeID, periodStart, -reqCostNano)
		}
		h.logger.Error("budget gate: CheckBudget error; blocking request",
			"project_id", pid, "err", err)
		writeError(w, http.StatusServiceUnavailable, "service_unavailable",
			"budget service error; try again shortly", "nats_unavailable")
		return false
	}

	switch dec.Verdict {
	case failmode.Allow:
		// Fix round-3 #12: log at Info when the Allow decision comes from a
		// degraded (NATS-down) FSM state so operators can see that the gateway
		// is operating in fallback mode on a per-request basis. Only logged when
		// Degraded is set to avoid a log entry on every healthy-path request.
		if dec.Degraded {
			h.logger.Info("budget gate: degraded allow (NATS unavailable, fallback tier used)",
				"project_id", pid,
				"state", dec.State.String(),
				"cost_nano_est", reqCostNano,
			)
		}
		// Reservation stays in-flight until billing goroutine decrements it.
		return true
	case failmode.Block402:
		// Decrement the reservation: this request will not be billed.
		if reqCostNano > 0 {
			h.addInflight(scopeID, periodStart, -reqCostNano)
		}
		writeError(w, http.StatusPaymentRequired, "budget_exceeded",
			"project budget exhausted for this billing period", "insufficient_quota")
		return false
	case failmode.Block503:
		// Decrement the reservation: this request will not be billed.
		if reqCostNano > 0 {
			h.addInflight(scopeID, periodStart, -reqCostNano)
		}
		writeError(w, http.StatusServiceUnavailable, "service_unavailable",
			"budget service temporarily unavailable; try again shortly", "nats_unavailable")
		return false
	default:
		// Unknown verdict: fail open (log and proceed). Should never happen.
		h.logger.Warn("budget gate: unknown verdict; allowing request",
			"verdict", fmt.Sprintf("%v", dec.Verdict))
		return true
	}
}

// identityProjectFromCtx extracts the project ID string set on the
// BifrostContext by newContext (via schemas.BifrostContextKeyVirtualKey).
func identityProjectFromCtx(ctx context.Context) string {
	type bifrostCtx interface {
		Value(key any) any
	}
	if bc, ok := ctx.(bifrostCtx); ok {
		if v, ok2 := bc.Value(schemas.BifrostContextKeyVirtualKey).(string); ok2 {
			return v
		}
	}
	return ""
}

// updateUsage records the billed cost for a completed request onto the
// authoritative counter and publishes a write-behind delta. It is
// best-effort fire-and-forget: errors are logged but do not cause the
// response to fail (the provider has already been called; double-billing
// is worse than a missed update).
//
// FIX #18 (async off critical path): the actual billing increment is
// launched in a bounded goroutine on a fresh context so:
//  1. A client disconnect before the increment does not cancel it.
//  2. The HTTP response is written BEFORE waiting on the NATS round-trip.
//
// The counter increment MUST still happen even if the client disconnects —
// the goroutine uses context.Background() bounded by billingCtxTimeout, not
// the request context. This matches the streaming path, which already bills
// post-drain.
//
// FIX #15: after a successful UpdateUsage, the post-increment ratio is
// compared against the pre-increment snapshot's SoftAlertPct (default 80).
// The soft alert fires ONLY when the spend CROSSES the threshold (was below,
// now at-or-above) — not on every request. TryAlertCooldown deduplicates
// within the cooldown window.
//
// The caller supplies the usage from the response; tokens default to 0 when
// the response carries no usage field (e.g. streaming partial responses).
// It returns true when a billing goroutine was actually spawned for a non-zero
// cost. Callers that must NOT lose spend silently (the stream drain, which may
// be settling recovered provider usage while a graceful shutdown is refusing
// new billing goroutines) use this to meter the drop instead of returning as if
// billed. A false return therefore means one of: governance not wired,
// unresolvable project, zero cost, or the increment was refused.
func (h *Handler) updateUsage(
	ctx context.Context,
	provider string,
	model string,
	inputTokens, outputTokens int64,
	projectIDStr string,
) bool {
	if h.budgetGate == nil || h.costCalc == nil {
		return false
	}
	pid := parseProjectID(projectIDStr)
	if pid < 0 {
		return false
	}
	scopeID := strconv.Itoa(pid)
	now := time.Now()
	periodStart := billingPeriodStart(now)
	periodEnd := billingPeriodEnd(now)

	// Compute cost on the caller's goroutine using the cost calculator (no I/O).
	// Use a fresh context for the cost lookup so a client disconnect doesn't
	// abort even the cheap in-process price lookup.
	costCtx, costCancel := context.WithTimeout(context.Background(), billingCtxTimeout)
	defer costCancel()

	actualCost := h.costCalc.Cost(costCtx, provider, model, inputTokens, outputTokens)
	if actualCost.TotalNanoUSD <= 0 {
		return false // nothing to bill
	}

	return h.spawnBillingGoroutine(pid, scopeID, periodStart, periodEnd, actualCost.TotalNanoUSD)
}

// updateUsageDirect bills a pre-computed costNano amount (nano-USD) for the
// given project, bypassing the cost.Calculator. Used for image-generation
// responses where the provider does not report token usage (Fix round-3 #8):
// the caller has already counted the generated images and multiplied by
// perImageFallbackNano.
//
// If costNano <= 0 or the gate/store is absent the call is a no-op.
func (h *Handler) updateUsageDirect(
	ctx context.Context,
	projectIDStr string,
	costNano int64,
) bool {
	if h.budgetGate == nil || costNano <= 0 {
		return false
	}
	pid := parseProjectID(projectIDStr)
	if pid < 0 {
		return false
	}
	scopeID := strconv.Itoa(pid)
	now := time.Now()
	periodStart := billingPeriodStart(now)
	periodEnd := billingPeriodEnd(now)

	return h.spawnBillingGoroutine(pid, scopeID, periodStart, periodEnd, costNano)
}

// spawnBillingGoroutine is the shared inner billing path: it guards against
// Add-after-Wait (Fix round-3 #2), spawns the billing goroutine, and runs
// the soft-alert crossing check after a successful increment.
//
// FIX #27 (github issue #15): the pre-increment CheckBudget snapshot (needed
// only for the soft-alert crossing comparison in trySoftAlert) is read INSIDE
// the goroutine, after billCtx is created and before UpdateUsage runs. It used
// to run synchronously on the caller's (request) goroutine, which — despite
// FIX #18 moving the increment itself off the critical path — still added up
// to billingCtxTimeout of client-visible latency when the budget store was slow.
//
// Callers must have already validated costNano > 0.
// It returns false when the goroutine was NOT spawned (drain in progress), so a
// caller holding known, provider-reported spend can meter the drop rather than
// letting it vanish into a log line.
func (h *Handler) spawnBillingGoroutine(
	pid int,
	scopeID string,
	periodStart, periodEnd int64,
	costNano int64,
) bool {
	eventID := uuid.NewString()

	// Fix round-3 #2: guard against Add-after-Wait (billingClosing already set
	// by DrainBilling) and track in-flight goroutines so DrainBilling can wait.
	if h.billingClosing.Load() != 0 {
		// Drain in progress — skip spawning; decrement the in-flight reservation
		// and log so spend is not silently dropped.
		if costNano > 0 {
			h.addInflight(scopeID, periodStart, -costNano)
		}
		h.logger.Warn("budget gate: billing goroutine skipped (drain in progress); spend may be under-counted",
			"project_id", pid, "cost_nano", costNano, "event_id", eventID)
		return false
	}
	h.billingWg.Add(1)
	go func() {
		defer h.billingWg.Done()
		// Decrement the in-flight reservation when this goroutine finishes,
		// whether UpdateUsage succeeded or failed (Fix round-3 #7).
		if costNano > 0 {
			defer h.addInflight(scopeID, periodStart, -costNano)
		}

		// FIX #27: pre-increment snapshot, read here (detached goroutine) instead
		// of on the request goroutine. Used only by the soft-alert crossing check
		// below; never gates the request (admission already happened in checkBudget).
		// It gets its OWN timeout budget, separate from billCtx below, so a
		// slow/degraded read can never shrink the money-critical UpdateUsage
		// call's deadline (gateway-review: sharing one budget across both would
		// silently starve UpdateUsage under DB/NATS degradation).
		alertCtx, alertCancel := context.WithTimeout(context.Background(), billingCtxTimeout)
		preDec, preErr := h.budgetGate.CheckBudget(alertCtx, pid, budgetScopeProject, scopeID, periodStart, 0)
		alertCancel()

		billCtx, cancel := context.WithTimeout(context.Background(), billingCtxTimeout)
		defer cancel()

		if err := h.budgetGate.UpdateUsage(billCtx, pid, budgetScopeProject, scopeID, eventID,
			costNano, periodStart, periodEnd); err != nil {
			h.logger.Warn("budget gate: UpdateUsage failed; spend may be under-counted",
				"project_id", pid, "cost_nano", costNano,
				"event_id", eventID, "err", err)
			return
		}

		// FIX #15: soft-alert threshold crossing check.
		// The alert must fire ONLY when the pre-increment spend was BELOW the
		// soft threshold and the post-increment spend is AT OR ABOVE it.
		if preErr != nil {
			// Non-fatal: skip the alert check if we couldn't read the pre-snapshot.
			return
		}
		// If the project was already over or at the hard limit before this
		// request, no soft alert is needed.
		if preDec.Verdict != failmode.Allow {
			return
		}
		h.trySoftAlert(billCtx, pid, scopeID, periodStart, costNano, preDec)
	}()
	return true
}

// trySoftAlert fires the 80% soft-alert ONLY when the running counter has
// CROSSED the SoftAlertPct threshold with this billing increment.
//
// Crossing detection: compare the pre-increment FSM state (preDec) with the
// post-increment FSM state (from a fresh CheckBudget). The alert fires when:
//   - preDec was Allow (spend was below the soft threshold), AND
//   - postDec is Block402 (hard limit crossed, definitely past 80%) OR
//     postDec.State is StateDownPGFreshNear (degraded-path near-threshold).
//
// On the NATS_HEALTHY path the post-increment CheckBudget re-reads the
// authoritative counter, so it correctly reflects the updated spend. On the
// degraded path the Snapshot AccumulatedNano doesn't change mid-request, so
// StateDownPGFreshNear signals the pre-computed threshold was already exceeded.
//
// TryAlertCooldown deduplicates: once an alert fires it is suppressed within
// the cooldown window (typically hours) even if every subsequent request also
// crosses the threshold.
func (h *Handler) trySoftAlert(
	ctx context.Context,
	pid int,
	scopeID string,
	periodStart, costJustBilled int64,
	preDec failmode.Decision,
) {
	// Re-read the budget state AFTER the increment. reqCostNano=costJustBilled
	// lets the FSM account for the just-billed amount when evaluating thresholds
	// (particularly the per-replica FRESH_NEAR cap on the degraded path).
	postDec, postErr := h.budgetGate.CheckBudget(ctx, pid, budgetScopeProject, scopeID, periodStart, costJustBilled)
	if postErr != nil {
		h.logger.Warn("budget gate: CheckBudget error during post-increment soft-alert check; skipping",
			"project_id", pid, "err", postErr)
		return
	}

	// Determine whether a threshold was crossed on this billing increment.
	// The pre-increment state was Allow (enforced by the caller).
	//
	//   - postDec.Verdict == Block402: hard limit (100%) was just crossed.
	//     The soft threshold (80%) is necessarily also crossed.
	//   - postDec.State == StateDownPGFreshNear: degraded-path 80%..100% range
	//     entered; the FSM already enforces the per-replica NEAR cap.
	//   - postDec.State == StateNATSHealthy && postDec.SoftThresholdNear &&
	//     !preDec.SoftThresholdNear: NATS_HEALTHY path just crossed into the
	//     soft-alert zone (Fix round-3 #6: previously the NATS_HEALTHY path
	//     never fired the soft alert because it didn't track the 80% threshold).
	//
	// Only fire in these cases to avoid alerting on every request.
	crossed := postDec.Verdict == failmode.Block402 ||
		postDec.State == failmode.StateDownPGFreshNear ||
		(postDec.State == failmode.StateNATSHealthy &&
			postDec.SoftThresholdNear && !preDec.SoftThresholdNear)

	h.logger.Debug("soft-alert crossing check",
		"project_id", pid,
		"crossed", crossed,
		"pre_state", preDec.State.String(), "pre_near", preDec.SoftThresholdNear,
		"post_state", postDec.State.String(), "post_near", postDec.SoftThresholdNear,
		"post_verdict", int(postDec.Verdict),
		"cost_just_billed_nano", costJustBilled)

	if !crossed {
		return
	}

	fired, err := h.budgetGate.TryAlertCooldown(ctx, budgetScopeProject, scopeID, periodStart)
	if err != nil {
		h.logger.Warn("budget gate: TryAlertCooldown error; soft-alert suppressed",
			"project_id", pid, "err", err)
		return
	}
	if fired {
		h.logger.Warn("budget soft-alert: project has crossed the spend threshold",
			"project_id", pid,
			"scope", budgetScopeProject,
			"scope_id", scopeID,
			"cost_just_billed_nano", costJustBilled,
			"period_start", periodStart,
			"pre_state", preDec.State.String(),
			"post_state", postDec.State.String(),
		)
		h.publishSoftAlertEvent(ctx, scopeID, costJustBilled, periodStart)
	}
}

// softAlertPayload is the budget.soft_alert event body. Field names are part
// of the platform event contract consumed by elitea-main subscribers and the
// BFF.9e live gate — change only with a spec update.
type softAlertPayload struct {
	ProjectID          string `json:"project_id"`
	Scope              string `json:"scope"`
	PeriodStartUnix    int64  `json:"period_start_unix"`
	CostJustBilledNano int64  `json:"cost_just_billed_nano"`
}

// softAlertEnvelope mirrors elitea-main's redis.Event envelope (the shape
// natsbus subscribers decode): {type, source, payload, timestamp}.
type softAlertEnvelope struct {
	Type      string          `json:"type"`
	Source    string          `json:"source"`
	Payload   json.RawMessage `json:"payload"`
	Timestamp time.Time       `json:"timestamp"`
}

// softAlertEventType matches elitea-main events.EventBudgetSoftAlert.
const softAlertEventType = "budget.soft_alert"

// publishSoftAlertEvent emits budget.soft_alert onto gateway.events.* so the
// alert is externally observable (spec §8.3 / BFF.9e: "a soft-alert is
// recorded on gateway.events.* within S seconds"). Best-effort: a publish
// failure is logged, never fatal — the authoritative alert record remains the
// NATS cooldown claim; the event is the notification channel.
func (h *Handler) publishSoftAlertEvent(ctx context.Context, scopeID string, costJustBilled, periodStart int64) {
	if h.alertEvents == nil {
		return
	}
	payload, err := json.Marshal(softAlertPayload{
		ProjectID:          scopeID,
		Scope:              budgetScopeProject,
		PeriodStartUnix:    periodStart,
		CostJustBilledNano: costJustBilled,
	})
	if err != nil {
		h.logger.Warn("budget soft-alert: marshal event payload failed", "err", err)
		return
	}
	env, err := json.Marshal(softAlertEnvelope{
		Type:      softAlertEventType,
		Source:    "elitea-llm-gateway",
		Payload:   payload,
		Timestamp: time.Now().UTC(),
	})
	if err != nil {
		h.logger.Warn("budget soft-alert: marshal event envelope failed", "err", err)
		return
	}

	pubCtx, cancel := context.WithTimeout(ctx, 150*time.Millisecond)
	defer cancel()
	if err := h.alertEvents.PublishSoftAlertEvent(pubCtx, scopeID, env); err != nil {
		h.logger.Warn("budget soft-alert: event publish failed", "project_id", scopeID, "err", err)
	}
}

// usageFromChatResponse extracts (inputTokens, outputTokens) from a
// BifrostChatResponse. Returns (0, 0) when the usage field is absent.
func usageFromChatResponse(resp *schemas.BifrostChatResponse) (int64, int64) {
	if resp == nil || resp.Usage == nil {
		return 0, 0
	}
	return int64(resp.Usage.PromptTokens), int64(resp.Usage.CompletionTokens)
}

// usageFromResponsesResponse extracts (inputTokens, outputTokens) from a
// BifrostResponsesResponse. Returns (0, 0) when the usage field is absent.
func usageFromResponsesResponse(resp *schemas.BifrostResponsesResponse) (int64, int64) {
	if resp == nil || resp.Usage == nil {
		return 0, 0
	}
	return int64(resp.Usage.InputTokens), int64(resp.Usage.OutputTokens)
}

// providerModelFromChatReq extracts provider and model strings from a
// BifrostChatRequest, converting the ModelProvider type to string.
func providerModelFromChatReq(req *schemas.BifrostChatRequest) (string, string) {
	if req == nil {
		return "", ""
	}
	return string(req.Provider), req.Model
}

// providerModelFromResponsesReq extracts provider and model from a
// BifrostResponsesRequest.
func providerModelFromResponsesReq(req *schemas.BifrostResponsesRequest) (string, string) {
	if req == nil {
		return "", ""
	}
	return string(req.Provider), req.Model
}

// providerModelFromTextReq extracts provider and model from a
// BifrostTextCompletionRequest.
func providerModelFromTextReq(req *schemas.BifrostTextCompletionRequest) (string, string) {
	if req == nil {
		return "", ""
	}
	return string(req.Provider), req.Model
}

// providerModelFromEmbeddingReq extracts provider and model from a
// BifrostEmbeddingRequest.
func providerModelFromEmbeddingReq(req *schemas.BifrostEmbeddingRequest) (string, string) {
	if req == nil {
		return "", ""
	}
	return string(req.Provider), req.Model
}

// usageFromTextCompletionResponse extracts (inputTokens, outputTokens) from a
// BifrostTextCompletionResponse. Returns (0, 0) when the usage field is absent.
func usageFromTextCompletionResponse(resp *schemas.BifrostTextCompletionResponse) (int64, int64) {
	if resp == nil || resp.Usage == nil {
		return 0, 0
	}
	return int64(resp.Usage.PromptTokens), int64(resp.Usage.CompletionTokens)
}

// usageFromEmbeddingResponse extracts (inputTokens, outputTokens) from a
// BifrostEmbeddingResponse. Embeddings only have prompt tokens; output is 0.
func usageFromEmbeddingResponse(resp *schemas.BifrostEmbeddingResponse) (int64, int64) {
	if resp == nil || resp.Usage == nil {
		return 0, 0
	}
	return int64(resp.Usage.PromptTokens), int64(resp.Usage.CompletionTokens)
}

// usageFromImageResponse extracts (inputTokens, outputTokens, imageCount)
// from a BifrostImageGenerationResponse.
//
// When the provider populates Usage (e.g. OpenAI gpt-image-1), the token
// counts are returned and imageCount is 0 — the normal cost.Calculator path
// applies.
//
// When Usage is nil (e.g. DALL·E 2, Stability AI), token counts are 0 and
// imageCount is set to len(resp.Data) so the caller can bill a fixed per-image
// fallback cost via perImageFallbackNano (Fix round-3 #8). This ensures image
// models that do not report token usage still get billed.
func usageFromImageResponse(resp *schemas.BifrostImageGenerationResponse) (inputTokens, outputTokens, imageCount int64) {
	if resp == nil {
		return 0, 0, 0
	}
	if resp.Usage != nil {
		return int64(resp.Usage.InputTokens), int64(resp.Usage.OutputTokens), 0
	}
	return 0, 0, int64(len(resp.Data))
}

// providerModelFromImageGenReq extracts provider and model from a
// BifrostImageGenerationRequest.
func providerModelFromImageGenReq(req *schemas.BifrostImageGenerationRequest) (string, string) {
	if req == nil {
		return "", ""
	}
	return string(req.Provider), req.Model
}

// providerModelFromImageEditReq extracts provider and model from a
// BifrostImageEditRequest.
func providerModelFromImageEditReq(req *schemas.BifrostImageEditRequest) (string, string) {
	if req == nil {
		return "", ""
	}
	return string(req.Provider), req.Model
}

// providerModelFromImageVariationReq extracts provider and model from a
// BifrostImageVariationRequest.
func providerModelFromImageVariationReq(req *schemas.BifrostImageVariationRequest) (string, string) {
	if req == nil {
		return "", ""
	}
	return string(req.Provider), req.Model
}
