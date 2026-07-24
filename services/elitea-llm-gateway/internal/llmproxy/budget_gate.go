package llmproxy

// budget_gate.go — pre-LLM admission check and post-completion billing hooks
// wired into the /llm handler layer (design §8.5, BF0.9b).
//
// The gate is nil-safe: when Handler.budgetGate is nil every helper returns
// immediately so existing call sites that build a Handler without governance
// continue to work unchanged.

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
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

// budgetScopeProject is the scope string used for project-level budget checks.
const budgetScopeProject = "project"

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

	dec, err := h.budgetGate.CheckBudget(ctx, pid, budgetScopeProject, scopeID, periodStart, reqCostNano)
	if err != nil {
		// A hard error from the gate is unexpected (the gate is designed to
		// degrade gracefully); treat it as a 503 to avoid silently bypassing
		// enforcement.
		h.logger.Error("budget gate: CheckBudget error; blocking request",
			"project_id", pid, "err", err)
		writeError(w, http.StatusServiceUnavailable, "service_unavailable",
			"budget service error; try again shortly", "nats_unavailable")
		return false
	}

	switch dec.Verdict {
	case failmode.Allow:
		return true
	case failmode.Block402:
		writeError(w, http.StatusPaymentRequired, "budget_exceeded",
			"project budget exhausted for this billing period", "insufficient_quota")
		return false
	case failmode.Block503:
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
func (h *Handler) updateUsage(
	ctx context.Context,
	provider string,
	model string,
	inputTokens, outputTokens int64,
	projectIDStr string,
) {
	if h.budgetGate == nil || h.costCalc == nil {
		return
	}
	pid := parseProjectID(projectIDStr)
	if pid < 0 {
		return
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
		return // nothing to bill
	}

	eventID := uuid.NewString()
	costNano := actualCost.TotalNanoUSD

	// FIX #18: read the pre-increment snapshot BEFORE spawning the goroutine
	// so we can compute the soft-alert crossing in the goroutine without
	// another round-trip to CheckBudget after the increment.
	preDec, preErr := h.budgetGate.CheckBudget(costCtx, pid, budgetScopeProject, scopeID, periodStart, 0)

	// Spawn the increment + alert goroutine OFF the HTTP response critical path.
	// The response is written by the caller immediately after updateUsage returns.
	go func() {
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
		// We already have the pre-increment Decision (preDec / preErr).
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
	//
	// Only check/fire in these two cases to avoid alerting on every request.
	crossed := postDec.Verdict == failmode.Block402 ||
		postDec.State == failmode.StateDownPGFreshNear

	// Additionally, detect NATS_HEALTHY threshold crossing: if the pre-state
	// was StateNATSHealthy (Allow, under the soft threshold) and the post-state
	// is Block402 we already covered that above. If both are StateNATSHealthy
	// but the post verdict is still Allow, no crossing has occurred on this path.
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

// usageFromImageResponse extracts (inputTokens, outputTokens) from a
// BifrostImageGenerationResponse. Image providers may carry token usage
// in the Usage field (e.g. OpenAI gpt-image-1); when absent both are 0.
// The cost.Calculator handles image models by looking up the catalog entry
// (which may express cost as input_tokens = image_tokens), so passing the
// available token counts is correct. When no usage is present the gate
// still enforces admission (checkBudget blocks over-budget projects) but
// skips the post-completion billing increment (nothing measurable to bill).
func usageFromImageResponse(resp *schemas.BifrostImageGenerationResponse) (int64, int64) {
	if resp == nil || resp.Usage == nil {
		return 0, 0
	}
	return int64(resp.Usage.InputTokens), int64(resp.Usage.OutputTokens)
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
