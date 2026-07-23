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
// authoritative counter and publishes a write-behind delta. It is a
// best-effort fire-and-forget: errors are logged but do not cause the
// response to fail (the provider has already been called; double-billing
// is worse than a missed update).
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

	actualCost := h.costCalc.Cost(ctx, provider, model, inputTokens, outputTokens)
	if actualCost.TotalNanoUSD <= 0 {
		return // nothing to bill
	}

	eventID := uuid.NewString()
	if err := h.budgetGate.UpdateUsage(ctx, pid, budgetScopeProject, scopeID, eventID,
		actualCost.TotalNanoUSD, periodStart, periodEnd); err != nil {
		h.logger.Warn("budget gate: UpdateUsage failed; spend may be under-counted",
			"project_id", pid, "cost_nano", actualCost.TotalNanoUSD,
			"event_id", eventID, "err", err)
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
