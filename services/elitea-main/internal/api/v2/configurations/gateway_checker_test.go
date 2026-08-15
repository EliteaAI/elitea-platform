package configurations_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	handler "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/configurations"
)

// fakeGateway is an httptest server standing in for elitea-llm-gateway's
// POST /llm/v1/check_connection, so GatewayConnectionChecker.Check's wire
// behaviour (request shape, identity headers, response mapping) can be
// verified without a live gateway or podman stack.
type fakeGateway struct {
	*httptest.Server
	lastRequest map[string]any
	lastHeaders http.Header
	respond     func(w http.ResponseWriter)
}

func newFakeGateway(respond func(w http.ResponseWriter)) *fakeGateway {
	fg := &fakeGateway{respond: respond}
	fg.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		fg.lastRequest = body
		fg.lastHeaders = r.Header.Clone()
		fg.respond(w)
	}))
	return fg
}

func writeGatewayJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// TestGatewayConnectionChecker_SuccessRoundTrip proves the checker forwards
// the credential type/data to the gateway and reports success only when the
// gateway itself reports success.
func TestGatewayConnectionChecker_SuccessRoundTrip(t *testing.T) {
	gw := newFakeGateway(func(w http.ResponseWriter) {
		writeGatewayJSON(w, http.StatusOK, map[string]any{"success": true, "reason": "ok"})
	})
	defer gw.Close()

	checker := handler.NewGatewayConnectionChecker(gw.URL, http.DefaultTransport, "shared-secret")
	ctx := handler.WithConnectionCheckProjectID(context.Background(), "42")

	result, err := checker.Check(ctx, "open_ai", map[string]any{"api_base": "https://api.openai.com/v1", "api_key": "sk-good"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Success {
		t.Fatalf("expected success, got %+v", result)
	}

	if gw.lastRequest["type"] != "open_ai" {
		t.Errorf("gateway received type=%v, want open_ai", gw.lastRequest["type"])
	}
	if gw.lastRequest["api_base"] != "https://api.openai.com/v1" {
		t.Errorf("gateway received api_base=%v", gw.lastRequest["api_base"])
	}
	if gw.lastRequest["api_key"] != "sk-good" {
		t.Errorf("gateway received api_key=%v", gw.lastRequest["api_key"])
	}
	if pid := gw.lastHeaders.Get("X-Elitea-Project-Id"); pid != "42" {
		t.Errorf("X-Elitea-Project-Id header = %q, want 42", pid)
	}
	if sig := gw.lastHeaders.Get("X-Elitea-Identity-Signature"); sig == "" {
		t.Error("expected a signed identity header when a secret is configured")
	}
}

// TestGatewayConnectionChecker_FailureRoundTrip proves a gateway-reported
// failure surfaces as ConnectionCheckResult{Success:false} with a safe
// message, not an error and not success.
func TestGatewayConnectionChecker_FailureRoundTrip(t *testing.T) {
	gw := newFakeGateway(func(w http.ResponseWriter) {
		writeGatewayJSON(w, http.StatusOK, map[string]any{"success": false, "reason": "unauthorized", "detail": "the provider rejected the credential"})
	})
	defer gw.Close()

	checker := handler.NewGatewayConnectionChecker(gw.URL, http.DefaultTransport, "")
	result, err := checker.Check(context.Background(), "open_ai", map[string]any{"api_base": "https://api.openai.com/v1", "api_key": "sk-bad"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Success {
		t.Fatal("expected success=false for a gateway-reported rejection")
	}
	if result.Message == "" {
		t.Error("expected a non-empty safe message")
	}
}

// TestGatewayConnectionChecker_GatewayUnreachableIsError proves a transport
// failure (connection refused) is returned as an error, not fabricated
// success or a silently-empty failure.
func TestGatewayConnectionChecker_GatewayUnreachableIsError(t *testing.T) {
	// A closed server: connecting fails immediately.
	gw := newFakeGateway(func(w http.ResponseWriter) { writeGatewayJSON(w, http.StatusOK, map[string]any{"success": true}) })
	gw.Close()

	checker := handler.NewGatewayConnectionChecker(gw.URL, http.DefaultTransport, "")
	_, err := checker.Check(context.Background(), "open_ai", map[string]any{"api_base": "https://api.openai.com/v1"})
	if err == nil {
		t.Fatal("expected an error when the gateway is unreachable")
	}
}

// TestGatewayConnectionChecker_NonOKStatusIsError proves an unexpected HTTP
// status from the gateway (e.g. 500, 403 from a broken identity secret) is
// reported as an error rather than silently treated as failure or success.
func TestGatewayConnectionChecker_NonOKStatusIsError(t *testing.T) {
	gw := newFakeGateway(func(w http.ResponseWriter) { w.WriteHeader(http.StatusInternalServerError) })
	defer gw.Close()

	checker := handler.NewGatewayConnectionChecker(gw.URL, http.DefaultTransport, "")
	_, err := checker.Check(context.Background(), "open_ai", map[string]any{"api_base": "https://api.openai.com/v1"})
	if err == nil {
		t.Fatal("expected an error for a non-200 gateway response")
	}
}
