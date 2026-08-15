package llmproxy

import (
	"bytes"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

// fakeEgressPolicy is a test double for EgressPolicy.
type fakeEgressPolicy struct {
	allow      bool
	configured bool
}

func (p fakeEgressPolicy) EgressAllows(string) bool        { return p.allow }
func (p fakeEgressPolicy) EgressAllowlistConfigured() bool { return p.configured }

// fakeProvider is an httptest server standing in for a real AI provider. It
// counts every request it receives and returns a configurable status, so
// tests can assert both "the provider was actually called" (Hits() > 0) and
// "a bad credential reports failure" (status 401).
type fakeProvider struct {
	*httptest.Server
	hits          atomic.Int64
	status        int
	lastPath      string
	lastAuth      string
	lastAPIKeyHdr string
}

func newFakeProvider(status int) *fakeProvider {
	fp := &fakeProvider{status: status}
	fp.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fp.hits.Add(1)
		fp.lastPath = r.URL.Path + "?" + r.URL.RawQuery
		fp.lastAuth = r.Header.Get("Authorization")
		fp.lastAPIKeyHdr = r.Header.Get("api-key")
		w.WriteHeader(fp.status)
		_, _ = w.Write([]byte(`{}`))
	}))
	return fp
}

func (fp *fakeProvider) Hits() int64 { return fp.hits.Load() }

func decodeCheckConnectionResponse(t *testing.T, rec *httptest.ResponseRecorder) checkConnectionResponse {
	t.Helper()
	var resp checkConnectionResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return resp
}

func newCheckConnectionHandler(policy EgressPolicy) *Handler {
	h := NewHandler(nil, nil, nil)
	h.egressPolicy = policy
	return h
}

func doCheckConnection(t *testing.T, h *Handler, body checkConnectionRequest) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/llm/v1/check_connection", bytes.NewReader(raw))
	rec := httptest.NewRecorder()
	h.CheckConnection(rec, req)
	return rec
}

// TestCheckConnection_UnsupportedTypeNeverCallsProvider proves an unknown or
// not-yet-implemented credential type is refused WITHOUT any network call —
// the fake provider's hit count stays at zero. A stub that always answers
// success (the pre-#319 behaviour) would not distinguish this from a real
// type at all, let alone leave the provider uncalled.
func TestCheckConnection_UnsupportedTypeNeverCallsProvider(t *testing.T) {
	fp := newFakeProvider(http.StatusOK)
	defer fp.Close()

	h := newCheckConnectionHandler(fakeEgressPolicy{allow: true})
	rec := doCheckConnection(t, h, checkConnectionRequest{Type: "amazon_bedrock", APIBase: fp.URL})

	resp := decodeCheckConnectionResponse(t, rec)
	if resp.Success {
		t.Fatal("unsupported type must not report success")
	}
	if resp.Reason != checkConnectionReasonUnsupported {
		t.Fatalf("reason = %q, want %q", resp.Reason, checkConnectionReasonUnsupported)
	}
	if fp.Hits() != 0 {
		t.Fatalf("provider must not be called for an unsupported type, got %d hits", fp.Hits())
	}
}

// TestCheckConnection_MissingAPIBaseNeverCallsProvider proves an empty
// api_base is refused before any dial is attempted.
func TestCheckConnection_MissingAPIBaseNeverCallsProvider(t *testing.T) {
	fp := newFakeProvider(http.StatusOK)
	defer fp.Close()

	h := newCheckConnectionHandler(fakeEgressPolicy{allow: true})
	rec := doCheckConnection(t, h, checkConnectionRequest{Type: "open_ai", APIBase: ""})

	resp := decodeCheckConnectionResponse(t, rec)
	if resp.Success || resp.Reason != checkConnectionReasonMissingBase {
		t.Fatalf("got success=%v reason=%q, want success=false reason=%q", resp.Success, resp.Reason, checkConnectionReasonMissingBase)
	}
	if fp.Hits() != 0 {
		t.Fatalf("provider must not be called with no api_base, got %d hits", fp.Hits())
	}
}

// TestCheckConnection_EgressDeniedNeverCallsProvider proves the operator's
// egress allowlist is consulted BEFORE any dial, for every credential type —
// this is the SSRF gate the issue requires (#13): a tenant-authored api_base
// must not be reachable just because it round-trips through this endpoint.
func TestCheckConnection_EgressDeniedNeverCallsProvider(t *testing.T) {
	fp := newFakeProvider(http.StatusOK)
	defer fp.Close()

	h := newCheckConnectionHandler(fakeEgressPolicy{allow: false})
	rec := doCheckConnection(t, h, checkConnectionRequest{Type: "open_ai", APIBase: fp.URL, APIKey: "sk-whatever"})

	resp := decodeCheckConnectionResponse(t, rec)
	if resp.Success || resp.Reason != checkConnectionReasonEgress {
		t.Fatalf("got success=%v reason=%q, want success=false reason=%q", resp.Success, resp.Reason, checkConnectionReasonEgress)
	}
	if fp.Hits() != 0 {
		t.Fatalf("provider must not be called when egress denies the host, got %d hits", fp.Hits())
	}
}

// TestCheckConnection_NilPolicyFailsClosed proves a Handler built without
// WithEgressPolicy refuses every check rather than skipping the gate.
func TestCheckConnection_NilPolicyFailsClosed(t *testing.T) {
	fp := newFakeProvider(http.StatusOK)
	defer fp.Close()

	h := NewHandler(nil, nil, nil) // no WithEgressPolicy: h.egressPolicy is nil
	rec := doCheckConnection(t, h, checkConnectionRequest{Type: "open_ai", APIBase: fp.URL})

	resp := decodeCheckConnectionResponse(t, rec)
	if resp.Success {
		t.Fatal("an unwired egress policy must fail closed, not report success")
	}
	if fp.Hits() != 0 {
		t.Fatalf("provider must not be called with no egress policy wired, got %d hits", fp.Hits())
	}
}

// TestCheckConnection_CloudProviderNeverDialsPrivateAddress is the core SSRF
// regression test: even when the operator's name-based allowlist says yes,
// a cloud-class credential (open_ai — not self-hosted) must never actually
// reach a private/loopback address, because GetConfigForProvider's real
// production policy never grants AllowPrivateNetwork to that class either.
// The fake provider here IS reachable (it is a real, listening loopback
// server) — proving the block is enforced at the dial layer, not merely
// because the target happened to be down.
func TestCheckConnection_CloudProviderNeverDialsPrivateAddress(t *testing.T) {
	fp := newFakeProvider(http.StatusOK)
	defer fp.Close()

	// Allowlist says yes (operator named this host), but open_ai is not a
	// self-hosted class, so private destinations must still be refused.
	h := newCheckConnectionHandler(fakeEgressPolicy{allow: true, configured: true})
	rec := doCheckConnection(t, h, checkConnectionRequest{Type: "open_ai", APIBase: fp.URL, APIKey: "sk-test"})

	resp := decodeCheckConnectionResponse(t, rec)
	if resp.Success {
		t.Fatal("open_ai must never report success against a private address")
	}
	if resp.Reason != checkConnectionReasonUnreachable {
		t.Fatalf("reason = %q, want %q", resp.Reason, checkConnectionReasonUnreachable)
	}
	if fp.Hits() != 0 {
		t.Fatalf("the provider handler must never have run — the dial itself must be refused, got %d hits", fp.Hits())
	}
}

// TestCheckConnection_OllamaSuccess_RealRoundTrip is the positive proof the
// issue demands: a self-hosted (Ollama) credential with the allowlist armed
// reaches the real fake-provider server, and success is reported ONLY
// because that round trip actually happened — not fabricated. A stub that
// answers success without calling anything would leave fp.Hits() == 0 and
// fail this test.
func TestCheckConnection_OllamaSuccess_RealRoundTrip(t *testing.T) {
	fp := newFakeProvider(http.StatusOK)
	defer fp.Close()

	h := newCheckConnectionHandler(fakeEgressPolicy{allow: true, configured: true})
	rec := doCheckConnection(t, h, checkConnectionRequest{Type: "ollama", APIBase: fp.URL})

	resp := decodeCheckConnectionResponse(t, rec)
	if !resp.Success {
		t.Fatalf("expected success, got success=false reason=%q detail=%q", resp.Reason, resp.Detail)
	}
	if fp.Hits() != 1 {
		t.Fatalf("expected exactly one real provider round trip, got %d hits", fp.Hits())
	}
	if fp.lastPath != "/api/tags?" {
		t.Fatalf("probe hit path %q, want /api/tags", fp.lastPath)
	}
}

// TestCheckConnection_OllamaBadCredential_RealRoundTrip proves a credential
// the provider rejects is reported as a failure, not success — and that the
// verdict came from an actual round trip (fp.Hits() == 1), not a canned
// answer.
func TestCheckConnection_OllamaBadCredential_RealRoundTrip(t *testing.T) {
	fp := newFakeProvider(http.StatusUnauthorized)
	defer fp.Close()

	h := newCheckConnectionHandler(fakeEgressPolicy{allow: true, configured: true})
	rec := doCheckConnection(t, h, checkConnectionRequest{Type: "ollama", APIBase: fp.URL})

	resp := decodeCheckConnectionResponse(t, rec)
	if resp.Success {
		t.Fatal("a credential the provider rejects must not report success")
	}
	if resp.Reason != checkConnectionReasonUnauth {
		t.Fatalf("reason = %q, want %q", resp.Reason, checkConnectionReasonUnauth)
	}
	if fp.Hits() != 1 {
		t.Fatalf("expected exactly one real provider round trip, got %d hits", fp.Hits())
	}
	// The response must never carry the raw provider body verbatim.
	if resp.Detail == "{}" {
		t.Fatalf("detail must not echo the raw provider response body, got %q", resp.Detail)
	}
}

// TestCheckConnection_IdentitySignatureRequiredWhenConfigured mirrors the
// gateway's other /llm/v1 handlers: a configured identity secret must reject
// an unsigned request before any provider dial.
func TestCheckConnection_IdentitySignatureRequiredWhenConfigured(t *testing.T) {
	fp := newFakeProvider(http.StatusOK)
	defer fp.Close()

	h := NewHandler(nil, nil, []byte("shared-secret"))
	h.egressPolicy = fakeEgressPolicy{allow: true, configured: true}

	raw, _ := json.Marshal(checkConnectionRequest{Type: "ollama", APIBase: fp.URL})
	req := httptest.NewRequest(http.MethodPost, "/llm/v1/check_connection", bytes.NewReader(raw))
	rec := httptest.NewRecorder()
	h.CheckConnection(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
	}
	if fp.Hits() != 0 {
		t.Fatalf("provider must not be called without a valid identity signature, got %d hits", fp.Hits())
	}
}

// --- Probe-level tests (bypass the SSRF client so open_ai/azure/ai_dial
// request-shaping can be verified against a loopback fake server; the SSRF
// gate itself is proven separately above and in TestCheckConnectionProbeClient_*). ---

func TestProbeOpenAICompatibleModels_SendsBearerAuth(t *testing.T) {
	fp := newFakeProvider(http.StatusOK)
	defer fp.Close()

	err := probeOpenAICompatibleModels(context.Background(), fp.Client(), checkConnectionRequest{
		APIBase: fp.URL, APIKey: "sk-real-key",
	})
	if err != nil {
		t.Fatalf("probe failed: %v", err)
	}
	if fp.lastPath != "/models?" {
		t.Fatalf("path = %q, want /models", fp.lastPath)
	}
	if fp.lastAuth != "Bearer sk-real-key" {
		t.Fatalf("Authorization header = %q, want Bearer sk-real-key", fp.lastAuth)
	}
}

func TestProbeOpenAICompatibleModels_BadKeyIsUnauthorized(t *testing.T) {
	fp := newFakeProvider(http.StatusUnauthorized)
	defer fp.Close()

	err := probeOpenAICompatibleModels(context.Background(), fp.Client(), checkConnectionRequest{
		APIBase: fp.URL, APIKey: "sk-bad-key",
	})
	if err == nil {
		t.Fatal("expected a failure for a rejected credential")
	}
	reason, _ := classifyCheckConnectionProbeError(err)
	if reason != checkConnectionReasonUnauth {
		t.Fatalf("reason = %q, want %q", reason, checkConnectionReasonUnauth)
	}
}

func TestProbeAzureDeployments_SendsAPIKeyHeaderAndDefaultVersion(t *testing.T) {
	fp := newFakeProvider(http.StatusOK)
	defer fp.Close()

	err := probeAzureDeployments(context.Background(), fp.Client(), checkConnectionRequest{
		APIBase: fp.URL, APIKey: "azure-key",
	})
	if err != nil {
		t.Fatalf("probe failed: %v", err)
	}
	if fp.lastAPIKeyHdr != "azure-key" {
		t.Fatalf("api-key header = %q, want azure-key", fp.lastAPIKeyHdr)
	}
	if fp.lastPath != "/openai/deployments?api-version="+defaultAzureAPIVersion {
		t.Fatalf("path = %q", fp.lastPath)
	}
}

func TestProbeOllamaTags_NoAuthHeader(t *testing.T) {
	fp := newFakeProvider(http.StatusOK)
	defer fp.Close()

	err := probeOllamaTags(context.Background(), fp.Client(), checkConnectionRequest{APIBase: fp.URL})
	if err != nil {
		t.Fatalf("probe failed: %v", err)
	}
	if fp.lastPath != "/api/tags?" {
		t.Fatalf("path = %q, want /api/tags", fp.lastPath)
	}
	if fp.lastAuth != "" {
		t.Fatalf("ollama probe must not send an Authorization header, got %q", fp.lastAuth)
	}
}

// --- SSRF dial-guard unit tests (isolated from the HTTP probe layer). ---

func TestCheckConnectionProbeClient_RefusesPrivateAddressByDefault(t *testing.T) {
	fp := newFakeProvider(http.StatusOK) // binds to a loopback address
	defer fp.Close()

	client := newCheckConnectionProbeClient(false)
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, fp.URL+"/models", nil)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	resp, err := client.Do(req)
	if err == nil {
		_ = resp.Body.Close()
		t.Fatal("expected the SSRF guard to refuse a loopback address")
	}
}

func TestCheckConnectionProbeClient_AllowsPrivateAddressWhenPermitted(t *testing.T) {
	fp := newFakeProvider(http.StatusOK)
	defer fp.Close()

	client := newCheckConnectionProbeClient(true)
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, fp.URL+"/models", nil)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("expected the permitted client to reach the loopback provider: %v", err)
	}
	_ = resp.Body.Close()
	if fp.Hits() != 1 {
		t.Fatalf("expected exactly one hit, got %d", fp.Hits())
	}
}

func TestIsDisallowedCheckConnectionAddress(t *testing.T) {
	cases := []struct {
		ip   string
		want bool
	}{
		{"127.0.0.1", true},
		{"10.0.0.5", true},
		{"172.16.0.5", true},
		{"192.168.1.1", true},
		{"169.254.169.254", true}, // cloud metadata address
		{"::1", true},
		{"fc00::1", true},
		{"0.0.0.0", true},
		{"8.8.8.8", false},
		{"93.184.216.34", false}, // public address
	}
	for _, c := range cases {
		ip := net.ParseIP(c.ip)
		if ip == nil {
			t.Fatalf("net.ParseIP(%q) failed", c.ip)
		}
		if got := isDisallowedCheckConnectionAddress(ip); got != c.want {
			t.Errorf("isDisallowedCheckConnectionAddress(%s) = %v, want %v", c.ip, got, c.want)
		}
	}
}
