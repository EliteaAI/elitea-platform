// schema_probe.go — the catalog price SELECT degrades on its own when the
// database is OLDER than the binary that reads it.
//
// WHY THIS FILE EXISTS. modelPriceSQL names the four audio price columns that
// migration 0086 adds. A gateway pod that rolls out ahead of elitea-migrate —
// the normal skew of a rolling deploy — asks a database where those columns do
// not exist yet, and Postgres answers 42703 (undefined_column) for EVERY model,
// not only for an audio one. lookupCatalog reads any non-ErrNoRows error as
// "uncatalogued", so without this file every request in the skew window would
// quietly take the DEFAULT price table instead of its catalog price: a
// catalog-WIDE mis-bill whose only signal is one WARN per model per cache TTL.
//
// The rule this restores: a column added by a later migration may cost the
// gateway the AUDIO bases and must never cost it token pricing. On 42703 the
// calculator latches, re-reads the SAME row with the pre-0086 two-column
// statement, and keeps billing tokens from the catalog. Only the audio rates go
// missing, so an audio request is UNPRICED and counted — the behaviour a model
// with no catalog rate already has.
//
// WHY A LATCH WITH AN EXPIRY, and not a one-time probe. A latch that never
// lifted would keep every audio request unpriced until an operator restarted
// the pods, long after elitea-migrate landed, and would leave the gauge stuck
// at 1 with nothing wrong. A probe repeated on every lookup would pay a refused
// query per model per cache miss. The latch expires after schemaProbeInterval,
// so the recovery costs at most one refused query per interval for the whole
// process, and the gateway heals itself.
package cost

import (
	"errors"
	"expvar"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

// MetricPriceCatalogSchemaBehind reports that this gateway reads a
// gateway_models table older than its own code: the migration-0086 audio price
// columns are not there.
//
// It is a GAUGE because the condition is a state and not an event. The skew
// lasts as long as the deploy takes, and an operator needs to know it is
// happening NOW, once for the process — not once per model per cache TTL, which
// is all the per-lookup WARN could ever give. 1 means the catalog read is
// degraded right now: token prices still come from the catalog and every audio
// request is UNPRICED. 0 means the columns are readable.
const MetricPriceCatalogSchemaBehind = "gateway_price_catalog_schema_behind"

// MetricPriceCatalogSchemaBehindTotal counts the catalog reads Postgres refused
// with 42703 because those columns are missing.
//
// The gauge answers "is it happening now"; this answers "did it happen at all,
// and how often". A pod that heals before anyone looks leaves the gauge at 0
// and this counter above zero, which is the only evidence the window existed.
const MetricPriceCatalogSchemaBehindTotal = "gateway_price_catalog_schema_behind_total"

var (
	catalogSchemaBehind      = expvar.NewInt(MetricPriceCatalogSchemaBehind)
	catalogSchemaBehindTotal = expvar.NewInt(MetricPriceCatalogSchemaBehindTotal)
)

// Metric describes one variable this package publishes to /metrics.
//
// The KIND travels with the NAME on purpose. The other packages here export
// []string and let the composition root guess the type in a switch; this pair
// is a gauge and a counter, and a gauge scraped as a counter is a lie an alarm
// acts on. Nothing outside this package has to know which is which.
type Metric struct {
	Name string
	Kind string // "gauge" or "counter"
	Help string
}

// Metrics returns the variables this package publishes, in a fixed order, for
// the composition root's /metrics allowlist.
//
// An expvar variable that is not on that allowlist has NO route on this
// process's mux: expvar registers /debug/vars on http.DefaultServeMux, which
// this gateway never serves (issue #465). Add a variable here when you publish
// one.
func Metrics() []Metric {
	return []Metric{{
		Name: MetricPriceCatalogSchemaBehind,
		Kind: "gauge",
		Help: "1 when the model catalog is missing the audio price columns (migration 0086 not applied). Token prices still come from the catalog; every audio request is unpriced.",
	}, {
		Name: MetricPriceCatalogSchemaBehindTotal,
		Kind: "counter",
		Help: "Count of catalog price reads Postgres refused because the audio price columns do not exist.",
	}}
}

// schemaProbeInterval is how long the calculator keeps using the pre-0086
// statement before it tries the widened one again. It bounds the cost of
// recovery at one refused query per interval for the whole process, and bounds
// how long audio stays unpriced after elitea-migrate finally runs.
const schemaProbeInterval = 5 * time.Minute

// undefinedColumnCode is the Postgres SQLSTATE for "column does not exist". It
// is the ONE error that means "the database is older than this binary" rather
// than "this row is not there" or "the database is unreachable", and it is the
// only one that may downgrade the statement.
const undefinedColumnCode = "42703"

// isUndefinedColumn reports whether err is Postgres 42703.
func isUndefinedColumn(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == undefinedColumnCode
}

// audioColumnsReadable reports whether the widened SELECT may be attempted:
// either it has never failed, or the latch has expired and it is time to probe
// the schema again.
func (c *Calculator) audioColumnsReadable() bool {
	until := c.schemaBehindUntil.Load()
	return until == 0 || !c.now().Before(time.Unix(0, until))
}

// latchSchemaBehind records a 42703 from the widened SELECT: stop attempting it
// until the probe interval elapses, and say so ONCE, loudly, for the whole
// catalog.
//
// The log level is Error and not Warn because the operator action is a deploy
// step: elitea-migrate has not run. The message names the migration so nobody
// has to correlate an SQLSTATE with a schema version at 3am.
func (c *Calculator) latchSchemaBehind(err error) {
	c.schemaBehindUntil.Store(c.now().Add(schemaProbeInterval).UnixNano())
	catalogSchemaBehind.Set(1)
	catalogSchemaBehindTotal.Add(1)
	c.logger.Error("cost: the model catalog has no audio price columns; migration 0086 has not run against this database. Token prices still come from the catalog. Every audio request is UNPRICED until it does.",
		"err", err,
		"retry_after", schemaProbeInterval.String(),
		"metric", MetricPriceCatalogSchemaBehind,
	)
}

// clearSchemaBehind un-latches after a widened SELECT succeeds. It is a no-op
// when nothing was latched, so the recovery line is written once and not on
// every lookup.
func (c *Calculator) clearSchemaBehind() {
	if c.schemaBehindUntil.Swap(0) == 0 {
		return
	}
	catalogSchemaBehind.Set(0)
	c.logger.Info("cost: the model catalog now carries the audio price columns; catalog audio pricing is live again",
		"metric", MetricPriceCatalogSchemaBehind)
}
