package llmproxy

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/maximhq/bifrost/core/providers/anthropic"
	"github.com/maximhq/bifrost/core/providers/openai"
	"github.com/maximhq/bifrost/core/schemas"

	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/pkg/ssewriter"
)

// Handler serves the /llm dialect surface. It decodes OpenAI/Anthropic wire
// bodies into bifrost/core request structs, calls the embedded core methods
// through the LLMRouter seam, and writes a net/http SSE loop over the returned
// stream channel (design §6.3). It never calls the fasthttp-bound integrations
// factories.
type Handler struct {
	router LLMRouter
	logger *slog.Logger
	// identitySecret verifies the edge's signed identity headers. An empty
	// secret disables verification (the mTLS transport still authenticates the
	// hop) — matching the edge, which only signs when a secret is configured.
	identitySecret []byte
	// models synthesises the per-project /llm/v1/models set from Postgres
	// (design §4.2, §3.4). nil when the gateway is booted without a database:
	// the /v1/models surface then reports an empty set rather than erroring.
	models *ModelResolver
	// budgetGate is the pre-LLM admission gate (design §8.5, BF0.9b).
	// nil means the gate is disabled — skip all budget enforcement. This keeps
	// existing tests that build a Handler without governance wired up passing.
	budgetGate BudgetChecker
	// costCalc estimates request cost in nano-USD. Required when budgetGate is
	// non-nil; ignored (and may be nil) when budgetGate is nil.
	costCalc CostEstimator

	// billingWg tracks in-flight async billing goroutines (Fix round-3 #2).
	// DrainBilling() blocks until all goroutines complete. billingClosing is
	// set to 1 atomically before DrainBilling waits, preventing any new Add
	// after Wait starts (Add-after-Wait panic guard).
	billingWg      sync.WaitGroup
	billingClosing atomic.Int32

	// loopGuard is the per-(project_id, model) circular-routing circuit
	// breaker (spec §2.6 guard #2). nil = disarmed (unit-test construction);
	// production wiring arms it via WithLoopBreaker.
	loopGuard *loopBreaker

	// alertEvents publishes budget.soft_alert to gateway.events.* when the
	// 80% soft alert fires (spec §8.3). nil = publishing disabled.
	alertEvents AlertEventPublisher

	// inflightNano is a per-project in-process reservation counter (Fix round-3
	// #7). When N concurrent requests pass admission before any async increment
	// lands, each one adds its estimated cost here so checkBudget can bound the
	// concurrent-admission window overshoot. The map value is *atomic.Int64
	// keyed by the scope+scopeID admission key. Values are decremented by the
	// billing goroutine after UpdateUsage completes.
	inflightNano sync.Map // key: string → *atomic.Int64

	// streamGrace is how long a stream whose SSE loop exited early may keep its
	// provider stream alive waiting for the authoritative usage trailer
	// (issue #9, DECISIONS.md 2026-08-05). 0 disables the mechanism: the
	// provider context is then bound to the request context exactly as before,
	// and an early exit bills nothing. Set via WithStreamGrace.
	streamGrace time.Duration

	// drainSlots bounds the number of concurrently-detained streams: each drain
	// holds a goroutine and an open provider socket for up to streamGrace.
	// nil = unbounded (unit-test construction only); production wiring always
	// sets a limit via WithStreamDrainLimit.
	drainSlots chan struct{}

	// drainClosing is closed by DrainBilling so a detached drain stops waiting
	// for a provider trailer once graceful shutdown starts — the pod's
	// termination grace must not be held hostage to streamGrace.
	drainClosing     chan struct{}
	drainClosingOnce sync.Once

	// streamCtxHook receives every context built by newStreamContext. It is a
	// TEST SEAM ONLY (nil in production, never set by any HandlerOption): the
	// "was the stream context cancelled when the budget gate blocked the
	// request?" assertion has no other observation point, because a blocked
	// request never reaches the router.
	streamCtxHook func(*schemas.BifrostContext)
}

// HandlerOption customises Handler construction. It keeps NewHandler's core
// signature stable (router/logger/identitySecret) while letting later features
// — the models resolver — be wired in without churning existing call sites.
type HandlerOption func(*Handler)

// WithModelResolver wires the synthetic /llm/v1/models resolver. A nil resolver
// leaves the models surface reporting an empty set.
func WithModelResolver(r *ModelResolver) HandlerOption {
	return func(h *Handler) { h.models = r }
}

// WithBudgetGate wires the pre-LLM budget enforcement gate. When gate is nil
// the option is a no-op (enforcement is skipped). calc must be non-nil when
// gate is non-nil — the cost Calculator is used for pre-flight estimation and
// for post-completion billing.
func WithBudgetGate(gate BudgetChecker, calc CostEstimator) HandlerOption {
	return func(h *Handler) {
		if gate == nil {
			return
		}
		h.budgetGate = gate
		h.costCalc = calc
	}
}

// WithLoopBreaker arms the per-(project_id, model) circular-routing circuit
// breaker (spec §2.6 guard #2): >= 5 requests for the same tuple within 1 s
// open the circuit and the handler returns 429 rate_limit_exceeded for 30 s.
// The composition root (cmd/elitea-llm-gateway/main.go) MUST arm this in
// production wiring — guarded by TestMainWiring.
func WithLoopBreaker() HandlerOption {
	return func(h *Handler) { h.loopGuard = newLoopBreaker() }
}

// WithLoopBreakerClock arms the breaker exactly like WithLoopBreaker but reads
// time from now instead of time.Now. It exists so tests outside this package
// (internal/preflight) can drive the 1 s sliding window from a frozen clock
// instead of racing the wall clock — a burst that must land inside one second
// is otherwise flaky on a loaded CI box. Production wiring uses WithLoopBreaker;
// a nil now falls back to time.Now.
func WithLoopBreakerClock(now func() time.Time) HandlerOption {
	return func(h *Handler) {
		h.loopGuard = newLoopBreaker()
		if now != nil {
			h.loopGuard.now = now
		}
	}
}

// WithAlertEventPublisher wires the gateway.events.* publisher used to emit
// the budget.soft_alert event when the 80% threshold alert fires (spec §8.3:
// "a soft-alert is recorded on gateway.events.*"). nil is a no-op (the alert
// still logs; nothing is published).
func WithAlertEventPublisher(p AlertEventPublisher) HandlerOption {
	return func(h *Handler) { h.alertEvents = p }
}

// WithStreamGrace sets how long an early-exiting stream may keep its provider
// stream alive waiting for the authoritative usage trailer (issue #9). The
// value is clamped to [0, MaxStreamGrace]; 0 disables the mechanism entirely
// (provider context stays bound to the request context, early exits bill
// nothing). The composition root wires this from LLM_STREAM_GRACE_MS.
func WithStreamGrace(d time.Duration) HandlerOption {
	return func(h *Handler) {
		if d < 0 {
			d = 0
		}
		if d > MaxStreamGrace {
			d = MaxStreamGrace
		}
		h.streamGrace = d
	}
}

// WithStreamDrainLimit bounds how many abandoned streams may be drained
// concurrently. n <= 0 leaves the pool unbounded (test construction); the
// composition root always passes a positive limit.
func WithStreamDrainLimit(n int) HandlerOption {
	return func(h *Handler) {
		if n <= 0 {
			h.drainSlots = nil
			return
		}
		h.drainSlots = make(chan struct{}, n)
	}
}

// NewHandler builds a /llm Handler over the given router. logger may be nil
// (a discarding logger is substituted). identitySecret may be empty to disable
// HMAC verification of the forwarded identity headers. Optional features (the
// models resolver) are supplied via HandlerOption.
func NewHandler(router LLMRouter, logger *slog.Logger, identitySecret []byte, opts ...HandlerOption) *Handler {
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(discard{}, nil))
	}
	h := &Handler{
		router:         router,
		logger:         logger,
		identitySecret: identitySecret,
		// Issue #9: the grace-period drain is ON by default so a Handler built
		// without the option (tests, embedders) still bills a disconnected
		// stream rather than silently dropping it. Production overrides the
		// duration and the concurrency bound from config.
		streamGrace:  DefaultStreamGrace,
		drainSlots:   make(chan struct{}, DefaultStreamDrainLimit),
		drainClosing: make(chan struct{}),
	}
	for _, opt := range opts {
		opt(h)
	}
	return h
}

// DrainBilling marks the handler as draining (no new billing goroutines will
// be spawned) and blocks until all in-flight async billing goroutines complete.
//
// Call this BEFORE govStore.Drain() during graceful shutdown so billing
// goroutines that call UpdateUsage finish before the governance store drains
// its own persist goroutines, preventing Add-after-Wait on persistWg.
//
// Sequence mandated by the design:
//  1. handler.DrainBilling() — waits for updateUsage goroutines.
//  2. govStore.Drain()       — waits for PersistOutageDelta goroutines.
//  3. srv.Shutdown()         — closes HTTP, bifrost, NATS.
func (h *Handler) DrainBilling() {
	h.billingClosing.Store(1)
	// Tell in-flight stream drains to stop waiting for a provider trailer: a
	// stream that has already lost its client must not extend the pod's
	// termination grace by up to streamGrace (issue #9).
	h.drainClosingOnce.Do(func() {
		if h.drainClosing != nil {
			close(h.drainClosing)
		}
	})
	h.billingWg.Wait()
}

// discard is an io.Writer that drops everything; used for the nil-logger case.
type discard struct{}

func (discard) Write(p []byte) (int, error) { return len(p), nil }

// newContext builds a BifrostContext for a request, trusting the edge's signed
// identity headers on the mTLS-internal network and injecting the resolved
// projectID as the Bifrost virtual-key value (design §5.3). It returns false
// (after writing a 403) when a configured identity secret does not verify.
func (h *Handler) newContext(w http.ResponseWriter, r *http.Request) (*schemas.BifrostContext, bool) {
	ctx, _, ok := h.buildContext(w, r, false)
	return ctx, ok
}

// newStreamContext builds the BifrostContext for a STREAMING request. Unlike
// newContext it decouples the provider stream from the client's request
// context: the parent is context.WithoutCancel(r.Context()), so a client
// disconnect no longer makes net/http cancel the context that bifrost's stream
// goroutine is watching (issue #9).
//
// That cancellation is what destroyed the authoritative usage trailer — the
// very record needed to bill the tokens the provider had already generated —
// and it is why simply draining the channel after a disconnect billed nothing.
// The returned streamCancel hands that decision to us instead: the SSE loop
// cancels on clean completion, and on an early exit the detached drain cancels
// once the trailer arrives or the grace period expires.
//
// The caller MUST ensure cancel is eventually invoked on every path (it is
// idempotent). Values — the virtual-key/project handle and user ID, on which
// per-project credential resolution depends — survive WithoutCancel unchanged.
func (h *Handler) newStreamContext(w http.ResponseWriter, r *http.Request) (*schemas.BifrostContext, *streamCancel, bool) {
	ctx, sc, ok := h.buildContext(w, r, h.streamGrace > 0)
	if ok && h.streamCtxHook != nil {
		h.streamCtxHook(ctx)
	}
	return ctx, sc, ok
}

// requestContext picks the streaming or unary context for a handler that serves
// both from one body (Chat, Responses, Messages). The caller owns the returned
// cancel until it hands it to a stream loop.
func (h *Handler) requestContext(w http.ResponseWriter, r *http.Request, streaming bool) (*schemas.BifrostContext, *streamCancel, bool) {
	if streaming {
		return h.newStreamContext(w, r)
	}
	return h.buildContext(w, r, false)
}

// buildContext is the shared body of newContext / newStreamContext. When
// detach is false the returned context inherits request cancellation exactly as
// before; the cancel is still returned so callers can release the context's
// watcher deterministically.
func (h *Handler) buildContext(w http.ResponseWriter, r *http.Request, detach bool) (*schemas.BifrostContext, *streamCancel, bool) {
	if !verifySignature(r.Header, h.identitySecret) {
		writeError(w, http.StatusForbidden, "permission_error", "invalid identity signature", "")
		return nil, nil, false
	}

	// Unary (and grace-disabled streaming) requests inherit the request's
	// cancellation so a client disconnect propagates into core; no deadline
	// (the SSE path is long-lived, §9.5).
	parent := r.Context()
	if detach {
		parent = context.WithoutCancel(r.Context())
	}
	ctx, cancel := schemas.NewBifrostContextWithCancel(parent)
	sc := &streamCancel{fn: cancel}

	// vk = the resolved projectID handle (never the raw key). Only set when
	// present; a missing project is fatal at the gateway only when
	// IsVkMandatory is on (governance, BF0.4), not here.
	//
	// FIX #24: also propagate the caller's user ID so usage attribution and
	// audit trails carry the originating user, not just the project.
	if id := identityFromHeaders(r.Header); id.projectID != "" {
		ctx.SetValue(schemas.BifrostContextKeyVirtualKey, id.projectID)
		if id.userID != "" {
			ctx.SetValue(schemas.BifrostContextKeyUserID, id.userID)
		}
	}
	return ctx, sc, true
}

// finish applies the response-header hygiene every /llm response gets: strip
// provider/litellm leakage and stamp the platform server name (design §2,
// §6.3). It must run before the status line is written.
func finish(h http.Header) {
	for k := range h {
		lk := canonicalLower(k)
		if hasPrefix(lk, "x-litellm-") || hasPrefix(lk, "llm_provider-") {
			h.Del(k)
		}
	}
	h.Set("Server", "Centry")
}

// ---- OpenAI dialect (catch-all /llm/v1/*) ----

// Chat handles POST /llm/v1/chat/completions. It streams when the body sets
// "stream": true, else returns a unary chat completion.
func (h *Handler) Chat(w http.ResponseWriter, r *http.Request) {
	// t0 anchors the hop-overhead measurement (design §10.2 / gate BFF.9d).
	// X-Elapsed-Ms reports the gateway's PRE-DISPATCH overhead — body decode,
	// identity verification, loop breaker and the NATS budget check — i.e.
	// everything between accepting the request and handing it to the router.
	// It deliberately does NOT include what happens inside the router call:
	// per-request credential resolution (Account/vault lookup) and core routing
	// run there, inseparably from the provider round-trip, so no measurement
	// taken outside the router can attribute them. The k6 overhead script
	// consumes this header and must be read as "pre-dispatch overhead", not
	// "total gateway overhead".
	t0 := time.Now()
	var req openai.OpenAIChatRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	streaming := isStream(req.Stream)
	ctx, sc, ok := h.requestContext(w, r, streaming)
	if !ok {
		return
	}
	bifReq := req.ToBifrostChatRequest(ctx)

	provider, model := providerModelFromChatReq(bifReq)
	// Pre-flight budget check. promptTokenEst=0 is safe here — the Chat wire
	// format does not expose a pre-counted prompt token count. The FSM uses
	// reqCostNano only for the FRESH_NEAR per-replica cap; 0 never over-gates.
	if !h.checkBudget(w, ctx, provider, model, 0) {
		sc.cancel() // blocked before dispatch: nothing owns the context
		return
	}

	if streaming {
		ch, bErr := h.router.ChatCompletionStreamRequest(ctx, bifReq)
		// FIX #5: pass billing context so streamOpenAI can call updateUsage
		// after the channel drains with the final usage-carrying chunk.
		// Issue #9: streamOpenAI takes ownership of sc — it settles the stream
		// inline on a clean close, or hands both channel and cancel to the
		// detached drain on an early exit.
		h.streamOpenAI(w, r.Context().Done(), ctx, sc, provider, model, ch, bErr)
		return
	}
	defer sc.cancel()
	// Stamp the header BEFORE dispatch: the value is the pre-dispatch overhead
	// (see t0 above), and headers must be set before the first body write anyway.
	setElapsedHeader(w, time.Since(t0))
	resp, bErr := h.router.ChatCompletionRequest(ctx, bifReq)
	// Write the response FIRST (client-visible), then bill asynchronously.
	// updateUsage spawns a bounded goroutine so the HTTP response latency does
	// not include the NATS billing round-trip (FIX #18).
	h.writeUnary(w, resp, bErr)
	if bErr == nil && resp != nil {
		in, out := usageFromChatResponse(resp)
		h.updateUsage(ctx, provider, model, in, out, identityProjectFromCtx(ctx))
	}
}

// TextCompletion handles POST /llm/v1/completions (legacy text completions).
func (h *Handler) TextCompletion(w http.ResponseWriter, r *http.Request) {
	var req openai.OpenAITextCompletionRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	ctx, ok := h.newContext(w, r)
	if !ok {
		return
	}
	bifReq := req.ToBifrostTextCompletionRequest(ctx)

	// FIX #4: enforce the budget gate before calling the provider.
	provider, model := providerModelFromTextReq(bifReq)
	if !h.checkBudget(w, ctx, provider, model, 0) {
		return
	}

	resp, bErr := h.router.TextCompletionRequest(ctx, bifReq)
	h.writeUnary(w, resp, bErr)
	if bErr == nil && resp != nil {
		in, out := usageFromTextCompletionResponse(resp)
		h.updateUsage(ctx, provider, model, in, out, identityProjectFromCtx(ctx))
	}
}

// Embeddings handles POST /llm/v1/embeddings.
func (h *Handler) Embeddings(w http.ResponseWriter, r *http.Request) {
	var req openai.OpenAIEmbeddingRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	ctx, ok := h.newContext(w, r)
	if !ok {
		return
	}
	bifReq := req.ToBifrostEmbeddingRequest(ctx)

	// FIX #4: enforce the budget gate before calling the provider.
	provider, model := providerModelFromEmbeddingReq(bifReq)
	if !h.checkBudget(w, ctx, provider, model, 0) {
		return
	}

	resp, bErr := h.router.EmbeddingRequest(ctx, bifReq)
	h.writeUnary(w, resp, bErr)
	if bErr == nil && resp != nil {
		in, out := usageFromEmbeddingResponse(resp)
		h.updateUsage(ctx, provider, model, in, out, identityProjectFromCtx(ctx))
	}
}

// Responses handles POST /llm/v1/responses (OpenAI Responses API). It streams
// when the body sets "stream": true.
func (h *Handler) Responses(w http.ResponseWriter, r *http.Request) {
	var req openai.OpenAIResponsesRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	streaming := isStream(req.Stream)
	ctx, sc, ok := h.requestContext(w, r, streaming)
	if !ok {
		return
	}
	bifReq := req.ToBifrostResponsesRequest(ctx)

	// FIX #3: enforce the budget gate before calling the provider (mirrors Messages).
	provider, model := providerModelFromResponsesReq(bifReq)
	if !h.checkBudget(w, ctx, provider, model, 0) {
		sc.cancel() // blocked before dispatch: nothing owns the context
		return
	}

	if streaming {
		ch, bErr := h.router.ResponsesStreamRequest(ctx, bifReq)
		// FIX #5: pass billing context so streamResponses can call updateUsage
		// after the channel drains with the final usage chunk.
		h.streamResponses(w, r.Context().Done(), ctx, sc, provider, model, ch, bErr, false)
		return
	}
	defer sc.cancel()
	resp, bErr := h.router.ResponsesRequest(ctx, bifReq)
	h.writeUnary(w, resp, bErr)
	// FIX #3: bill the unary response after writing to the client.
	if bErr == nil && resp != nil {
		in, out := usageFromResponsesResponse(resp)
		h.updateUsage(ctx, provider, model, in, out, identityProjectFromCtx(ctx))
	}
}

// ImageGeneration handles POST /llm/v1/images/generations (JSON body).
func (h *Handler) ImageGeneration(w http.ResponseWriter, r *http.Request) {
	var req openai.OpenAIImageGenerationRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	ctx, ok := h.newContext(w, r)
	if !ok {
		return
	}
	bifReq := req.ToBifrostImageGenerationRequest(ctx)

	// FIX #26: enforce the budget gate before calling the image provider.
	// Image generation can be expensive; an over-budget project must be
	// blocked before any provider call incurs real cost.
	// promptTokenEst=0 is correct here — image requests have no prompt
	// token pre-count available. The FSM uses reqCostNano only for the
	// FRESH_NEAR per-replica cap; passing 0 is conservative (never over-gates).
	provider, model := providerModelFromImageGenReq(bifReq)
	if !h.checkBudget(w, ctx, provider, model, 0) {
		return
	}

	resp, bErr := h.router.ImageGenerationRequest(ctx, bifReq)
	// Write the response first, then bill asynchronously (FIX #18).
	h.writeUnary(w, resp, bErr)
	if bErr == nil && resp != nil {
		// Fix round-3 #8: bill image responses that carry no token Usage by
		// falling back to a fixed per-image cost (perImageFallbackNano).
		// usageFromImageResponse returns (in, out, imgCount):
		//   - Usage != nil  →  in/out populated, imgCount = 0  →  normal token path.
		//   - Usage == nil  →  in=out=0, imgCount = len(Data)  →  direct billing path.
		in, out, imgCount := usageFromImageResponse(resp)
		if in > 0 || out > 0 {
			h.updateUsage(ctx, provider, model, in, out, identityProjectFromCtx(ctx))
		} else if imgCount > 0 {
			h.updateUsageDirect(ctx, identityProjectFromCtx(ctx), imgCount*perImageFallbackNano)
		}
	}
}

// ---- Anthropic dialect (exact /llm/v1/messages) ----

// Messages handles POST /llm/v1/messages. In bifrost/core v1.7.3 the Anthropic
// messages surface routes through the Responses API
// (RouteConfigTypeAnthropic): the body converts via ToBifrostResponsesRequest
// and streaming uses ResponsesStreamRequest with the Anthropic stream-event
// framing (design §6.2; corrects the stale "uses Chat" table).
func (h *Handler) Messages(w http.ResponseWriter, r *http.Request) {
	var req anthropic.AnthropicMessageRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	streaming := isStream(req.Stream)
	ctx, sc, ok := h.requestContext(w, r, streaming)
	if !ok {
		return
	}
	bifReq := req.ToBifrostResponsesRequest(ctx)

	provider, model := providerModelFromResponsesReq(bifReq)
	// Pre-flight budget check. promptTokenEst=0 (see Chat handler comment).
	if !h.checkBudget(w, ctx, provider, model, 0) {
		sc.cancel() // blocked before dispatch: nothing owns the context
		return
	}

	if streaming {
		ch, bErr := h.router.ResponsesStreamRequest(ctx, bifReq)
		// FIX #5: pass billing context so streamAnthropic can call updateUsage
		// after the channel drains with the final usage-carrying chunk.
		h.streamAnthropic(w, r.Context().Done(), ctx, sc, provider, model, ch, bErr)
		return
	}
	defer sc.cancel()
	resp, bErr := h.router.ResponsesRequest(ctx, bifReq)
	if bErr != nil {
		// Fix round-3 #4: spec §2.5 mandates OpenAI-shaped errors on ALL /llm
		// routes, including /llm/v1/messages. Use writeOpenAIError, not
		// writeAnthropicError, so the error body is {"error":{message,type,code}}.
		h.writeOpenAIError(w, bErr)
		return
	}
	// Write the response first, then bill asynchronously (FIX #18).
	writeJSON(w, http.StatusOK, anthropic.ToAnthropicResponsesResponse(ctx, resp))
	in, out := usageFromResponsesResponse(resp)
	h.updateUsage(ctx, provider, model, in, out, identityProjectFromCtx(ctx))
}

// CountTokens handles POST /llm/v1/messages/count_tokens — a synchronous
// (non-SSE) Anthropic token count backed by CountTokensRequest.
func (h *Handler) CountTokens(w http.ResponseWriter, r *http.Request) {
	var req anthropic.AnthropicMessageRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	ctx, ok := h.newContext(w, r)
	if !ok {
		return
	}
	bifReq := req.ToBifrostResponsesRequest(ctx)
	// Budget gate BEFORE the provider — count_tokens is a provider call and must
	// be admission-gated like every other /llm endpoint (uniform gating,
	// DECISIONS.md). No updateUsage after: CountTokensResponse carries no billable
	// usage, so there is nothing to meter post-response.
	provider, model := providerModelFromResponsesReq(bifReq)
	if !h.checkBudget(w, ctx, provider, model, 0) {
		return
	}
	resp, bErr := h.router.CountTokensRequest(ctx, bifReq)
	if bErr != nil {
		// Fix round-3 #4: spec §2.5 — OpenAI-shaped errors on ALL /llm routes.
		h.writeOpenAIError(w, bErr)
		return
	}
	writeJSON(w, http.StatusOK, anthropic.ToAnthropicCountTokensResponse(resp))
}

// MessagesSubPath handles unknown POST /llm/v1/messages/{suffix} paths. Only
// count_tokens is a real Anthropic sub-path; everything else is 404 rather than
// being misrouted to the OpenAI catch-all.
func (h *Handler) MessagesSubPath(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotFound, "invalid_request_error", "unknown messages sub-path", "")
}

// ---- synthetic models surface (GET /llm/v1/models, not routed through core) ----

// Models handles GET /llm/v1/models. The set is synthesised from the calling
// project's Postgres configuration (section 'llm'), NOT routed through
// bifrost/core (design §4.2, §3.4). Response is the OpenAI list envelope.
func (h *Handler) Models(w http.ResponseWriter, r *http.Request) {
	projectID, ok := h.modelsProjectID(w, r)
	if !ok {
		return
	}
	list := modelsList{Object: modelsListType, Data: h.modelList(r.Context(), projectID)}
	writeJSON(w, http.StatusOK, list)
}

// Model handles GET /llm/v1/models/{name}: a single-model lookup returning 200
// with the model object when the calling project has it, else 404.
func (h *Handler) Model(w http.ResponseWriter, r *http.Request) {
	projectID, ok := h.modelsProjectID(w, r)
	if !ok {
		return
	}
	name := modelNameFromPath(r.URL.Path)
	if name == "" {
		writeError(w, http.StatusNotFound, "invalid_request_error", "unknown model", "")
		return
	}
	if h.models == nil {
		writeError(w, http.StatusNotFound, "invalid_request_error", "unknown model", "")
		return
	}
	mo, found := h.models.Get(r.Context(), projectID, name)
	if !found {
		writeError(w, http.StatusNotFound, "invalid_request_error", "unknown model", "")
		return
	}
	writeJSON(w, http.StatusOK, mo)
}

// modelsProjectID verifies the edge's signed identity and returns the resolved
// projectID. It writes a 403 and returns ok=false on an invalid signature
// (matching newContext); a missing project id resolves to "" (an empty model
// set), never an error.
func (h *Handler) modelsProjectID(w http.ResponseWriter, r *http.Request) (string, bool) {
	if !verifySignature(r.Header, h.identitySecret) {
		writeError(w, http.StatusForbidden, "permission_error", "invalid identity signature", "")
		return "", false
	}
	return identityFromHeaders(r.Header).projectID, true
}

// modelList resolves the project's synthesised model set, tolerating a nil
// resolver (gateway booted without a database ⇒ empty set).
func (h *Handler) modelList(ctx context.Context, projectID string) []modelObject {
	if h.models == nil {
		return []modelObject{}
	}
	return h.models.List(ctx, projectID)
}

// modelNameFromPath extracts the {name} segment from a /llm/v1/models/{name}
// path. Model ids may themselves contain slashes (e.g. "openai/gpt-4o"), so the
// whole remainder after the "/models/" prefix is the id, URL-unescaped.
func modelNameFromPath(path string) string {
	const prefix = "/llm/v1/models/"
	i := strings.Index(path, prefix)
	if i < 0 {
		return ""
	}
	name := path[i+len(prefix):]
	if unescaped, err := url.PathUnescape(name); err == nil {
		name = unescaped
	}
	return strings.Trim(name, "/")
}

// NotFound writes an OpenAI-shaped 404 for any unmounted /llm path so the
// surface returns a structured error body rather than chi's bare 404 text.
func (h *Handler) NotFound(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotFound, "invalid_request_error", "unknown route", "")
}

// MethodNotAllowed writes an OpenAI-shaped 405 for a known path hit with the
// wrong method.
func (h *Handler) MethodNotAllowed(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusMethodNotAllowed, "invalid_request_error", "method not allowed", "")
}

// ---- shared response helpers ----

// writeUnary marshals a successful bifrost response as JSON, or maps a
// *schemas.BifrostError to an OpenAI-shaped error body with the right status.
func (h *Handler) writeUnary(w http.ResponseWriter, resp interface{}, bErr *schemas.BifrostError) {
	if bErr != nil {
		h.writeOpenAIError(w, bErr)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// streamOpenAI writes the OpenAI SSE framing: each chunk is a data-only frame,
// then a terminal "data: [DONE]" marker on normal completion. A mid-stream
// error is emitted as a data frame carrying the OpenAI-shaped error and ends
// the stream (no [DONE]).
//
// FIX #5: the final usage-carrying chunk (BifrostChatResponse.Usage != nil)
// is captured; after the channel drains updateUsage is called with the real
// streamed token counts.
//
// Issue #9: every early exit hands the still-open channel AND the stream
// cancel to a detached drain instead of returning, so a client that
// disconnects mid-stream is still billed from the provider's own usage trailer
// if it arrives within the grace period — and the loss is metered if it does
// not. sc is owned by this function from here on and is settled exactly once.
func (h *Handler) streamOpenAI(
	w http.ResponseWriter,
	clientGone <-chan struct{},
	ctx *schemas.BifrostContext,
	sc *streamCancel,
	provider, model string,
	ch chan *schemas.BifrostStreamChunk,
	bErr *schemas.BifrostError,
) {
	if bErr != nil {
		sc.cancel()
		h.writeOpenAIError(w, bErr)
		return
	}
	if ch == nil {
		// A nil channel with a nil error is a router contract violation
		// (observed from bifrost's responses-stream path); ranging over it
		// would hang the request forever. Surface it as a 502 instead.
		sc.cancel()
		h.logger.Error("stream router returned nil channel with nil error", "provider", provider, "model", model)
		writeError(w, http.StatusBadGateway, "api_error",
			"upstream stream could not be established", "bad_gateway")
		return
	}
	s := h.newChatSettler("streamOpenAI", ctx, sc, provider, model, ch)
	sw, err := h.beginStream(w)
	if err != nil {
		// The provider stream is already open; it must be drained (and billed)
		// even though we can never write it to this client.
		s.settleEarly(lossReasonBeginStreamFail)
		return
	}
	for {
		chunk, more := nextChunk(ch, clientGone)
		if !more {
			if chunk == nil && isClientGone(clientGone) {
				// The client vanished while the provider was silent. Without
				// this the loop would park here until the provider's own idle
				// timeout, because the provider stream no longer dies with the
				// request (issue #9).
				s.settleEarly(lossReasonClientGone)
				return
			}
			break
		}
		if chunk == nil {
			continue
		}
		if chunk.BifrostError != nil {
			data, _ := json.Marshal(openAIErrorBody(chunk.BifrostError))
			_ = sw.Data(string(data))
			s.settleEarly(lossReasonProviderError)
			return
		}
		// Capture usage from the final usage-carrying chunk (providers send
		// usage in the last chunk before [DONE]; earlier chunks have Usage=nil).
		s.observe(chunk)
		data, mErr := json.Marshal(chunk)
		if mErr != nil {
			h.logger.Warn("marshal stream chunk", "err", mErr)
			continue
		}
		if writeErr := sw.Data(string(data)); writeErr != nil {
			s.settleEarly(lossReasonWriteError) // client disconnected
			return
		}
	}
	_ = sw.Data("[DONE]")
	// Bill after the channel drains successfully.
	s.settleClean()
}

// streamResponses writes the OpenAI Responses-API SSE framing: each chunk
// carries its own event type (resp.Type) and no [DONE] marker. sendDone is
// kept for symmetry but is false for the Responses API.
//
// FIX #5: the "response.completed" event carries Response.Usage; usage is
// captured from that chunk and updateUsage is called after the channel drains.
// Issue #9: see streamOpenAI — every early exit hands the open channel and the
// stream cancel to the detached drain.
func (h *Handler) streamResponses(
	w http.ResponseWriter,
	clientGone <-chan struct{},
	ctx *schemas.BifrostContext,
	sc *streamCancel,
	provider, model string,
	ch chan *schemas.BifrostStreamChunk,
	bErr *schemas.BifrostError,
	sendDone bool,
) {
	if bErr != nil {
		sc.cancel()
		h.writeOpenAIError(w, bErr)
		return
	}
	if ch == nil {
		// A nil channel with a nil error is a router contract violation
		// (observed from bifrost's responses-stream path); ranging over it
		// would hang the request forever. Surface it as a 502 instead.
		sc.cancel()
		h.logger.Error("stream router returned nil channel with nil error", "provider", provider, "model", model)
		writeError(w, http.StatusBadGateway, "api_error",
			"upstream stream could not be established", "bad_gateway")
		return
	}
	s := h.newResponsesSettler("streamResponses", ctx, sc, provider, model, ch)
	sw, err := h.beginStream(w)
	if err != nil {
		s.settleEarly(lossReasonBeginStreamFail)
		return
	}
	for {
		chunk, more := nextChunk(ch, clientGone)
		if !more {
			if chunk == nil && isClientGone(clientGone) {
				s.settleEarly(lossReasonClientGone)
				return
			}
			break
		}
		if chunk == nil {
			continue
		}
		if chunk.BifrostError != nil {
			data, _ := json.Marshal(openAIErrorBody(chunk.BifrostError))
			_ = sw.Event("error", string(data))
			s.settleEarly(lossReasonProviderError)
			return
		}
		if chunk.BifrostResponsesStreamResponse == nil {
			continue
		}
		// Capture usage from the response.completed event (carries Response.Usage).
		s.observe(chunk)
		sr := chunk.BifrostResponsesStreamResponse
		event := string(sr.Type)
		data, mErr := json.Marshal(sr)
		if mErr != nil {
			h.logger.Warn("marshal responses chunk", "err", mErr)
			continue
		}
		if writeErr := sw.Event(event, string(data)); writeErr != nil {
			s.settleEarly(lossReasonWriteError)
			return
		}
	}
	if sendDone {
		_ = sw.Data("[DONE]")
	}
	// Bill after the channel drains successfully.
	s.settleClean()
}

// streamAnthropic writes the Anthropic SSE framing: each Responses stream chunk
// is converted to one or more AnthropicStreamEvents ("event: <type>\ndata:
// ...") with NO [DONE] marker. A mid-stream error is emitted as the Anthropic
// "event: error" frame and ends the stream.
//
// FIX #5: usage is captured from the response.completed event (Response.Usage)
// and updateUsage is called after the channel drains successfully.
// Issue #9: see streamOpenAI — every early exit hands the open channel and the
// stream cancel to the detached drain.
func (h *Handler) streamAnthropic(
	w http.ResponseWriter,
	clientGone <-chan struct{},
	ctx *schemas.BifrostContext,
	sc *streamCancel,
	provider, model string,
	ch chan *schemas.BifrostStreamChunk,
	bErr *schemas.BifrostError,
) {
	if bErr != nil {
		// Fix round-3 #4: spec §2.5 — OpenAI-shaped errors on ALL /llm routes,
		// including the Anthropic /v1/messages streaming pre-error path.
		sc.cancel()
		h.writeOpenAIError(w, bErr)
		return
	}
	if ch == nil {
		// Router contract violation (nil chan + nil error) — see streamResponses.
		sc.cancel()
		h.logger.Error("stream router returned nil channel with nil error", "provider", provider, "model", model)
		writeError(w, http.StatusBadGateway, "api_error",
			"upstream stream could not be established", "bad_gateway")
		return
	}
	s := h.newResponsesSettler("streamAnthropic", ctx, sc, provider, model, ch)
	sw, err := h.beginStream(w)
	if err != nil {
		s.settleEarly(lossReasonBeginStreamFail)
		return
	}
	for {
		chunk, more := nextChunk(ch, clientGone)
		if !more {
			if chunk == nil && isClientGone(clientGone) {
				s.settleEarly(lossReasonClientGone)
				return
			}
			break
		}
		if chunk == nil {
			continue
		}
		if chunk.BifrostError != nil {
			// ToAnthropicResponsesStreamError returns a complete
			// "event: error\ndata: ...\n\n" frame.
			_ = sw.Raw(anthropic.ToAnthropicResponsesStreamError(chunk.BifrostError))
			s.settleEarly(lossReasonProviderError)
			return
		}
		if chunk.BifrostResponsesStreamResponse == nil {
			continue
		}
		// Capture usage from the response.completed event.
		s.observe(chunk)
		sr := chunk.BifrostResponsesStreamResponse
		events := anthropic.ToAnthropicResponsesStreamResponse(ctx, sr)
		for _, ev := range events {
			if ev == nil {
				continue
			}
			data, mErr := json.Marshal(ev)
			if mErr != nil {
				h.logger.Warn("marshal anthropic event", "err", mErr)
				continue
			}
			if writeErr := sw.Event(string(ev.Type), string(data)); writeErr != nil {
				s.settleEarly(lossReasonWriteError)
				return
			}
		}
	}
	// Bill after the channel drains successfully.
	s.settleClean()
}

// beginStream applies header hygiene, then constructs the SSE writer (which
// sets the streaming headers and clears the write deadline). On failure it
// writes a 500 and returns the error so the caller aborts.
//
// The SSE loop is only correct if the ResponseWriter supports per-chunk
// flushing: without http.Flusher the net/http server buffers the whole
// response and every stream chunk arrives at end-of-request, defeating the
// streaming contract (design §6.3). The precondition is asserted here (the
// handler owns the streaming decision) before delegating the framing to
// ssewriter, which re-checks and clears the write deadline.
func (h *Handler) beginStream(w http.ResponseWriter) (*ssewriter.Writer, error) {
	if _, ok := w.(http.Flusher); !ok {
		writeError(w, http.StatusInternalServerError, "api_error", "streaming unsupported", "")
		return nil, errStreamingUnsupported
	}
	finish(w.Header())
	sw, err := ssewriter.New(w)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "api_error", "streaming unsupported", "")
		return nil, err
	}
	return sw, nil
}
