package pricesync

import "testing"

func fptr(v float64) *float64 { return &v }

func TestDenominationString(t *testing.T) {
	cases := map[Denomination]string{
		PerToken:            "per-token",
		Per1K:               "per-1k",
		Per1M:               "per-1m",
		DenominationUnknown: "unknown",
		Denomination(99):    "unknown",
	}
	for d, want := range cases {
		if got := d.String(); got != want {
			t.Errorf("Denomination(%d).String() = %q, want %q", int(d), got, want)
		}
	}
}

func TestFactorTo1M(t *testing.T) {
	cases := []struct {
		d      Denomination
		want   float64
		wantOK bool
	}{
		{PerToken, 1_000_000, true},
		{Per1K, 1_000, true},
		{Per1M, 1, true},
		{DenominationUnknown, 0, false},
	}
	for _, c := range cases {
		got, err := c.d.factorTo1M()
		if c.wantOK && err != nil {
			t.Errorf("%v: unexpected error %v", c.d, err)
		}
		if !c.wantOK && err == nil {
			t.Errorf("%v: expected error, got none", c.d)
		}
		if got != c.want {
			t.Errorf("%v: factor = %v, want %v", c.d, got, c.want)
		}
	}
}

// TestNormalizePerTokenTo1M is the load-bearing 1000×/1e6 guard: a per-token
// LiteLLM value must become per-1M via exactly ×1,000,000.
func TestNormalizePerTokenTo1M(t *testing.T) {
	var n Normalizer
	// gpt-4o: $0.0000025/token input → $2.50 per 1M; $0.00001/token → $10.00.
	raw := RawModelPrice{
		Provider:          "openai",
		ModelName:         "gpt-4o",
		InputCost:         fptr(0.0000025),
		OutputCost:        fptr(0.00001),
		CacheCreationCost: fptr(0.000003125),
		CacheReadCost:     fptr(0.00000125),
	}
	got, err := n.Normalize(raw, PerToken, "litellm")
	if err != nil {
		t.Fatalf("normalize: %v", err)
	}
	if got.InputCostPer1M == nil || !almost(*got.InputCostPer1M, 2.50) {
		t.Errorf("input per-1M = %v, want 2.50", got.InputCostPer1M)
	}
	if got.OutputCostPer1M == nil || !almost(*got.OutputCostPer1M, 10.00) {
		t.Errorf("output per-1M = %v, want 10.00", got.OutputCostPer1M)
	}
	if got.CacheCreationPer1M == nil || !almost(*got.CacheCreationPer1M, 3.125) {
		t.Errorf("cache creation per-1M = %v, want 3.125", got.CacheCreationPer1M)
	}
	if got.CacheReadPer1M == nil || !almost(*got.CacheReadPer1M, 1.25) {
		t.Errorf("cache read per-1M = %v, want 1.25", got.CacheReadPer1M)
	}
	if got.Source != "litellm" {
		t.Errorf("source = %q, want litellm", got.Source)
	}
}

func TestNormalizePer1MNoOp(t *testing.T) {
	var n Normalizer
	raw := RawModelPrice{Provider: "openai", ModelName: "gpt-4o", InputCost: fptr(2.50)}
	got, err := n.Normalize(raw, Per1M, "seed")
	if err != nil {
		t.Fatalf("normalize: %v", err)
	}
	if got.InputCostPer1M == nil || !almost(*got.InputCostPer1M, 2.50) {
		t.Errorf("per-1M no-op = %v, want 2.50", got.InputCostPer1M)
	}
}

func TestNormalizePer1KTo1M(t *testing.T) {
	var n Normalizer
	// $0.0025 per 1k → $2.50 per 1M.
	raw := RawModelPrice{Provider: "x", ModelName: "y", InputCost: fptr(0.0025)}
	got, err := n.Normalize(raw, Per1K, "custom")
	if err != nil {
		t.Fatalf("normalize: %v", err)
	}
	if got.InputCostPer1M == nil || !almost(*got.InputCostPer1M, 2.50) {
		t.Errorf("per-1k→1M = %v, want 2.50", got.InputCostPer1M)
	}
}

func TestNormalizeNilPreserved(t *testing.T) {
	var n Normalizer
	raw := RawModelPrice{Provider: "openai", ModelName: "embed", InputCost: fptr(0.00000002), OutputCost: nil}
	got, err := n.Normalize(raw, PerToken, "litellm")
	if err != nil {
		t.Fatalf("normalize: %v", err)
	}
	if got.OutputCostPer1M != nil {
		t.Errorf("nil output must stay nil, got %v", got.OutputCostPer1M)
	}
	if got.InputCostPer1M == nil || !almost(*got.InputCostPer1M, 0.02) {
		t.Errorf("input per-1M = %v, want 0.02", got.InputCostPer1M)
	}
}

func TestNormalizeUnknownDenomErrors(t *testing.T) {
	var n Normalizer
	_, err := n.Normalize(RawModelPrice{Provider: "p", ModelName: "m"}, DenominationUnknown, "bad")
	if err == nil {
		t.Fatal("expected error for unknown denomination")
	}
}

func TestKey(t *testing.T) {
	a := NormalizedModelPrice{Provider: "openai", ModelName: "gpt-4o"}
	b := NormalizedModelPrice{Provider: "openai", ModelName: "gpt-4o-mini"}
	if a.key() == b.key() {
		t.Error("distinct models must have distinct keys")
	}
	// The separator prevents provider+model concat collisions.
	c := NormalizedModelPrice{Provider: "openaigpt-4o", ModelName: ""}
	if a.key() == c.key() {
		t.Error("separator must prevent concat collision")
	}
}

// TestNormalizeAudioPricesUseTheSameFactor is the audio half of the 1e6 guard.
// Upstream publishes a per-second and a per-character price the same way it
// publishes a per-token price: as the cost of ONE unit. So the ×1,000,000
// convert applies unchanged. A second, unit-specific factor here would be a
// 1,000,000x error on every audio row, and skipping the convert would be a
// 1,000,000x undercharge.
func TestNormalizeAudioPricesUseTheSameFactor(t *testing.T) {
	var n Normalizer
	raw := RawModelPrice{
		Provider:  "openai",
		ModelName: "whisper-1",
		// $0.0001 per second → $100.00 per 1M seconds.
		InputCostPerSecond:  fptr(0.0001),
		OutputCostPerSecond: fptr(0.0002),
		// $0.000015 per character → $15.00 per 1M characters.
		InputCostPerCharacter:  fptr(0.0000003),
		OutputCostPerCharacter: fptr(0.000015),
	}
	got, err := n.Normalize(raw, PerToken, "litellm")
	if err != nil {
		t.Fatalf("normalize: %v", err)
	}
	cases := []struct {
		name string
		got  *float64
		want float64
	}{
		{"input per 1M seconds", got.InputCostPer1MSeconds, 100},
		{"output per 1M seconds", got.OutputCostPer1MSeconds, 200},
		{"input per 1M characters", got.InputCostPer1MCharacters, 0.3},
		{"output per 1M characters", got.OutputCostPer1MCharacters, 15},
	}
	for _, c := range cases {
		if c.got == nil {
			t.Errorf("%s is nil, want %v", c.name, c.want)
			continue
		}
		if !almost(*c.got, c.want) {
			t.Errorf("%s = %v, want %v", c.name, *c.got, c.want)
		}
	}
	// An audio-only row carries no token price, and the absent-vs-zero
	// distinction must survive the conversion.
	if got.InputCostPer1M != nil || got.OutputCostPer1M != nil {
		t.Errorf("absent token prices must stay nil, got in=%v out=%v",
			got.InputCostPer1M, got.OutputCostPer1M)
	}
}

// TestNormalizeAudioPricesRespectDenomination guards the other direction: a
// source that already publishes per-1M (the bundled seed) must not have its
// audio prices scaled again.
func TestNormalizeAudioPricesRespectDenomination(t *testing.T) {
	var n Normalizer
	raw := RawModelPrice{Provider: "openai", ModelName: "whisper-1", InputCostPerSecond: fptr(100)}
	got, err := n.Normalize(raw, Per1M, "seed")
	if err != nil {
		t.Fatalf("normalize: %v", err)
	}
	if got.InputCostPer1MSeconds == nil || !almost(*got.InputCostPer1MSeconds, 100) {
		t.Errorf("per-1M source must convert ×1, got %v", got.InputCostPer1MSeconds)
	}
}

func almost(a, b float64) bool {
	d := a - b
	if d < 0 {
		d = -d
	}
	return d < 1e-9
}
