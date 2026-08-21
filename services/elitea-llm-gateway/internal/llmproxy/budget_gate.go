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
	"time"

	"github.com/google/uuid"
	"github.com/maximhq/bifrost/core/schemas"

	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/cost"
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

// billOutcome distinguishes the three ways a billing attempt can end. Only
// billRefused means real, known spend was dropped and must be alarmed on.
type billOutcome int

const (
	billBilled      billOutcome = iota // increment accepted (goroutine spawned)
	billNotBillable                    // nothing to bill: no gate, no project, or zero cost
	billRefused                        // billing is closing — a known amount was DROPPED
)

// budgetScopeProject is the scope string used for project-level budget checks.
const budgetScopeProject = failmode.ScopeProject

// budgetScopeUser is the scope string used for per-member budget checks
// (issue #321). Its scope_id is "{project_id}:{user_id}"; see
// failmode.UserScopeID for why that shape is fixed.
const budgetScopeUser = failmode.ScopeUser

// The budget refusal wire contract. Every budget refusal this gateway writes
// uses these three constants, and the SDK's reader is the reason they are what
// they are.
//
// elitea-sdk `runtime/exceptions.py::budget_exceeded_from` is the ONE place any
// SDK caller decides whether a 402 is a budget rejection. It does two things,
// in this order:
//
//  1. It matches on error.TYPE only: `detail.get("type") == "budget_exceeded"`.
//     A body whose type is anything else returns None from the same branch —
//     it does NOT fall through to the message-text path below it.
//  2. It reads the SCOPE out of error.CODE, and accepts exactly two values:
//     "project_budget_exceeded" and "member_budget_exceeded". Any other code
//     resolves to the default scope, which is the project one.
//
// So the type carries "this is a budget refusal" and the code carries "which
// budget". A refusal that puts the scope in the type is not recognised as a
// budget refusal at all: the SDK returns None, the handler treats the 402 as an
// ordinary provider error, and the policy rejection is fed back to the model as
// message content. The SDK's own docstring names that outcome as the thing the
// typed exception exists to prevent.
//
// The scope also survives past the SDK: BudgetExceededError.scope becomes the
// agent event's `budget_error_code`, which is what the front end keys its
// member-versus-project message on (EliteaUI budgetError.constants.js). The
// front end never sees this HTTP body.
const (
	// budgetErrorType is the ONLY error type a budget refusal may carry. It is
	// the SDK's match key; see above.
	budgetErrorType = "budget_exceeded"
	// budgetCodeProject is the project-ceiling code. It stays the OpenAI
	// canonical "insufficient_quota" rather than "project_budget_exceeded":
	// a generic OpenAI client understands it, spec §2.5 and the cutover gate
	// (cutover-ctl budget-check, BFF.9E) both assert it, and the SDK resolves
	// an unrecognised code to the project scope anyway — which is the correct
	// scope for this refusal. TestBudgetRefusalMatchesSDKContract pins that
	// reliance so it cannot become accidental.
	budgetCodeProject = "insufficient_quota"
	// budgetCodeMember is the member-ceiling code. The member cap is an Elitea
	// concept with no OpenAI equivalent, so there is no canonical code to keep
	// here, and the SDK needs this exact spelling to report the member scope.
	budgetCodeMember = "member_budget_exceeded"
)

// perImageFallbackNano is the fixed per-image billing cost in nano-USD used
// when an image-generation response carries no token-based Usage field.
// $0.040 per image (40_000_000 nano-USD) matches the DALL·E 3 Standard
// 1024×1024 list price and is a conservative floor for image models that do
// not report token usage. This constant is intentionally NOT a catalog lookup:
// image models whose pricing is token-based will report Usage and go through
// the normal cost.Calculator path; this path only fires when Usage==nil.
const perImageFallbackNano int64 = 40_000_000

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
//  3. Calls BudgetChecker.CheckBudget with reqCostNano=0; on Block402 → writes
//     HTTP 402; on Block503 → writes HTTP 503; on Allow → returns (true, nil).
//
// reqCostNano is 0 because the gateway has no pre-flight token estimate: the
// wire formats do not carry a pre-counted prompt token count, and computing one
// from the marshalled body would over-count inline base64 image/audio payloads
// by orders of magnitude. 0 is the conservative value — the FSM uses
// reqCostNano only for the degraded-path FRESH_NEAR per-replica cap, so it can
// never over-gate. The actual cost is billed after the response arrives.
//
// Issue #10: an in-process per-project "in-flight reservation" counter used to
// be added here, claiming to bound the concurrent-admission overshoot. Every
// call site passed promptTokenEst=0, so the reservation was never incremented
// while the billing path always decremented — the counter only ever drifted
// negative and its sync.Map entries were never reaped. The mechanism was
// deleted rather than repaired: bounding the overshoot for real needs a token
// estimator nobody has asked for, and the NATS counter remains ground truth.
//
// Returns (proceed=true) when the caller should continue; (proceed=false) means
// the response has already been written and the caller must return immediately.
func (h *Handler) checkBudget(
	w http.ResponseWriter,
	ctx context.Context,
	model string,
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

	// Bound the admission read. Streaming requests now hand this function a
	// context that is deliberately decoupled from the client (issue #9), so it
	// has neither a deadline nor a cancellation path: without this timeout a
	// stalled Postgres pool would park the handler goroutine forever, where it
	// previously unwound on client hangup. Fail-closed semantics are preserved
	// — a timeout surfaces as the existing 503 branch below.
	gateCtx, gateCancel := context.WithTimeout(ctx, budgetGateTimeout)
	dec, err := h.budgetGate.CheckBudget(gateCtx, pid, budgetScopeProject, scopeID, periodStart, 0)
	gateCancel()
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
		// Fix round-3 #12: log at Info when the Allow decision comes from a
		// degraded (NATS-down) FSM state so operators can see that the gateway
		// is operating in fallback mode on a per-request basis. Only logged when
		// Degraded is set to avoid a log entry on every healthy-path request.
		if dec.Degraded {
			h.logger.Info("budget gate: degraded allow (NATS unavailable, fallback tier used)",
				"project_id", pid,
				"state", dec.State.String(),
			)
		}
		// The project has room. The member cap is a SECOND ceiling inside it,
		// so it is asked only after the project admits (issue #321).
		return h.checkMemberBudget(w, ctx, pid, periodStart)
	case failmode.Block402:
		writeError(w, http.StatusPaymentRequired, budgetErrorType,
			"project budget exhausted for this billing period", budgetCodeProject)
		return false
	case failmode.Block503:
		writeError(w, http.StatusServiceUnavailable, "service_unavailable",
			"budget service temporarily unavailable; try again shortly", "nats_unavailable")
		return false
	default:
		// Unknown verdict: fail open on the PROJECT ceiling (log and proceed).
		// Should never happen. The member ceiling is still applied — a verdict
		// this code does not recognise is not a reason to skip a second,
		// independent limit.
		h.logger.Warn("budget gate: unknown verdict; allowing request",
			"verdict", fmt.Sprintf("%v", dec.Verdict))
		return h.checkMemberBudget(w, ctx, pid, periodStart)
	}
}

// checkMemberBudget is the per-member half of the admission check (issue #321).
//
// Until this existed, a project admin could set a member's monthly cap, get a
// 200 back, watch the value round-trip through the API, and that member could
// still spend the entire project budget. The limit was authored, served and
// rendered; nothing read it.
//
// It runs on the SAME machinery as the project check — the same FSM, the same
// tiered-hybrid fallback, the same NATS counter and write-back — because the
// accumulator has always been keyed by (scope, scope_id, period) and
// elitea-main has always read the user scope. Only the gateway's read and write
// of that scope were missing.
//
// A request with no resolvable member id is admitted: an integration
// authenticating with a project token has no member to charge, and refusing it
// would break every non-interactive caller. Those calls remain bounded by the
// project ceiling, which is the ceiling they have always been bounded by.
//
// The refusal carries the member scope in error.CODE, and the shared
// `budget_exceeded` type. The front end has had a distinct message for
// `member_budget_exceeded` since before the Go port (EliteaUI
// budgetError.constants.js), and it deep-links to the member's own Usage tab;
// collapsing the two would send a member who is over THEIR cap to a project
// budget screen they cannot act on.
//
// The scope moved from the type to the code in the SDK-compatibility pass. It
// was in the type, and the front end never received it: EliteaUI does not read
// this HTTP body. It reads the agent event's `budget_error_code`, which is
// elitea-sdk's BudgetExceededError.scope, and the SDK derives that scope from
// error.CODE after matching error.TYPE against `budget_exceeded` alone. A
// member refusal typed `member_budget_exceeded` failed that match, so
// budget_exceeded_from returned None, no typed exception was raised, and the
// refusal reached the model as ordinary message content. See budgetErrorType.
func (h *Handler) checkMemberBudget(
	w http.ResponseWriter,
	ctx context.Context,
	projectID int,
	periodStart int64,
) bool {
	raw := identityUserFromCtx(ctx)
	uid := parseUserID(raw)
	if uid < 0 {
		// "No member" and "a member id we could not read" are different, and
		// only the second is a fault. Without this line they look identical in
		// production, and a member cap that quietly stops applying is the #321
		// shape all over again.
		if raw != "" {
			h.logger.Warn("budget gate: member id is present but unusable; the member cap is not applied",
				"project_id", projectID, "user_id_header", raw)
		}
		return true
	}
	scopeID := failmode.UserScopeID(projectID, uid)

	gateCtx, gateCancel := context.WithTimeout(ctx, budgetGateTimeout)
	dec, err := h.budgetGate.CheckBudget(gateCtx, projectID, budgetScopeUser, scopeID, periodStart, 0)
	gateCancel()
	if err != nil {
		// Same reasoning as the project gate: a hard error is not a licence to
		// skip the ceiling.
		h.logger.Error("budget gate: member CheckBudget error; blocking request",
			"project_id", projectID, "user_id", uid, "err", err)
		writeError(w, http.StatusServiceUnavailable, "service_unavailable",
			"budget service error; try again shortly", "nats_unavailable")
		return false
	}

	switch dec.Verdict {
	case failmode.Block402:
		h.logger.Info("budget gate: member budget exhausted",
			"project_id", projectID, "user_id", uid, "state", dec.State.String())
		writeError(w, http.StatusPaymentRequired, budgetErrorType,
			"member budget exhausted for this billing period", budgetCodeMember)
		return false
	case failmode.Block503:
		writeError(w, http.StatusServiceUnavailable, "service_unavailable",
			"budget service temporarily unavailable; try again shortly", "nats_unavailable")
		return false
	default:
		return true
	}
}

// identityProjectFromCtx extracts the project ID string set on the
// BifrostContext by newContext (via schemas.BifrostContextKeyVirtualKey).
func identityProjectFromCtx(ctx context.Context) string {
	return bifrostCtxString(ctx, schemas.BifrostContextKeyVirtualKey)
}

// identityUserFromCtx extracts the member ID string set on the BifrostContext
// by newContext from the X-Elitea-User-Id header. elitea-main has forwarded
// that header since the llmproxy identity path was written; until issue #321
// the gateway carried it and read it for nothing.
func identityUserFromCtx(ctx context.Context) string {
	return bifrostCtxString(ctx, schemas.BifrostContextKeyUserID)
}

func bifrostCtxString(ctx context.Context, key any) string {
	type bifrostCtx interface {
		Value(key any) any
	}
	if bc, ok := ctx.(bifrostCtx); ok {
		if v, ok2 := bc.Value(key).(string); ok2 {
			return v
		}
	}
	return ""
}

// parseUserID converts the member ID string from the identity headers into an
// int. It returns -1 for an absent or unusable value, which every caller reads
// as "no member to charge" — the same convention parseProjectID uses.
func parseUserID(s string) int {
	if s == "" {
		return -1
	}
	n, err := strconv.Atoi(s)
	if err != nil || n <= 0 {
		return -1
	}
	return n
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
// It reports WHY nothing was billed, not merely that nothing was. The stream
// drain alarms on a refused increment (real, known spend dropped) and must stay
// silent for "there was nothing to bill here" — a gateway with no budget gate
// wired, an unresolvable project, or a zero-priced model. Collapsing the two
// made every clean stream on an ungoverned deployment publish a
// billing_refused alarm, desensitising operators to the one signal that
// detects real loss.
func (h *Handler) updateUsage(
	ctx context.Context,
	provider string,
	model string,
	inputTokens, outputTokens int64,
	projectIDStr string,
	userIDStr string,
) billOutcome {
	return h.updateUsageUnits(ctx, provider, model,
		cost.Units{InputTokens: inputTokens, OutputTokens: outputTokens},
		projectIDStr, userIDStr)
}

// updateUsageUnits is updateUsage over any denomination the catalog can price:
// tokens, seconds (carried as milliseconds) or characters (issue #323). Only
// the two audio routes call it directly. updateUsage is the token-only form,
// and its eleven call sites are unchanged.
//
// It is one function and not two because everything after the price lookup —
// the period bounds, the ledger dimensions, the drain guard, the member scope,
// the soft alert — is identical for every basis. A second copy of that path is
// a second place for the money to go missing.
func (h *Handler) updateUsageUnits(
	ctx context.Context,
	provider string,
	model string,
	u cost.Units,
	projectIDStr string,
	userIDStr string,
) billOutcome {
	if h.budgetGate == nil || h.costCalc == nil {
		return billNotBillable
	}
	pid := parseProjectID(projectIDStr)
	if pid < 0 {
		return billNotBillable
	}
	now := time.Now()
	periodStart := billingPeriodStart(now)
	periodEnd := billingPeriodEnd(now)

	// Compute cost on the caller's goroutine using the cost calculator (no I/O).
	// Use a fresh context for the cost lookup so a client disconnect doesn't
	// abort even the cheap in-process price lookup.
	costCtx, costCancel := context.WithTimeout(context.Background(), billingCtxTimeout)
	defer costCancel()

	actualCost := h.costCalc.CostUnits(costCtx, provider, model, u)

	// Report which rate paid, and refuse to let an UNPRICED audio request look
	// like a cheap one. The two counters live in audio.go, where their names
	// are published to /metrics.
	//
	// The test is written against the basis the UNITS ask for, not against
	// Cost.Basis alone, and that is deliberate. A token-billed request whose
	// price is zero is PRICED and costs nothing; reading Cost.Basis alone would
	// make every zero-cost estimator stub look unpriced and would put the
	// eleven token call sites on a path they never take today.
	if u.Basis() != cost.BasisTokens {
		if actualCost.Basis == "" {
			// The provider reported seconds or characters and the catalog holds
			// no rate for them. Billing zero here is unavoidable — inventing a
			// rate would put a made-up figure on the authoritative counter — but
			// it must not be silent. This is the number an operator alarms on.
			audioUnpriced.Add(1)
			h.logger.WarnContext(ctx, "audio: the catalog carries no rate for the units this response reported; the request bills zero",
				"provider", provider, "model", model,
				"unit_basis", u.Basis(), "metric", MetricAudioUnpriced)
			return billNotBillable
		}
		audioNonTokenBasis.Add(1)
		h.logger.InfoContext(ctx, "audio: a non-token rate priced this request",
			"provider", provider, "model", model,
			"basis", actualCost.Basis, "source", actualCost.Source,
			"cost_nano", actualCost.TotalNanoUSD, "metric", MetricAudioNonTokenBasis)
	} else if actualCost.TotalNanoUSD > 0 && !actualCost.FromCatalog() {
		// The audio response reported TOKENS, and the token price did not come
		// from the catalog.
		//
		// The seconds and characters bases cannot reach here: audioCost refuses
		// a rate that is not from the catalog, so they bill a real price or
		// nothing. The token basis is different — it falls back to the pylon
		// default table like every other route, which is longstanding and
		// disclosed. The consequence for AUDIO is what was silent: the amount is
		// non-zero and plausible, so MetricAudioUnpriced cannot fire (a price
		// was produced) and MetricAudioNonTokenBasis cannot fire (the basis is
		// tokens). An invented figure reached the authoritative counter and left
		// no trace.
		//
		// This does NOT refuse the request. Refusing would change the pricing
		// policy of the token basis for one route, and that is a [human
		// decision]. It makes the condition alarmable, which is what was
		// missing.
		audioDefaultPriced.Add(1)
		h.logger.WarnContext(ctx, "audio: billed a token price the catalog did not supply",
			"provider", provider, "model", model,
			"source", actualCost.Source, "cost_nano", actualCost.TotalNanoUSD,
			"metric", MetricAudioDefaultPriced)
	}

	if actualCost.TotalNanoUSD <= 0 {
		return billNotBillable // nothing to bill
	}

	// The dimensions the usage ledger records for this request (issue #320).
	// They are the values the billing path ALREADY has — the resolved provider
	// and model it just priced, and the token counts the provider reported. No
	// count is derived or estimated: an estimated token is not a billed one.
	// The token columns stay the TOKEN counts. A seconds-billed or
	// characters-billed request reports none, so they stay zero: writing a
	// millisecond count into a column named prompt_tokens would put a duration
	// on a page of token figures, and nothing downstream would say so.
	dims := &failmode.UsageDimensions{
		UserID:           optionalUserID(userIDStr),
		Provider:         provider,
		Model:            model,
		PromptTokens:     u.InputTokens,
		CompletionTokens: u.OutputTokens,
		// The instant THIS gateway billed the request, taken from the same
		// `now` the period bounds come from. The ledger row is written by the
		// scheduler, minutes later or more, so a column default would date the
		// request to whenever the consumer got to it.
		OccurredAtUnix: now.Unix(),
	}

	if h.spawnBillingGoroutine(pid, userIDStr, periodStart, periodEnd, actualCost.TotalNanoUSD, dims) {
		return billBilled
	}
	return billRefused
}

// optionalUserID renders the identity header's member id as a *int for the
// ledger: nil when there is no member to attribute the call to.
func optionalUserID(userIDStr string) *int {
	uid := parseUserID(userIDStr)
	if uid < 0 {
		return nil
	}
	return &uid
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
	userIDStr string,
	provider string,
	model string,
	costNano int64,
) billOutcome {
	if h.budgetGate == nil || costNano <= 0 {
		return billNotBillable
	}
	pid := parseProjectID(projectIDStr)
	if pid < 0 {
		return billNotBillable
	}
	now := time.Now()
	periodStart := billingPeriodStart(now)
	periodEnd := billingPeriodEnd(now)

	// An image response that reports no Usage still has a provider, a model and
	// a cost, so it still belongs in the ledger and in the per-model table. Its
	// token counts stay 0 — the provider reported none, and inventing one to
	// fill a column would put an estimate on a page of billed figures.
	dims := &failmode.UsageDimensions{
		UserID:         optionalUserID(userIDStr),
		Provider:       provider,
		Model:          model,
		OccurredAtUnix: now.Unix(),
	}

	if h.spawnBillingGoroutine(pid, userIDStr, periodStart, periodEnd, costNano, dims) {
		return billBilled
	}
	return billRefused
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
// The member scope is billed in the SAME goroutine, with its OWN event id.
// Two ids, not one, because gateway.processed_event_ids has event_id as its
// primary key: a member delta reusing the project delta's id would be seen as
// an already-applied redelivery and silently contribute nothing to the member's
// accumulator. The member cap would then admit forever while appearing enforced
// — the same defect as #321, one layer down.
//
// The member increment carries NO usage dimensions. The ledger row written for
// the project delta already names the member in its user_id column; a second
// row would double every token count, request count and cost figure the
// per-day and per-model views report.
func (h *Handler) spawnBillingGoroutine(
	pid int,
	userIDStr string,
	periodStart, periodEnd int64,
	costNano int64,
	dims *failmode.UsageDimensions,
) bool {
	scopeID := strconv.Itoa(pid)
	eventID := uuid.NewString()
	uid := parseUserID(userIDStr)

	// Fix round-3 #2: guard against Add-after-Wait (billingClosing already set
	// by DrainBilling) and track in-flight goroutines so DrainBilling can wait.
	if h.billingClosing.Load() != 0 {
		// Drain in progress — skip spawning and log so spend is not silently
		// dropped.
		h.logger.Warn("budget gate: billing goroutine skipped (drain in progress); spend may be under-counted",
			"project_id", pid, "cost_nano", costNano, "event_id", eventID)
		return false
	}
	h.billingWg.Add(1)
	go func() {
		defer h.billingWg.Done()

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

		projectErr := h.budgetGate.UpdateUsage(billCtx, pid, budgetScopeProject, scopeID, eventID,
			costNano, periodStart, periodEnd, dims)
		if projectErr != nil {
			h.logger.Warn("budget gate: UpdateUsage failed; spend may be under-counted",
				"project_id", pid, "cost_nano", costNano,
				"event_id", eventID, "err", projectErr)
		}

		// Bill the member scope even when the project increment failed: the two
		// counters are independent, and skipping the member increment because
		// the project one erred would leave a member cap under-counted for
		// reasons that have nothing to do with that member.
		//
		// It gets its OWN timeout budget rather than sharing billCtx, for the
		// reason FIX #27 gives one to the pre-increment snapshot: a slow project
		// increment would otherwise spend the whole 10 s and hand this call an
		// already-expired context. That is not a missed alert, it is member
		// spend dropped — and the member cap that admits forever afterwards is
		// the defect #321 exists about, one layer down.
		if uid > 0 {
			memberEventID := uuid.NewString()
			memberCtx, memberCancel := context.WithTimeout(context.Background(), billingCtxTimeout)
			err := h.budgetGate.UpdateUsage(memberCtx, pid, budgetScopeUser,
				failmode.UserScopeID(pid, uid), memberEventID,
				costNano, periodStart, periodEnd, nil)
			memberCancel()
			if err != nil {
				h.logger.Warn("budget gate: member UpdateUsage failed; member spend may be under-counted",
					"project_id", pid, "user_id", uid, "cost_nano", costNano,
					"event_id", memberEventID, "err", err)
			}
		}

		if projectErr != nil {
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

	// The platform soft-alert switch (issue #322). An operator who turns alert
	// emission off through PUT /admin/gateway/budget-alerts used to get 200 OK,
	// a changed GET, and alerts that kept firing until the pod restarted and the
	// GET silently flipped back. The switch now lives in a row the gateway
	// reads, and this is where it takes effect.
	//
	// It is checked AFTER the crossing test and BEFORE the cooldown claim, on
	// purpose: not claiming the cooldown means the first crossing after an
	// operator re-enables alerts still fires, rather than being suppressed by a
	// claim made silently while alerts were off.
	if postDec.SoftAlertsDisabled {
		h.logger.Debug("budget gate: soft alert suppressed by platform switch",
			"project_id", pid, "scope_id", scopeID)
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
