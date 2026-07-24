package main

import (
	"math"
	"testing"
)

// TestCostParityPylonVectors pins the exact pylon test_cost_calculator.py
// vectors through the pylonCalculate reproduction, so a drift in the reference
// arithmetic is caught here rather than silently accepted by the comparison.
func TestCostParityPylonVectors(t *testing.T) {
	cases := []struct {
		name                       string
		inTok, outTok              int64
		inRate, outRate            float64
		wantIn, wantOut, wantTotal float64
	}{
		// test_calculate_basic: gpt-4o (2.50/10.00), 1000 in / 500 out.
		{"basic_gpt4o", 1000, 500, 2.50, 10.00, 0.0025, 0.005, 0.0075},
		// test_calculate_large_token_count: 1M in / 500k out.
		{"large_gpt4o", 1_000_000, 500_000, 2.50, 10.00, 2.50, 5.00, 7.50},
		// test_calculate_zero_tokens.
		{"zero", 0, 0, 2.50, 10.00, 0, 0, 0},
		// test_cost_precision: gpt-4o-mini (0.15/0.60), 333 in / 666 out. pylon
		// rounds each component to 6 decimals: 0.00004995→0.00005,
		// 0.0003996→0.0004, and total (from the raw sum 0.00044955)→0.00045.
		{"precision_mini", 333, 666, 0.15, 0.60, 0.00005, 0.0004, 0.00045},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := pylonCalculate(tc.inTok, tc.outTok, tc.inRate, tc.outRate)
			if math.Abs(got.InputUSD-tc.wantIn) > 1e-9 {
				t.Errorf("input = %.9f, want %.9f", got.InputUSD, tc.wantIn)
			}
			if math.Abs(got.OutputUSD-tc.wantOut) > 1e-9 {
				t.Errorf("output = %.9f, want %.9f", got.OutputUSD, tc.wantOut)
			}
			if math.Abs(got.TotalUSD-tc.wantTotal) > 1e-9 {
				t.Errorf("total = %.9f, want %.9f", got.TotalUSD, tc.wantTotal)
			}
		})
	}
}

// TestCostParityAllFixturesMatch is the core assertion: every default fixture
// agrees between the pylon float-USD path and the gateway nano-USD path at
// micro-USD granularity. This is exactly what the cost-parity subcommand exits
// 0 on.
func TestCostParityAllFixturesMatch(t *testing.T) {
	for _, f := range defaultCostFixtures {
		r := compareCost(f)
		if !r.match {
			t.Errorf("%s (%d/%d tok): pylon %d µUSD != gateway %d µUSD (pylon %.6f USD, gateway %d nano)",
				f.model, f.inTok, f.outTok, r.pylonMicro, r.gatewayMicro, r.pylonUSD, r.gatewayNano)
		}
	}
}

// TestCostParityDetectsThousandXBug is the guard's guard: with the wrong
// denomination (per-1k instead of per-1M) the gateway cost is 1000× the pylon
// cost, and the parity comparison MUST flag it. If this ever passes with the
// bad divisor, the gate is not actually protecting the invariant.
func TestCostParityDetectsThousandXBug(t *testing.T) {
	const badDivisor = 1_000 // per-1k: the 1000× bug
	caughtAtLeastOne := false
	for _, f := range defaultCostFixtures {
		if f.inTok == 0 && f.outTok == 0 {
			continue // zero cost is 0 under any divisor; not a discriminating case
		}
		inRate, outRate := pylonPriceUSD(f.model)
		pc := pylonCalculate(f.inTok, f.outTok, inRate, outRate)
		pylonMicro := int64(math.Round(pc.TotalUSD * 1e6))

		inNano := gatewayCostNano(f.inTok, usdPer1MToNano(inRate), badDivisor)
		outNano := gatewayCostNano(f.outTok, usdPer1MToNano(outRate), badDivisor)
		badMicro := nanoToMicroRound(inNano + outNano)

		if pylonMicro == badMicro {
			t.Errorf("%s: per-1k bug NOT detected — pylon %d µUSD == bad-divisor %d µUSD",
				f.model, pylonMicro, badMicro)
			continue
		}
		caughtAtLeastOne = true
	}
	if !caughtAtLeastOne {
		t.Fatal("no fixture discriminated the per-1k bug; the gate is toothless")
	}
}

// TestCostGatewayNanoMirrorsGatewayModule pins gatewayCostNano against the exact
// values the gateway internal/cost.costNano test asserts, since the two live in
// separate modules and cannot import each other.
func TestCostGatewayNanoMirrorsGatewayModule(t *testing.T) {
	cases := []struct {
		tokens         int64
		priceNanoPer1M int64
		want           int64
	}{
		{1000, 2_500_000_000, 2_500_000},                         // gpt-4o input, 1000 tok
		{500, 10_000_000_000, 5_000_000},                         // gpt-4o output, 500 tok
		{1_000_000, 2_500_000_000, 2_500_000_000},                // 1M tok @ $2.50/1M = $2.50 (thousandX guard)
		{333, 150_000_000, 49_950},                               // gpt-4o-mini input precision
		{666, 600_000_000, 399_600},                              // gpt-4o-mini output precision
		{10_000_000_000, 600_000_000_000, 6_000_000_000_000_000}, // no int64 overflow (math/big)
		{-5, 2_500_000_000, 0},                                   // negative tokens clamp
		{1000, -1, 0},                                            // negative price clamp
	}
	for _, tc := range cases {
		got := gatewayCostNano(tc.tokens, tc.priceNanoPer1M, tokensPer1M)
		if got != tc.want {
			t.Errorf("gatewayCostNano(%d, %d) = %d, want %d", tc.tokens, tc.priceNanoPer1M, got, tc.want)
		}
	}
}

// TestCostPylonPriceOrderedPrefixMatch verifies the reference price table
// preserves pylon's insertion-order first-match semantics: a shorter prefix must
// not shadow a longer, more-specific one.
func TestCostPylonPriceOrderedPrefixMatch(t *testing.T) {
	cases := []struct {
		model   string
		wantIn  float64
		wantOut float64
	}{
		{"gpt-4o-mini", 0.15, 0.60},
		{"gpt-4o-mini-2024-07-18", 0.15, 0.60},
		{"gpt-4o", 2.50, 10.00},
		{"gpt-4o-2024-08-06", 2.50, 10.00},
		{"gpt-4-turbo", 10.00, 30.00},
		{"gpt-4", 30.00, 60.00},
		{"o1-pro", 150.00, 600.00},
		{"o1-mini", 3.00, 12.00},
		{"o1", 15.00, 60.00},
		{"claude-3-5-sonnet-20241022", 3.00, 15.00},
		{"O1-PRO", 150.00, 600.00}, // case-insensitive
		{"totally-unknown", pylonFallbackInputUSD, pylonFallbackOutputUSD},
	}
	for _, tc := range cases {
		t.Run(tc.model, func(t *testing.T) {
			in, out := pylonPriceUSD(tc.model)
			if in != tc.wantIn || out != tc.wantOut {
				t.Errorf("pylonPriceUSD(%q) = %.3f/%.3f, want %.3f/%.3f", tc.model, in, out, tc.wantIn, tc.wantOut)
			}
		})
	}
}

// TestCostRound6HalfEven checks the pylon-parity rounding matches CPython's
// round() ties-to-even at the 6th decimal.
func TestCostRound6HalfEven(t *testing.T) {
	cases := []struct {
		in   float64
		want float64
	}{
		{0.00044955, 0.00045}, // >6 decimals → round to 6 (449.55µ → 450µ)
		{0.0000005, 0.0},      // 0.5 µ ties to even (0)
		{0.0000015, 0.000002}, // 1.5 µ ties to even (2)
		{0.0000025, 0.000002}, // 2.5 µ ties to even (2)
		{2.5, 2.5},
	}
	for _, tc := range cases {
		if got := round6(tc.in); math.Abs(got-tc.want) > 1e-12 {
			t.Errorf("round6(%.10f) = %.10f, want %.10f", tc.in, got, tc.want)
		}
	}
}

// TestCostUsdPer1MToNano verifies decimal per-1M prices scale to exact integer
// nano-USD (the value the gateway stores as input_cost_per_1m_tokens × NanoUSD).
func TestCostUsdPer1MToNano(t *testing.T) {
	cases := []struct {
		usd  float64
		want int64
	}{
		{2.50, 2_500_000_000},
		{0.15, 150_000_000},
		{0.075, 75_000_000},
		{150.00, 150_000_000_000},
		{1.0, 1_000_000_000},
	}
	for _, tc := range cases {
		if got := usdPer1MToNano(tc.usd); got != tc.want {
			t.Errorf("usdPer1MToNano(%.3f) = %d, want %d", tc.usd, got, tc.want)
		}
	}
}

// TestCostNanoToMicroRound checks the nano→micro reduction used for comparison.
func TestCostNanoToMicroRound(t *testing.T) {
	cases := []struct {
		nano int64
		want int64
	}{
		{0, 0},
		{-100, 0},
		{499, 0},
		{500, 1},
		{1_000, 1},
		{1_499, 1},
		{1_500, 2},
		{2_500_000, 2_500}, // $0.0025 = 2500 µUSD
	}
	for _, tc := range cases {
		if got := nanoToMicroRound(tc.nano); got != tc.want {
			t.Errorf("nanoToMicroRound(%d) = %d, want %d", tc.nano, got, tc.want)
		}
	}
}
