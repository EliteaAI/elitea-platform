package pricesync

import (
	"context"
	"testing"
)

func TestSeedSourceLoadsEmbedded(t *testing.T) {
	src := NewSeedSource()
	if src.Name() != "seed" {
		t.Errorf("name = %q, want seed", src.Name())
	}
	if src.Denomination() != Per1M {
		t.Errorf("denomination = %v, want per-1m", src.Denomination())
	}
	got, err := src.Fetch(context.Background())
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if len(got) == 0 {
		t.Fatal("embedded seed must yield at least one model")
	}
	// Every seed row must have a provider, model, and a per-1M input price that
	// is plausibly per-1M (i.e. >= 0.01 for a real model, not a per-token value).
	var sawOpenAI bool
	for _, r := range got {
		if r.Provider == "" || r.ModelName == "" {
			t.Errorf("seed row missing provider/model: %+v", r)
		}
		if r.Provider == "openai" {
			sawOpenAI = true
		}
		if r.InputCost != nil && *r.InputCost > 0 && *r.InputCost < 0.001 {
			t.Errorf("seed input cost %v for %s/%s looks per-token, not per-1M",
				*r.InputCost, r.Provider, r.ModelName)
		}
	}
	if !sawOpenAI {
		t.Error("expected at least one openai model in the seed")
	}
}

func TestSeedSourceNormalizesNoOp(t *testing.T) {
	src := NewSeedSource()
	raws, err := src.Fetch(context.Background())
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	var n Normalizer
	for _, r := range raws {
		got, err := n.Normalize(r, src.Denomination(), src.Name())
		if err != nil {
			t.Fatalf("normalize %s/%s: %v", r.Provider, r.ModelName, err)
		}
		// Per-1M source → ×1 no-op: normalized value equals raw value.
		if r.InputCost != nil {
			if got.InputCostPer1M == nil || *got.InputCostPer1M != *r.InputCost {
				t.Errorf("%s/%s: per-1M no-op broken: raw=%v got=%v",
					r.Provider, r.ModelName, *r.InputCost, got.InputCostPer1M)
			}
		}
	}
}
