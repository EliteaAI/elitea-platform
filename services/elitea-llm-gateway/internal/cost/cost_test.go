package cost

import (
	"context"
	"errors"
	"math"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

// fakeRow is a canned pgxRow: it copies srcInput/srcOutput into the *int64
// scan targets, or returns scanErr.
type fakeRow struct {
	srcInput  *int64
	srcOutput *int64
	scanErr   error
}

func (r fakeRow) Scan(dest ...any) error {
	if r.scanErr != nil {
		return r.scanErr
	}
	if len(dest) != 2 {
		return errors.New("fakeRow: expected 2 scan targets")
	}
	*(dest[0].(**int64)) = r.srcInput
	*(dest[1].(**int64)) = r.srcOutput
	return nil
}

// fakeDB is a canned rowQuerier keyed by "provider:model"; it counts calls so a
// cache-hit test can prove the DB is not re-queried.
type fakeDB struct {
	rows  map[string]fakeRow
	def   fakeRow // returned when key not present (defaults to pgx.ErrNoRows)
	calls int
}

func (d *fakeDB) QueryRow(_ context.Context, _ string, args ...any) pgxRow {
	d.calls++
	provider, _ := args[0].(string)
	model, _ := args[1].(string)
	if r, ok := d.rows[provider+":"+model]; ok {
		return r
	}
	if d.def.scanErr == nil && d.def.srcInput == nil {
		return fakeRow{scanErr: pgx.ErrNoRows}
	}
	return d.def
}

func ptr(v int64) *int64 { return &v }

// usdToNano converts a USD/1M price to nano-USD/1M for building fake catalog rows.
func usdToNano(usd float64) int64 { return int64(math.Round(usd * float64(NanoUSD))) }

func TestCostNano_PylonParityVectors(t *testing.T) {
	// These mirror pylon test_cost_calculator.py exactly. pylon computes
	// cost_usd = (tokens / 1e6) * price_per_1M; we compute the nano-USD
	// equivalent and assert both the nano value AND the USD round-trip.
	cases := []struct {
		name         string
		inTok, outTok int64
		inUSD, outUSD float64 // price per 1M USD
		wantInNano    int64
		wantOutNano   int64
	}{
		// test_calculate_basic: gpt-4o (2.50/10.00), 1000 in / 500 out.
		{"basic_gpt4o", 1000, 500, 2.50, 10.00, 2_500_000, 5_000_000},
		// test_calculate_large_token_count: 1M in / 500k out.
		{"large_gpt4o", 1_000_000, 500_000, 2.50, 10.00, 2_500_000_000, 5_000_000_000},
		// test_calculate_zero_tokens.
		{"zero", 0, 0, 2.50, 10.00, 0, 0},
		// test_cost_precision: gpt-4o-mini (0.15/0.60), 333 in / 666 out.
		//   0.15/1M*333 = 0.00004995 USD = 49_950 nano; 0.60/1M*666 = 0.0003996 USD = 399_600 nano.
		{"precision_mini", 333, 666, 0.15, 0.60, 49_950, 399_600},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gotIn := costNano(tc.inTok, usdToNano(tc.inUSD))
			gotOut := costNano(tc.outTok, usdToNano(tc.outUSD))
			if gotIn != tc.wantInNano {
				t.Errorf("input nano = %d, want %d", gotIn, tc.wantInNano)
			}
			if gotOut != tc.wantOutNano {
				t.Errorf("output nano = %d, want %d", gotOut, tc.wantOutNano)
			}
			// USD round-trip parity with pylon's rounded-to-6 result.
			gotUSD := float64(gotIn+gotOut) / float64(NanoUSD)
			wantUSD := (float64(tc.inTok)/1e6)*tc.inUSD + (float64(tc.outTok)/1e6)*tc.outUSD
			if math.Abs(gotUSD-wantUSD) > 1e-9 {
				t.Errorf("total USD = %.9f, want %.9f", gotUSD, wantUSD)
			}
		})
	}
}

func TestCostNano_ThousandXBugGuard(t *testing.T) {
	// The load-bearing invariant: prices are per-1M. If a per-token price
	// (1e6× smaller) were fed as if per-1M, or the divisor were 1e3 instead of
	// 1e6, cost would be off by a factor of 1e6 / 1e3. This test pins that a
	// per-1M price of $2.50 over 1M tokens is exactly $2.50 (2.5e9 nano) — not
	// $2500 (per-1k bug) and not $0.0000025 (per-token confusion).
	const priceNanoPer1M = 2_500_000_000 // $2.50/1M
	got := costNano(1_000_000, priceNanoPer1M)
	if got != 2_500_000_000 {
		t.Fatalf("cost for 1M tokens @ $2.50/1M = %d nano, want 2_500_000_000 ($2.50)", got)
	}
	// A per-1k divisor would give 1000× this. Assert we are NOT that.
	perKBug := (int64(1_000_000) * priceNanoPer1M) / 1_000
	if got == perKBug {
		t.Fatal("cost matches the per-1k (1000×) bug value")
	}
}

func TestCostNano_NegativeAndZeroClamp(t *testing.T) {
	if got := costNano(-5, 2_500_000_000); got != 0 {
		t.Errorf("negative tokens: got %d, want 0", got)
	}
	if got := costNano(1000, -1); got != 0 {
		t.Errorf("negative price: got %d, want 0", got)
	}
	if got := costNano(0, 2_500_000_000); got != 0 {
		t.Errorf("zero tokens: got %d, want 0", got)
	}
}

func TestCostNano_NoInt64OverflowOnLargeBatch(t *testing.T) {
	// A naive int64 multiply of tokens*priceNano overflows well before these
	// values; math/big must keep the result exact. 10e9 tokens @ $600/1M
	// (o1-pro output) = 6e12 USD... unrealistic, but proves no overflow/panic.
	// tokens * priceNano = 1e10 * 6e11 = 6e21 > int64 max (9.2e18).
	got := costNano(10_000_000_000, 600_000_000_000)
	// Expected: 1e10 * 6e11 / 1e6 = 6e15 nano-USD.
	want := int64(6_000_000_000_000_000)
	if got != want {
		t.Fatalf("large-batch cost = %d, want %d (overflow?)", got, want)
	}
}

func TestPrice_CatalogHit(t *testing.T) {
	db := &fakeDB{rows: map[string]fakeRow{
		"openai:gpt-4o": {srcInput: ptr(usdToNano(2.50)), srcOutput: ptr(usdToNano(10.00))},
	}}
	c := New(Config{DB: db})
	p := c.Price(context.Background(), "openai", "gpt-4o")
	if p.Source != "catalog" {
		t.Fatalf("source = %q, want catalog", p.Source)
	}
	if p.InputNanoPer1M != 2_500_000_000 || p.OutputNanoPer1M != 10_000_000_000 {
		t.Fatalf("price = %+v, want 2.5e9/1e10", p)
	}
}

func TestPrice_CatalogNullOutputUsesInputTimes3(t *testing.T) {
	// pylon: output_cost = output or input*3 when output is None.
	db := &fakeDB{rows: map[string]fakeRow{
		"custom:m": {srcInput: ptr(usdToNano(5.00)), srcOutput: nil},
	}}
	c := New(Config{DB: db})
	p := c.Price(context.Background(), "custom", "m")
	if p.OutputNanoPer1M != 15_000_000_000 { // 5*3 = 15 USD
		t.Fatalf("output = %d, want 15e9 (input*3)", p.OutputNanoPer1M)
	}
}

func TestPrice_CatalogNullInputFallsBackToDefault(t *testing.T) {
	// A row with NULL input price is treated as uncatalogued → default table.
	db := &fakeDB{rows: map[string]fakeRow{
		"openai:gpt-4o": {srcInput: nil, srcOutput: ptr(usdToNano(10.00))},
	}}
	c := New(Config{DB: db})
	p := c.Price(context.Background(), "openai", "gpt-4o")
	if p.Source != "default" {
		t.Fatalf("source = %q, want default", p.Source)
	}
	if p.InputNanoPer1M != 2_500_000_000 { // gpt-4o default
		t.Fatalf("input = %d, want gpt-4o default 2.5e9", p.InputNanoPer1M)
	}
}

func TestPrice_DBErrorFallsBackToDefault(t *testing.T) {
	db := &fakeDB{def: fakeRow{scanErr: errors.New("connection refused")}}
	c := New(Config{DB: db})
	p := c.Price(context.Background(), "openai", "gpt-4o-mini")
	if p.Source != "default" {
		t.Fatalf("source = %q, want default (DB error → fail-open to defaults)", p.Source)
	}
	if p.InputNanoPer1M != 150_000_000 {
		t.Fatalf("input = %d, want gpt-4o-mini default 0.15e9", p.InputNanoPer1M)
	}
}

func TestPrice_NoDB_UsesDefaultTable(t *testing.T) {
	c := New(Config{DB: nil})
	p := c.Price(context.Background(), "openai", "gpt-4")
	if p.Source != "default" || p.InputNanoPer1M != 30_000_000_000 {
		t.Fatalf("price = %+v, want gpt-4 default 30e9", p)
	}
}

func TestPrice_UnknownModelUsesFallback(t *testing.T) {
	c := New(Config{DB: nil})
	p := c.Price(context.Background(), "who", "unknown-model-xyz")
	if p.Source != "fallback" {
		t.Fatalf("source = %q, want fallback", p.Source)
	}
	if p.InputNanoPer1M != fallbackInputNano || p.OutputNanoPer1M != fallbackOutputNano {
		t.Fatalf("price = %+v, want 1.0/3.0 USD fallback", p)
	}
}

func TestPrice_CacheHitDoesNotRequeryDB(t *testing.T) {
	db := &fakeDB{rows: map[string]fakeRow{
		"openai:gpt-4o": {srcInput: ptr(usdToNano(2.50)), srcOutput: ptr(usdToNano(10.00))},
	}}
	c := New(Config{DB: db})
	_ = c.Price(context.Background(), "openai", "gpt-4o")
	_ = c.Price(context.Background(), "openai", "gpt-4o")
	_ = c.Price(context.Background(), "openai", "gpt-4o")
	if db.calls != 1 {
		t.Fatalf("db.calls = %d, want 1 (subsequent reads served from cache)", db.calls)
	}
}

func TestPrice_CacheExpiryRequeriesDB(t *testing.T) {
	db := &fakeDB{rows: map[string]fakeRow{
		"openai:gpt-4o": {srcInput: ptr(usdToNano(2.50)), srcOutput: ptr(usdToNano(10.00))},
	}}
	base := time.Unix(1_700_000_000, 0)
	clock := base
	c := New(Config{DB: db, CacheTTL: time.Minute, Now: func() time.Time { return clock }})
	_ = c.Price(context.Background(), "openai", "gpt-4o")
	clock = base.Add(2 * time.Minute) // past TTL
	_ = c.Price(context.Background(), "openai", "gpt-4o")
	if db.calls != 2 {
		t.Fatalf("db.calls = %d, want 2 (cache expired → re-query)", db.calls)
	}
}

func TestCost_EndToEnd_CatalogAndSource(t *testing.T) {
	db := &fakeDB{rows: map[string]fakeRow{
		"openai:gpt-4o": {srcInput: ptr(usdToNano(2.50)), srcOutput: ptr(usdToNano(10.00))},
	}}
	c := New(Config{DB: db})
	got := c.Cost(context.Background(), "openai", "gpt-4o", 1000, 500)
	if got.InputNanoUSD != 2_500_000 || got.OutputNanoUSD != 5_000_000 {
		t.Fatalf("cost = %+v, want in=2.5e6 out=5e6", got)
	}
	if got.TotalNanoUSD != 7_500_000 {
		t.Fatalf("total = %d, want 7_500_000", got.TotalNanoUSD)
	}
	if got.Source != "catalog" {
		t.Fatalf("source = %q, want catalog", got.Source)
	}
}

func TestDefaultPrice_OrderedPrefixMatch(t *testing.T) {
	// The ordering guard: "gpt-4o" must NOT be shadowed by "gpt-4", and
	// "gpt-4o-mini" must win over "gpt-4o". Go map iteration would break this.
	cases := []struct {
		model     string
		wantInput int64
	}{
		{"gpt-4o-mini", 150_000_000},
		{"gpt-4o-mini-2024-07-18", 150_000_000},
		{"gpt-4o", 2_500_000_000},
		{"gpt-4o-2024-08-06", 2_500_000_000},
		{"gpt-4-turbo", 10_000_000_000},
		{"gpt-4", 30_000_000_000},
		{"claude-3-5-sonnet-20241022", 3_000_000_000},
		{"claude-3-5-haiku-20241022", 800_000_000},
		{"O1-PRO", 150_000_000_000}, // case-insensitive
	}
	for _, tc := range cases {
		t.Run(tc.model, func(t *testing.T) {
			p := defaultPrice(tc.model)
			if p.InputNanoPer1M != tc.wantInput {
				t.Errorf("defaultPrice(%q).input = %d, want %d", tc.model, p.InputNanoPer1M, tc.wantInput)
			}
		})
	}
}
