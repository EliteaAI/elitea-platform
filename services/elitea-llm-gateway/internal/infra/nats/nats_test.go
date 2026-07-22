package nats

import (
	"context"
	"errors"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/sony/gobreaker/v2"
)

// --- fakes for the narrow operation seams -----------------------------------

type fakePublisher struct {
	mu      sync.Mutex
	calls   int
	lastMsg *nats.Msg
	ackVal  string
	err     error
	block   time.Duration // simulate a slow/partitioned server
	ctxSaw  error         // records ctx.Err() observed inside the op
}

func (f *fakePublisher) PublishMsg(ctx context.Context, m *nats.Msg, _ ...jetstream.PublishOpt) (*jetstream.PubAck, error) {
	f.mu.Lock()
	f.calls++
	f.lastMsg = m
	block, err, ackVal := f.block, f.err, f.ackVal
	f.mu.Unlock()
	if block > 0 {
		select {
		case <-time.After(block):
		case <-ctx.Done():
			f.mu.Lock()
			f.ctxSaw = ctx.Err()
			f.mu.Unlock()
			return nil, ctx.Err()
		}
	}
	if err != nil {
		return nil, err
	}
	return &jetstream.PubAck{Value: ackVal}, nil
}

func (f *fakePublisher) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

type fakeReader struct {
	raw *jetstream.RawStreamMsg
	err error
}

func (f *fakeReader) GetLastMsgForSubject(_ context.Context, _ string) (*jetstream.RawStreamMsg, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.raw, nil
}

type fakeKV struct {
	existing map[string]bool
	err      error
	mu       sync.Mutex
}

func (f *fakeKV) Create(_ context.Context, key string, _ []byte, _ ...jetstream.KVCreateOpt) (uint64, error) {
	if f.err != nil {
		return 0, f.err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.existing == nil {
		f.existing = map[string]bool{}
	}
	if f.existing[key] {
		return 0, jetstream.ErrKeyExists
	}
	f.existing[key] = true
	return 1, nil
}

// fakeConn is a stand-in for *nats.Conn used to exercise Close().
type fakeConn struct {
	closed bool
	closes int
}

func (f *fakeConn) Close()         { f.closed = true; f.closes++ }
func (f *fakeConn) IsClosed() bool { return f.closed }

// fakeProvisioner exercises ensureAssets without a live server. It records the
// StreamConfig so the AllowMsgCounter contract can be asserted, and returns a
// stub Stream that satisfies both jetstream.Stream and counterReader.
type fakeProvisioner struct {
	streamCfg jetstream.StreamConfig
	kvCfg     jetstream.KeyValueConfig
	streamErr error
	kvErr     error
	bindErr   error
	boundStrm jetstream.Stream
}

func (f *fakeProvisioner) CreateOrUpdateStream(_ context.Context, cfg jetstream.StreamConfig) (jetstream.Stream, error) {
	f.streamCfg = cfg
	return nil, f.streamErr
}

func (f *fakeProvisioner) CreateOrUpdateKeyValue(_ context.Context, cfg jetstream.KeyValueConfig) (jetstream.KeyValue, error) {
	f.kvCfg = cfg
	if f.kvErr != nil {
		return nil, f.kvErr
	}
	return stubKV{}, nil
}

func (f *fakeProvisioner) Stream(_ context.Context, _ string) (jetstream.Stream, error) {
	return f.boundStrm, f.bindErr
}

// stubKV satisfies jetstream.KeyValue enough to be returned by the provisioner;
// only Create is reachable through the Client.
type stubKV struct{ jetstream.KeyValue }

// newTestClient builds a Client wired to fakes with a low failure threshold so
// breaker behaviour is exercisable in a unit test.
func newTestClient(cfg Config, pub publisher, rd counterReader, kv kvCreator) *Client {
	cfg = cfg.withDefaults()
	c := &Client{cfg: cfg, pub: pub, budget: rd, cooldown: kv}
	c.breaker = newBreaker(cfg, func(from, to gobreaker.State) {
		if c.onStateChange != nil {
			c.onStateChange(from, to)
		}
	})
	return c
}

// --- tests ------------------------------------------------------------------

func TestConfigDefaults(t *testing.T) {
	c := Config{}.withDefaults()
	if c.Name != "elitea-llm-gateway" {
		t.Errorf("Name default = %q", c.Name)
	}
	if c.CBFailureThreshold != 3 {
		t.Errorf("CBFailureThreshold default = %d, want 3", c.CBFailureThreshold)
	}
	if c.CBOpenDuration != 10*time.Second {
		t.Errorf("CBOpenDuration default = %v, want 10s", c.CBOpenDuration)
	}
	if c.Replicas != 1 {
		t.Errorf("Replicas default = %d, want 1", c.Replicas)
	}
}

func TestConnectEmptyURL(t *testing.T) {
	if _, err := Connect(context.Background(), Config{}); err == nil {
		t.Fatal("Connect with empty URL should error")
	}
}

func TestBudgetSubject(t *testing.T) {
	got := BudgetSubject("project", "42", 1700000000)
	want := "gateway.budget.counter.project.42.1700000000"
	if got != want {
		t.Errorf("BudgetSubject = %q, want %q", got, want)
	}
}

func TestOpTimeoutIs150ms(t *testing.T) {
	// The hardening contract: OpTimeout is exactly 150ms and ConnectTimeout 1s.
	if OpTimeout != 150*time.Millisecond {
		t.Errorf("OpTimeout = %v, want 150ms", OpTimeout)
	}
	if ConnectTimeout != 1*time.Second {
		t.Errorf("ConnectTimeout = %v, want 1s", ConnectTimeout)
	}
}

func TestIncrBudgetReturnsRunningTotal(t *testing.T) {
	pub := &fakePublisher{ackVal: "1500000000"} // 1.5 USD in nano
	c := newTestClient(Config{}, pub, nil, nil)
	got, err := c.IncrBudget(context.Background(), "gateway.budget.counter.project.1.100", 500000000)
	if err != nil {
		t.Fatalf("IncrBudget: %v", err)
	}
	if got != 1500000000 {
		t.Errorf("total = %d, want 1500000000", got)
	}
	// The Nats-Incr header MUST carry the delta.
	if h := pub.lastMsg.Header.Get(IncrHeader); h != "500000000" {
		t.Errorf("Nats-Incr header = %q, want 500000000", h)
	}
}

func TestIncrBudgetNegativeDelta(t *testing.T) {
	pub := &fakePublisher{ackVal: "0"}
	c := newTestClient(Config{}, pub, nil, nil)
	if _, err := c.IncrBudget(context.Background(), "s", -250); err != nil {
		t.Fatalf("IncrBudget negative: %v", err)
	}
	if h := pub.lastMsg.Header.Get(IncrHeader); h != "-250" {
		t.Errorf("Nats-Incr header = %q, want -250", h)
	}
}

func TestIncrBudgetBadAckValueIsConfigError(t *testing.T) {
	// A non-counter stream returns an empty/blank val — a config error, mapped
	// through but NOT masked as ErrUnavailable.
	pub := &fakePublisher{ackVal: ""}
	c := newTestClient(Config{}, pub, nil, nil)
	_, err := c.IncrBudget(context.Background(), "s", 1)
	if err == nil {
		t.Fatal("expected error on empty counter ack")
	}
	if errors.Is(err, ErrUnavailable) {
		t.Error("empty ack must not be mapped to ErrUnavailable (it is a config error)")
	}
}

func TestReadBudgetMissingCounterIsZero(t *testing.T) {
	rd := &fakeReader{err: jetstream.ErrMsgNotFound}
	c := newTestClient(Config{}, nil, rd, nil)
	got, err := c.ReadBudget(context.Background(), "s")
	if err != nil {
		t.Fatalf("ReadBudget: %v", err)
	}
	if got != 0 {
		t.Errorf("missing counter = %d, want 0", got)
	}
}

func TestReadBudgetParsesPayload(t *testing.T) {
	rd := &fakeReader{raw: &jetstream.RawStreamMsg{Data: []byte("9223372036854775807")}}
	c := newTestClient(Config{}, nil, rd, nil)
	got, err := c.ReadBudget(context.Background(), "s")
	if err != nil {
		t.Fatalf("ReadBudget: %v", err)
	}
	if got != 9223372036854775807 {
		t.Errorf("total = %d, want max int64", got)
	}
}

func TestCounterValueEmpty(t *testing.T) {
	v, err := counterValue(&jetstream.RawStreamMsg{})
	if err != nil || v != 0 {
		t.Errorf("counterValue(empty) = %d, %v; want 0, nil", v, err)
	}
	if v, err := counterValue(nil); err != nil || v != 0 {
		t.Errorf("counterValue(nil) = %d, %v; want 0, nil", v, err)
	}
}

func TestCounterValueGarbage(t *testing.T) {
	if _, err := counterValue(&jetstream.RawStreamMsg{Data: []byte("not-a-number")}); err == nil {
		t.Error("counterValue should error on non-numeric payload")
	}
}

func TestTryAlertCooldownFirstFiresThenSuppresses(t *testing.T) {
	kv := &fakeKV{}
	c := newTestClient(Config{}, nil, nil, kv)
	fire, err := c.TryAlertCooldown(context.Background(), "project:1:80")
	if err != nil || !fire {
		t.Fatalf("first claim: fire=%v err=%v; want true,nil", fire, err)
	}
	fire, err = c.TryAlertCooldown(context.Background(), "project:1:80")
	if err != nil {
		t.Fatalf("second claim err: %v", err)
	}
	if fire {
		t.Error("second claim within cooldown must suppress (fire=false)")
	}
}

func TestPublishDeltaSetsMsgID(t *testing.T) {
	pub := &fakePublisher{ackVal: "0"}
	c := newTestClient(Config{}, pub, nil, nil)
	if err := c.PublishDelta(context.Background(), "evt-123", []byte(`{"x":1}`)); err != nil {
		t.Fatalf("PublishDelta: %v", err)
	}
	if pub.lastMsg.Subject != DeltaSubject {
		t.Errorf("subject = %q, want %q", pub.lastMsg.Subject, DeltaSubject)
	}
	if id := pub.lastMsg.Header.Get(jetstream.MsgIDHeader); id != "evt-123" {
		t.Errorf("Nats-Msg-Id = %q, want evt-123", id)
	}
}

func TestOpTimeoutTripsBreaker(t *testing.T) {
	// A publisher that blocks longer than OpTimeout must surface ErrUnavailable
	// (deadline) rather than hang, and the op's ctx MUST have been cancelled.
	pub := &fakePublisher{ackVal: "0", block: 500 * time.Millisecond}
	c := newTestClient(Config{}, pub, nil, nil)
	start := time.Now()
	_, err := c.IncrBudget(context.Background(), "s", 1)
	elapsed := time.Since(start)
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("slow op err = %v, want ErrUnavailable", err)
	}
	if elapsed > 400*time.Millisecond {
		t.Errorf("op took %v; OpTimeout(150ms) not enforced", elapsed)
	}
	if pub.ctxSaw == nil {
		t.Error("op ctx was not cancelled at the OpTimeout deadline")
	}
}

func TestBreakerOpensAfterThresholdAndMapsUnavailable(t *testing.T) {
	pub := &fakePublisher{err: nats.ErrNoResponders}
	c := newTestClient(Config{CBFailureThreshold: 3}, pub, nil, nil)

	var mu sync.Mutex
	var transitions []gobreaker.State
	c.onStateChange = func(_, to gobreaker.State) {
		mu.Lock()
		transitions = append(transitions, to)
		mu.Unlock()
	}

	for i := 0; i < 3; i++ {
		if _, err := c.IncrBudget(context.Background(), "s", 1); !errors.Is(err, ErrUnavailable) {
			t.Fatalf("call %d err = %v, want ErrUnavailable", i, err)
		}
	}
	if c.BreakerState() != gobreaker.StateOpen {
		t.Fatalf("breaker state = %v, want Open after %d failures", c.BreakerState(), 3)
	}
	// While open, the op is short-circuited — the publisher is NOT called again.
	before := pub.callCount()
	if _, err := c.IncrBudget(context.Background(), "s", 1); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("open-state err = %v, want ErrUnavailable", err)
	}
	if pub.callCount() != before {
		t.Error("open breaker must short-circuit without invoking the publisher")
	}
	mu.Lock()
	sawOpen := false
	for _, s := range transitions {
		if s == gobreaker.StateOpen {
			sawOpen = true
		}
	}
	mu.Unlock()
	if !sawOpen {
		t.Error("OnBreakerStateChange never reported the Open transition")
	}
}

func TestBreakerRecoversToClosed(t *testing.T) {
	pub := &fakePublisher{err: nats.ErrTimeout}
	c := newTestClient(Config{CBFailureThreshold: 2, CBOpenDuration: 60 * time.Millisecond}, pub, nil, nil)

	for i := 0; i < 2; i++ {
		_, _ = c.IncrBudget(context.Background(), "s", 1)
	}
	if c.BreakerState() != gobreaker.StateOpen {
		t.Fatalf("state = %v, want Open", c.BreakerState())
	}
	// After the open duration the breaker probes half-open; a success closes it.
	time.Sleep(80 * time.Millisecond)
	pub.mu.Lock()
	pub.err = nil
	pub.ackVal = "10"
	pub.mu.Unlock()
	if _, err := c.IncrBudget(context.Background(), "s", 5); err != nil {
		t.Fatalf("half-open probe err: %v", err)
	}
	if c.BreakerState() != gobreaker.StateClosed {
		t.Errorf("state = %v, want Closed after successful probe", c.BreakerState())
	}
}

func TestMapErrPassthrough(t *testing.T) {
	sentinel := errors.New("boom")
	if got := mapErr(sentinel); errors.Is(got, ErrUnavailable) {
		t.Error("unrelated error must not be mapped to ErrUnavailable")
	}
	if mapErr(nil) != nil {
		t.Error("mapErr(nil) must be nil")
	}
	for _, e := range []error{
		gobreaker.ErrOpenState, gobreaker.ErrTooManyRequests,
		context.DeadlineExceeded, nats.ErrTimeout, nats.ErrNoResponders, nats.ErrConnectionClosed,
	} {
		if got := mapErr(e); !errors.Is(got, ErrUnavailable) {
			t.Errorf("mapErr(%v) not mapped to ErrUnavailable", e)
		}
	}
}

func TestReadBudgetMapsInfraError(t *testing.T) {
	rd := &fakeReader{err: nats.ErrTimeout}
	c := newTestClient(Config{}, nil, rd, nil)
	if _, err := c.ReadBudget(context.Background(), "s"); !errors.Is(err, ErrUnavailable) {
		t.Errorf("ReadBudget infra err = %v, want ErrUnavailable", err)
	}
}

func TestReadBudgetGarbagePayloadIsConfigError(t *testing.T) {
	rd := &fakeReader{raw: &jetstream.RawStreamMsg{Data: []byte("xyz")}}
	c := newTestClient(Config{}, nil, rd, nil)
	_, err := c.ReadBudget(context.Background(), "s")
	if err == nil {
		t.Fatal("expected parse error")
	}
	if errors.Is(err, ErrUnavailable) {
		t.Error("parse error must not be ErrUnavailable")
	}
}

func TestTryAlertCooldownMapsInfraError(t *testing.T) {
	kv := &fakeKV{err: nats.ErrNoResponders}
	c := newTestClient(Config{}, nil, nil, kv)
	if _, err := c.TryAlertCooldown(context.Background(), "k"); !errors.Is(err, ErrUnavailable) {
		t.Errorf("cooldown infra err = %v, want ErrUnavailable", err)
	}
}

func TestPublishDeltaMapsInfraError(t *testing.T) {
	pub := &fakePublisher{err: nats.ErrConnectionClosed}
	c := newTestClient(Config{}, pub, nil, nil)
	if err := c.PublishDelta(context.Background(), "e", []byte("{}")); !errors.Is(err, ErrUnavailable) {
		t.Errorf("PublishDelta infra err = %v, want ErrUnavailable", err)
	}
}

func TestConnectUnreachableURLFailsFast(t *testing.T) {
	// A syntactically valid but unroutable URL must fail (fast, bounded by the
	// 1s connect timeout) rather than hang. Uses the reserved TEST-NET-1 block.
	start := time.Now()
	_, err := Connect(context.Background(), Config{URL: "nats://192.0.2.1:4222"})
	if err == nil {
		t.Fatal("Connect to unreachable server should error")
	}
	if time.Since(start) > 5*time.Second {
		t.Errorf("Connect took %v; connect timeout not enforced", time.Since(start))
	}
}

func TestEnsureAssetsConfiguresCounterStream(t *testing.T) {
	prov := &fakeProvisioner{}
	c := &Client{cfg: Config{Replicas: 3}.withDefaults()}
	if err := c.ensureAssets(context.Background(), prov); err != nil {
		t.Fatalf("ensureAssets: %v", err)
	}
	// The budget stream MUST enable the atomic counter (Nats-Incr requires it).
	if !prov.streamCfg.AllowMsgCounter {
		t.Error("budget stream must set AllowMsgCounter=true")
	}
	if prov.streamCfg.Name != BudgetStream {
		t.Errorf("stream name = %q, want %q", prov.streamCfg.Name, BudgetStream)
	}
	if prov.streamCfg.Replicas != 3 {
		t.Errorf("stream replicas = %d, want 3", prov.streamCfg.Replicas)
	}
	if prov.kvCfg.Bucket != AlertCooldownBucket {
		t.Errorf("kv bucket = %q, want %q", prov.kvCfg.Bucket, AlertCooldownBucket)
	}
	if c.cooldown == nil {
		t.Error("cooldown KV not bound")
	}
}

func TestEnsureAssetsPropagatesErrors(t *testing.T) {
	cases := map[string]*fakeProvisioner{
		"stream": {streamErr: errors.New("stream boom")},
		"kv":     {kvErr: errors.New("kv boom")},
		"bind":   {bindErr: errors.New("bind boom")},
	}
	for name, prov := range cases {
		t.Run(name, func(t *testing.T) {
			c := &Client{cfg: Config{}.withDefaults()}
			if err := c.ensureAssets(context.Background(), prov); err == nil {
				t.Errorf("%s error not propagated", name)
			}
		})
	}
}

func TestOnBreakerStateChangeAndAccessors(t *testing.T) {
	pub := &fakePublisher{err: nats.ErrNoResponders}
	c := newTestClient(Config{CBFailureThreshold: 1}, pub, nil, nil)
	var fired bool
	c.OnBreakerStateChange(func(_, _ gobreaker.State) { fired = true })
	_, _ = c.IncrBudget(context.Background(), "s", 1)
	if !fired {
		t.Error("OnBreakerStateChange callback not invoked on transition")
	}
	if c.BreakerState() != gobreaker.StateOpen {
		t.Errorf("state = %v, want Open", c.BreakerState())
	}
}

func TestCloseIsIdempotent(t *testing.T) {
	fc := &fakeConn{}
	c := &Client{nc: fc}
	c.Close()
	c.Close() // second close must be a no-op (IsClosed guard)
	if fc.closes != 1 {
		t.Errorf("Close invoked underlying %d times, want 1", fc.closes)
	}
	// Close on a client with no conn must not panic.
	(&Client{}).Close()
}

func TestJetStreamAccessor(t *testing.T) {
	c := &Client{}
	if c.JetStream() != nil {
		t.Error("nil js should return nil")
	}
}

func TestParseIntRoundTripGuard(t *testing.T) {
	// Guard the nano-USD headroom claim: int64 holds ≈9.2e9 USD in nano.
	const maxNano = int64(9223372036854775807)
	s := strconv.FormatInt(maxNano, 10)
	back, err := strconv.ParseInt(s, 10, 64)
	if err != nil || back != maxNano {
		t.Fatalf("nano round-trip failed: %v", err)
	}
}
