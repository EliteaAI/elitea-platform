package main

import (
	"flag"
	"fmt"
	"math"
	"math/big"
	"os"
	"strings"
	"text/tabwriter"
)

// cost-parity (spec §5.1 / §8.8 / §7.3, gate BFF.2 / validator BFF.9b):
//
// The migration replaces the pylon CostCalculator (float USD, prices per-1M
// tokens) with the gateway's int64 nano-USD budget counter. The load-bearing
// invariant is that the two denominations agree — prices are per-1,000,000
// tokens and the counter accumulates nano-USD (×1e9). A divisor that disagrees
// with the price denomination (e.g. per-1k / 1e3 instead of per-1M / 1e6) is a
// 1000× costing error, the single worst failure mode of this migration.
//
// This subcommand proves parity WITHOUT a live gateway or database by running
// two genuinely independent implementations of the same cost over a fixture set
// and asserting they agree at pylon's reporting granularity (micro-USD, the
// precision `round(x, 6)` reports):
//
//   - pylonCalculate — the pylon CostCalculator arithmetic verbatim:
//     input_cost = (tokens / 1e6) * price_per_1M in float64 USD, rounded to 6.
//   - gatewayCostNano — the gateway cost path: round(tokens * priceNanoPer1M /
//     TokensPer1M) in int64 nano-USD via math/big (mirrors
//     services/elitea-llm-gateway/internal/cost.costNano; that module cannot be
//     imported here — it is a separate GOWORK=off Go 1.26.4 module — so the
//     arithmetic is reproduced and pinned by unit tests).
//
// Because one path is float-USD-per-1M and the other is integer-nano-per-1M,
// their agreement is a real cross-check of the denomination: swap the gateway
// divisor to 1e3 and every fixture mismatches by ~1000× (asserted in
// costparity_test.go's TestCostParityDetectsThousandXBug).
//
// The price table below is pylon gateway_analytics.MODEL_PRICING_DEFAULTS
// (USD per 1M tokens) in insertion order — the ordered prefix match is
// load-bearing (pylon matches the FIRST prefix, so "gpt-4o-mini" must precede
// "gpt-4o" must precede "gpt-4"). This is the same table the gateway mirrors in
// internal/cost/default_prices.go (there scaled to nano-USD integer literals).

// nanoPerUSD is the nano-USD scale factor: 1 USD = 1e9 nano-USD (gateway
// cost.NanoUSD). Budget counters are int64 nano-USD.
const nanoPerUSD int64 = 1_000_000_000

// tokensPer1M is the price denominator: prices are per this many tokens. Using
// any other divisor here is the 1000×/1e6 costing bug this gate guards
// (gateway cost.TokensPer1M).
const tokensPer1M int64 = 1_000_000

// nanoPerMicroUSD is the number of nano-USD in one micro-USD (1e-6 USD). pylon
// reports costs rounded to 6 decimals (micro-USD); parity is asserted at this
// granularity so sub-micro float noise in the pylon path cannot cause a false
// mismatch, while a gross (1000×) error survives the rounding.
const nanoPerMicroUSD int64 = 1_000

// pylonPriceEntry is one row of the pylon default price table: a model-name
// prefix and its input/output price in USD per 1,000,000 tokens.
type pylonPriceEntry struct {
	prefix    string
	inputUSD  float64
	outputUSD float64
}

// pylonPriceTable mirrors pylon MODEL_PRICING_DEFAULTS verbatim, in insertion
// order. ORDER IS LOAD-BEARING (see file header).
var pylonPriceTable = []pylonPriceEntry{
	{"gpt-4o-mini", 0.15, 0.60},
	{"gpt-4o", 2.50, 10.00},
	{"gpt-4-turbo", 10.00, 30.00},
	{"gpt-4", 30.00, 60.00},
	{"gpt-3.5-turbo", 0.50, 1.50},
	{"claude-3-5-sonnet", 3.00, 15.00},
	{"claude-3-5-haiku", 0.80, 4.00},
	{"claude-3-opus", 15.00, 75.00},
	{"claude-3-haiku", 0.25, 1.25},
	{"claude-sonnet-4", 3.00, 15.00},
	{"claude-opus-4", 15.00, 75.00},
	{"o1-mini", 3.00, 12.00},
	{"o1-pro", 150.00, 600.00},
	{"o1", 15.00, 60.00},
	{"gemini-1.5-flash", 0.075, 0.30},
	{"gemini-1.5-pro", 1.25, 5.00},
	{"gemini-2.0-flash", 0.10, 0.40},
	{"amazon.titan-text-express", 0.20, 0.60},
	{"amazon.titan-text-lite", 0.15, 0.20},
	{"anthropic.claude-3-sonnet", 3.00, 15.00},
	{"anthropic.claude-3-haiku", 0.25, 1.25},
	{"mistral-large", 2.00, 6.00},
	{"mistral-small", 0.10, 0.30},
}

// pylon's ultimate default when no prefix matches: 1.0 / 3.0 USD per 1M tokens.
const (
	pylonFallbackInputUSD  = 1.0
	pylonFallbackOutputUSD = 3.0
)

// pylonPriceUSD resolves the per-1M USD price for a model name exactly as pylon
// does: case-insensitive, FIRST-matching prefix in insertion order, else the
// 1.0/3.0 USD fallback.
func pylonPriceUSD(model string) (inputUSD, outputUSD float64) {
	lower := strings.ToLower(model)
	for _, e := range pylonPriceTable {
		if strings.HasPrefix(lower, strings.ToLower(e.prefix)) {
			return e.inputUSD, e.outputUSD
		}
	}
	return pylonFallbackInputUSD, pylonFallbackOutputUSD
}

// pylonCost is one pylon CostCalculator result, USD rounded to 6 decimals.
type pylonCost struct {
	InputUSD  float64
	OutputUSD float64
	TotalUSD  float64
}

// pylonCalculate reproduces pylon CostCalculator.calculate verbatim: each
// component cost is (tokens / 1e6) * rate in float64 USD; the returned fields
// are rounded to 6 decimals (input/output rounded independently, total rounded
// from the raw sum — exactly as pylon does).
func pylonCalculate(inTok, outTok int64, inRate, outRate float64) pylonCost {
	inRaw := (float64(inTok) / 1e6) * inRate
	outRaw := (float64(outTok) / 1e6) * outRate
	totalRaw := inRaw + outRaw
	return pylonCost{
		InputUSD:  round6(inRaw),
		OutputUSD: round6(outRaw),
		TotalUSD:  round6(totalRaw),
	}
}

// round6 rounds a USD amount to 6 decimals using round-half-to-even, matching
// Python's built-in round() that pylon CostCalculator uses.
func round6(v float64) float64 {
	return roundHalfEven(v*1e6) / 1e6
}

// roundHalfEven rounds to the nearest integer, ties to even — CPython's round()
// semantics. Used so the Go pylon reproduction matches the reference bit-for-bit
// on half-way values.
func roundHalfEven(v float64) float64 {
	floor := math.Floor(v)
	diff := v - floor
	switch {
	case diff < 0.5:
		return floor
	case diff > 0.5:
		return floor + 1
	default: // exactly 0.5 → round to even
		if math.Mod(floor, 2) == 0 {
			return floor
		}
		return floor + 1
	}
}

// gatewayCostNano returns round(tokens * priceNanoPer1M / tokensPer1M) in
// nano-USD via math/big, mirroring the gateway cost.costNano exactly: the
// multiply is done in big.Int so a large token count cannot overflow int64
// before the divide; rounding is half-up (both operands non-negative). divisor
// is tokensPer1M in production; costparity_test.go injects a wrong divisor to
// prove the gate catches the 1000× bug.
func gatewayCostNano(tokens, priceNanoPer1M, divisor int64) int64 {
	if tokens <= 0 || priceNanoPer1M <= 0 {
		return 0
	}
	prod := new(big.Int).Mul(big.NewInt(tokens), big.NewInt(priceNanoPer1M))
	prod.Add(prod, big.NewInt(divisor/2)) // round half-up
	prod.Quo(prod, big.NewInt(divisor))
	return prod.Int64()
}

// usdPer1MToNano converts a per-1M USD price to per-1M nano-USD (×1e9),
// rounding to the nearest nano so a decimal price like 0.075 becomes an exact
// integer 75_000_000 — the same integer the gateway stores in
// gateway_models.input_cost_per_1m_tokens × NanoUSD.
func usdPer1MToNano(usd float64) int64 {
	return int64(math.Round(usd * float64(nanoPerUSD)))
}

// costFixture is one parity test case: a model and a token split. Provider is
// carried for readable output only — pylon prices purely by model_name prefix.
type costFixture struct {
	provider string
	model    string
	inTok    int64
	outTok   int64
}

// defaultCostFixtures exercises the full range of the parity check: common and
// small-price models, the fallback path, and large token counts that would
// overflow a naive int64 multiply and would blow up by 1000× under a per-1k
// denomination.
var defaultCostFixtures = []costFixture{
	{"openai", "gpt-4o", 1000, 500},                        // common case
	{"openai", "gpt-4o-mini", 333, 666},                    // sub-micro precision
	{"openai", "gpt-4o", 1_000_000, 500_000},               // 1M tokens: $2.50/$5.00 exactly (not $2500)
	{"anthropic", "claude-3-5-sonnet-20241022", 2000, 800}, // versioned suffix → prefix match
	{"openai", "gpt-4", 1500, 750},                         // large per-1M price
	{"openai", "gpt-4-turbo", 1500, 750},                   // ordering: must not match gpt-4
	{"openai", "o1-pro", 100, 100},                         // huge price ($150/$600 per 1M)
	{"openai", "o1", 100, 100},                             // ordering: o1-pro/o1-mini before o1
	{"google", "gemini-1.5-flash", 10_000, 5_000},          // fractional price 0.075
	{"who", "totally-unknown-model", 1000, 500},            // fallback 1.0/3.0 USD
	{"openai", "gpt-4o", 0, 0},                             // zero tokens → zero cost
}

// costParityResult is the outcome of comparing the two implementations for one
// fixture.
type costParityResult struct {
	fixture      costFixture
	inputUSD     float64 // pylon input price per 1M
	outputUSD    float64 // pylon output price per 1M
	pylonUSD     float64 // pylon total cost (round6)
	gatewayNano  int64   // gateway total cost in nano-USD
	pylonMicro   int64   // pylon total in micro-USD (comparison unit)
	gatewayMicro int64   // gateway total in micro-USD (comparison unit)
	match        bool
}

// compareCost computes the pylon and gateway cost for one fixture and compares
// them at micro-USD granularity (pylon's reporting precision). The gateway path
// uses the production divisor tokensPer1M.
func compareCost(f costFixture) costParityResult {
	inRate, outRate := pylonPriceUSD(f.model)
	pc := pylonCalculate(f.inTok, f.outTok, inRate, outRate)

	inNano := gatewayCostNano(f.inTok, usdPer1MToNano(inRate), tokensPer1M)
	outNano := gatewayCostNano(f.outTok, usdPer1MToNano(outRate), tokensPer1M)
	gwNano := inNano + outNano

	pylonMicro := int64(math.Round(pc.TotalUSD * 1e6))
	gwMicro := nanoToMicroRound(gwNano)

	return costParityResult{
		fixture:      f,
		inputUSD:     inRate,
		outputUSD:    outRate,
		pylonUSD:     pc.TotalUSD,
		gatewayNano:  gwNano,
		pylonMicro:   pylonMicro,
		gatewayMicro: gwMicro,
		match:        pylonMicro == gwMicro,
	}
}

// nanoToMicroRound converts nano-USD to micro-USD, rounding half-up (the value
// is non-negative). 1 micro-USD = 1000 nano-USD.
func nanoToMicroRound(nano int64) int64 {
	if nano <= 0 {
		return 0
	}
	return (nano + nanoPerMicroUSD/2) / nanoPerMicroUSD
}

// cmdCostParity is the `cutover-ctl cost-parity` entrypoint. It runs the fixture
// set through both the pylon float-USD and the gateway nano-USD paths and exits
// 0 only when every fixture agrees at micro-USD granularity.
func cmdCostParity(args []string) {
	fs := flag.NewFlagSet("cost-parity", flag.ExitOnError)
	against := fs.String("against", "pylon", "reference cost model to compare against (only \"pylon\" is supported)")
	_ = fs.Parse(args)

	if *against != "pylon" {
		fmt.Fprintf(os.Stderr, "cost-parity: unknown reference %q; only \"pylon\" is supported\n", *against)
		os.Exit(2)
	}

	results := make([]costParityResult, 0, len(defaultCostFixtures))
	mismatches := 0
	for _, f := range defaultCostFixtures {
		r := compareCost(f)
		results = append(results, r)
		if !r.match {
			mismatches++
		}
	}

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	_, _ = fmt.Fprintln(w, "MODEL\tIN/OUT TOK\tPYLON USD\tGATEWAY nano\tGATEWAY USD\tMATCH")
	for _, r := range results {
		mark := "✓"
		if !r.match {
			mark = "✗"
		}
		_, _ = fmt.Fprintf(w, "%s\t%d/%d\t%.6f\t%d\t%.6f\t%s\n",
			r.fixture.model, r.fixture.inTok, r.fixture.outTok,
			r.pylonUSD, r.gatewayNano, float64(r.gatewayNano)/float64(nanoPerUSD), mark)
	}
	_ = w.Flush()

	if mismatches > 0 {
		fmt.Fprintf(os.Stderr, "\n✗ cost-parity: %d of %d fixtures diverge from the pylon CostCalculator "+
			"(per-1M price → nano-USD; check the denomination — spec §5.1/§8.8, gate BFF.2).\n",
			mismatches, len(results))
		os.Exit(1)
	}
	fmt.Printf("\n✓ cost-parity: all %d fixtures match the pylon CostCalculator (per-1M → nano-USD, no 1000× drift)\n", len(results))
}
