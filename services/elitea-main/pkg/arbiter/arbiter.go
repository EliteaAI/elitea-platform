// Package arbiter is a placeholder for the request arbitration / routing logic
// that determines which backend handles a given inference request.
// TODO: implement arbiter routing rules.
package arbiter

// Arbiter routes inference requests to the appropriate backend.
type Arbiter struct{}

// New creates a new placeholder Arbiter.
func New() *Arbiter {
	return &Arbiter{}
}
