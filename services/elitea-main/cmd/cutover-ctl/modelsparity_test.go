package main

import (
	"encoding/json"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

// TestModelsParityDiffSets covers the order-insensitive set diff: equal sets
// (in any order, with dupes/empties) diff to nothing; asymmetric sets report the
// correct missing (legacy-only) and extra (gateway-only) ids.
func TestModelsParityDiffSets(t *testing.T) {
	cases := []struct {
		name        string
		gateway     []string
		legacy      []string
		wantMissing []string
		wantExtra   []string
		wantEquiv   bool
	}{
		{
			name:      "identical",
			gateway:   []string{"gpt-4o", "claude-sonnet-5"},
			legacy:    []string{"gpt-4o", "claude-sonnet-5"},
			wantEquiv: true,
		},
		{
			name:      "reordered equivalent",
			gateway:   []string{"claude-sonnet-5", "gpt-4o"},
			legacy:    []string{"gpt-4o", "claude-sonnet-5"},
			wantEquiv: true,
		},
		{
			name:      "dupes and empties collapse to equivalent",
			gateway:   []string{"gpt-4o", "gpt-4o", "", "claude-sonnet-5"},
			legacy:    []string{"claude-sonnet-5", "gpt-4o"},
			wantEquiv: true,
		},
		{
			name:        "missing from gateway",
			gateway:     []string{"gpt-4o"},
			legacy:      []string{"gpt-4o", "claude-sonnet-5"},
			wantMissing: []string{"claude-sonnet-5"},
			wantEquiv:   false,
		},
		{
			name:      "extra on gateway",
			gateway:   []string{"gpt-4o", "o1", "claude-sonnet-5"},
			legacy:    []string{"gpt-4o", "claude-sonnet-5"},
			wantExtra: []string{"o1"},
			wantEquiv: false,
		},
		{
			name:        "both missing and extra",
			gateway:     []string{"gpt-4o", "o1"},
			legacy:      []string{"gpt-4o", "claude-sonnet-5"},
			wantMissing: []string{"claude-sonnet-5"},
			wantExtra:   []string{"o1"},
			wantEquiv:   false,
		},
		{
			name:      "both empty",
			gateway:   nil,
			legacy:    nil,
			wantEquiv: true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			missing, extra := diffModelSets(tc.gateway, tc.legacy)
			if !equalStringSlices(missing, tc.wantMissing) {
				t.Errorf("missing = %v, want %v", missing, tc.wantMissing)
			}
			if !equalStringSlices(extra, tc.wantExtra) {
				t.Errorf("extra = %v, want %v", extra, tc.wantExtra)
			}
			if got := setsEquivalent(tc.gateway, tc.legacy); got != tc.wantEquiv {
				t.Errorf("setsEquivalent = %v, want %v", got, tc.wantEquiv)
			}
		})
	}
}

// equalStringSlices treats nil and empty as equal so a case with no expected
// diff need not distinguish nil from []string{}.
func equalStringSlices(a, b []string) bool {
	if len(a) == 0 && len(b) == 0 {
		return true
	}
	return reflect.DeepEqual(a, b)
}

// TestModelsParityIDSet checks the envelope id extraction sorts, de-dupes, and
// drops empty ids so the comparison and reporting are deterministic.
func TestModelsParityIDSet(t *testing.T) {
	env := modelsListEnvelope{Object: "list"}
	env.Data = []struct {
		ID string `json:"id"`
	}{
		{ID: "gpt-4o"},
		{ID: "claude-sonnet-5"},
		{ID: "gpt-4o"}, // dupe
		{ID: ""},       // empty dropped
		{ID: "o1"},
	}
	got := env.idSet()
	want := []string{"claude-sonnet-5", "gpt-4o", "o1"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("idSet = %v, want %v", got, want)
	}
}

// TestModelsParityIDSetDecodesLiteLLMShape confirms the envelope decodes a real
// OpenAI /v1/models JSON body and ignores the fields parity does not compare.
func TestModelsParityIDSetDecodesLiteLLMShape(t *testing.T) {
	body := `{"object":"list","data":[
		{"id":"gpt-4o","object":"model","created":0,"owned_by":"elitea"},
		{"id":"claude-sonnet-5","object":"model","created":1700000000,"owned_by":"litellm"}
	]}`
	var env modelsListEnvelope
	if err := json.Unmarshal([]byte(body), &env); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	got := env.idSet()
	want := []string{"claude-sonnet-5", "gpt-4o"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("idSet = %v, want %v", got, want)
	}
}

// TestModelsParityPercentile covers the nearest-rank p99: bounds (empty, single),
// p0/p100 endpoints, and a distribution where p99 must pick the top sample.
func TestModelsParityPercentile(t *testing.T) {
	ms := func(n int) time.Duration { return time.Duration(n) * time.Millisecond }

	if got := percentile(nil, 99); got != 0 {
		t.Errorf("percentile(nil) = %s, want 0", got)
	}
	if got := percentile([]time.Duration{ms(42)}, 99); got != ms(42) {
		t.Errorf("percentile(single) = %s, want 42ms", got)
	}

	// 100 samples 1..100 ms; nearest-rank p99 = ceil(0.99*100)=99th value = 99ms.
	samples := make([]time.Duration, 0, 100)
	for i := 100; i >= 1; i-- { // unsorted on input; percentile must copy+sort
		samples = append(samples, ms(i))
	}
	if got := percentile(samples, 99); got != ms(99) {
		t.Errorf("percentile(1..100, 99) = %s, want 99ms", got)
	}
	if got := percentile(samples, 100); got != ms(100) {
		t.Errorf("percentile(1..100, 100) = %s, want 100ms", got)
	}
	if got := percentile(samples, 0); got != ms(1) {
		t.Errorf("percentile(1..100, 0) = %s, want 1ms", got)
	}

	// Input must not be mutated by percentile (defensive copy).
	first := samples[0]
	_ = percentile(samples, 50)
	if samples[0] != first {
		t.Errorf("percentile mutated input: samples[0] = %s, want %s", samples[0], first)
	}
}

// TestModelsParityPercentileThreshold demonstrates the exact gate decision: a
// clean sample stays below the 200ms bar while one 500ms outlier in 10 samples
// pushes p99 to the ceiling (nearest-rank picks the max), tripping the gate.
func TestModelsParityPercentileThreshold(t *testing.T) {
	ms := func(n int) time.Duration { return time.Duration(n) * time.Millisecond }
	bar := 200 * time.Millisecond

	fast := []time.Duration{ms(10), ms(12), ms(9), ms(15), ms(11), ms(13), ms(8), ms(14), ms(10), ms(12)}
	if p := percentile(fast, 99); p >= bar {
		t.Errorf("fast p99 = %s, want < %s", p, bar)
	}

	slow := append([]time.Duration{}, fast...)
	slow[4] = ms(500) // one outlier
	if p := percentile(slow, 99); p < bar {
		t.Errorf("slow p99 = %s, want >= %s (outlier should trip the gate)", p, bar)
	}
}

// TestModelsParityLoadProjectsFixture round-trips the operator-seeded fixture and
// checks the validation errors: unreadable path, malformed JSON, and an entry
// with an empty project_id.
func TestModelsParityLoadProjectsFixture(t *testing.T) {
	dir := t.TempDir()

	good := filepath.Join(dir, "projects.json")
	writeFile(t, good, `[
		{"project_id":"101","api_key":"sk-a"},
		{"project_id":"102","api_key":"sk-b","legacy_api_key":"sk-legacy-b"}
	]`)
	projects, err := loadProjectsFixture(good)
	if err != nil {
		t.Fatalf("loadProjectsFixture(good) error: %v", err)
	}
	if len(projects) != 2 {
		t.Fatalf("got %d projects, want 2", len(projects))
	}
	if projects[0].ProjectID != "101" || projects[0].APIKey != "sk-a" {
		t.Errorf("project[0] = %+v", projects[0])
	}
	if projects[1].LegacyAPIKey != "sk-legacy-b" {
		t.Errorf("project[1] legacy key = %q, want sk-legacy-b", projects[1].LegacyAPIKey)
	}

	if _, err := loadProjectsFixture(filepath.Join(dir, "nope.json")); err == nil {
		t.Error("expected error for missing fixture file")
	}

	bad := filepath.Join(dir, "bad.json")
	writeFile(t, bad, `{not json`)
	if _, err := loadProjectsFixture(bad); err == nil {
		t.Error("expected error for malformed JSON")
	}

	emptyID := filepath.Join(dir, "empty_id.json")
	writeFile(t, emptyID, `[{"project_id":"","api_key":"sk-a"}]`)
	if _, err := loadProjectsFixture(emptyID); err == nil {
		t.Error("expected error for empty project_id")
	}
}
