package main

// budgetcheck_live_test.go — unit tests for the live BFF.9e plumbing against
// an httptest gateway double and a fake alert waiter. No NATS or real gateway.

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

// TestBudgetCheckLive_SignIdentity_GoldenVector pins the v1 signing scheme to
// the gateway's wire contract: sha256=<hex hmac over "v1\nproject\nuser\ntenant">.
func TestBudgetCheckLive_SignIdentity_GoldenVector(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/llm/v1/chat/completions", nil)
	secret := []byte("test-secret")
	signIdentity(req, secret, "42", "u1", "t1")

	if got := req.Header.Get(bcHeaderProject); got != "42" {
		t.Errorf("project header = %q, want 42", got)
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte("v1\n42\nu1\nt1"))
	want := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	if got := req.Header.Get(bcHeaderSignature); got != want {
		t.Errorf("signature = %q, want %q", got, want)
	}
}

// TestBudgetCheckLive_SignIdentity_EmptySecretNoSignature asserts unsigned
// deployments get identity headers but no signature header.
func TestBudgetCheckLive_SignIdentity_EmptySecretNoSignature(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	signIdentity(req, nil, "42", "u", "t")
	if req.Header.Get(bcHeaderSignature) != "" {
		t.Error("signature header set despite empty secret")
	}
	if req.Header.Get(bcHeaderProject) != "42" {
		t.Error("identity headers must be set even without a secret")
	}
}

// TestBudgetCheckLive_LoadFixture covers happy path + each error path.
func TestBudgetCheckLive_LoadFixture(t *testing.T) {
	dir := t.TempDir()
	good := filepath.Join(dir, "good.json")
	if err := os.WriteFile(good, []byte(`{
		"over_budget":  {"project_id":"9101","user_id":"u","tenant_id":"t"},
		"soft_alert":   {"project_id":"9102","model":"anthropic/claude-sonnet-5"},
		"under_budget": {"project_id":"9103"}
	}`), 0o644); err != nil {
		t.Fatal(err)
	}
	f, err := loadBudgetFixture(good)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if f.SoftAlert.model() != "anthropic/claude-sonnet-5" {
		t.Errorf("soft_alert model = %q", f.SoftAlert.model())
	}
	if f.UnderBudget.model() != "openai/gpt-4o" {
		t.Errorf("default model = %q, want openai/gpt-4o", f.UnderBudget.model())
	}

	if _, err := loadBudgetFixture(filepath.Join(dir, "missing.json")); err == nil {
		t.Error("missing file must error")
	}
	bad := filepath.Join(dir, "bad.json")
	_ = os.WriteFile(bad, []byte("{"), 0o644)
	if _, err := loadBudgetFixture(bad); err == nil {
		t.Error("malformed JSON must error")
	}
	empty := filepath.Join(dir, "empty.json")
	_ = os.WriteFile(empty, []byte(`{"over_budget":{"project_id":"1"},"soft_alert":{"project_id":"2"},"under_budget":{}}`), 0o644)
	if _, err := loadBudgetFixture(empty); err == nil {
		t.Error("missing under_budget.project_id must error")
	}
}

// fakeGateway simulates the gateway's budget + breaker behaviour keyed on the
// signed project header:
//   - project "9101" (over budget): 402 budget_exceeded until the same tuple
//     has made >= 5 requests within the run, then 429 rate_limit_exceeded
//     (breaker admission runs before the budget gate).
//   - project "9102" (soft alert):  200.
//   - project "9103" (under):       200.
func fakeGateway(t *testing.T) (*httptest.Server, *atomic.Int64) {
	t.Helper()
	var overCalls atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/llm/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		switch r.Header.Get(bcHeaderProject) {
		case "9101":
			n := overCalls.Add(1)
			w.Header().Set("Content-Type", "application/json")
			if n >= 5 {
				w.WriteHeader(http.StatusTooManyRequests)
				_, _ = w.Write([]byte(`{"error":{"message":"loop","type":"rate_limit_error","code":"rate_limit_exceeded"}}`))
				return
			}
			w.WriteHeader(http.StatusPaymentRequired)
			_, _ = w.Write([]byte(`{"error":{"message":"over budget","type":"budget_exceeded","code":"insufficient_quota"}}`))
		default:
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"ok","choices":[]}`))
		}
	}))
	t.Cleanup(srv.Close)
	return srv, &overCalls
}

// fakeWaiter satisfies alertWaiter with canned observations. setupDelay
// simulates a slow subscription: readiness is signalled only after it elapses,
// and the caller must not tip before then.
type fakeWaiter struct {
	fired      bool
	latency    time.Duration
	err        error
	setupDelay time.Duration
}

func (f *fakeWaiter) WaitForAlert(_ string, _ time.Duration, ready chan<- struct{}) (bool, time.Time, error) {
	if f.setupDelay > 0 {
		time.Sleep(f.setupDelay)
	}
	close(ready)
	if !f.fired {
		return false, time.Time{}, f.err
	}
	return true, time.Now().Add(f.latency), f.err
}

func liveFixture() budgetFixture {
	return budgetFixture{
		OverBudget:  budgetProject{ProjectID: "9101", UserID: "u", TenantID: "t"},
		SoftAlert:   budgetProject{ProjectID: "9102", UserID: "u", TenantID: "t"},
		UnderBudget: budgetProject{ProjectID: "9103", UserID: "u", TenantID: "t"},
	}
}

// TestBudgetCheckLive_AllGatesPass drives the full probe sequence against the
// fake gateway and asserts every gate holds.
func TestBudgetCheckLive_AllGatesPass(t *testing.T) {
	srv, _ := fakeGateway(t)
	result, err := runLiveBudgetCheck(liveBudgetCheckConfig{
		gatewayURL:    srv.URL,
		secret:        []byte("s"),
		fixture:       liveFixture(),
		alertLatencyS: 10,
		client:        srv.Client(),
		waiter:        &fakeWaiter{fired: true, latency: 1500 * time.Millisecond},
		logf:          t.Logf,
	})
	if err != nil {
		t.Fatalf("runLiveBudgetCheck: %v", err)
	}

	out := checkBudgetResult(result, 10)
	if !out.allPass() {
		t.Fatalf("gates failed: %+v", out)
	}
	if result.HardBlockStatus != 402 || result.HardBlockType != "budget_exceeded" || result.HardBlockCode != "insufficient_quota" {
		t.Errorf("hard-block observation = %+v", result)
	}
	if !result.BreakerTripped {
		t.Error("breaker burst did not observe 429 rate_limit_exceeded")
	}
}

// TestBudgetCheckLive_NoBreaker_Fails asserts a gateway WITHOUT the loop
// breaker (never returns 429) fails the circular-guard gate — the assertion
// that makes this gate meaningful.
func TestBudgetCheckLive_NoBreaker_Fails(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Header.Get(bcHeaderProject) == "9101" {
			w.WriteHeader(http.StatusPaymentRequired)
			_, _ = w.Write([]byte(`{"error":{"type":"budget_exceeded","code":"insufficient_quota"}}`))
			return
		}
		_, _ = w.Write([]byte(`{"id":"ok"}`))
	}))
	t.Cleanup(srv.Close)

	result, err := runLiveBudgetCheck(liveBudgetCheckConfig{
		gatewayURL:    srv.URL,
		secret:        nil,
		fixture:       liveFixture(),
		alertLatencyS: 10,
		client:        srv.Client(),
		waiter:        &fakeWaiter{fired: true, latency: time.Second},
		logf:          t.Logf,
	})
	if err != nil {
		t.Fatalf("runLiveBudgetCheck: %v", err)
	}
	out := checkBudgetResult(result, 10)
	if out.CircularGuardPass {
		t.Fatal("CircularGuardPass = true for a gateway without a loop breaker — gate is toothless")
	}
	if out.allPass() {
		t.Fatal("allPass = true, want false")
	}
}

// TestBudgetCheckLive_NoAlert_Fails asserts a missing soft-alert event fails
// the alert gate.
func TestBudgetCheckLive_NoAlert_Fails(t *testing.T) {
	srv, _ := fakeGateway(t)
	result, err := runLiveBudgetCheck(liveBudgetCheckConfig{
		gatewayURL:    srv.URL,
		secret:        nil,
		fixture:       liveFixture(),
		alertLatencyS: 10,
		client:        srv.Client(),
		waiter:        &fakeWaiter{fired: false},
		logf:          t.Logf,
	})
	if err != nil {
		t.Fatalf("runLiveBudgetCheck: %v", err)
	}
	if out := checkBudgetResult(result, 10); out.SoftAlertPass {
		t.Fatal("SoftAlertPass = true with no alert observed")
	}
}

// orderedWaiter records whether it had signalled subscription readiness before
// the caller sent the tipping request.
type orderedWaiter struct {
	setupDelay time.Duration
	ready      atomic.Bool
}

func (w *orderedWaiter) WaitForAlert(_ string, _ time.Duration, ready chan<- struct{}) (bool, time.Time, error) {
	time.Sleep(w.setupDelay)
	w.ready.Store(true)
	close(ready)
	return true, time.Now(), nil
}

// TestBudgetCheckLive_TipWaitsForSubscription asserts the soft-alert probe tips
// the project only AFTER the waiter reports its subscription is live. A fixed
// sleep here would race a slow (e.g. reconnecting) NATS and drop the alert,
// failing the gate for a healthy gateway.
func TestBudgetCheckLive_TipWaitsForSubscription(t *testing.T) {
	waiter := &orderedWaiter{setupDelay: 150 * time.Millisecond}
	var tippedAfterReady atomic.Bool
	var tips atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get(bcHeaderProject) == "9102" {
			tips.Add(1)
			tippedAfterReady.Store(waiter.ready.Load())
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"ok"}`))
	}))
	t.Cleanup(srv.Close)

	if _, err := runLiveBudgetCheck(liveBudgetCheckConfig{
		gatewayURL:    srv.URL,
		secret:        nil,
		fixture:       liveFixture(),
		alertLatencyS: 10,
		client:        srv.Client(),
		waiter:        waiter,
		logf:          t.Logf,
	}); err != nil {
		t.Fatalf("runLiveBudgetCheck: %v", err)
	}
	if tips.Load() != 1 {
		t.Fatalf("soft-alert tipping requests = %d, want 1", tips.Load())
	}
	if !tippedAfterReady.Load() {
		t.Fatal("tipping request was sent before the subscription reported ready")
	}
}

// TestBudgetCheckLive_ProbeDecodesEnvelope pins sendChatProbe's envelope decode.
func TestBudgetCheckLive_ProbeDecodesEnvelope(t *testing.T) {
	srv, _ := fakeGateway(t)
	resp, err := sendChatProbe(srv.Client(), srv.URL, nil, budgetProject{ProjectID: "9101"})
	if err != nil {
		t.Fatalf("sendChatProbe: %v", err)
	}
	if resp.Status != 402 || resp.ErrType != "budget_exceeded" || resp.ErrCode != "insufficient_quota" {
		t.Errorf("probe = %+v, want 402/budget_exceeded/insufficient_quota", resp)
	}
}

// TestBudgetCheckLive_ProbeSendsWellFormedChatBody asserts the probe body is
// a decodable chat request carrying the fixture's model.
func TestBudgetCheckLive_ProbeSendsWellFormedChatBody(t *testing.T) {
	var gotModel string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Model    string `json:"model"`
			Messages []any  `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("gateway received undecodable body: %v", err)
		}
		gotModel = body.Model
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(srv.Close)

	_, err := sendChatProbe(srv.Client(), srv.URL, nil, budgetProject{ProjectID: "1", Model: "openai/gpt-4o-mini"})
	if err != nil {
		t.Fatal(err)
	}
	if gotModel != "openai/gpt-4o-mini" {
		t.Errorf("model = %q, want openai/gpt-4o-mini", gotModel)
	}
}

// TestBudgetCheckLive_EventSubject pins the subject to the natsbus scheme.
func TestBudgetCheckLive_EventSubject(t *testing.T) {
	if got, want := eventSubject("42"), "gateway.events.project.42.events"; got != want {
		t.Errorf("eventSubject = %q, want %q", got, want)
	}
}

// TestBudgetCheck_Outcome_AllPassRequiresBreaker asserts the evaluator's new
// gate: a result that passes gates 1-3 but never tripped the breaker fails.
func TestBudgetCheck_Outcome_AllPassRequiresBreaker(t *testing.T) {
	r := budgetCheckResult{
		HardBlockStatus: 402, HardBlockType: "budget_exceeded", HardBlockCode: "insufficient_quota",
		SoftAlertFired: true, SoftAlertLatencyS: 2, UnderBudgetStatus: 200,
		BreakerTripped: false,
	}
	out := checkBudgetResult(r, 10)
	if out.allPass() {
		t.Fatal("allPass = true without BreakerTripped")
	}
	r.BreakerTripped = true
	if out := checkBudgetResult(r, 10); !out.allPass() {
		t.Fatalf("allPass = false with all gates satisfied: %+v", out)
	}
}
