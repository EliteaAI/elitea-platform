package llmproxy

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"strings"

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

// NewHandler builds a /llm Handler over the given router. logger may be nil
// (a discarding logger is substituted). identitySecret may be empty to disable
// HMAC verification of the forwarded identity headers. Optional features (the
// models resolver) are supplied via HandlerOption.
func NewHandler(router LLMRouter, logger *slog.Logger, identitySecret []byte, opts ...HandlerOption) *Handler {
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(discard{}, nil))
	}
	h := &Handler{router: router, logger: logger, identitySecret: identitySecret}
	for _, opt := range opts {
		opt(h)
	}
	return h
}

// discard is an io.Writer that drops everything; used for the nil-logger case.
type discard struct{}

func (discard) Write(p []byte) (int, error) { return len(p), nil }

// newContext builds a BifrostContext for a request, trusting the edge's signed
// identity headers on the mTLS-internal network and injecting the resolved
// projectID as the Bifrost virtual-key value (design §5.3). It returns false
// (after writing a 403) when a configured identity secret does not verify.
func (h *Handler) newContext(w http.ResponseWriter, r *http.Request) (*schemas.BifrostContext, bool) {
	if !verifySignature(r.Header, h.identitySecret) {
		writeError(w, http.StatusForbidden, "permission_error", "invalid identity signature", "")
		return nil, false
	}

	// Inherit the request's cancellation so a client disconnect propagates into
	// core; no deadline (the SSE path is long-lived, §9.5).
	ctx := schemas.NewBifrostContext(r.Context(), schemas.NoDeadline)

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
	return ctx, true
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
	var req openai.OpenAIChatRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	ctx, ok := h.newContext(w, r)
	if !ok {
		return
	}
	bifReq := req.ToBifrostChatRequest(ctx)

	provider, model := providerModelFromChatReq(bifReq)
	// Pre-flight budget check. promptTokenEst=0 is safe here — the Chat wire
	// format does not expose a pre-counted prompt token count. The FSM uses
	// reqCostNano only for the FRESH_NEAR per-replica cap; 0 never over-gates.
	if !h.checkBudget(w, ctx, provider, model, 0) {
		return
	}

	if isStream(req.Stream) {
		ch, bErr := h.router.ChatCompletionStreamRequest(ctx, bifReq)
		// FIX #5: pass billing context so streamOpenAI can call updateUsage
		// after the channel drains with the final usage-carrying chunk.
		h.streamOpenAI(w, ctx, provider, model, ch, bErr)
		return
	}
	resp, bErr := h.router.ChatCompletionRequest(ctx, bifReq)
	if bErr == nil && resp != nil {
		in, out := usageFromChatResponse(resp)
		h.updateUsage(ctx, provider, model, in, out, identityProjectFromCtx(ctx))
	}
	h.writeUnary(w, resp, bErr)
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
	if bErr == nil && resp != nil {
		in, out := usageFromTextCompletionResponse(resp)
		h.updateUsage(ctx, provider, model, in, out, identityProjectFromCtx(ctx))
	}
	h.writeUnary(w, resp, bErr)
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
	if bErr == nil && resp != nil {
		in, out := usageFromEmbeddingResponse(resp)
		h.updateUsage(ctx, provider, model, in, out, identityProjectFromCtx(ctx))
	}
	h.writeUnary(w, resp, bErr)
}

// Responses handles POST /llm/v1/responses (OpenAI Responses API). It streams
// when the body sets "stream": true.
func (h *Handler) Responses(w http.ResponseWriter, r *http.Request) {
	var req openai.OpenAIResponsesRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	ctx, ok := h.newContext(w, r)
	if !ok {
		return
	}
	bifReq := req.ToBifrostResponsesRequest(ctx)

	// FIX #3: enforce the budget gate before calling the provider (mirrors Messages).
	provider, model := providerModelFromResponsesReq(bifReq)
	if !h.checkBudget(w, ctx, provider, model, 0) {
		return
	}

	if isStream(req.Stream) {
		ch, bErr := h.router.ResponsesStreamRequest(ctx, bifReq)
		// FIX #5: pass billing context so streamResponses can call updateUsage
		// after the channel drains with the final usage chunk.
		h.streamResponses(w, ctx, provider, model, ch, bErr, false)
		return
	}
	resp, bErr := h.router.ResponsesRequest(ctx, bifReq)
	// FIX #3: bill the unary response after a successful completion.
	if bErr == nil && resp != nil {
		in, out := usageFromResponsesResponse(resp)
		h.updateUsage(ctx, provider, model, in, out, identityProjectFromCtx(ctx))
	}
	h.writeUnary(w, resp, bErr)
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
	resp, bErr := h.router.ImageGenerationRequest(ctx, bifReq)
	h.writeUnary(w, resp, bErr)
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
	ctx, ok := h.newContext(w, r)
	if !ok {
		return
	}
	bifReq := req.ToBifrostResponsesRequest(ctx)

	provider, model := providerModelFromResponsesReq(bifReq)
	// Pre-flight budget check. promptTokenEst=0 (see Chat handler comment).
	if !h.checkBudget(w, ctx, provider, model, 0) {
		return
	}

	if isStream(req.Stream) {
		ch, bErr := h.router.ResponsesStreamRequest(ctx, bifReq)
		// FIX #5: pass billing context so streamAnthropic can call updateUsage
		// after the channel drains with the final usage-carrying chunk.
		h.streamAnthropic(w, ctx, provider, model, ch, bErr)
		return
	}
	resp, bErr := h.router.ResponsesRequest(ctx, bifReq)
	if bErr != nil {
		h.writeAnthropicError(w, bErr)
		return
	}
	in, out := usageFromResponsesResponse(resp)
	h.updateUsage(ctx, provider, model, in, out, identityProjectFromCtx(ctx))
	writeJSON(w, http.StatusOK, anthropic.ToAnthropicResponsesResponse(ctx, resp))
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
	resp, bErr := h.router.CountTokensRequest(ctx, bifReq)
	if bErr != nil {
		h.writeAnthropicError(w, bErr)
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
// streamed token counts. If no usage chunk appears a warning is logged.
func (h *Handler) streamOpenAI(
	w http.ResponseWriter,
	ctx *schemas.BifrostContext,
	provider, model string,
	ch chan *schemas.BifrostStreamChunk,
	bErr *schemas.BifrostError,
) {
	if bErr != nil {
		h.writeOpenAIError(w, bErr)
		return
	}
	sw, err := h.beginStream(w)
	if err != nil {
		return
	}
	var (
		streamedIn, streamedOut int64
		gotUsage                bool
	)
	for chunk := range ch {
		if chunk == nil {
			continue
		}
		if chunk.BifrostError != nil {
			data, _ := json.Marshal(openAIErrorBody(chunk.BifrostError))
			_ = sw.Data(string(data))
			return
		}
		// Capture usage from the final usage-carrying chunk (providers send
		// usage in the last chunk before [DONE]; earlier chunks have Usage=nil).
		if chunk.BifrostChatResponse != nil && chunk.BifrostChatResponse.Usage != nil {
			streamedIn, streamedOut = usageFromChatResponse(chunk.BifrostChatResponse)
			gotUsage = true
		}
		data, mErr := json.Marshal(chunk)
		if mErr != nil {
			h.logger.Warn("marshal stream chunk", "err", mErr)
			continue
		}
		if writeErr := sw.Data(string(data)); writeErr != nil {
			return // client disconnected
		}
	}
	_ = sw.Data("[DONE]")
	// Bill after the channel drains successfully.
	if gotUsage {
		h.updateUsage(ctx, provider, model, streamedIn, streamedOut, identityProjectFromCtx(ctx))
	} else {
		h.logger.Warn("streamOpenAI: no usage chunk in stream; response unbilled",
			"provider", provider, "model", model)
	}
}

// streamResponses writes the OpenAI Responses-API SSE framing: each chunk
// carries its own event type (resp.Type) and no [DONE] marker. sendDone is
// kept for symmetry but is false for the Responses API.
//
// FIX #5: the "response.completed" event carries Response.Usage; usage is
// captured from that chunk and updateUsage is called after the channel drains.
func (h *Handler) streamResponses(
	w http.ResponseWriter,
	ctx *schemas.BifrostContext,
	provider, model string,
	ch chan *schemas.BifrostStreamChunk,
	bErr *schemas.BifrostError,
	sendDone bool,
) {
	if bErr != nil {
		h.writeOpenAIError(w, bErr)
		return
	}
	sw, err := h.beginStream(w)
	if err != nil {
		return
	}
	var (
		streamedIn, streamedOut int64
		gotUsage                bool
	)
	for chunk := range ch {
		if chunk == nil {
			continue
		}
		if chunk.BifrostError != nil {
			data, _ := json.Marshal(openAIErrorBody(chunk.BifrostError))
			_ = sw.Event("error", string(data))
			return
		}
		if chunk.BifrostResponsesStreamResponse == nil {
			continue
		}
		// Capture usage from the response.completed event (carries Response.Usage).
		sr := chunk.BifrostResponsesStreamResponse
		if sr.Response != nil && sr.Response.Usage != nil {
			streamedIn, streamedOut = usageFromResponsesResponse(sr.Response)
			gotUsage = true
		}
		event := string(sr.Type)
		data, mErr := json.Marshal(sr)
		if mErr != nil {
			h.logger.Warn("marshal responses chunk", "err", mErr)
			continue
		}
		if writeErr := sw.Event(event, string(data)); writeErr != nil {
			return
		}
	}
	if sendDone {
		_ = sw.Data("[DONE]")
	}
	// Bill after the channel drains successfully.
	if gotUsage {
		h.updateUsage(ctx, provider, model, streamedIn, streamedOut, identityProjectFromCtx(ctx))
	} else {
		h.logger.Warn("streamResponses: no usage in stream; response unbilled",
			"provider", provider, "model", model)
	}
}

// streamAnthropic writes the Anthropic SSE framing: each Responses stream chunk
// is converted to one or more AnthropicStreamEvents ("event: <type>\ndata:
// ...") with NO [DONE] marker. A mid-stream error is emitted as the Anthropic
// "event: error" frame and ends the stream.
//
// FIX #5: usage is captured from the response.completed event (Response.Usage)
// and updateUsage is called after the channel drains successfully.
func (h *Handler) streamAnthropic(
	w http.ResponseWriter,
	ctx *schemas.BifrostContext,
	provider, model string,
	ch chan *schemas.BifrostStreamChunk,
	bErr *schemas.BifrostError,
) {
	if bErr != nil {
		h.writeAnthropicError(w, bErr)
		return
	}
	sw, err := h.beginStream(w)
	if err != nil {
		return
	}
	var (
		streamedIn, streamedOut int64
		gotUsage                bool
	)
	for chunk := range ch {
		if chunk == nil {
			continue
		}
		if chunk.BifrostError != nil {
			// ToAnthropicResponsesStreamError returns a complete
			// "event: error\ndata: ...\n\n" frame.
			_ = sw.Raw(anthropic.ToAnthropicResponsesStreamError(chunk.BifrostError))
			return
		}
		if chunk.BifrostResponsesStreamResponse == nil {
			continue
		}
		// Capture usage from the response.completed event.
		sr := chunk.BifrostResponsesStreamResponse
		if sr.Response != nil && sr.Response.Usage != nil {
			streamedIn, streamedOut = usageFromResponsesResponse(sr.Response)
			gotUsage = true
		}
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
				return
			}
		}
	}
	// Bill after the channel drains successfully.
	if gotUsage {
		h.updateUsage(ctx, provider, model, streamedIn, streamedOut, identityProjectFromCtx(ctx))
	} else {
		h.logger.Warn("streamAnthropic: no usage in stream; response unbilled",
			"provider", provider, "model", model)
	}
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
