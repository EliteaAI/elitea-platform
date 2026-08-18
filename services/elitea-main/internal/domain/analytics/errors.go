package analytics

import (
	"errors"
	"fmt"
)

// ErrNoSource marks a figure this platform has no producer for.
//
// It exists so the API layer can tell "the query failed" from "nothing to
// report" from "there is nowhere for this to come from", instead of collapsing
// all three into a zero. Issue #303: the analytics handler discarded its
// repository error and answered 200 with hardcoded zeros, so a project with
// real usage and a query against a table that has never existed rendered the
// same dashboard.
var ErrNoSource = errors.New("analytics: no data source")

// NoSourceError names the figure and why it cannot be sourced. The reason is
// carried in the error rather than logged so it reaches the operator reading
// the response, which is the only place this failure has ever been visible
// from.
func NoSourceError(figure, reason string) error {
	return fmt.Errorf("%w: %s: %s", ErrNoSource, figure, reason)
}
