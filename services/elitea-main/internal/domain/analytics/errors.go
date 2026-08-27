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

// ErrBadProject marks a project id the caller sent that cannot name a project.
//
// It exists for the reason ErrNoSource does: the API layer has to tell the
// three cases apart. This one is the CALLER's mistake, so it answers 400 —
// where a "failed to query analytics" 500 would blame the server for a value it
// was handed, and invite a retry that cannot succeed. /analytics_costs already
// answers 400 for the same input; without this its neighbours could not.
var ErrBadProject = errors.New("analytics: invalid project id")

// BadProjectError names the offending value.
func BadProjectError(raw string) error {
	return fmt.Errorf("%w: %q is not a positive integer", ErrBadProject, raw)
}

// NoSourceError names the figure and why it cannot be sourced. The reason is
// carried in the error rather than logged so it reaches the operator reading
// the response, which is the only place this failure has ever been visible
// from.
func NoSourceError(figure, reason string) error {
	return fmt.Errorf("%w: %s: %s", ErrNoSource, figure, reason)
}
