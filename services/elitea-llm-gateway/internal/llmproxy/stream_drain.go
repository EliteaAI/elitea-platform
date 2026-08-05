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
	"strconv"
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

	// SaturatedStreamGrace is the (much shorter) grace given to a drain that
	// could not take a slot from the bounded pool. Saturation must NOT mean
	// "bill nothing": the resource being protected is a provider socket that is
	// about to close anyway, and the common late-disconnect case delivers its
	// trailer within a few hundred milliseconds. Cutting straight to grace=0
	// would fail OPEN — destroying a recoverable trailer — which is the very
	// bypass issue #9 exists to close (gateway-review blocker 2, human decision
	// 2026-08-05).
	SaturatedStreamGrace = 500 * time.Millisecond

	// drainPerProjectDivisor derives the per-project slot cap from the global
	// limit. Without a per-project bound the pool is a shared fate: one tenant
	// disconnecting in a storm starves every other tenant's drains down to the
	// saturated grace. Derived rather than a second env knob so operators have
	// one number to reason about.
	drainPerProjectDivisor = 8

	// drainHardTimeout bounds the wait AFTER the provider context is cancelled.
	// Cancellation makes bifrost close the socket and `defer CloseStream`, so
	// the channel closes promptly in every normal case; this is the backstop
	// for a wedged provider, and it caps how long a drain can run in total
	// (grace + drainHardTimeout).
	drainHardTimeout = 10 * time.Second

	// drainShutdownTimeout replaces drainHardTimeout once graceful shutdown has
	// started: a wedged provider must not hold the pod's termination grace for
	// grace+drainHardTimeout when we have already stopped waiting for its
	// trailer (gateway-review).
	drainShutdownTimeout = 1 * time.Second
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
	// lossReasonBillingRefused: the authoritative usage WAS recovered but the
	// billing increment was refused (billing drain already in progress), so
	// real, known spend was dropped. Distinct from the no-usage reasons above
	// because it is a gateway-side loss, not a provider-side one — alarm on it
	// separately.
	lossReasonBillingRefused = "billing_refused"
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
type streamExit int

const (
	streamExitChunk    streamExit = iota // a chunk was delivered
	streamExitChanDone                   // the provider closed the channel
	streamExitClient                     // the client went away
)

func nextChunk(
	ch chan *schemas.BifrostStreamChunk,
	clientGone <-chan struct{},
) (*schemas.BifrostStreamChunk, streamExit) {
	select {
	case c, ok := <-ch:
		if !ok {
			// A closed channel wins even when the client also vanished: the
			// provider genuinely finished, so this is a clean completion. Left
			// to select's random choice the two would be indistinguishable and
			// a completed stream could be mislabelled a disconnect (and burn a
			// drain slot for an already-closed channel).
			return nil, streamExitChanDone
		}
		return c, streamExitChunk
	case <-clientGone:
		// Re-check the channel: if the producer closed while we were being
		// woken, prefer the clean exit for the same reason.
		select {
		case c, ok := <-ch:
			if !ok {
				return nil, streamExitChanDone
			}
			return c, streamExitChunk
		default:
			return nil, streamExitClient
		}
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
	outcome := ""
	slotHeld := false

	switch {
	case grace <= 0:
		// Mechanism disabled by configuration (LLM_STREAM_GRACE_MS=0).
		outcome = drainOutcomeDisabled
	case s.h.drainsClosing.Load() != 0:
		// Shutting down: never hold the pod's termination grace hostage to a
		// provider trailer.
		grace = 0
		outcome = drainOutcomeShuttingDown
	case !s.h.drainLimit.acquire(s.projectID):
		// Saturated. Do NOT drop to grace=0: that fails open, destroying a
		// trailer that is often milliseconds away, which is the bypass this
		// whole mechanism exists to close. Take the short grace instead
		// (human decision 2026-08-05, gateway-review blocker 2).
		if grace > SaturatedStreamGrace {
			grace = SaturatedStreamGrace
		}
		outcome = drainOutcomeSaturated
		inUse, total, per := s.h.drainLimit.snapshot()
		s.h.logger.Warn("stream drain pool saturated; falling back to the short grace",
			"loop", s.loop, "provider", s.provider, "model", s.model,
			"project_id", s.projectID, "grace", grace,
			"in_use", inUse, "limit", total, "per_project_limit", per)
	default:
		slotHeld = true
	}

	if grace <= 0 {
		// No waiting: tear the producer down now. The goroutine below still
		// drains so the producer's pending send unblocks and CloseStream runs.
		s.sc.cancel()
	}

	// Track the drain on drainWg — NOT billingWg — so DrainBilling can wait for
	// drains to settle before it closes billing (same Add-after-Wait guard
	// shape as spawnBillingGoroutine, against drainsClosing). A drain spawned
	// after phase 1 runs untracked: it was just cancelled, so it exits
	// promptly, and its report() still bills while billing remains open.
	tracked := s.h.drainsClosing.Load() == 0
	if tracked {
		s.h.drainWg.Add(1)
	}
	go func() {
		defer func() {
			if tracked {
				s.h.drainWg.Done()
			}
		}()
		if slotHeld {
			defer s.h.drainLimit.release(s.projectID)
		}
		defer s.sc.cancel() // backstop: idempotent

		drained := s.drain(grace)
		if outcome == "" || outcome == drainOutcomeSaturated {
			// A saturated drain still reports what actually happened when the
			// short grace was not enough, so operators can tell "we were full"
			// from "full AND we lost the trailer".
			if outcome == drainOutcomeSaturated && drained != drainOutcomeChannelClosed {
				outcome = drainOutcomeSaturated + "/" + drained
			} else if outcome == "" {
				outcome = drained
			}
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
	graceExpired := false

	for {
		select {
		case chunk, ok := <-s.ch:
			if !ok {
				// Distinguish "the producer finished inside the grace" from
				// "we cut it off and it then unwound": both close the channel,
				// but only the first means the grace was sufficient. Collapsing
				// them would make grace_expired unreportable and hide a grace
				// that is too short for real traffic.
				if graceExpired {
					return drainOutcomeGraceExpired
				}
				return drainOutcomeChannelClosed
			}
			s.observe(chunk)
		case <-graceC:
			// Grace elapsed with no trailer: stop paying for generation the
			// client abandoned. Keep reading until the producer unwinds.
			graceC = nil
			graceExpired = true
			s.sc.cancel()
		case <-closingC:
			// Graceful shutdown started while we were waiting. Shrink the hard
			// backstop too: a wedged provider must cost the pod's termination
			// grace at most drainShutdownTimeout, not the full grace+backstop.
			closingC = nil // a closed channel stays ready; do not spin on it
			graceC = nil
			hard.Reset(drainShutdownTimeout)
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
		// We recovered the authoritative numbers — but the increment can still
		// be refused (graceful shutdown already set billingClosing). If that
		// happens the spend is gone, and it must NOT disappear as a lone WARN:
		// it is exactly the loss this event exists to make alarmable
		// (gateway-review blocker 1, reproduced on the deploy path).
		if s.h.updateUsage(context.Background(), s.provider, s.model, s.in, s.out, s.projectID) {
			return
		}
		s.h.logger.Warn(s.loop+": provider usage recovered but the billing increment was refused; spend dropped",
			"provider", s.provider, "model", s.model, "project_id", s.projectID,
			"reason", reason, "drain_outcome", outcome,
			"input_tokens", s.in, "output_tokens", s.out)
		s.h.publishUnbilledStreamEvent(s.projectID, s.provider, s.model,
			lossReasonBillingRefused, outcome, s.observedOutBytes)
		return
	}
	s.h.logger.Warn(s.loop+": stream ended with no provider usage; response unbilled",
		"provider", s.provider, "model", s.model, "project_id", s.projectID,
		"reason", reason, "drain_outcome", outcome,
		"observed_output_bytes", s.observedOutBytes)
	s.h.publishUnbilledStreamEvent(s.projectID, s.provider, s.model, reason, outcome, s.observedOutBytes)
}

// drainLimiter bounds concurrent abandoned-stream drains both globally and per
// project. Each in-flight drain holds a goroutine AND an open provider socket,
// so the global bound protects the pod; the per-project bound stops one tenant
// from consuming the whole pool and degrading everyone else's billing to the
// saturated grace (gateway-review blocker 2).
type drainLimiter struct {
	mu         sync.Mutex
	total      int
	inUse      int
	perProject int
	byProject  map[string]int
}

// newDrainLimiter builds a limiter for n concurrent drains. n <= 0 returns nil,
// meaning unbounded (unit-test construction).
func newDrainLimiter(n int) *drainLimiter {
	if n <= 0 {
		return nil
	}
	per := n / drainPerProjectDivisor
	if per < 1 {
		per = 1
	}
	return &drainLimiter{total: n, perProject: per, byProject: make(map[string]int)}
}

// acquire takes a slot for projectID. It never blocks: a caller that cannot get
// one falls back to the saturated grace rather than queueing, because queueing
// would hold the provider socket open anyway — the resource the bound protects.
func (l *drainLimiter) acquire(projectID string) bool {
	if l == nil {
		return true
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.inUse >= l.total || l.byProject[projectID] >= l.perProject {
		return false
	}
	l.inUse++
	l.byProject[projectID]++
	return true
}

// release returns a slot. Releasing a project down to zero drops its map entry
// so the map cannot grow without bound across projects.
func (l *drainLimiter) release(projectID string) {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.inUse > 0 {
		l.inUse--
	}
	if n := l.byProject[projectID]; n <= 1 {
		delete(l.byProject, projectID)
	} else {
		l.byProject[projectID] = n - 1
	}
}

// snapshot reports current usage (tests and future gauges).
func (l *drainLimiter) snapshot() (inUse, total, perProject int) {
	if l == nil {
		return 0, 0, 0
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.inUse, l.total, l.perProject
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
	if h.opsEvents == nil {
		return
	}
	// Normalise the identity exactly like the billing path does: projectID
	// comes from a header, and every sibling money/event path routes it through
	// parseProjectID before use. An unresolvable project has no budget row and
	// nothing to attribute, so there is nothing to publish.
	pid := parseProjectID(projectID)
	if pid < 0 {
		h.logger.Warn("unbilled-stream event: unresolvable project id; loss not attributable",
			"project_id", projectID, "provider", provider, "model", model, "reason", reason)
		return
	}
	scopeID := strconv.Itoa(pid)
	payload, err := json.Marshal(unbilledStreamPayload{
		ProjectID:           scopeID,
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
	if err := h.opsEvents.PublishOpsEvent(pubCtx, env); err != nil {
		h.logger.Warn("unbilled-stream event: publish failed", "project_id", scopeID, "err", err)
	}
}
