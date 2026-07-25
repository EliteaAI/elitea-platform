package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

// overhead-check (spec §2.4 / §7.3, gate BFF.9d):
//
// The gateway adds a forwarding hop between the caller and the upstream model
// provider. Before the big-bang cutover we must prove this hop is cheap: p99
// gateway-hop latency MUST be below the operator-configured threshold (default
// 50 ms). A result above the threshold means the gateway's routing or TLS
// overhead has grown too large and must be investigated before cutting over.
//
// Two modes share one parse/assert path:
//
//   - live (default, the BFF.9d validator invocation): the subcommand drives the
//     k6 load script (testdata/overhead_loadtest.js) against the gateway itself
//     and parses the summary k6 exports.
//   - hermetic (--summary <path>): the operator runs k6 separately
//     (k6 run --summary-export summary.json ...) and hands the file to the gate;
//     no k6 binary or live gateway is needed (CI-friendly).
//
// Either way the gate asserts the p99 of the custom "gateway_overhead_ms" trend
// metric is below the threshold, and persists the result to
// testdata/p99_overhead_benchmark.json (design §10.2) unless --benchmark-out
// is set to "".
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

// k6Args builds the argv (after the binary name) for a k6 run that exports its
// summary to summaryPath and targets gatewayURL. Pure so tests can pin the exact
// invocation shape. API_KEY / PROJECT_ID are intentionally NOT forwarded here —
// k6 exposes the OS environment through __ENV, so the operator's exported values
// reach the script without appearing in process listings.
func k6Args(script, gatewayURL, summaryPath string) []string {
	return []string{
		"run",
		"--summary-export", summaryPath,
		"-e", "GATEWAY_URL=" + gatewayURL,
		script,
	}
}

// runK6Summary drives the k6 load script against the gateway and returns the
// bytes of the --summary-export JSON it produced. k6's own stdout/stderr are
// streamed through to the given writers so the operator sees live progress.
// The summary file is written to a temp dir and removed on return.
func runK6Summary(k6Bin, script, gatewayURL string, stdout, stderr io.Writer) ([]byte, error) {
	tmpDir, err := os.MkdirTemp("", "overhead-check-*")
	if err != nil {
		return nil, fmt.Errorf("overhead-check: cannot create temp dir: %w", err)
	}
	defer func() { _ = os.RemoveAll(tmpDir) }()

	summaryPath := filepath.Join(tmpDir, "summary.json")
	cmd := exec.Command(k6Bin, k6Args(script, gatewayURL, summaryPath)...)
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("overhead-check: k6 run failed (%v) — is k6 installed and the gateway reachable at %s?", err, gatewayURL)
	}

	data, err := os.ReadFile(summaryPath)
	if err != nil {
		return nil, fmt.Errorf("overhead-check: k6 exited 0 but wrote no summary export: %w", err)
	}
	return data, nil
}

// benchmarkRecord is the persisted shape of an overhead-check run
// (testdata/p99_overhead_benchmark.json, design §10.2). It captures enough
// context to audit WHICH run produced the number the cutover sign-off cites.
type benchmarkRecord struct {
	Gate        string  `json:"gate"`         // always "BFF.9d"
	MetricUsed  string  `json:"metric_used"`  // gateway_overhead_ms or http_req_duration
	P99MS       float64 `json:"p99_ms"`       // measured p99 in milliseconds
	ThresholdMS float64 `json:"threshold_ms"` // the bar (spec §10.2: 50 ms)
	Pass        bool    `json:"pass"`
	Source      string  `json:"source"`      // "k6-run" or "summary-file"
	Script      string  `json:"script"`      // k6 script path (k6-run mode)
	GatewayURL  string  `json:"gateway_url"` // target gateway (k6-run mode)
	GeneratedAt string  `json:"generated_at"`
}

// benchmarkOutAuto is the --benchmark-out sentinel: persist to the default path
// for live k6 runs, and do NOT persist for --summary (hermetic) runs. This stops
// a fixture-driven CI invocation from overwriting the operator's real benchmark
// record with canned data. An explicit path always persists; "" always disables.
const benchmarkOutAuto = "auto"

// defaultBenchmarkPath is where live-run results are persisted (design §10.2).
var defaultBenchmarkPath = filepath.Join("testdata", "p99_overhead_benchmark.json")

// resolveBenchmarkOut maps the --benchmark-out flag value + run source to the
// effective output path ("" = do not persist). Pure for testability.
func resolveBenchmarkOut(flagVal, source string) string {
	switch flagVal {
	case benchmarkOutAuto:
		if source == "k6-run" {
			return defaultBenchmarkPath
		}
		return ""
	default:
		return flagVal // explicit path, or "" to disable
	}
}

// writeBenchmarkFile persists the benchmark record as indented JSON, creating
// parent directories as needed.
func writeBenchmarkFile(path string, rec benchmarkRecord) error {
	data, err := json.MarshalIndent(rec, "", "  ")
	if err != nil {
		return fmt.Errorf("overhead-check: cannot marshal benchmark record: %w", err)
	}
	if dir := filepath.Dir(path); dir != "." && dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("overhead-check: cannot create benchmark dir %q: %w", dir, err)
		}
	}
	if err := os.WriteFile(path, append(data, '\n'), 0o644); err != nil {
		return fmt.Errorf("overhead-check: cannot write benchmark file %q: %w", path, err)
	}
	return nil
}

// cmdOverheadCheck is the `cutover-ctl overhead-check` entrypoint. Two modes:
//
//   - live (default): drive the k6 script (--script) against the gateway
//     (--gateway-url) via the k6 binary (--k6-bin), then parse the exported
//     summary. This is the BFF.9d validator invocation, which passes no --summary.
//   - hermetic: --summary <path> parses a pre-exported k6 summary JSON instead
//     of running k6 (CI-friendly; no live gateway needed).
//
// In both modes the parsed result is persisted to --benchmark-out (default
// testdata/p99_overhead_benchmark.json, design §10.2; empty string disables).
// Exits 0 iff p99 < --max-p99-overhead-ms; 1 on threshold breach; 2 on
// operator/config errors (missing file, malformed summary, k6 failure).
func cmdOverheadCheck(args []string) {
	fs := flag.NewFlagSet("overhead-check", flag.ExitOnError)
	maxP99MS := fs.Float64("max-p99-overhead-ms", 50, "maximum acceptable gateway-hop p99 latency in milliseconds")
	summaryPath := fs.String("summary", "", "path to a pre-exported k6 --summary-export JSON (skips running k6)")
	script := fs.String("script", "testdata/overhead_loadtest.js", "k6 load script to run (live mode)")
	gatewayURL := fs.String("gateway-url", "http://localhost:8083", "gateway base URL the k6 script targets (live mode)")
	k6Bin := fs.String("k6-bin", "k6", "k6 binary to invoke (live mode)")
	benchmarkOut := fs.String("benchmark-out", benchmarkOutAuto,
		"benchmark record output path; \"auto\" = testdata/p99_overhead_benchmark.json for live k6 runs only, \"\" disables")
	_ = fs.Parse(args)

	var (
		data   []byte
		err    error
		source = "summary-file"
	)
	if *summaryPath != "" {
		data, err = os.ReadFile(*summaryPath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "overhead-check: cannot read summary file %q: %v\n", *summaryPath, err)
			os.Exit(2)
		}
	} else {
		source = "k6-run"
		fmt.Printf("overhead-check: driving k6 (%s) against %s ...\n", *script, *gatewayURL)
		data, err = runK6Summary(*k6Bin, *script, *gatewayURL, os.Stdout, os.Stderr)
		if err != nil {
			fmt.Fprintln(os.Stderr, err.Error())
			os.Exit(2)
		}
	}

	res, err := parseK6SummaryForOverhead(data, *maxP99MS)
	if err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(2)
	}

	if outPath := resolveBenchmarkOut(*benchmarkOut, source); outPath != "" {
		rec := benchmarkRecord{
			Gate:        "BFF.9d",
			MetricUsed:  res.MetricUsed,
			P99MS:       res.P99MS,
			ThresholdMS: res.ThresholdMS,
			Pass:        res.Pass,
			Source:      source,
			GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		}
		if source == "k6-run" {
			rec.Script = *script
			rec.GatewayURL = *gatewayURL
		}
		if err := writeBenchmarkFile(outPath, rec); err != nil {
			fmt.Fprintln(os.Stderr, err.Error())
			os.Exit(2)
		}
		fmt.Printf("overhead-check: benchmark persisted to %s\n", outPath)
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
