package pricesync

import (
	"context"
	"errors"
	"log/slog"
	"math"
)

// advisoryLockKey is the pg_try_advisory_xact_lock key that serialises price
// sync across scheduler replicas (design §8.8 multi-replica safety). Distinct
// from the scheduler's Redis tick lock and any app-level advisory lock.
const advisoryLockKey int64 = 0x4c4c4d5052494345 // "LLMPRICE" ascii, arbitrary-but-stable

// driftThreshold is the relative input-price disagreement (fraction) above which
// two sources are considered in conflict and a drift alarm is logged (§8.8).
const driftThreshold = 0.10

// Syncer composes ordered PriceSources, normalises their output to per-1M, merges
// them (first source with a model wins; later sources fill gaps), and UPSERTs the
// result into gateway.gateway_models under a Postgres advisory lock.
type Syncer struct {
	db      DB
	sources []PriceSource
	norm    Normalizer
	logger  *slog.Logger
}

// NewSyncer builds a Syncer. sources are in precedence order (first wins).
func NewSyncer(db DB, sources []PriceSource, logger *slog.Logger) *Syncer {
	if logger == nil {
		logger = slog.Default()
	}
	return &Syncer{db: db, sources: sources, logger: logger}
}

// Sync runs one sync pass:
//  1. Fetch every source (network) BEFORE taking the DB lock, so a partition
//     doesn't hold a connection+lock open; a per-source failure is fail-open
//     (WARN + skip, other sources still apply — §8.8 degradation).
//  2. Merge normalised prices in precedence order with a drift alarm.
//  3. In one transaction: take pg_try_advisory_xact_lock (bail if another
//     replica holds it), UPSERT all rows, commit (which releases the xact lock).
//
// It returns the number of rows upserted. A run where the lock is held by another
// replica returns (0, nil) — a benign no-op, not an error.
func (s *Syncer) Sync(ctx context.Context) (int, error) {
	merged, err := s.collect(ctx)
	if err != nil {
		return 0, err
	}
	if len(merged) == 0 {
		s.logger.Warn("pricesync: no prices resolved from any source; skipping upsert")
		return 0, nil
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return 0, err
	}
	// Rollback is a no-op after a successful Commit; safe to always defer.
	defer func() { _ = tx.Rollback(ctx) }()

	var locked bool
	if err := tx.QueryRow(ctx, `SELECT pg_try_advisory_xact_lock($1)`, advisoryLockKey).Scan(&locked); err != nil {
		return 0, err
	}
	if !locked {
		s.logger.Info("pricesync: advisory lock held by another replica; skipping this pass")
		return 0, nil
	}

	for _, m := range merged {
		if err := s.upsert(ctx, tx, m); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	s.logger.Info("pricesync: catalog upserted", "models", len(merged))
	return len(merged), nil
}

// collect fetches and normalises every source, then merges by precedence.
func (s *Syncer) collect(ctx context.Context) ([]NormalizedModelPrice, error) {
	if len(s.sources) == 0 {
		return nil, errors.New("pricesync: no sources configured")
	}

	// merged holds the winning row per key; order preserves first-seen for a
	// deterministic UPSERT order.
	merged := map[string]NormalizedModelPrice{}
	var order []string
	// seenInput tracks the winning input price per key for the drift alarm.
	seenInput := map[string]float64{}
	var anySucceeded bool

	for _, src := range s.sources {
		raws, err := src.Fetch(ctx)
		if err != nil {
			// Fail-open: log and skip this source; keep serving other sources.
			s.logger.Warn("pricesync: source fetch failed; skipping", "source", src.Name(), "err", err)
			continue
		}
		anySucceeded = true
		for _, raw := range raws {
			n, err := s.norm.Normalize(raw, src.Denomination(), src.Name())
			if err != nil {
				s.logger.Warn("pricesync: normalize failed; skipping model",
					"source", src.Name(), "provider", raw.Provider, "model", raw.ModelName, "err", err)
				continue
			}
			k := n.key()
			if _, exists := merged[k]; !exists {
				// First source with this model wins.
				merged[k] = n
				order = append(order, k)
				if n.InputCostPer1M != nil {
					seenInput[k] = *n.InputCostPer1M
				}
				continue
			}
			// Later source: does not override, but flag price drift for audit.
			if n.InputCostPer1M != nil {
				if prev, ok := seenInput[k]; ok && priceDrifts(prev, *n.InputCostPer1M) {
					s.logger.Warn("pricesync: price drift between sources",
						"provider", n.Provider, "model", n.ModelName,
						"winning_input_per_1m", prev, "other_source", src.Name(),
						"other_input_per_1m", *n.InputCostPer1M)
				}
			}
		}
	}

	if !anySucceeded {
		return nil, errors.New("pricesync: all sources failed to fetch")
	}

	out := make([]NormalizedModelPrice, 0, len(order))
	for _, k := range order {
		out = append(out, merged[k])
	}
	return out, nil
}

// priceDrifts reports whether two prices disagree by more than driftThreshold
// (relative). Two exact zeros never drift; a zero-vs-nonzero always drifts.
func priceDrifts(a, b float64) bool {
	if a == b {
		return false
	}
	denom := math.Max(math.Abs(a), math.Abs(b))
	if denom == 0 {
		return false
	}
	return math.Abs(a-b)/denom > driftThreshold
}

// upsert writes one normalised row into gateway.gateway_models. The write is
// per-1M (matching the column denomination) and records source provenance.
func (s *Syncer) upsert(ctx context.Context, tx Tx, m NormalizedModelPrice) error {
	const q = `
		INSERT INTO gateway.gateway_models (
			provider, model_name,
			input_cost_per_1m_tokens, output_cost_per_1m_tokens,
			cache_creation_input_token_cost, cache_read_input_token_cost,
			input_cost_per_1m_tokens_above_128k,
			source, source_synced_at, last_sync_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now(), now())
		ON CONFLICT (provider, model_name) DO UPDATE SET
			input_cost_per_1m_tokens            = EXCLUDED.input_cost_per_1m_tokens,
			output_cost_per_1m_tokens           = EXCLUDED.output_cost_per_1m_tokens,
			cache_creation_input_token_cost     = EXCLUDED.cache_creation_input_token_cost,
			cache_read_input_token_cost         = EXCLUDED.cache_read_input_token_cost,
			input_cost_per_1m_tokens_above_128k = EXCLUDED.input_cost_per_1m_tokens_above_128k,
			source                              = EXCLUDED.source,
			source_synced_at                    = EXCLUDED.source_synced_at,
			last_sync_at                        = EXCLUDED.last_sync_at,
			updated_at                          = now()`
	return tx.Exec(ctx, q,
		m.Provider, m.ModelName,
		m.InputCostPer1M, m.OutputCostPer1M,
		m.CacheCreationPer1M, m.CacheReadPer1M,
		m.InputCostAbove128k,
		m.Source,
	)
}
