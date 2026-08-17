package llmproxy

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// ── NewStaticModelResolver ────────────────────────────────────────────────────
//
// Exported for test-support packages (e.g. internal/preflight) that need to
// inject a fixed model set without a live database.  Mirrors the precedent of
// SignIdentityHeaders being exported for the same reason (identity.go §86).
//
// modelRowQuerier and modelRows are unexported interfaces so this constructor
// must live inside package llmproxy; external packages consume it via the
// exported *ModelResolver return type.

// staticModelQuerier is a modelRowQuerier that always returns a fixed set of
// rows regardless of the SQL text or arguments.  All model ids are represented
// as elitea_title values so the resolver uses them directly as the model id
// (modelNames prefers title over data.name when non-empty).
type staticModelQuerier struct {
	rows []staticModelRow
}

type staticModelRow struct {
	title string
}

// staticModelRowsIter iterates a slice of staticModelRow as modelRows.
type staticModelRowsIter struct {
	rows []staticModelRow
	i    int
}

func (it *staticModelRowsIter) Next() bool {
	if it.i >= len(it.rows) {
		return false
	}
	it.i++
	return true
}

// Scan fills (title string, data []byte, shared bool) — the column order
// queryScope() expects. The data JSONB column is set to nil: because title is
// always non-empty here, modelNames returns it as the id, and the provider
// model name falls back to that same title (issue #317). shared is true so the
// rows stay usable if a caller configures this static resolver with a public
// project scope.
func (it *staticModelRowsIter) Scan(dest ...any) error {
	if len(dest) != 3 {
		return fmt.Errorf("staticModelRowsIter: expected 3 scan destinations, got %d", len(dest))
	}
	row := it.rows[it.i-1]
	*dest[0].(*string) = row.title
	*dest[1].(*[]byte) = nil // title is non-empty; data not needed
	*dest[2].(*bool) = true
	return nil
}

func (it *staticModelRowsIter) Err() error { return nil }
func (it *staticModelRowsIter) Close()     {}

// compile-time assertions.
var _ modelRows = (*staticModelRowsIter)(nil)

// Query ignores the schema name but NOT the statement. The resolver issues two
// different statements with two different column shapes: the model read that
// staticModelRowsIter serves, and the credential read of issue #451. Answering
// the credential read with model rows would fail on the scan arity, so it
// yields no credentials — a static model set links to nothing and keeps taking
// its provider from the model-name prefix.
func (q *staticModelQuerier) Query(_ context.Context, sql string, _ ...any) (modelRows, error) {
	if strings.Contains(sql, credentialSection) {
		return &staticModelRowsIter{}, nil
	}
	return &staticModelRowsIter{rows: q.rows}, nil
}

var _ modelRowQuerier = (*staticModelQuerier)(nil)

// NewStaticModelResolver returns a ModelResolver backed by an in-memory fake
// that returns ids for any valid numeric project id.  The fake DB ignores the
// SQL query text (including the per-project schema name p_{projectID}) and
// always returns the same set of rows, so a single resolver serves all test
// projects.  The TTL is set to 24 h so test calls never trigger a re-query.
//
// Exported for test-support packages (e.g. internal/preflight) that need to
// inject a fixed model set without a live database.
func NewStaticModelResolver(ids []string) *ModelResolver {
	rows := make([]staticModelRow, len(ids))
	for i, id := range ids {
		rows[i] = staticModelRow{title: id}
	}
	return NewModelResolver(ModelResolverConfig{
		DB:       &staticModelQuerier{rows: rows},
		CacheTTL: 24 * time.Hour,
	})
}
