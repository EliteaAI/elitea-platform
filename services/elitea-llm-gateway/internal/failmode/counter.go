package failmode

import (
	"sync"
	"sync/atomic"
)

// DegradedCounters tracks, per budget scope, the nano-USD this replica has
// billed while NATS is down (design §8.5). It bounds per-replica overspend
// during the breaker-open window and is reset to zero — per scope — on the
// breaker→CLOSED transition, after the NATS replay is confirmed, so the cap
// keeps gating until the authoritative counter is current. It otherwise resets
// only on pod restart.
//
// It is safe for concurrent use: the request path calls Add/Get; the recovery
// goroutine calls Reset.
type DegradedCounters struct {
	mu sync.RWMutex
	// vals maps a scope key (BudgetSubject-style scope.scope_id.period) to the
	// replica-local billed total. A *atomic.Int64 per key lets the hot path
	// Add without holding the map write lock once the key exists.
	vals map[string]*atomic.Int64
}

// NewDegradedCounters constructs an empty counter set.
func NewDegradedCounters() *DegradedCounters {
	return &DegradedCounters{vals: make(map[string]*atomic.Int64)}
}

// counterFor returns the atomic counter for key, creating it on first use.
func (d *DegradedCounters) counterFor(key string) *atomic.Int64 {
	d.mu.RLock()
	c := d.vals[key]
	d.mu.RUnlock()
	if c != nil {
		return c
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if c = d.vals[key]; c != nil { // re-check under the write lock
		return c
	}
	c = &atomic.Int64{}
	d.vals[key] = c
	return c
}

// Add records deltaNano billed against key while degraded and returns the new
// replica-local total. deltaNano is nano-USD (may be negative for a correction).
func (d *DegradedCounters) Add(key string, deltaNano int64) int64 {
	return d.counterFor(key).Add(deltaNano)
}

// Get returns this replica's degraded-window total for key (0 if never billed).
func (d *DegradedCounters) Get(key string) int64 {
	d.mu.RLock()
	c := d.vals[key]
	d.mu.RUnlock()
	if c == nil {
		return 0
	}
	return c.Load()
}

// Reset zeroes the degraded counter for key. Called on the breaker→CLOSED
// transition after the NATS replay for that scope is confirmed (§8.5). Resetting
// before the replay would let the now-healthy counter under-count; resetting
// per-request would defeat the cap.
func (d *DegradedCounters) Reset(key string) {
	d.mu.RLock()
	c := d.vals[key]
	d.mu.RUnlock()
	if c != nil {
		c.Store(0)
	}
}

// ResetAll zeroes every scope counter. Used when the breaker closes and the
// recovery pass has reconciled all outstanding outage rows for this replica.
func (d *DegradedCounters) ResetAll() {
	d.mu.RLock()
	defer d.mu.RUnlock()
	for _, c := range d.vals {
		c.Store(0)
	}
}
