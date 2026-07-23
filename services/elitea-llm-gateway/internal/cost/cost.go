// Package cost computes per-request LLM cost in int64 nano-USD for the
// governance PostLLMHook path (design §8.7, §5.1, §8.8).
//
// Two denominations meet here and MUST NOT be confused (design §5.1):
//
//   - Model price — USD per 1,000,000 tokens, stored in gateway.gateway_models
//     (input_cost_per_1m_tokens / output_cost_per_1m_tokens). This is the cost
//     BASIS, written by the price-sync service.
//   - Budget counter — int64 nano-USD (×1e9, NanoUSD), incremented via Nats-Incr
//     after each response.
//
// The load-bearing invariant (§8.8, guards the 1000× / 1e6 costing bug): prices
// are per-1M tokens. The pylon reference (gateway_analytics.CostCalculator)
// computes cost as (tokens / 1_000_000) * price_per_1M in USD; this package
// produces the exact int64 nano-USD equivalent so the two agree end-to-end
// (pre-flight gate BFF.2 / spec §7 s8):
//
//	costNano = round( tokens * priceNanoPer1M / TokensPer1M )
//
// where priceNanoPer1M = price_per_1M_usd * NanoUSD. The multiply is done in
// math/big so a large token count cannot overflow int64 before the divide.
//
// The package reads prices from Postgres (source of truth) with a short
// in-process TTL cache on the hot path (§8.8, line 448), and falls back to the
// same default price table pylon uses (identical values, identical ordered
// prefix match) so an un-catalogued model is priced consistently with the
// legacy path rather than dropped.
package cost

import (
	"context"
	"errors"
	"log/slog"
	"math/big"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
)

// NanoUSD is the nano-USD scale factor: 1 USD = 1e9 nano-USD. Budget counters
// are int64 nano-USD (design §8; matches failmode.NanoUSD — the same domain
// constant, defined locally to avoid coupling the cost package to failmode).
const NanoUSD int64 = 1_000_000_000

// TokensPer1M is the price denominator: prices in gateway_models are per this
// many tokens. Using any other divisor here is the 1000×/1e6 costing bug the
// migration guards (design §8.8).
const TokensPer1M int64 = 1_000_000

// DefaultCacheTTL is the in-process price-cache lifetime on the cost hot path
// (design §8.8: "a 5-minute in-process cache on the cost hot path"). It matches
// the pylon CostCalculator's 5-minute pricing cache.
const DefaultCacheTTL = 5 * time.Minute

// Price is a resolved per-1M-token price in nano-USD, plus its provenance.
type Price struct {
	// InputNanoPer1M is the input token price in nano-USD per 1,000,000 tokens.
	InputNanoPer1M int64
	// OutputNanoPer1M is the output token price in nano-USD per 1,000,000 tokens.
	OutputNanoPer1M int64
	// Source is where the price came from: "catalog" (gateway_models),
	// "default" (a matched entry in the pylon default table), or "fallback"
	// (the ultimate 1.0/3.0 USD default).
	Source string
}

// Cost is a computed per-request cost, all fields in int64 nano-USD.
type Cost struct {
	InputNanoUSD  int64
	OutputNanoUSD int64
	TotalNanoUSD  int64
	// Source mirrors the Price.Source the cost was computed from.
	Source string
}

// rowQuerier is the minimal pgx surface the calculator needs, satisfied by
// *pgxpool.Pool and by test fakes (mirrors the account package's DB seam so the
// package is unit-testable with no live database).
type rowQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgxRow
}

// pgxRow mirrors pgx.Row (Scan-only).
type pgxRow interface {
	Scan(dest ...any) error
}

// modelPriceSQL reads the per-1M prices for one (provider, model) and scales
// them to nano-USD exactly in SQL. NUMERIC(20,8) × 1e9 is an integer (≤8
// fractional digits), so the ::bigint cast is exact — no float ever touches the
// money path. NULL costs scan into the *int64 pointers as nil (pylon treats a
// row with a NULL input cost as "not usable" and falls back to defaults).
//
// $1 provider, $2 model_name, $3 NanoUSD scale factor.
const modelPriceSQL = `SELECT
		(input_cost_per_1m_tokens  * $3::numeric)::bigint AS input_nano,
		(output_cost_per_1m_tokens * $3::numeric)::bigint AS output_nano
	FROM gateway.gateway_models
	WHERE provider = $1 AND model_name = $2`

// Calculator resolves prices and computes nano-USD costs. It is safe for
// concurrent use.
type Calculator struct {
	db     rowQuerier
	ttl    time.Duration
	now    func() time.Time
	logger *slog.Logger

	mu    sync.RWMutex
	cache map[string]cacheEntry
}

type cacheEntry struct {
	price   Price
	expires time.Time
}

// Config configures a Calculator.
type Config struct {
	// DB is the Postgres handle (*pgxpool.Pool in production, via NewPoolQuerier).
	// When nil the calculator serves prices from the default table only — useful
	// for tests and for a gateway booted without a catalog.
	DB rowQuerier
	// CacheTTL overrides the price-cache lifetime. <= 0 uses DefaultCacheTTL.
	CacheTTL time.Duration
	// Now overrides the clock (tests). nil uses time.Now.
	Now func() time.Time
	// Logger is used for price-lookup warnings. nil uses slog.Default().
	Logger *slog.Logger
}

// New builds a Calculator from cfg.
func New(cfg Config) *Calculator {
	ttl := cfg.CacheTTL
	if ttl <= 0 {
		ttl = DefaultCacheTTL
	}
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	logger := cfg.Logger
	if logger == nil {
		logger = slog.Default()
	}
	return &Calculator{
		db:     cfg.DB,
		ttl:    ttl,
		now:    now,
		logger: logger,
		cache:  make(map[string]cacheEntry),
	}
}

// Cost computes the input/output/total cost in int64 nano-USD for a request of
// inputTokens/outputTokens against (provider, model). Negative token counts are
// clamped to zero. The price is resolved from the catalog (cached), then the
// default table, then the ultimate fallback — never erroring on an unknown
// model, so a pricing gap never blocks the /llm response path.
//
// If a catalog price is so large that the multiplication overflows int64 after
// the per-1M divide (indicating a corrupt DB row), Cost falls back to the
// default price for the model and logs a warning rather than returning a
// silently wrong value.
func (c *Calculator) Cost(ctx context.Context, provider, model string, inputTokens, outputTokens int64) Cost {
	price := c.Price(ctx, provider, model)
	in, inOK := costNano(inputTokens, price.InputNanoPer1M)
	out, outOK := costNano(outputTokens, price.OutputNanoPer1M)
	if !inOK || !outOK {
		// The catalog price is pathologically large (corrupt DB row): fall back
		// to the default price so the /llm path is never blocked or mis-billed.
		c.logger.WarnContext(ctx, "cost: price overflows int64 after divide; falling back to default price",
			"provider", provider, "model", model,
			"input_nano_per_1m", price.InputNanoPer1M,
			"output_nano_per_1m", price.OutputNanoPer1M,
		)
		price = defaultPrice(model)
		in, _ = costNano(inputTokens, price.InputNanoPer1M)
		out, _ = costNano(outputTokens, price.OutputNanoPer1M)
	}
	return Cost{
		InputNanoUSD:  in,
		OutputNanoUSD: out,
		TotalNanoUSD:  in + out,
		Source:        price.Source,
	}
}

// Price resolves the per-1M nano-USD price for (provider, model). It checks the
// TTL cache, then the catalog, then the default table. It never returns an
// error: an unknown model resolves to the ultimate fallback price.
func (c *Calculator) Price(ctx context.Context, provider, model string) Price {
	key := provider + ":" + model

	c.mu.RLock()
	if ent, ok := c.cache[key]; ok && c.now().Before(ent.expires) {
		c.mu.RUnlock()
		return ent.price
	}
	c.mu.RUnlock()

	price, ok := c.lookupCatalog(ctx, provider, model)
	if !ok {
		// Not in the catalog (or a NULL/absent input price, or a DB error):
		// fall back to the pylon default table, exactly as the legacy path does.
		price = defaultPrice(model)
	}

	c.mu.Lock()
	c.cache[key] = cacheEntry{price: price, expires: c.now().Add(c.ttl)}
	c.mu.Unlock()

	return price
}

// lookupCatalog reads (provider, model) from gateway_models. ok is false when
// there is no DB, the row is absent, the input price is NULL, or the query
// errors — in every such case the caller falls back to the default table (this
// mirrors pylon, which uses the DB row only when input_cost_per_1m_tokens is not
// None and otherwise drops to its default table).
func (c *Calculator) lookupCatalog(ctx context.Context, provider, model string) (Price, bool) {
	if c.db == nil {
		return Price{}, false
	}

	var inputNano, outputNano *int64
	err := c.db.QueryRow(ctx, modelPriceSQL, provider, model, NanoUSD).Scan(&inputNano, &outputNano)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			c.logger.Warn("cost: catalog price lookup failed; using defaults",
				"provider", provider, "model", model, "err", err)
		}
		return Price{}, false
	}
	if inputNano == nil {
		// Row exists but has no usable input price — treat as uncatalogued.
		return Price{}, false
	}

	out := int64(0)
	if outputNano != nil {
		out = *outputNano
	} else {
		// pylon default when output price is absent: input * 3.
		out = *inputNano * 3
	}
	return Price{InputNanoPer1M: *inputNano, OutputNanoPer1M: out, Source: "catalog"}, true
}

// costNano returns round( tokens * priceNanoPer1M / TokensPer1M ) in nano-USD
// and whether the result fits in int64. ok is false only when priceNanoPer1M is
// so extreme that the final quotient does not fit in int64, which indicates a
// corrupt DB row; the caller must fall back to a safe default in that case.
// The multiply uses math/big so a large token count cannot overflow int64 before
// the divide; rounding is half-up (both operands are non-negative).
func costNano(tokens, priceNanoPer1M int64) (int64, bool) {
	if tokens <= 0 || priceNanoPer1M <= 0 {
		return 0, true
	}
	prod := new(big.Int).Mul(big.NewInt(tokens), big.NewInt(priceNanoPer1M))
	// Round half-up: (prod + TokensPer1M/2) / TokensPer1M.
	prod.Add(prod, big.NewInt(TokensPer1M/2))
	prod.Quo(prod, big.NewInt(TokensPer1M))
	if !prod.IsInt64() {
		return 0, false
	}
	return prod.Int64(), true
}
