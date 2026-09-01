package llmproxy

// The gauge the HPA has always named and nothing published (O3).
//
// deploy/helm/elitea/values.yaml has pointed
// llmGateway.autoscaling.sseConnectionMetric at
// `gateway_llm_sse_active_connections` since the HPA was written, and no code
// produced it. The /metrics surface is an explicit allowlist, so this was not
// a metric that merely went unscraped — it did not exist. An operator who
// enabled that HPA got ScalingActive=False / FailedGetPodsMetric, which does
// not scale and does not complain.
//
// These tests are about the COUNTING, not the transport: that an open stream
// raises it, that a finished stream lowers it again, and that a refused stream
// never raises it at all. The last is the one that matters most — a gauge
// that only ever rises reads to an autoscaler as permanent load, so it would
// pin the deployment at maxReplicas rather than at minReplicas. Swapping one
// silent wrong answer for another is not a fix.

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// nonFlusher is an http.ResponseWriter WITHOUT Flush, which is the precondition
// beginStream refuses on.
type nonFlusher struct{ header http.Header }

func (n *nonFlusher) Header() http.Header {
	if n.header == nil {
		n.header = http.Header{}
	}
	return n.header
}
func (n *nonFlusher) Write(b []byte) (int, error) { return len(b), nil }
func (n *nonFlusher) WriteHeader(int)             {}

func TestAnOpenStreamIsCountedAndReleased(t *testing.T) {
	handler := &Handler{}
	before := sseActiveConnections.Value()

	writer, endStream, err := handler.beginStream(httptest.NewRecorder())
	if err != nil {
		t.Fatalf("beginStream: %v", err)
	}
	if writer == nil {
		t.Fatal("beginStream returned no writer")
	}

	if got := sseActiveConnections.Value(); got != before+1 {
		t.Fatalf("an open stream is not counted: gauge %d, want %d", got, before+1)
	}

	endStream()

	// Back to where it started. A gauge that never comes down is what an
	// autoscaler reads as load that never ends.
	if got := sseActiveConnections.Value(); got != before {
		t.Fatalf("a finished stream is not released: gauge %d, want %d", got, before)
	}
}

func TestReleasingTwiceDoesNotDoubleCount(t *testing.T) {
	// Callers `defer endStream()`, and a path that also releases explicitly on
	// an early return would otherwise drive the gauge NEGATIVE — which the
	// Prometheus Adapter would surface as a nonsense replica target rather
	// than as an error.
	handler := &Handler{}
	before := sseActiveConnections.Value()

	_, endStream, err := handler.beginStream(httptest.NewRecorder())
	if err != nil {
		t.Fatal(err)
	}
	endStream()
	endStream()

	if got := sseActiveConnections.Value(); got != before {
		t.Fatalf("a double release moved the gauge to %d, want %d", got, before)
	}
}

func TestARefusedStreamIsNeverCounted(t *testing.T) {
	// The failure that would make this metric worse than useless: counting a
	// stream that never opened leaks upward on every refusal, and the gauge
	// then only ever rises.
	handler := &Handler{}
	before := sseActiveConnections.Value()

	_, endStream, err := handler.beginStream(&nonFlusher{})
	if err == nil {
		t.Fatal("beginStream accepted a ResponseWriter with no Flush")
	}
	if got := sseActiveConnections.Value(); got != before {
		t.Fatalf("a refused stream was counted: gauge %d, want %d", got, before)
	}

	// The release from a refused stream must also be safe to defer.
	endStream()
	if got := sseActiveConnections.Value(); got != before {
		t.Fatalf("releasing a refused stream moved the gauge to %d, want %d", got, before)
	}
}

func TestTheGaugeIsPublishedUnderTheNameTheChartScalesOn(t *testing.T) {
	// The chart and the code must agree on the string, and nothing else checks
	// it: values.yaml names it, this package publishes it, and a rename on
	// either side turns the HPA back into the silent no-op this fixes.
	names := SSEMetricNames()
	if len(names) != 1 || names[0] != "gateway_llm_sse_active_connections" {
		t.Fatalf("SSEMetricNames() = %v; deploy/helm/elitea/values.yaml scales on gateway_llm_sse_active_connections", names)
	}
}
