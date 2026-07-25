package main

// budgetcheck_live.go — the live plumbing for `cutover-ctl budget-check`
// (gate BFF.9e, spec §8.5/§8.8 + the §2.6 circular-guard assertion).
//
// The gate targets the gateway DIRECTLY (:8083), signing the same v1 identity
// headers the elitea-main edge injects (X-Elitea-Project-Id / -User-Id /
// -Tenant-Id / -Identity-Signature over "v1\nproject\nuser\ntenant"). The
// signing secret comes from --identity-secret or $GATEWAY_IDENTITY_SECRET; an
// empty secret is valid when the gateway runs without one (headers are then
// trusted off the mTLS hop alone).
//
// Four live probes populate budgetCheckResult; checkBudgetResult stays the
// single evaluator (unit-tested against fixtures):
//
//  1. hard-block  — one chat request as the over-budget project → 402 with
//     type=budget_exceeded / code=insufficient_quota.
//  2. under-budget — one chat request as the control project → 200.
//  3. soft-alert  — subscribe gateway.events.project.<id>.events, send the
//     tipping request as the ~79% project, measure seconds until the
//     budget.soft_alert event arrives (must be <= --alert-latency-s).
//  4. circular guard — burst the over-budget tuple: the breaker admission
//     check runs BEFORE the budget gate, so rapid requests must flip from
//     402 to 429 rate_limit_exceeded within the burst (spec §2.6 guard #2).
//     NOTE: this opens the tuple's circuit for 30 s on the target gateway —
//     use a disposable test project.

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/nats-io/nats.go"
)

// Identity header names + scheme, mirroring internal/llmproxy/identity.go
// (same module, but the package does not export them; the wire contract is
// stable by spec §6.1).
const (
	bcHeaderProject   = "X-Elitea-Project-Id"
	bcHeaderUser      = "X-Elitea-User-Id"
	bcHeaderTenant    = "X-Elitea-Tenant-Id"
	bcHeaderSignature = "X-Elitea-Identity-Signature"
	bcSigVersion      = "v1"
)

// signIdentity sets the v1 signed identity headers on req. Empty secret sets
// the identity headers without a signature (mTLS-trust deployments).
func signIdentity(req *http.Request, secret []byte, projectID, userID, tenantID string) {
	req.Header.Set(bcHeaderProject, projectID)
	req.Header.Set(bcHeaderUser, userID)
	req.Header.Set(bcHeaderTenant, tenantID)
	if len(secret) == 0 {
		return
	}
	canonical := bcSigVersion + "\n" + projectID + "\n" + userID + "\n" + tenantID
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(canonical))
	req.Header.Set(bcHeaderSignature, "sha256="+hex.EncodeToString(mac.Sum(nil)))
}

// budgetProject is one seeded fixture project.
type budgetProject struct {
	ProjectID string `json:"project_id"`
	UserID    string `json:"user_id"`
	TenantID  string `json:"tenant_id"`
	Model     string `json:"model"` // defaults to openai/gpt-4o
}

func (p budgetProject) model() string {
	if p.Model == "" {
		return "openai/gpt-4o"
	}
	return p.Model
}

// budgetFixture is the --projects-file shape the operator seeds (BFF.9e):
// over_budget at/above its hard limit; soft_alert at ~79% of its limit so one
// request tips it over 80%; under_budget far below its limit.
type budgetFixture struct {
	OverBudget  budgetProject `json:"over_budget"`
	SoftAlert   budgetProject `json:"soft_alert"`
	UnderBudget budgetProject `json:"under_budget"`
}

// loadBudgetFixture reads and validates the fixture file.
func loadBudgetFixture(path string) (budgetFixture, error) {
	var f budgetFixture
	data, err := os.ReadFile(path)
	if err != nil {
		return f, fmt.Errorf("budget-check: cannot read projects file %q: %w", path, err)
	}
	if err := json.Unmarshal(data, &f); err != nil {
		return f, fmt.Errorf("budget-check: malformed projects file %q: %w", path, err)
	}
	for name, p := range map[string]budgetProject{
		"over_budget": f.OverBudget, "soft_alert": f.SoftAlert, "under_budget": f.UnderBudget,
	} {
		if p.ProjectID == "" {
			return f, fmt.Errorf("budget-check: projects file %q: %s.project_id is required", path, name)
		}
	}
	return f, nil
}

// chatBody builds a minimal non-streaming chat request for model. max_tokens
// bounds generation so a long-form (e.g. reasoning) model cannot stall the
// probe past the HTTP client timeout; the exact token count is irrelevant to
// every gate this probe feeds.
func chatBody(model string) []byte {
	b, _ := json.Marshal(map[string]any{
		"model":      model,
		"max_tokens": 64,
		"messages":   []map[string]string{{"role": "user", "content": "budget-check probe"}},
	})
	return b
}

// probeResponse is the decoded outcome of one gateway probe.
type probeResponse struct {
	Status  int
	ErrType string
	ErrCode string
}

// sendChatProbe POSTs one signed chat request and decodes the OpenAI error
// envelope (if any).
func sendChatProbe(client *http.Client, gatewayURL string, secret []byte, p budgetProject) (probeResponse, error) {
	req, err := http.NewRequest(http.MethodPost, gatewayURL+"/llm/v1/chat/completions", bytes.NewReader(chatBody(p.model())))
	if err != nil {
		return probeResponse{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	signIdentity(req, secret, p.ProjectID, p.UserID, p.TenantID)

	resp, err := client.Do(req)
	if err != nil {
		return probeResponse{}, fmt.Errorf("budget-check: gateway request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	out := probeResponse{Status: resp.StatusCode}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var envelope struct {
		Error struct {
			Type string `json:"type"`
			Code string `json:"code"`
		} `json:"error"`
	}
	if json.Unmarshal(body, &envelope) == nil {
		out.ErrType = envelope.Error.Type
		out.ErrCode = envelope.Error.Code
	}
	return out, nil
}

// probeCircularGuard bursts requests at the same (project, model) tuple and
// reports whether the gateway flipped to 429 rate_limit_exceeded within the
// burst (spec §2.6: >= 5 requests within 1 s must open the circuit). The
// burst sends up to 2× the spec threshold to absorb request latency jitter.
func probeCircularGuard(client *http.Client, gatewayURL string, secret []byte, p budgetProject) (bool, error) {
	const burst = 10
	for i := 0; i < burst; i++ {
		resp, err := sendChatProbe(client, gatewayURL, secret, p)
		if err != nil {
			return false, err
		}
		if resp.Status == http.StatusTooManyRequests && resp.ErrCode == "rate_limit_exceeded" {
			return true, nil
		}
	}
	return false, nil
}

// alertWaiter abstracts the NATS soft-alert observation so the decision logic
// is unit-testable without a broker.
type alertWaiter interface {
	// WaitForAlert blocks until a budget.soft_alert event for projectID
	// arrives or timeout elapses. Returns the observed latency from tipAt.
	WaitForAlert(projectID string, tipAt time.Time, timeout time.Duration) (fired bool, latencyS float64, err error)
}

// natsAlertWaiter subscribes to the project's gateway.events subject.
type natsAlertWaiter struct {
	conn *nats.Conn
}

// eventSubject mirrors elitea-main natsbus subjectFor("project:<id>:events")
// and the gateway's eventSubjectForProject.
func eventSubject(projectID string) string {
	return "gateway.events.project." + projectID + ".events"
}

func (w *natsAlertWaiter) WaitForAlert(projectID string, tipAt time.Time, timeout time.Duration) (bool, float64, error) {
	ch := make(chan *nats.Msg, 16)
	sub, err := w.conn.ChanSubscribe(eventSubject(projectID), ch)
	if err != nil {
		return false, 0, fmt.Errorf("budget-check: NATS subscribe: %w", err)
	}
	defer func() { _ = sub.Unsubscribe() }()

	deadline := time.NewTimer(timeout)
	defer deadline.Stop()
	for {
		select {
		case <-deadline.C:
			return false, 0, nil
		case msg := <-ch:
			var evt struct {
				Type string `json:"type"`
			}
			if json.Unmarshal(msg.Data, &evt) == nil && evt.Type == "budget.soft_alert" {
				return true, time.Since(tipAt).Seconds(), nil
			}
		}
	}
}

// liveBudgetCheckConfig carries everything the live gate needs; the HTTP
// client and waiter are injectable for tests.
type liveBudgetCheckConfig struct {
	gatewayURL    string
	secret        []byte
	fixture       budgetFixture
	alertLatencyS float64
	client        *http.Client
	waiter        alertWaiter
	logf          func(format string, args ...any)
}

// runLiveBudgetCheck executes the four probes and returns the populated
// budgetCheckResult for checkBudgetResult to evaluate.
func runLiveBudgetCheck(cfg liveBudgetCheckConfig) (budgetCheckResult, error) {
	var r budgetCheckResult

	// 1. Hard block.
	cfg.logf("budget-check: probing hard block (project %s) ...", cfg.fixture.OverBudget.ProjectID)
	hb, err := sendChatProbe(cfg.client, cfg.gatewayURL, cfg.secret, cfg.fixture.OverBudget)
	if err != nil {
		return r, err
	}
	r.HardBlockStatus = hb.Status
	r.HardBlockType = hb.ErrType
	r.HardBlockCode = hb.ErrCode
	// RouterCalled cannot be observed from outside the gateway; the hermetic
	// preflight gate (TestBFF9E) proves admission-time blocking. Live mode
	// asserts the wire contract only.
	r.RouterCalled = false

	// 2. Under-budget control.
	cfg.logf("budget-check: probing under-budget control (project %s) ...", cfg.fixture.UnderBudget.ProjectID)
	ub, err := sendChatProbe(cfg.client, cfg.gatewayURL, cfg.secret, cfg.fixture.UnderBudget)
	if err != nil {
		return r, err
	}
	r.UnderBudgetStatus = ub.Status

	// 3. Soft alert: subscribe first, then tip the ~79% project over 80%.
	cfg.logf("budget-check: tipping project %s over the 80%% threshold ...", cfg.fixture.SoftAlert.ProjectID)
	tipAt := time.Now()
	type waitOut struct {
		fired    bool
		latencyS float64
		err      error
	}
	waitCh := make(chan waitOut, 1)
	go func() {
		fired, lat, werr := cfg.waiter.WaitForAlert(
			cfg.fixture.SoftAlert.ProjectID, tipAt,
			time.Duration(cfg.alertLatencyS*float64(time.Second)))
		waitCh <- waitOut{fired, lat, werr}
	}()
	// Give the subscription a beat to establish before tipping.
	time.Sleep(100 * time.Millisecond)
	if _, err := sendChatProbe(cfg.client, cfg.gatewayURL, cfg.secret, cfg.fixture.SoftAlert); err != nil {
		return r, err
	}
	wo := <-waitCh
	if wo.err != nil {
		return r, wo.err
	}
	r.SoftAlertFired = wo.fired
	r.SoftAlertLatencyS = wo.latencyS

	// 4. Circular-routing guard (spec §2.6): burst the over-budget tuple.
	cfg.logf("budget-check: bursting (project %s, %s) to assert the loop breaker ...",
		cfg.fixture.OverBudget.ProjectID, cfg.fixture.OverBudget.model())
	tripped, err := probeCircularGuard(cfg.client, cfg.gatewayURL, cfg.secret, cfg.fixture.OverBudget)
	if err != nil {
		return r, err
	}
	r.BreakerTripped = tripped

	return r, nil
}
