package llmproxy

import (
	"encoding/json"
	"log/slog"
	"net/http"

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
}

// NewHandler builds a /llm Handler over the given router. logger may be nil
// (a discarding logger is substituted). identitySecret may be empty to disable
// HMAC verification of the forwarded identity headers.
func NewHandler(router LLMRouter, logger *slog.Logger, identitySecret []byte) *Handler {
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(discard{}, nil))
	}
	return &Handler{router: router, logger: logger, identitySecret: identitySecret}
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
	if id := identityFromHeaders(r.Header); id.projectID != "" {
		ctx.SetValue(schemas.BifrostContextKeyVirtualKey, id.projectID)
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

	if isStream(req.Stream) {
		ch, bErr := h.router.ChatCompletionStreamRequest(ctx, bifReq)
		h.streamOpenAI(w, ch, bErr)
		return
	}
	resp, bErr := h.router.ChatCompletionRequest(ctx, bifReq)
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
	resp, bErr := h.router.TextCompletionRequest(ctx, bifReq)
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
	resp, bErr := h.router.EmbeddingRequest(ctx, bifReq)
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

	if isStream(req.Stream) {
		ch, bErr := h.router.ResponsesStreamRequest(ctx, bifReq)
		// The Responses API signals completion by closing the stream (no
		// [DONE] marker), and frames carry their own event types.
		h.streamResponses(w, ch, bErr, false)
		return
	}
	resp, bErr := h.router.ResponsesRequest(ctx, bifReq)
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

	if isStream(req.Stream) {
		ch, bErr := h.router.ResponsesStreamRequest(ctx, bifReq)
		h.streamAnthropic(w, ctx, ch, bErr)
		return
	}
	resp, bErr := h.router.ResponsesRequest(ctx, bifReq)
	if bErr != nil {
		h.writeAnthropicError(w, bErr)
		return
	}
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
func (h *Handler) streamOpenAI(w http.ResponseWriter, ch chan *schemas.BifrostStreamChunk, bErr *schemas.BifrostError) {
	if bErr != nil {
		h.writeOpenAIError(w, bErr)
		return
	}
	sw, err := h.beginStream(w)
	if err != nil {
		return
	}
	for chunk := range ch {
		if chunk == nil {
			continue
		}
		if chunk.BifrostError != nil {
			data, _ := json.Marshal(openAIErrorBody(chunk.BifrostError))
			_ = sw.Data(string(data))
			return
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
}

// streamResponses writes the OpenAI Responses-API SSE framing: each chunk
// carries its own event type (resp.Type) and no [DONE] marker. sendDone is
// kept for symmetry but is false for the Responses API.
func (h *Handler) streamResponses(w http.ResponseWriter, ch chan *schemas.BifrostStreamChunk, bErr *schemas.BifrostError, sendDone bool) {
	if bErr != nil {
		h.writeOpenAIError(w, bErr)
		return
	}
	sw, err := h.beginStream(w)
	if err != nil {
		return
	}
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
		event := string(chunk.BifrostResponsesStreamResponse.Type)
		data, mErr := json.Marshal(chunk.BifrostResponsesStreamResponse)
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
}

// streamAnthropic writes the Anthropic SSE framing: each Responses stream chunk
// is converted to one or more AnthropicStreamEvents ("event: <type>\ndata:
// ...") with NO [DONE] marker. A mid-stream error is emitted as the Anthropic
// "event: error" frame and ends the stream.
func (h *Handler) streamAnthropic(w http.ResponseWriter, ctx *schemas.BifrostContext, ch chan *schemas.BifrostStreamChunk, bErr *schemas.BifrostError) {
	if bErr != nil {
		h.writeAnthropicError(w, bErr)
		return
	}
	sw, err := h.beginStream(w)
	if err != nil {
		return
	}
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
		events := anthropic.ToAnthropicResponsesStreamResponse(ctx, chunk.BifrostResponsesStreamResponse)
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
