package llmproxy

// stream_disconnect_test.go — the rest of the issue #9 contract: what happens
// when the grace period does NOT recover the usage trailer, and the guardrails
// around the mechanism (bounded concurrency, bounded shutdown, no estimate ever
// reaching the money path, no context leak on the blocked path).
//
// The end-to-end reproduction lives in stream_disconnect_gate_test.go.

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/maximhq/bifrost/core/schemas"

	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/config"
	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/failmode"
)

// recordingEvents captures gateway.events.* publishes so tests can assert the
// loss is metered rather than silently dropped.
type recordingEvents struct {
	mu     sync.Mutex
	events [][]byte
	fired  chan struct{}
	once   sync.Once
}

func newRecordingEvents() *recordingEvents {
	return &recordingEvents{fired: make(chan struct{})}
}

func (r *recordingEvents) PublishSoftAlertEvent(_ context.Context, _ string, event []byte) error {
	r.mu.Lock()
	r.events = append(r.events, event)
	r.mu.Unlock()
	r.once.Do(func() { close(r.fired) })
	return nil
}

// waitForEvent blocks until the first event is published (or the test times out).
func (r *recordingEvents) waitForEvent(t *testing.T) {
	t.Helper()
	select {
	case <-r.fired:
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for a gateway.events.* publish")
	}
}

// decodeUnbilled returns the decoded payload of the first budget.unbilled_stream
// event, failing the test when none was published.
func (r *recordingEvents) decodeUnbilled(t *testing.T) unbilledStreamPayload {
	t.Helper()
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, raw := range r.events {
		var env softAlertEnvelope
		if err := json.Unmarshal(raw, &env); err != nil {
			t.Fatalf("unmarshal envelope: %v", err)
		}
		if env.Type != unbilledStreamEventType {
			continue
		}
		var p unbilledStreamPayload
		if err := json.Unmarshal(env.Payload, &p); err != nil {
			t.Fatalf("unmarshal payload: %v", err)
		}
		return p
	}
	t.Fatalf("no %s event published; got %d event(s)", unbilledStreamEventType, len(r.events))
	return unbilledStreamPayload{}
}

// silentRouter returns a stream that emits its preamble and then goes quiet
// forever, closing only when the provider context is cancelled — a provider
// that never sends a usage trailer.
type silentRouter struct {
	fakeRouter
	preamble []*schemas.BifrostStreamChunk
	// closed is closed by the producer when it finally returns, so tests can
	// assert the provider stream really was torn down.
	closed chan struct{}
}

func newSilentRouter(preamble ...*schemas.BifrostStreamChunk) *silentRouter {
	return &silentRouter{preamble: preamble, closed: make(chan struct{})}
}

func (r *silentRouter) stream(ctx *schemas.BifrostContext) chan *schemas.BifrostStreamChunk {
	ch := make(chan *schemas.BifrostStreamChunk)
	go func() {
		defer close(ch)
		defer close(r.closed)
		for _, c := range r.preamble {
			select {
			case ch <- c:
			case <-ctx.Done():
				return
			}
		}
		<-ctx.Done() // no trailer, ever
	}()
	return ch
}

func (r *silentRouter) ChatCompletionStreamRequest(ctx *schemas.BifrostContext, _ *schemas.BifrostChatRequest) (chan *schemas.BifrostStreamChunk, *schemas.BifrostError) {
	return r.stream(ctx), nil
}

func (r *silentRouter) ResponsesStreamRequest(ctx *schemas.BifrostContext, _ *schemas.BifrostResponsesRequest) (chan *schemas.BifrostStreamChunk, *schemas.BifrostError) {
	return r.stream(ctx), nil
}

// failAfterWriter is an http.ResponseWriter whose Write starts failing after
// okWrites successful calls — the in-process stand-in for "the client went
// away mid-stream". It is only the SSE-loop half of a disconnect; the other
// half (the provider context dying with the request) is what the real-hangup
// gate test in stream_disconnect_gate_test.go covers, and what a stub writer
// fundamentally cannot model.
type failAfterWriter struct {
	okWrites int
	writes   int
	hdr      http.Header
	code     int
}

func (f *failAfterWriter) Header() http.Header {
	if f.hdr == nil {
		f.hdr = http.Header{}
	}
	return f.hdr
}

func (f *failAfterWriter) WriteHeader(code int) { f.code = code }

func (f *failAfterWriter) Write(p []byte) (int, error) {
	if f.writes >= f.okWrites {
		return 0, errClientGone
	}
	f.writes++
	return len(p), nil
}

func (f *failAfterWriter) Flush() {}

var errClientGone = errors.New("client disconnected")

// allowGate builds a budget checker that admits everything and records billing.
func allowGate() *fakeBudgetChecker {
	return &fakeBudgetChecker{
		checkVerdict: failmode.Decision{Verdict: failmode.Allow, State: failmode.StateNATSHealthy},
		updated:      make(chan struct{}),
	}
}

// TestStreamDisconnect_NoTrailer_BillsNothingAndMetersLoss is the anti-estimate
// guard. When the grace period expires with no provider usage, the ONLY correct
// outcomes are: bill nothing, and make the loss loudly visible. Billing an
// observed-output estimate here was the second rejected attempt (issue #9) — it
// puts a bytes/4 heuristic on the money path, which DECISIONS.md forbids.
func TestStreamDisconnect_NoTrailer_BillsNothingAndMetersLoss(t *testing.T) {
	gate := allowGate()
	events := newRecordingEvents()
	router := newSilentRouter(chatDelta("c1", "hello "), chatDelta("c2", "world"))
	calc := &fakeCostEstimator{inputRateNano: gateInputRateNano, outputRateNano: gateOutputRateNano}
	h := NewHandler(router, nil, nil,
		WithBudgetGate(gate, calc),
		WithAlertEventPublisher(events),
		WithStreamGrace(50*time.Millisecond))

	w := &failAfterWriter{okWrites: 1} // client disconnects on the second frame
	h.Chat(w, chatReqWithProject(t, "30", true))

	events.waitForEvent(t)
	h.DrainBilling()

	if got := gate.updateCalls.Load(); got != 0 {
		t.Fatalf("UpdateUsage calls = %d, want 0 — with no provider usage NOTHING may be billed "+
			"(an observed-bytes estimate on the money path is forbidden by DECISIONS.md)", got)
	}
	p := events.decodeUnbilled(t)
	if p.ProjectID != "30" {
		t.Errorf("event project_id = %q, want 30", p.ProjectID)
	}
	if p.Reason != lossReasonWriteError {
		t.Errorf("event reason = %q, want %q", p.Reason, lossReasonWriteError)
	}
	if p.DrainOutcome != drainOutcomeChannelClosed && p.DrainOutcome != drainOutcomeGraceExpired {
		t.Errorf("event drain_outcome = %q, want channel_closed or grace_expired", p.DrainOutcome)
	}
	if p.ObservedOutputBytes <= 0 {
		t.Errorf("observed_output_bytes = %d, want > 0 (the magnitude of the loss must be visible)", p.ObservedOutputBytes)
	}

	// The provider stream must actually have been torn down once the grace
	// expired — the whole point of the bound is that we stop paying for a
	// generation nobody is reading.
	select {
	case <-router.closed:
	case <-time.After(2 * time.Second):
		t.Fatal("provider stream was never torn down after the grace period")
	}
}

// TestStreamDisconnect_SilentProvider_LoopExitsOnClientGone covers the hazard
// the decoupling introduces: once the provider stream no longer dies with the
// request, a client that leaves while the provider is silent produces NO write
// error, so a loop that only watches the channel would park until the
// provider's own idle timeout (bifrost: 120 s). The SSE loop must notice the
// request context instead, settle, and return promptly.
func TestStreamDisconnect_SilentProvider_LoopExitsOnClientGone(t *testing.T) {
	gate := allowGate()
	events := newRecordingEvents()
	router := newSilentRouter(chatDelta("c1", "hello"))
	h := NewHandler(router, nil, nil,
		WithBudgetGate(gate, &fakeCostEstimator{totalNano: 1_000}),
		WithAlertEventPublisher(events),
		WithStreamGrace(50*time.Millisecond))

	reqCtx, cancelReq := context.WithCancel(context.Background())
	req := chatReqWithProject(t, "30", true).WithContext(reqCtx)

	returned := make(chan struct{})
	go func() {
		defer close(returned)
		h.Chat(httptest.NewRecorder(), req)
	}()

	// Let the first chunk through, then hang up. The provider stays silent.
	time.Sleep(50 * time.Millisecond)
	cancelReq()

	select {
	case <-returned:
	case <-time.After(3 * time.Second):
		t.Fatal("SSE loop did not return after the client disconnected — it is parked waiting " +
			"for a chunk from a provider that has nothing to say")
	}

	events.waitForEvent(t)
	h.DrainBilling()

	if got := gate.updateCalls.Load(); got != 0 {
		t.Fatalf("UpdateUsage calls = %d, want 0 (no provider usage was ever reported)", got)
	}
	if p := events.decodeUnbilled(t); p.Reason != lossReasonClientGone && p.Reason != lossReasonWriteError {
		t.Errorf("event reason = %q, want %q or %q", p.Reason, lossReasonClientGone, lossReasonWriteError)
	}
}

// TestStreamDisconnect_MultimodalPayload_BillsZeroNotAnEstimate is the direct
// regression guard for the rejected estimate: a stream carrying a large
// base64-ish payload and no usage trailer must bill exactly zero. The earlier
// attempt billed len(bytes)/4 "tokens" here, over-charging inline-image
// requests by 2–3 orders of magnitude.
func TestStreamDisconnect_MultimodalPayload_BillsZeroNotAnEstimate(t *testing.T) {
	gate := allowGate()
	events := newRecordingEvents()
	// ~256 KB of "inline base64" output — 65k phantom tokens under a bytes/4
	// heuristic, and at these rates ~650_000_000 nano-USD of phantom spend.
	huge := strings.Repeat("QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=", 8192)
	router := newSilentRouter(chatDelta("c1", huge))
	calc := &fakeCostEstimator{inputRateNano: gateInputRateNano, outputRateNano: gateOutputRateNano}
	h := NewHandler(router, nil, nil,
		WithBudgetGate(gate, calc),
		WithAlertEventPublisher(events),
		WithStreamGrace(50*time.Millisecond))

	w := &failAfterWriter{okWrites: 0} // disconnected before the first frame lands
	h.Chat(w, chatReqWithProject(t, "30", true))

	events.waitForEvent(t)
	h.DrainBilling()

	if got := gate.updateCalls.Load(); got != 0 {
		t.Fatalf("UpdateUsage calls = %d, want 0", got)
	}
	if got := gate.getLastUpdateCostNano(); got != 0 {
		t.Fatalf("billed %d nano-USD for a stream with no provider usage, want 0", got)
	}
	if in, out := calc.getLastTokens(); in != 0 || out != 0 {
		t.Fatalf("cost calculator was called with (%d, %d) tokens — no estimated token count "+
			"may ever reach the cost path", in, out)
	}
	// The magnitude is still reported, as an observability dimension only.
	if p := events.decodeUnbilled(t); p.ObservedOutputBytes < int64(len(huge)) {
		t.Errorf("observed_output_bytes = %d, want >= %d", p.ObservedOutputBytes, len(huge))
	}
}

// TestStreamDisconnect_DrainSaturated_MetersLoss: when every drain slot is
// taken, an abandoned stream is cut loose immediately instead of queueing (the
// slot bounds open provider sockets, so queueing would defeat it) — and the
// loss is metered with the saturation reason rather than dropped.
func TestStreamDisconnect_DrainSaturated_MetersLoss(t *testing.T) {
	gate := allowGate()
	events := newRecordingEvents()
	router := newSilentRouter(chatDelta("c1", "hello"), chatDelta("c2", " world"))
	h := NewHandler(router, nil, nil,
		WithBudgetGate(gate, &fakeCostEstimator{totalNano: 1_000}),
		WithAlertEventPublisher(events),
		WithStreamGrace(5*time.Second),
		WithStreamDrainLimit(1))

	// Occupy the only slot.
	if !h.acquireDrainSlot() {
		t.Fatal("could not take the single drain slot")
	}

	start := time.Now()
	w := &failAfterWriter{okWrites: 1}
	h.Chat(w, chatReqWithProject(t, "30", true))
	events.waitForEvent(t)
	h.DrainBilling()

	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Errorf("saturated drain waited %v — it must not hold the stream for the full grace", elapsed)
	}
	if got := gate.updateCalls.Load(); got != 0 {
		t.Fatalf("UpdateUsage calls = %d, want 0", got)
	}
	if p := events.decodeUnbilled(t); p.DrainOutcome != drainOutcomeSaturated {
		t.Errorf("drain_outcome = %q, want %q", p.DrainOutcome, drainOutcomeSaturated)
	}
}

// TestStreamDisconnect_DrainReleasesItsSlot: a completed drain must return its
// slot, or the pool bleeds capacity until every disconnect is reported as
// saturated.
func TestStreamDisconnect_DrainReleasesItsSlot(t *testing.T) {
	gate := allowGate()
	events := newRecordingEvents()
	router := newSilentRouter(chatDelta("c1", "hello"), chatDelta("c2", " world"))
	h := NewHandler(router, nil, nil,
		WithBudgetGate(gate, &fakeCostEstimator{totalNano: 1_000}),
		WithAlertEventPublisher(events),
		WithStreamGrace(50*time.Millisecond),
		WithStreamDrainLimit(1))

	w := &failAfterWriter{okWrites: 1}
	h.Chat(w, chatReqWithProject(t, "30", true))
	events.waitForEvent(t)
	h.DrainBilling()

	if !h.acquireDrainSlot() {
		t.Fatal("drain slot was never released — the bounded pool leaks capacity")
	}
}

// TestStreamDisconnect_DrainBillingDoesNotWaitFullGrace: graceful shutdown must
// not be held hostage by an abandoned stream. With a long grace configured,
// DrainBilling has to cut the drains loose promptly.
func TestStreamDisconnect_DrainBillingDoesNotWaitFullGrace(t *testing.T) {
	gate := allowGate()
	router := newSilentRouter(chatDelta("c1", "hello"), chatDelta("c2", " world"))
	h := NewHandler(router, nil, nil,
		WithBudgetGate(gate, &fakeCostEstimator{totalNano: 1_000}),
		WithStreamGrace(MaxStreamGrace)) // 15 s

	w := &failAfterWriter{okWrites: 1}
	h.Chat(w, chatReqWithProject(t, "30", true))

	done := make(chan struct{})
	go func() { defer close(done); h.DrainBilling() }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("DrainBilling blocked on the stream grace period; a deploy would truncate on shutdown")
	}
}

// TestStreamContext_CancelledWhenBudgetBlocks: a request rejected before
// dispatch owns a stream context nobody will ever settle. It must be cancelled
// on the spot, otherwise every blocked streaming request leaks a context (and
// the watcher goroutine BifrostContext starts for it).
func TestStreamContext_CancelledWhenBudgetBlocks(t *testing.T) {
	gate := &fakeBudgetChecker{
		checkVerdict: failmode.Decision{Verdict: failmode.Block402, State: failmode.StateNATSHealthy},
		updated:      make(chan struct{}),
	}
	router := &trackingRouter{}
	h := newBudgetHandler(router, gate, 1_000)

	captured := make(chan *schemas.BifrostContext, 4)
	h.streamCtxHook = func(ctx *schemas.BifrostContext) { captured <- ctx }

	rec := httptest.NewRecorder()
	h.Chat(rec, chatReqWithProject(t, "30", true))

	if rec.Code != http.StatusPaymentRequired {
		t.Fatalf("status = %d, want 402", rec.Code)
	}
	if router.called.Load() {
		t.Fatal("provider was dispatched despite a 402")
	}
	var ctx *schemas.BifrostContext
	select {
	case ctx = <-captured:
	default:
		t.Fatal("no stream context was built")
	}
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("stream context outlived a blocked request — cancel was not called on the 402 path")
	}
}

// TestStreamContext_PreservesIdentityValues: decoupling cancellation must not
// decouple values. Per-project credential resolution reads the virtual key from
// this context inside bifrost — losing it would break every streamed request.
func TestStreamContext_PreservesIdentityValues(t *testing.T) {
	h := NewHandler(&fakeRouter{}, nil, nil, WithStreamGrace(DefaultStreamGrace))
	req := httptest.NewRequest(http.MethodPost, "/llm/v1/chat/completions", strings.NewReader("{}"))
	req.Header.Set(headerProjectID, "4242")
	req.Header.Set(headerUserID, "user-7")

	ctx, sc, ok := h.newStreamContext(httptest.NewRecorder(), req)
	if !ok {
		t.Fatal("newStreamContext rejected the request")
	}
	defer sc.cancel()

	if got, _ := ctx.Value(schemas.BifrostContextKeyVirtualKey).(string); got != "4242" {
		t.Errorf("virtual key = %q, want 4242 (per-project credentials resolve from this)", got)
	}
	if got, _ := ctx.Value(schemas.BifrostContextKeyUserID).(string); got != "user-7" {
		t.Errorf("user id = %q, want user-7", got)
	}
	// The whole point: the request's cancellation must NOT reach it.
	if ctx.Err() != nil {
		t.Errorf("stream context already cancelled: %v", ctx.Err())
	}
}

// TestStreamGraceDisabled_KeepsRequestBoundContext: LLM_STREAM_GRACE_MS=0 is the
// kill switch. It must restore the pre-fix behaviour exactly — provider stream
// bound to the request — so an operator can turn the mechanism off without a
// deploy of new code.
func TestStreamGraceDisabled_KeepsRequestBoundContext(t *testing.T) {
	h := NewHandler(&fakeRouter{}, nil, nil, WithStreamGrace(0))
	req := httptest.NewRequest(http.MethodPost, "/llm/v1/chat/completions", strings.NewReader("{}"))
	req.Header.Set(headerProjectID, "1")
	reqCtx, cancelReq := context.WithCancel(context.Background())

	ctx, sc, ok := h.newStreamContext(httptest.NewRecorder(), req.WithContext(reqCtx))
	if !ok {
		t.Fatal("newStreamContext rejected the request")
	}
	defer sc.cancel()

	cancelReq() // simulate the client hanging up
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("with the grace disabled the provider context must still follow the request context")
	}
}

// TestWithStreamGrace_Clamped pins the configured bound: an operator cannot set
// a grace so long that the gateway finances an abandoned generation.
func TestWithStreamGrace_Clamped(t *testing.T) {
	cases := []struct {
		in   time.Duration
		want time.Duration
	}{
		{-time.Second, 0},
		{0, 0},
		{3 * time.Second, 3 * time.Second},
		{MaxStreamGrace, MaxStreamGrace},
		{time.Hour, MaxStreamGrace},
	}
	for _, tc := range cases {
		h := NewHandler(&fakeRouter{}, nil, nil, WithStreamGrace(tc.in))
		if h.streamGrace != tc.want {
			t.Errorf("WithStreamGrace(%v) → %v, want %v", tc.in, h.streamGrace, tc.want)
		}
	}
}

// TestStreamGraceConstantsInSync keeps the env-facing defaults in config and the
// handler-facing defaults here from drifting apart — they describe the same
// policy and a mismatch would make the chart lie about the running behaviour.
func TestStreamGraceConstantsInSync(t *testing.T) {
	if config.DefaultStreamGrace != DefaultStreamGrace {
		t.Errorf("config.DefaultStreamGrace = %v, llmproxy.DefaultStreamGrace = %v", config.DefaultStreamGrace, DefaultStreamGrace)
	}
	if config.MaxStreamGrace != MaxStreamGrace {
		t.Errorf("config.MaxStreamGrace = %v, llmproxy.MaxStreamGrace = %v", config.MaxStreamGrace, MaxStreamGrace)
	}
	if config.DefaultStreamDrainLimit != DefaultStreamDrainLimit {
		t.Errorf("config.DefaultStreamDrainLimit = %d, llmproxy.DefaultStreamDrainLimit = %d", config.DefaultStreamDrainLimit, DefaultStreamDrainLimit)
	}
}
