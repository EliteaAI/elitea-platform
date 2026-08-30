// Package overhead carries the gateway's own per-request cost measurement
// across the bifrost router boundary.
//
// The BFF.9d gate (design §10.2) reads the X-Elapsed-Ms header. That header
// must report the time the gateway adds, and not the time the provider takes.
// Part of the gateway time runs INSIDE the router call: bifrost/core resolves
// the caller's provider credential through
// account.EliteaAccount.GetKeysForProvider, which reads Postgres and decrypts
// the Fernet vault. A handler that stops its clock before the router call
// cannot see that work, so the metric understated the overhead (issue #17).
//
// bifrost/core gives the caller's own *schemas.BifrostContext to
// GetKeysForProvider. The /llm handler therefore puts a Meter on that context
// before dispatch, the account marks the Meter from inside the router, and the
// handler reads the Meter back after the router returns.
//
// bifrost v1.7.3 gives no seam around the provider round-trip
// (ProviderConfig.NetworkConfig takes no RoundTripper), so "overhead = total
// minus provider" stays unavailable. The mark is the boundary instead: core
// dials the provider only after it holds the key.
package overhead

import (
	"context"
	"sync/atomic"
	"time"
)

// meterKey is the context key for the Meter. The type is unexported, so no
// other package can collide with it or replace the value.
type meterKey struct{}

// ValueSetter is the write half of *schemas.BifrostContext. The package takes
// this small interface, and not the concrete type, to stay free of a bifrost
// import.
type ValueSetter interface {
	SetValue(key, value any)
}

// Meter records when the router completed the per-request credential
// resolution.
//
// bifrost/core can call GetKeysForProvider more than one time for one request,
// and it can call it from more than one goroutine (fallback providers, retries
// after a dead key). Meter is therefore safe for concurrent use.
//
// Meter keeps the EARLIEST mark. A later mark comes from a retry or a fallback,
// which runs AFTER a provider round-trip; that round-trip is the one cost the
// metric must not contain.
type Meter struct {
	// start is the instant the handler accepted the request. New writes it
	// before the Meter reaches any other goroutine, and nothing writes it
	// again.
	start time.Time
	// resolvedNanos holds the earliest mark, as nanoseconds after start. Zero
	// means "no mark". A mark records 1 ns at minimum, so zero stays free.
	resolvedNanos atomic.Int64
}

// New returns a Meter for a request that started at start.
func New(start time.Time) *Meter { return &Meter{start: start} }

// Attach creates a Meter for a request that started at start, puts it on ctx,
// and returns it. Call it before dispatch: the account reads the Meter off the
// context from inside the router call.
func Attach(ctx ValueSetter, start time.Time) *Meter {
	m := New(start)
	if ctx != nil {
		ctx.SetValue(meterKey{}, m)
	}
	return m
}

// FromContext returns the Meter on ctx, or nil when the context carries none.
// Every Meter method accepts a nil receiver, so a caller does not test the
// result.
func FromContext(ctx context.Context) *Meter {
	if ctx == nil {
		return nil
	}
	m, _ := ctx.Value(meterKey{}).(*Meter)
	return m
}

// MarkCredentialsResolved records that credential resolution completed now.
// Call it from any goroutine. Only the earliest mark of a request counts.
func (m *Meter) MarkCredentialsResolved() {
	if m == nil {
		return
	}
	// start carries a monotonic reading, so elapsed cannot go backwards. The
	// clamp keeps zero as the "no mark" value for a resolution that completed
	// in less than one nanosecond.
	elapsed := int64(time.Since(m.start))
	if elapsed < 1 {
		elapsed = 1
	}
	for {
		current := m.resolvedNanos.Load()
		if current != 0 && current <= elapsed {
			return
		}
		if m.resolvedNanos.CompareAndSwap(current, elapsed) {
			return
		}
	}
}

// Overhead returns the gateway overhead to report for the request.
//
// preDispatch is the time the handler measured before it called the router.
// That value is the answer when no mark landed. A request resolves no
// credential when the caller supplied a direct key, when a plugin
// short-circuited the call, or when the request failed before core reached the
// provider worker.
//
// With a mark, the answer is the time from the start of the request to the end
// of credential resolution. It counts the body decode, the identity check, the
// loop breaker, the budget check, the wait in the core provider queue, core
// routing and the credential read itself. It stops before the provider
// round-trip, because core dials the provider only after it holds the key.
func (m *Meter) Overhead(preDispatch time.Duration) time.Duration {
	if m == nil {
		return preDispatch
	}
	resolved := time.Duration(m.resolvedNanos.Load())
	if resolved <= 0 {
		return preDispatch
	}
	if resolved < preDispatch {
		// Both values measure the same request from the same start, so the mark
		// cannot precede the pre-dispatch snapshot. Report the larger value
		// anyway: this metric must never understate the overhead.
		return preDispatch
	}
	return resolved
}
