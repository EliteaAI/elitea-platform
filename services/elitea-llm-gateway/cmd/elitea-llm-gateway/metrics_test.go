// metrics_test.go — issue #465. The budget-enforcement gauge must be readable
// over HTTP.
//
// Read the acceptance rule before you change a test here: "A test that reads
// the variable in the same process, and not through HTTP, does not prove the
// route exists." Every test in this file makes an HTTP request. The last one
// starts the real gateway binary and scrapes it.
package main

import (
	"context"
	"expvar"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/llmproxy"
)

// scrape performs GET on url and returns the status and the body.
func scrape(t *testing.T, url string) (int, string) {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, url, nil)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	return resp.StatusCode, string(body)
}

// newMetricsServer mounts the metrics route on a real mux, exactly as main()
// mounts it, and serves it over a real HTTP listener.
func newMetricsServer(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.Handle("/metrics", makeMetricsHandler(gatewayMetrics()))
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

// TestMetricsRoute_ServesTheBudgetGaugeOverHTTP is issue #465's first two
// acceptance bullets: read the gauge through HTTP, and see both values.
//
// Before the fix this route did not exist, so the request answered 404 and no
// value could be read at all.
func TestMetricsRoute_ServesTheBudgetGaugeOverHTTP(t *testing.T) {
	srv := newMetricsServer(t)
	// The gauge is process-wide. Put it back so test order cannot matter.
	t.Cleanup(func() { budgetEnforcementEnabled.Set(0) })

	recordBudgetEnforcementEnabled(false)
	status, body := scrape(t, srv.URL+"/metrics")
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", status, body)
	}
	if !strings.Contains(body, metricBudgetEnforcementEnabled+" 0") {
		t.Fatalf("scrape does not report enforcement off:\n%s", body)
	}
	if !strings.Contains(body, "# TYPE "+metricBudgetEnforcementEnabled+" gauge") {
		t.Fatalf("scrape carries no TYPE line, so it is not a valid scrape:\n%s", body)
	}

	recordBudgetEnforcementEnabled(true)
	status, body = scrape(t, srv.URL+"/metrics")
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", status, body)
	}
	if !strings.Contains(body, metricBudgetEnforcementEnabled+" 1") {
		t.Fatalf("scrape does not report enforcement on:\n%s", body)
	}
}

// TestMetricsRoute_ServesTheModelMapCounters proves the model-map refusal
// counters reach the same scrape surface (issue #469). A refusal an operator
// cannot count is a refusal nobody sees.
func TestMetricsRoute_ServesTheModelMapCounters(t *testing.T) {
	srv := newMetricsServer(t)
	status, body := scrape(t, srv.URL+"/metrics")
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", status, body)
	}
	for _, name := range llmproxy.ModelMapMetricNames() {
		if !strings.Contains(body, "# TYPE "+name+" counter") {
			t.Errorf("scrape does not carry counter %q:\n%s", name, body)
		}
	}
}

// TestGatewayMetrics_EveryListedMetricIsPublished stops the silent-skip trap.
//
// gatewayMetrics resolves the model-map counters by name. A name that no expvar
// variable carries would write an "# UNPUBLISHED" line, and an absent metric
// reads to an alarm exactly like a control reporting zero.
func TestGatewayMetrics_EveryListedMetricIsPublished(t *testing.T) {
	metrics := gatewayMetrics()
	if len(metrics) < 2 {
		t.Fatalf("gatewayMetrics returned %d entries; the gauge and the counters are both required", len(metrics))
	}
	for _, m := range metrics {
		if m.v == nil {
			t.Errorf("metric %q is listed but not published", m.name)
		}
		if m.kind != "gauge" && m.kind != "counter" {
			t.Errorf("metric %q has kind %q, want gauge or counter", m.name, m.kind)
		}
		if m.help == "" {
			t.Errorf("metric %q has no help text", m.name)
		}
	}
}

// TestMetricsRoute_DoesNotServeTheWholeExpvarSurface is the second half of
// issue #465's decision: /debug/vars must not be public.
//
// expvar.Handler writes every variable the process publishes, which includes
// `cmdline` (the process arguments) and `memstats`. This route serves an
// allowlist. The test publishes a variable that is not on the list and proves
// the scrape does not carry it.
func TestMetricsRoute_DoesNotServeTheWholeExpvarSurface(t *testing.T) {
	const secret = "gateway_test_unlisted_variable"
	if expvar.Get(secret) == nil {
		expvar.NewString(secret).Set("must-not-appear")
	}
	srv := newMetricsServer(t)

	_, body := scrape(t, srv.URL+"/metrics")
	for _, unwanted := range []string{secret, "cmdline", "memstats"} {
		if strings.Contains(body, unwanted) {
			t.Errorf("the scrape carries %q; /metrics must serve the allowlist only:\n%s", unwanted, body)
		}
	}
}

// TestMetricsRoute_IsServedByTheRunningGateway is the acceptance proof.
//
// It builds the gateway binary, starts it with no NATS, and scrapes the gauge
// over HTTP. A handler test cannot prove main() mounts the route; this can.
// Issue #465 is exactly that gap: the gauge existed, the comment said operators
// could alarm on it, and no route served it.
func TestMetricsRoute_IsServedByTheRunningGateway(t *testing.T) {
	bin := filepath.Join(t.TempDir(), "elitea-llm-gateway")
	build := exec.CommandContext(t.Context(), "go", "build", "-o", bin, ".")
	// The gateway is a standalone module outside go.work (AGENTS.md).
	build.Env = append(os.Environ(), "GOWORK=off")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build the gateway: %v\n%s", err, out)
	}

	addr := freeLoopbackAddr(t)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	gw := exec.CommandContext(ctx, bin)
	gw.Env = append(os.Environ(),
		"GATEWAY_HTTP_ADDR="+addr,
		// Required once a database pool exists (issue #11). The pool is lazy,
		// so no database has to answer for the process to start and serve.
		"GATEWAY_IDENTITY_SECRET=test-identity-secret",
		// No NATS: budget enforcement is off, so the gauge must read 0.
		"GATEWAY_NATS_URL=",
	)
	var out strings.Builder
	gw.Stdout, gw.Stderr = &out, &out
	if err := gw.Start(); err != nil {
		t.Fatalf("start the gateway: %v", err)
	}
	t.Cleanup(func() {
		cancel()
		_ = gw.Wait()
	})

	waitForLiveness(t, "http://"+addr+"/healthz", &out)

	status, body := scrape(t, "http://"+addr+"/metrics")
	if status != http.StatusOK {
		t.Fatalf("GET /metrics on the running gateway: status = %d, want 200; body=%s\nlog:\n%s",
			status, body, out.String())
	}
	if !strings.Contains(body, metricBudgetEnforcementEnabled+" 0") {
		t.Fatalf("the running gateway does not report enforcement off:\n%s", body)
	}

	// /debug/vars stays unmounted. expvar registers it on http.DefaultServeMux,
	// which this process never serves, and the decision is to keep it that way.
	if status, _ := scrape(t, "http://"+addr+"/debug/vars"); status != http.StatusNotFound {
		t.Errorf("GET /debug/vars: status = %d, want 404; the full expvar surface must stay unpublished", status)
	}
}

// freeLoopbackAddr returns a loopback address that is free right now.
func freeLoopbackAddr(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve a port: %v", err)
	}
	addr := l.Addr().String()
	if err := l.Close(); err != nil {
		t.Fatalf("release the port: %v", err)
	}
	return addr
}

// waitForLiveness polls /healthz until the gateway answers, or fails the test.
func waitForLiveness(t *testing.T, url string, log *strings.Builder) {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, url, nil)
		if err != nil {
			t.Fatalf("build request: %v", err)
		}
		resp, err := http.DefaultClient.Do(req)
		if err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("the gateway did not answer %s in 30s\nlog:\n%s", url, log.String())
}
