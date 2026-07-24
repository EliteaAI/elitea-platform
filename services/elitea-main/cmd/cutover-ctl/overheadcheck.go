package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
)

// overhead-check (spec §2.4 / §7.3, gate BFF.9d):
//
// The gateway adds a forwarding hop between the caller and the upstream model
// provider. Before the big-bang cutover we must prove this hop is cheap: p99
// gateway-hop latency MUST be below the operator-configured threshold (default
// 50 ms). A result above the threshold means the gateway's routing or TLS
// overhead has grown too large and must be investigated before cutting over.
//
// The gate is HERMETIC — it does NOT call a live gateway. Instead the operator
// runs a k6 load test (see testdata/overhead_loadtest.js) against staging, exports
// the k6 summary JSON (k6 run --summary-export summary.json ...), and hands the
// file path to this subcommand. The subcommand parses the summary and asserts the
// p99 of the custom "gateway_overhead_ms" trend metric is below the threshold.
//
// Metric selection: we use a custom k6 Trend metric "gateway_overhead_ms" that
// the k6 script populates via a server-timing header (X-Elapsed-Ms or
// Server-Timing: gw;dur=…) emitted by the gateway. If the custom metric is absent
// the gate falls back to "http_req_duration" p99 as a conservative proxy (the
// round-trip always dominates hop-only overhead, so a p99 under 50 ms is still a
// safe upper bound on hop cost). The selected metric and its p99 are printed so
// operators can confirm which metric was used.
//
// The k6 summary-export JSON shape (--summary-export):
//
//	{
//	  "metrics": {
//	    "gateway_overhead_ms": {
//	      "type": "trend",
//	      "values": { "p(99)": 12.3, "avg": 7.1, ... }
//	    },
//	    "http_req_duration": { ... }
//	  }
//	}

// k6SummaryExport is the top-level shape of a k6 --summary-export JSON file.
// Only the "metrics" map is consumed; all other keys are intentionally ignored.
type k6SummaryExport struct {
	Metrics map[string]k6Metric `json:"metrics"`
}

// k6Metric is a single metric entry in the k6 summary. The "values" map contains
// statistics keyed by their k6 name: "p(99)", "avg", "min", "max", "med", etc.
type k6Metric struct {
	Type   string             `json:"type"`
	Values map[string]float64 `json:"values"`
}

// overheadMetricPreference lists the metrics to try, in priority order. The first
// metric found in the summary is used. "gateway_overhead_ms" is the custom trend
// metric the k6 script populates from the gateway's server-timing; "http_req_duration"
// is the built-in fallback that is always present.
var overheadMetricPreference = []string{
	"gateway_overhead_ms",
	"http_req_duration",
}

// k6P99 is the key for p99 in the k6 "values" map.
const k6P99Key = "p(99)"

// overheadCheckResult is the pure result of parsing a k6 summary and evaluating
// the threshold. It carries enough context for tests to assert correctness without
// touching os.Exit.
type overheadCheckResult struct {
	MetricUsed  string  // which metric was found (gateway_overhead_ms or http_req_duration)
	P99MS       float64 // parsed p99 value in milliseconds
	ThresholdMS float64 // the configured threshold
	Pass        bool    // true iff P99MS < ThresholdMS
}

// parseK6SummaryForOverhead parses the k6 summary JSON bytes and extracts the
// p99 of the highest-priority matching metric. It returns an overheadCheckResult
// and an error if the summary is malformed, missing, or contains no recognisable
// metric.
//
// This function is pure (no os.Exit, no I/O) so tests can invoke it directly.
func parseK6SummaryForOverhead(data []byte, thresholdMS float64) (overheadCheckResult, error) {
	var summary k6SummaryExport
	if err := json.Unmarshal(data, &summary); err != nil {
		return overheadCheckResult{}, fmt.Errorf("overhead-check: malformed k6 summary JSON: %w", err)
	}
	if summary.Metrics == nil {
		return overheadCheckResult{}, fmt.Errorf("overhead-check: k6 summary has no \"metrics\" key (is this a --summary-export file?)")
	}

	for _, name := range overheadMetricPreference {
		m, ok := summary.Metrics[name]
		if !ok {
			continue
		}
		p99, ok := m.Values[k6P99Key]
		if !ok {
			return overheadCheckResult{}, fmt.Errorf("overhead-check: metric %q found but has no %q value", name, k6P99Key)
		}
		res := overheadCheckResult{
			MetricUsed:  name,
			P99MS:       p99,
			ThresholdMS: thresholdMS,
			Pass:        p99 < thresholdMS,
		}
		return res, nil
	}

	return overheadCheckResult{}, fmt.Errorf(
		"overhead-check: summary contains none of the expected metrics (%s); "+
			"run the k6 script with --summary-export and include gateway_overhead_ms or http_req_duration",
		fmt.Sprintf("%v", overheadMetricPreference),
	)
}

// cmdOverheadCheck is the `cutover-ctl overhead-check` entrypoint. It reads a k6
// summary-export JSON (via --summary), parses the gateway-hop p99, and exits 0
// iff the p99 is below --max-p99-overhead-ms. Exits non-zero (with a clear
// message) on threshold breach or if the summary is missing / malformed.
func cmdOverheadCheck(args []string) {
	fs := flag.NewFlagSet("overhead-check", flag.ExitOnError)
	maxP99MS := fs.Float64("max-p99-overhead-ms", 50, "maximum acceptable gateway-hop p99 latency in milliseconds")
	summaryPath := fs.String("summary", "", "path to the k6 --summary-export JSON file (required)")
	_ = fs.Parse(args)

	if *summaryPath == "" {
		fmt.Fprintln(os.Stderr, "overhead-check: --summary <path> is required (run: k6 run --summary-export summary.json testdata/overhead_loadtest.js)")
		os.Exit(2)
	}

	data, err := os.ReadFile(*summaryPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "overhead-check: cannot read summary file %q: %v\n", *summaryPath, err)
		os.Exit(2)
	}

	res, err := parseK6SummaryForOverhead(data, *maxP99MS)
	if err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(2)
	}

	// Always echo the parsed result for operator visibility.
	fmt.Printf("overhead-check: metric=%s  p99=%.3f ms  threshold=%.0f ms\n",
		res.MetricUsed, res.P99MS, res.ThresholdMS)

	if !res.Pass {
		fmt.Fprintf(os.Stderr,
			"\n✗ overhead-check: p99 %.3f ms exceeds threshold %.0f ms (metric: %s).\n"+
				"  Investigate gateway routing / TLS overhead before cutover (spec §2.4, gate BFF.9d).\n",
			res.P99MS, res.ThresholdMS, res.MetricUsed)
		os.Exit(1)
	}

	fmt.Printf("✓ overhead-check: p99 %.3f ms < %.0f ms threshold — gateway hop overhead is within budget\n",
		res.P99MS, res.ThresholdMS)
}
