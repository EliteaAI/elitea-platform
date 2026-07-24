package main

import (
	"os"
	"path/filepath"
	"testing"
)

// fixture reads a testdata file relative to this test's source directory and
// returns its bytes, failing the test on any error.
func fixture(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatalf("fixture %q: %v", name, err)
	}
	return data
}

// TestOverheadCheck_UnderThreshold_Pass asserts that the under-threshold fixture
// (gateway_overhead_ms p99 = 38.475 ms < 50 ms) parses successfully and yields
// Pass=true.
func TestOverheadCheck_UnderThreshold_Pass(t *testing.T) {
	data := fixture(t, "k6_summary_under_threshold.json")
	res, err := parseK6SummaryForOverhead(data, 50)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.MetricUsed != "gateway_overhead_ms" {
		t.Errorf("MetricUsed = %q, want gateway_overhead_ms", res.MetricUsed)
	}
	if res.P99MS != 38.475 {
		t.Errorf("P99MS = %v, want 38.475", res.P99MS)
	}
	if !res.Pass {
		t.Errorf("Pass = false, want true (p99=%.3f < threshold=%.0f)", res.P99MS, res.ThresholdMS)
	}
}

// TestOverheadCheck_OverThreshold_Fail asserts that the over-threshold fixture
// (gateway_overhead_ms p99 = 87.334 ms > 50 ms) parses successfully and yields
// Pass=false.
func TestOverheadCheck_OverThreshold_Fail(t *testing.T) {
	data := fixture(t, "k6_summary_over_threshold.json")
	res, err := parseK6SummaryForOverhead(data, 50)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.MetricUsed != "gateway_overhead_ms" {
		t.Errorf("MetricUsed = %q, want gateway_overhead_ms", res.MetricUsed)
	}
	if res.P99MS != 87.334 {
		t.Errorf("P99MS = %v, want 87.334", res.P99MS)
	}
	if res.Pass {
		t.Errorf("Pass = true, want false (p99=%.3f >= threshold=%.0f)", res.P99MS, res.ThresholdMS)
	}
}

// TestOverheadCheck_MalformedSummary_Fail asserts that a JSON parse error returns
// a non-nil error (no panic, no os.Exit).
func TestOverheadCheck_MalformedSummary_Fail(t *testing.T) {
	_, err := parseK6SummaryForOverhead([]byte(`not valid json {{{`), 50)
	if err == nil {
		t.Fatal("expected error for malformed JSON, got nil")
	}
}

// TestOverheadCheck_NoMetricsKey_Fail asserts that a well-formed JSON object that
// lacks a "metrics" key returns an error.
func TestOverheadCheck_NoMetricsKey_Fail(t *testing.T) {
	_, err := parseK6SummaryForOverhead([]byte(`{"root_groups":{}}`), 50)
	if err == nil {
		t.Fatal("expected error for missing metrics key, got nil")
	}
}

// TestOverheadCheck_FallbackMetric_Pass asserts that when gateway_overhead_ms is
// absent the fallback metric (http_req_duration, p99 = 44.889 ms < 50 ms) is
// used and the gate passes.
func TestOverheadCheck_FallbackMetric_Pass(t *testing.T) {
	data := fixture(t, "k6_summary_fallback_no_custom_metric.json")
	res, err := parseK6SummaryForOverhead(data, 50)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.MetricUsed != "http_req_duration" {
		t.Errorf("MetricUsed = %q, want http_req_duration", res.MetricUsed)
	}
	if res.P99MS != 44.889 {
		t.Errorf("P99MS = %v, want 44.889", res.P99MS)
	}
	if !res.Pass {
		t.Errorf("Pass = false, want true (fallback p99=%.3f < threshold=%.0f)", res.P99MS, res.ThresholdMS)
	}
}

// TestOverheadCheck_NoKnownMetric_Fail asserts that a summary containing neither
// gateway_overhead_ms nor http_req_duration returns an error.
func TestOverheadCheck_NoKnownMetric_Fail(t *testing.T) {
	json := `{
		"metrics": {
			"vus": {"type":"gauge","values":{"value":0,"min":0,"max":50}},
			"iterations": {"type":"counter","values":{"count":100,"rate":10}}
		}
	}`
	_, err := parseK6SummaryForOverhead([]byte(json), 50)
	if err == nil {
		t.Fatal("expected error when no known metric is present, got nil")
	}
}

// TestOverheadCheck_MetricMissingP99_Fail asserts that a metric present without
// the p(99) key returns an error rather than silently returning 0.
func TestOverheadCheck_MetricMissingP99_Fail(t *testing.T) {
	json := `{
		"metrics": {
			"gateway_overhead_ms": {
				"type": "trend",
				"values": {"avg": 8.0, "min": 1.0, "max": 40.0}
			}
		}
	}`
	_, err := parseK6SummaryForOverhead([]byte(json), 50)
	if err == nil {
		t.Fatal("expected error when p(99) key is absent, got nil")
	}
}

// TestOverheadCheck_CustomThreshold asserts that the threshold comparison uses
// the supplied value, not the default 50 ms.
func TestOverheadCheck_CustomThreshold(t *testing.T) {
	// p99 = 38.475 ms (under-threshold fixture)
	data := fixture(t, "k6_summary_under_threshold.json")

	// With threshold = 40 ms: 38.475 < 40 → pass.
	res, err := parseK6SummaryForOverhead(data, 40)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !res.Pass {
		t.Errorf("Pass = false with threshold 40, want true (p99=%.3f)", res.P99MS)
	}

	// With threshold = 30 ms: 38.475 >= 30 → fail.
	res2, err := parseK6SummaryForOverhead(data, 30)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res2.Pass {
		t.Errorf("Pass = true with threshold 30, want false (p99=%.3f)", res2.P99MS)
	}
}

// TestOverheadCheck_ResultFields asserts ThresholdMS is propagated faithfully.
func TestOverheadCheck_ResultFields(t *testing.T) {
	data := fixture(t, "k6_summary_under_threshold.json")
	const threshold = 75.0
	res, err := parseK6SummaryForOverhead(data, threshold)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.ThresholdMS != threshold {
		t.Errorf("ThresholdMS = %v, want %v", res.ThresholdMS, threshold)
	}
}
