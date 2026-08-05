package llmproxy

// stream_drain.go — settles billing for a streamed response whose SSE loop
// exited before the provider's authoritative usage trailer arrived (issue #9,
// DECISIONS.md 2026-08-05).
//
// The problem: all three SSE dialects bill only from the final usage chunk. Any
// early exit — client disconnect (SSE write error), mid-stream provider error,
// failed stream setup — returned before that chunk, so the whole streamed
// response was unbilled. Disconnecting just before stream end yielded free
// inference: a reachable hard-budget bypass.
//
// Why a drain alone does not fix it: the chunk producer is bifrost's stream
// goroutine, and it is bound to the context the handler hands to core. When
// that context is the request context, net/http cancels it on client
// disconnect, bifrost returns from its read loop
// (providers/openai/openai.go: `select { case <-ctx.Done(): return }`) and
// SetupStreamCancellation closes the raw provider socket. The trailer is
// destroyed by the very cancellation we are trying to bill for, and a drain
// drains a dead channel. This is what sank the first attempt (see
// wip/round5-6-unshipped).
//
// The fix, in two halves:
//  1. newStreamContext builds the provider context from
//     context.WithoutCancel(r.Context()) and hands the handler an explicit
//     cancel (streamCancel). A client disconnect no longer tears the provider
//     stream down; we decide when it dies.
//  2. On early exit the still-live channel is handed to a detached drain
//     (streamSettler.settleEarly) which waits up to the grace period for the
//     authoritative usage chunk, then cancels.
//
// What is deliberately NOT here: any estimate. If the trailer does not arrive,
// NOTHING is billed and a budget.unbilled_stream event is emitted instead. An
// observed-output-bytes estimate on the money path was the second rejected
// attempt: it contradicts the standing "estimates feed ONLY the reservation —
// never the money path" rule, over-bills inline-base64 multimodal by orders of
// magnitude, and cannot tell a clean close from a disconnect. observedOutBytes
// below is an OBSERVABILITY dimension on the loss event only; it must never
// reach a cost calculation.

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
)

// Stream-grace bounds (DECISIONS.md 2026-08-05). At a typical 40–120 output
// tokens/sec, 5 s covers roughly the last ~400 generated tokens — the window in
// which a "disconnect just before the end" would otherwise buy free inference.
// Past ~15 s we would no longer be catching a trailer, only financing an
// abandoned generation, so the configured value is clamped.
const (
	DefaultStreamGrace = 5 * time.Second
	MaxStreamGrace     = 15 * time.Second

	// DefaultStreamDrainLimit bounds how many abandoned streams may be kept
	// alive concurrently. Each one holds a goroutine AND an open provider
	// socket for up to the grace period, so a disconnect storm without this
	// bound is a resource amplifier pointed at both us and the provider.
	DefaultStreamDrainLimit = 256

	// drainHardTimeout bounds the wait AFTER the provider context is cancelled.
	// Cancellation makes bifrost close the socket and `defer CloseStream`, so
	// the channel closes promptly in every normal case; this is the backstop
	// for a wedged provider, and it caps how long a drain can run in total
	// (grace + drainHardTimeout).
	drainHardTimeout = 10 * time.Second
)

// Exit reasons for a stream that produced no authoritative usage. Emitted as
// the `reason` dimension of budget.unbilled_stream — keep the set closed so it
// is alarmable.
const (
	lossReasonWriteError       = "write_error"         // SSE write failed: the client is gone
	lossReasonClientGone       = "client_disconnected" // request context cancelled while the provider was silent
	lossReasonProviderError    = "provider_error"      // mid-stream BifrostError chunk
	lossReasonBeginStreamFail  = "begin_stream_failed" // ResponseWriter could not start SSE
	lossReasonCleanCloseNoTrai = "no_trailer_on_clean_close"
)

// nextChunk reads the next chunk from a stream channel while also watching the
// client. It returns more=false when the provider closed the channel OR the
// client went away.
//
// Watching clientGone is not an optimisation. Once the provider stream is
// decoupled from the request context (issue #9), a disconnect no longer closes
// the channel, and the loop only discovers it by failing a write — which needs
// a chunk to write. A provider that goes quiet after the client leaves would
// otherwise park this handler goroutine until the provider's own idle timeout
// (bifrost: 120 s by default). Watching the request context bounds that to the
// disconnect itself, and makes the disconnect path deterministic instead of
// dependent on write timing.
func nextChunk(
	ch chan *schemas.BifrostStreamChunk,
	clientGone <-chan struct{},
) (chunk *schemas.BifrostStreamChunk, more bool) {
	select {
	case c, ok := <-ch:
		return c, ok
	case <-clientGone:
		return nil, false
	}
}

// isClientGone reports whether the client's request context is already done. It
// disambiguates the two nextChunk exits: a closed provider channel (clean) from
// a vanished client (early).
func isClientGone(clientGone <-chan struct{}) bool {
	select {
	case <-clientGone:
		return true
	default:
		return false
	}
}

// Drain outcomes: what the detached drain managed to do about the exit reason.
const (
	drainOutcomeChannelClosed = "channel_closed" // producer finished within the grace
	drainOutcomeGraceExpired  = "grace_expired"  // grace elapsed, no trailer
	drainOutcomeHardTimeout   = "hard_timeout"   // provider wedged after cancellation
	drainOutcomeSaturated     = "drain_saturated"
	drainOutcomeShuttingDown  = "shutting_down"
	drainOutcomeDisabled      = "disabled" // LLM_STREAM_GRACE_MS=0
	drainOutcomeInline        = "inline"   // no drain ran (clean close / nil channel)
)

// unbilledStreamEventType is the gateway.events.* event emitted when a stream
// ends with no provider-reported usage. It is the metered counterpart of the
// billing we cannot do: the loss is explicitly observable, never silent.
const unbilledStreamEventType = "budget.unbilled_stream"

// streamCancel owns the cancellation of a decoupled stream context. Exactly one
// of the SSE loop or the detached drain settles a stream, but both may reach
// cancel on error paths, and the drain runs on another goroutine — so the call
// is made idempotent rather than relying on call-site discipline.
type streamCancel struct {
	once sync.Once
	fn   context.CancelFunc
}

// cancel tears the provider stream down. Safe to call any number of times, from
// any goroutine, and on a nil receiver (handlers built without a stream context).
func (c *streamCancel) cancel() {
	if c == nil {
		return
	}
	c.once.Do(func() {
		if c.fn != nil {
			c.fn()
		}
	})
}

// usageExtractor pulls provider-reported usage out of a stream chunk. ok=false
// means this chunk carries no usage (the overwhelming majority).
type usageExtractor func(*schemas.BifrostStreamChunk) (in, out int64, ok bool)

// chatUsageFromChunk reads usage from the OpenAI chat SSE dialect: the final
// chunk before [DONE] carries Usage; earlier chunks have Usage=nil.
func chatUsageFromChunk(c *schemas.BifrostStreamChunk) (int64, int64, bool) {
	if c == nil || c.BifrostChatResponse == nil || c.BifrostChatResponse.Usage == nil {
		return 0, 0, false
	}
	in, out := usageFromChatResponse(c.BifrostChatResponse)
	return in, out, true
}

// responsesUsageFromChunk reads usage from the Responses-API dialect (also the
// Anthropic /v1/messages framing, which consumes the same chunk stream): the
// response.completed event carries Response.Usage.
func responsesUsageFromChunk(c *schemas.BifrostStreamChunk) (int64, int64, bool) {
	if c == nil || c.BifrostResponsesStreamResponse == nil {
		return 0, 0, false
	}
	sr := c.BifrostResponsesStreamResponse
	if sr.Response == nil || sr.Response.Usage == nil {
		return 0, 0, false
	}
	in, out := usageFromResponsesResponse(sr.Response)
	return in, out, true
}

// chatDeltaBytes counts streamed output payload bytes on a chat chunk.
//
// OBSERVABILITY ONLY. This number exists so the loss event carries the
// magnitude of what went unbilled; it is NOT a token count and MUST NOT be fed
// to cost.Calculator or any billing path (DECISIONS.md: estimates never reach
// the money path).
func chatDeltaBytes(c *schemas.BifrostStreamChunk) int64 {
	if c == nil || c.BifrostChatResponse == nil {
		return 0
	}
	var n int64
	for i := range c.BifrostChatResponse.Choices {
		sc := c.BifrostChatResponse.Choices[i].ChatStreamResponseChoice
		if sc == nil || sc.Delta == nil {
			continue
		}
		d := sc.Delta
		if d.Content != nil {
			n += int64(len(*d.Content))
		}
		if d.Refusal != nil {
			n += int64(len(*d.Refusal))
		}
		if d.Reasoning != nil {
			n += int64(len(*d.Reasoning))
		}
		for j := range d.ToolCalls {
			n += int64(len(d.ToolCalls[j].Function.Arguments))
		}
	}
	return n
}

// responsesDeltaBytes counts streamed output payload bytes on a Responses-API
// chunk. Only the incremental Delta is counted: the *.done events re-carry text
// already streamed as deltas. OBSERVABILITY ONLY — see chatDeltaBytes.
func responsesDeltaBytes(c *schemas.BifrostStreamChunk) int64 {
	if c == nil || c.BifrostResponsesStreamResponse == nil || c.BifrostResponsesStreamResponse.Delta == nil {
		return 0
	}
	return int64(len(*c.BifrostResponsesStreamResponse.Delta))
}

// streamSettler accumulates billable evidence while an SSE loop — and, after an
// early exit, the detached drain — consumes a stream, and settles the stream
// exactly once.
//
// Billing evidence is provider-reported usage and nothing else. Providers emit
// cumulative counts, so a later usage chunk overrides an earlier one.
type streamSettler struct {
	h                *Handler
	loop             string
	provider, model  string
	projectID        string
	ctx              *schemas.BifrostContext
	sc               *streamCancel
	ch               chan *schemas.BifrostStreamChunk
	usageFrom        usageExtractor
	deltaFrom        func(*schemas.BifrostStreamChunk) int64
	in, out          int64
	gotUsage         bool
	observedOutBytes int64
	settled          bool
}

// newChatSettler builds the settler for the OpenAI chat SSE dialect.
func (h *Handler) newChatSettler(
	loop string,
	ctx *schemas.BifrostContext,
	sc *streamCancel,
	provider, model string,
	ch chan *schemas.BifrostStreamChunk,
) *streamSettler {
	return &streamSettler{
		h: h, loop: loop, provider: provider, model: model,
		projectID: identityProjectFromCtx(ctx),
		ctx:       ctx, sc: sc, ch: ch,
		usageFrom: chatUsageFromChunk, deltaFrom: chatDeltaBytes,
	}
}

// newResponsesSettler builds the settler for the Responses-API dialect and for
// the Anthropic /v1/messages framing over the same chunk stream.
func (h *Handler) newResponsesSettler(
	loop string,
	ctx *schemas.BifrostContext,
	sc *streamCancel,
	provider, model string,
	ch chan *schemas.BifrostStreamChunk,
) *streamSettler {
	return &streamSettler{
		h: h, loop: loop, provider: provider, model: model,
		projectID: identityProjectFromCtx(ctx),
		ctx:       ctx, sc: sc, ch: ch,
		usageFrom: responsesUsageFromChunk, deltaFrom: responsesDeltaBytes,
	}
}

// observe folds one consumed chunk into the accumulator. Called from the SSE
// loop and from the detached drain — never concurrently: the loop hands the
// channel over and returns.
func (s *streamSettler) observe(c *schemas.BifrostStreamChunk) {
	if c == nil {
		return
	}
	if in, out, ok := s.usageFrom(c); ok {
		s.in, s.out, s.gotUsage = in, out, true
	}
	if s.deltaFrom != nil {
		s.observedOutBytes += s.deltaFrom(c)
	}
}

// settleClean settles a stream whose channel the SSE loop consumed to closure.
// The producer is finished, so there is nothing left to drain: bill the
// authoritative usage if the trailer arrived, else meter the loss.
//
// Note this path is also reached when a disconnect happens to surface as a
// channel close rather than a write error. That is fine and needs no
// discriminator: with the decoupled context the producer is not torn down by
// the disconnect, so a channel close here really does mean the provider
// finished.
func (s *streamSettler) settleClean() {
	if s.settled {
		return // defence in depth: a stream is billed at most once
	}
	s.settled = true
	s.sc.cancel()
	s.report(lossReasonCleanCloseNoTrai, drainOutcomeInline)
}

// settleEarly takes ownership of a still-open channel after an early exit and
// settles the stream on a detached goroutine.
//
// The grace period is the whole point: the provider context is NOT bound to the
// client request, so the producer is still alive and may still deliver the
// usage trailer. We wait for it, bounded, then cancel.
//
// Draining is mandatory even when the grace is zero or unavailable: bifrost's
// GateSendChunk blocks on `responseChan <- chunk` (with a ctx.Done guard), so a
// channel nobody reads and nobody cancels wedges a provider goroutine forever.
func (s *streamSettler) settleEarly(reason string) {
	if s.settled {
		return
	}
	s.settled = true

	if s.ch == nil {
		s.sc.cancel()
		s.report(reason, drainOutcomeInline)
		return
	}

	grace := s.h.streamGrace
	release := func() {}
	outcome := ""

	switch {
	case grace <= 0:
		// Mechanism disabled by configuration (LLM_STREAM_GRACE_MS=0).
		outcome = drainOutcomeDisabled
	case s.h.billingClosing.Load() != 0:
		// Shutting down: never hold the pod's termination grace hostage to a
		// provider trailer.
		grace = 0
		outcome = drainOutcomeShuttingDown
	case !s.h.acquireDrainSlot():
		grace = 0
		outcome = drainOutcomeSaturated
		s.h.logger.Warn("stream drain saturated; abandoning stream without waiting for provider usage",
			"loop", s.loop, "provider", s.provider, "model", s.model,
			"project_id", s.projectID, "limit", cap(s.h.drainSlots))
	default:
		release = s.h.releaseDrainSlot
	}

	if grace <= 0 {
		// No waiting: tear the producer down now. The goroutine below still
		// drains so the producer's pending send unblocks and CloseStream runs.
		s.sc.cancel()
	}

	// Track the drain like any other billing goroutine so DrainBilling waits
	// for it (same Add-after-Wait guard as spawnBillingGoroutine). When we are
	// already closing, the drain runs untracked — it was just cancelled, so it
	// exits promptly and has nothing to bill.
	tracked := s.h.billingClosing.Load() == 0
	if tracked {
		s.h.billingWg.Add(1)
	}
	go func() {
		defer func() {
			if tracked {
				s.h.billingWg.Done()
			}
		}()
		defer release()
		defer s.sc.cancel() // backstop: idempotent

		drained := s.drain(grace)
		if outcome == "" {
			outcome = drained
		}
		s.sc.cancel() // release the provider socket before the billing round-trip
		s.report(reason, outcome)
	}()
}

// drain consumes the channel until it closes, the grace expires, or the hard
// backstop fires. It returns the drain outcome.
func (s *streamSettler) drain(grace time.Duration) string {
	var graceC <-chan time.Time
	if grace > 0 {
		t := time.NewTimer(grace)
		defer t.Stop()
		graceC = t.C
	}
	// Absolute cap: grace (waiting for the trailer) plus the post-cancellation
	// window in which a healthy provider closes the channel.
	hard := time.NewTimer(grace + drainHardTimeout)
	defer hard.Stop()

	closingC := s.h.drainClosing

	for {
		select {
		case chunk, ok := <-s.ch:
			if !ok {
				return drainOutcomeChannelClosed
			}
			s.observe(chunk)
		case <-graceC:
			// Grace elapsed with no trailer: stop paying for generation the
			// client abandoned. Keep reading until the producer unwinds.
			graceC = nil
			s.sc.cancel()
		case <-closingC:
			// Graceful shutdown started while we were waiting.
			closingC = nil // a closed channel stays ready; do not spin on it
			graceC = nil
			s.sc.cancel()
		case <-hard.C:
			s.h.logger.Warn("stream drain: provider channel never closed after cancellation; abandoning",
				"loop", s.loop, "provider", s.provider, "model", s.model,
				"project_id", s.projectID, "grace", grace)
			return drainOutcomeHardTimeout
		}
	}
}

// report settles the stream: bill the provider's numbers, or meter the loss.
// There is no third option — an estimate never reaches this path.
func (s *streamSettler) report(reason, outcome string) {
	if s.gotUsage {
		s.h.updateUsage(s.ctx, s.provider, s.model, s.in, s.out, s.projectID)
		return
	}
	s.h.logger.Warn(s.loop+": stream ended with no provider usage; response unbilled",
		"provider", s.provider, "model", s.model, "project_id", s.projectID,
		"reason", reason, "drain_outcome", outcome,
		"observed_output_bytes", s.observedOutBytes)
	s.h.publishUnbilledStreamEvent(s.projectID, s.provider, s.model, reason, outcome, s.observedOutBytes)
}

// acquireDrainSlot takes a slot from the bounded drain pool. It never blocks: a
// caller that cannot get a slot abandons the stream immediately rather than
// queueing (queueing would hold the provider socket open anyway, which is the
// resource we are protecting).
func (h *Handler) acquireDrainSlot() bool {
	if h.drainSlots == nil {
		return true
	}
	select {
	case h.drainSlots <- struct{}{}:
		return true
	default:
		return false
	}
}

// releaseDrainSlot returns a slot to the bounded drain pool.
func (h *Handler) releaseDrainSlot() {
	if h.drainSlots == nil {
		return
	}
	select {
	case <-h.drainSlots:
	default:
	}
}

// unbilledStreamPayload is the budget.unbilled_stream event body. It is the
// alarmable record of spend the gateway could not attribute.
//
// ObservedOutputBytes is a magnitude hint for operators — raw SSE delta bytes,
// NOT tokens and NOT a cost. Nothing may derive money from it.
type unbilledStreamPayload struct {
	ProjectID           string `json:"project_id"`
	Provider            string `json:"provider"`
	Model               string `json:"model"`
	Reason              string `json:"reason"`
	DrainOutcome        string `json:"drain_outcome"`
	ObservedOutputBytes int64  `json:"observed_output_bytes"`
}

// publishUnbilledStreamEvent emits budget.unbilled_stream onto gateway.events.*
// so a stream the gateway could not bill is externally visible and alarmable
// (issue #9 acceptance criterion: "the loss is explicitly metered and alarmed").
// Best-effort: a publish failure is logged, never fatal — the WARN log remains.
func (h *Handler) publishUnbilledStreamEvent(projectID, provider, model, reason, outcome string, outBytes int64) {
	if h.alertEvents == nil || projectID == "" {
		return
	}
	payload, err := json.Marshal(unbilledStreamPayload{
		ProjectID:           projectID,
		Provider:            provider,
		Model:               model,
		Reason:              reason,
		DrainOutcome:        outcome,
		ObservedOutputBytes: outBytes,
	})
	if err != nil {
		h.logger.Warn("unbilled-stream event: marshal payload failed", "err", err)
		return
	}
	env, err := json.Marshal(softAlertEnvelope{
		Type:      unbilledStreamEventType,
		Source:    "elitea-llm-gateway",
		Payload:   payload,
		Timestamp: time.Now().UTC(),
	})
	if err != nil {
		h.logger.Warn("unbilled-stream event: marshal envelope failed", "err", err)
		return
	}
	// Detached context: the request context is cancelled by now, by design.
	pubCtx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	if err := h.alertEvents.PublishSoftAlertEvent(pubCtx, projectID, env); err != nil {
		h.logger.Warn("unbilled-stream event: publish failed", "project_id", projectID, "err", err)
	}
}
