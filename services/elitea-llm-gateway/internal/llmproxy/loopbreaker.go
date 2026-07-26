package llmproxy

import (
	"sync"
	"time"
)

// Circular-routing guard #2 (spec §2.6): a per-(project_id, model) circuit
// breaker on the /llm handler. If >= loopBreakerThreshold requests for the same
// (project_id, model) tuple arrive within loopBreakerWindow, the circuit opens
// and the handler returns HTTP 429 (rate_limit_error / rate_limit_exceeded) for
// loopBreakerOpenFor, containing a runtime routing loop when the
// SELF_REFERENTIAL_CREDENTIAL guard (spec §2.6 guard #1, internal/account) is
// bypassed — e.g. a credential whose api_base points back at the platform /llm
// origin via a redirecting intermediary the upsert-time normalisation cannot see.
//
// The breaker is deliberately per-replica in-process state: a routing loop
// multiplies request volume on whichever replica it transits, so a local
// counter trips regardless of cluster-wide coordination, and the scale-1
// profile (LLM_BUDGET_EXPECTED_REPLICAS=1) makes local == global. The numbers
// are fixed by spec §2.6, not configurable — a knob would invite weakening the
// guard (see CLAUDE.md enforcement-policy rules).
const (
	// loopBreakerThreshold is the request count within loopBreakerWindow at
	// which the circuit opens ("≥ 5 requests ... within 1 second").
	loopBreakerThreshold = 5
	// loopBreakerWindow is the sliding observation window.
	loopBreakerWindow = time.Second
	// loopBreakerOpenFor is how long an opened circuit keeps returning 429.
	loopBreakerOpenFor = 30 * time.Second

	// loopBreakerMaxTuples bounds BOTH tracking maps (hits and openUntil) so an
	// attacker cycling model names cannot grow memory without bound. When a cap
	// is reached, pruneLocked drops stale tuples first; if every tuple is live
	// the newest request is still tracked by evicting nothing and admitting (the
	// guard degrades to inactive for brand-new tuples rather than blocking
	// honest traffic on a full table).
	loopBreakerMaxTuples = 65536
)

// loopBreaker tracks request timestamps per (project_id, model) tuple.
// Zero-value is NOT usable; construct with newLoopBreaker.
type loopBreaker struct {
	mu sync.Mutex
	// hits holds the timestamps (mono ns) of requests inside the current
	// window for each tuple.
	hits map[string][]int64
	// openUntil holds the mono-ns instant until which the tuple's circuit
	// stays open. Absent = closed.
	openUntil map[string]int64
	// now is injectable for tests; defaults to time.Now.
	now func() time.Time
}

func newLoopBreaker() *loopBreaker {
	return &loopBreaker{
		hits:      make(map[string][]int64),
		openUntil: make(map[string]int64),
		now:       time.Now,
	}
}

// loopKey builds the tuple key. model already includes the provider prefix
// ("openai/gpt-4o") as it appears on the wire, so provider is not a separate
// dimension.
func loopKey(projectID, model string) string {
	return projectID + "\x00" + model
}

// allow records one request for the tuple and reports whether it may proceed.
// It returns (false, retryAfter) while the tuple's circuit is open.
func (b *loopBreaker) allow(projectID, model string) (bool, time.Duration) {
	key := loopKey(projectID, model)
	nowNS := b.now().UnixNano()

	b.mu.Lock()
	defer b.mu.Unlock()

	// Open circuit: reject until openUntil passes.
	if until, ok := b.openUntil[key]; ok {
		if nowNS < until {
			return false, time.Duration(until-nowNS) * time.Nanosecond
		}
		// Cooldown elapsed — close the circuit and fall through to counting.
		delete(b.openUntil, key)
		delete(b.hits, key)
	}

	// Slide the window: keep only hits inside [now-window, now].
	cutoff := nowNS - loopBreakerWindow.Nanoseconds()
	kept := b.hits[key][:0]
	for _, ts := range b.hits[key] {
		if ts > cutoff {
			kept = append(kept, ts)
		}
	}
	kept = append(kept, nowNS)

	if len(kept) >= loopBreakerThreshold {
		// Trip: open for loopBreakerOpenFor. The tripping request itself is
		// rejected — a loop's 5th request is already abusive traffic.
		delete(b.hits, key)
		// openUntil is the map that survives the trip (hits is dropped), so it
		// is the one an attacker cycling model names would grow. Cap it exactly
		// like hits: reclaim elapsed cooldowns first, and if every circuit is
		// still live, reject without recording rather than leaking an entry.
		// The tuple is then not pinned open for the full 30 s, but each
		// threshold-th request keeps being rejected — the guard degrades to
		// rate limiting, never to unbounded memory.
		if _, open := b.openUntil[key]; !open && len(b.openUntil) >= loopBreakerMaxTuples {
			b.pruneLocked(nowNS)
			if len(b.openUntil) >= loopBreakerMaxTuples {
				return false, loopBreakerOpenFor
			}
		}
		b.openUntil[key] = nowNS + loopBreakerOpenFor.Nanoseconds()
		return false, loopBreakerOpenFor
	}

	if _, tracked := b.hits[key]; !tracked && len(b.hits) >= loopBreakerMaxTuples {
		b.pruneLocked(nowNS)
		if len(b.hits) >= loopBreakerMaxTuples {
			// Table still full of live tuples — admit without tracking rather
			// than blocking honest traffic (see loopBreakerMaxTuples doc).
			return true, 0
		}
	}
	b.hits[key] = kept
	return true, 0
}

// pruneLocked reclaims dead entries from BOTH maps at instant nowNS: hits whose
// newest timestamp has fallen out of the sliding window, and openUntil entries
// whose cooldown has elapsed. Pruning openUntil here is what keeps it bounded —
// the fall-through in allow only reclaims an expired circuit when that exact
// tuple is requested again. Caller holds mu.
func (b *loopBreaker) pruneLocked(nowNS int64) {
	cutoff := nowNS - loopBreakerWindow.Nanoseconds()
	for k, ts := range b.hits {
		if len(ts) == 0 || ts[len(ts)-1] <= cutoff {
			delete(b.hits, k)
		}
	}
	for k, until := range b.openUntil {
		if until <= nowNS {
			delete(b.openUntil, k)
		}
	}
}
