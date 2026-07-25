// Package preflight — circular-routing guard integration test (spec §2.6,
// pre-flight exit-gate item "circular-routing guard integration test passes").
//
// Guard #1 (SELF_REFERENTIAL_CREDENTIAL) is covered by unit tests in
// internal/account. This file covers guard #2 end-to-end through the mounted
// chi router: >= 5 requests for the same (project_id, model) tuple within 1 s
// open the circuit and the handler returns HTTP 429 with the spec §2.5 error
// shape (rate_limit_error / rate_limit_exceeded) for 30 s, WITHOUT invoking
// the LLM router — containing a runtime routing loop.
package preflight_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/failmode"
	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/llmproxy"
	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/preflight"
)

// TestCircularRoutingGuard_LoopContained is the §2.6 guard-#2 integration gate.
func TestCircularRoutingGuard_LoopContained(t *testing.T) {
	t.Parallel()

	secret := []byte("circular-guard-secret")
	const (
		projectID     = 9005
		projectIDStr  = "9005"
		userID        = "user-circular"
		tenantID      = "tenant-circular"
		hardLimitNano = int64(100) * failmode.NanoUSD // generous — budget must NOT be the blocker
	)

	router := preflight.NewMockRouter(preflight.MockRouterConfig{
		InputTokens:  10,
		OutputTokens: 5,
	})
	gov, _, _ := preflight.NewSeededGovernance(t, projectID, hardLimitNano, 0)
	handler := preflight.MountedHandler(t, router, gov, secret,
		llmproxy.WithLoopBreaker(), // arm guard #2 exactly as main.go does
	)

	send := func() *httptest.ResponseRecorder {
		body := `{"model":"openai/gpt-4o","messages":[{"role":"user","content":"loop"}]}`
		req := httptest.NewRequest(http.MethodPost, "/llm/v1/chat/completions", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		preflight.SignRequest(req, secret, projectIDStr, userID, tenantID)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}

	// A loop hammers the same tuple with no delay: the first 4 requests pass,
	// the 5th opens the circuit.
	for i := 0; i < 4; i++ {
		if rec := send(); rec.Code != http.StatusOK {
			t.Fatalf("request %d: status = %d, want 200 (below breaker threshold)\nbody: %s",
				i+1, rec.Code, rec.Body.String())
		}
	}

	rec := send()
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("5th request within 1 s: status = %d, want 429 (circuit must open)\nbody: %s",
			rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Error("429 response missing Retry-After header")
	}

	var errBody struct {
		Error struct {
			Type string `json:"type"`
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &errBody); err != nil {
		t.Fatalf("decode 429 body: %v\nraw: %s", err, rec.Body.String())
	}
	if errBody.Error.Type != "rate_limit_error" {
		t.Errorf("error.type = %q, want rate_limit_error (spec §2.5)", errBody.Error.Type)
	}
	if errBody.Error.Code != "rate_limit_exceeded" {
		t.Errorf("error.code = %q, want rate_limit_exceeded (spec §2.5)", errBody.Error.Code)
	}

	// While open, the loop's traffic keeps getting 429 and the provider is
	// never called again.
	router.Reset()
	for i := 0; i < 3; i++ {
		if rec := send(); rec.Code != http.StatusTooManyRequests {
			t.Fatalf("request during open circuit: status = %d, want 429", rec.Code)
		}
	}
	if router.Called() {
		t.Error("provider was called during open circuit — loop NOT contained")
	}

	// A different project on the same model is unaffected (tuple isolation).
	otherBody := `{"model":"openai/gpt-4o","messages":[{"role":"user","content":"innocent"}]}`
	otherReq := httptest.NewRequest(http.MethodPost, "/llm/v1/chat/completions", strings.NewReader(otherBody))
	otherReq.Header.Set("Content-Type", "application/json")
	preflight.SignRequest(otherReq, secret, "9006", userID, tenantID)
	otherRec := httptest.NewRecorder()
	handler.ServeHTTP(otherRec, otherReq)
	if otherRec.Code != http.StatusOK {
		t.Errorf("innocent project during open circuit: status = %d, want 200 (tuple isolation)", otherRec.Code)
	}
}
