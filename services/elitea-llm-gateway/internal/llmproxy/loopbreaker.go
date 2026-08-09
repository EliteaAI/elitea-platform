package llmproxy

import (
	"sync"
	"time"
)

// A per-(project_id, model) circuit breaker on the /llm handler. If >= its
// threshold requests for the same (project_id, model) tuple arrive within the
// window, the circuit opens and the handler returns HTTP 429 (rate_limit_error
// / rate_limit_exceeded) for the open duration.
//
// The breaker is deliberately per-replica in-process state: it observes only
// the traffic that transits this replica, and the scale-1 profile
// (LLM_BUDGET_EXPECTED_REPLICAS=1) makes local == global.
//
// # What this is, and what it is NOT (issue #12)
//
// It was specified and shipped as "circular-routing guard #2" (spec §2.6), but
// it performs NO hop detection whatsoever: it counts requests. At the shipped
// 5-per-second it was a hardcoded rate limiter armed in production — a 50-VU
// k6 run against one tuple measured 99.96% HTTP 429, i.e. the breaker, not the
// gateway, was what an overhead gate was measuring. It is an availability
// defect wearing a security control's name.
//
// Worse, no rate threshold can separate a routing loop from legitimate traffic
// here, because BOTH are bounded by the same per-replica provider worker pool
// (GATEWAY_PROVIDER_CONCURRENCY): a threshold low enough to catch the canonical
// loop is low enough to trip ordinary bursty traffic, and one high enough not
// to trip ordinary traffic can never fire on the canonical loop. The actual
// anti-circular-routing mechanism is hop-marker detection — a header the
// gateway sets and recognises — which is tracked as a follow-up.
//
// Until that lands, this layer is treated as what it measurably is: an
// AMPLIFICATION BACKSTOP against request volume no replica could ever serve,
// with operator-settable numbers. See DefaultLoopBreakerThreshold for the
// derivation of the default.
const (
	// DefaultLoopBreakerThreshold is the request count within the window at
	// which the circuit opens (LLM_LOOP_BREAKER_THRESHOLD).
	//
	// Derivation. A single replica's sustained throughput for one
	// (project, model) tuple is bounded by its provider worker pool divided by
	// per-call latency. With the tuned default pool of 50
	// (GATEWAY_PROVIDER_CONCURRENCY) and the FASTEST realistic call class —
	// embeddings at ~50 ms — that ceiling is 50 / 0.05 = 1000 req/s. Arrivals
	// sustained above it are being generated faster than this replica could
	// ever complete them, whatever the cause; arrivals below it are traffic the
	// gateway could have served, so rejecting them is pure availability loss.
	// 1000 is therefore the highest threshold that still means something and
	// the lowest that does not punish legitimate load.
	//
	// Worst case permitted: 1000 req/s per tuple per replica × replicas,
	// sustained. That is ~200× the old 5 req/s — deliberately, because the old
	// number's containment was illusory (it could not distinguish a loop) while
	// its false positives were real and measured.
	//
	// 0 disables the breaker entirely; main() logs the disarmed state loudly.
	DefaultLoopBreakerThreshold = 1000
	// DefaultLoopBreakerWindow is the sliding observation window
	// (LLM_LOOP_BREAKER_WINDOW_MS).
	DefaultLoopBreakerWindow = time.Second
	// DefaultLoopBreakerOpenFor is how long an opened circuit keeps returning
	// 429 (LLM_LOOP_BREAKER_OPEN_SEC). Reduced from the shipped 30 s: a 30 s
	// lockout on a false positive is a small outage for that tuple, and 5 s is
	// already long enough to shed the burst that opened it.
	DefaultLoopBreakerOpenFor = 5 * time.Second
)

const (
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
	// threshold / window / openFor are the operator-settable numbers
	// (issue #12). They are per-instance rather than package constants so a
	// deployment can tune them without a rebuild, and so tests can pin them.
	threshold int
	window    time.Duration
	openFor   time.Duration

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

// LoopBreakerParams are the operator-settable breaker numbers (issue #12).
// A zero or negative field falls back to its Default* value; Threshold is the
// one exception — an explicit 0 DISABLES the breaker, which newLoopBreaker
// signals by returning nil.
type LoopBreakerParams struct {
	Threshold int
	Window    time.Duration
	OpenFor   time.Duration
}

// newLoopBreaker constructs a breaker from p, filling any unset field with its
// Default* value. Whether the breaker is armed AT ALL is decided one level up,
// in WithLoopBreakerParams — so that a disarmed deployment is a logged startup
// decision rather than an invisible property of a nil pointer.
func newLoopBreaker(p LoopBreakerParams) *loopBreaker {
	if p.Threshold <= 0 {
		p.Threshold = DefaultLoopBreakerThreshold
	}
	if p.Window <= 0 {
		p.Window = DefaultLoopBreakerWindow
	}
	if p.OpenFor <= 0 {
		p.OpenFor = DefaultLoopBreakerOpenFor
	}
	return &loopBreaker{
		threshold: p.Threshold,
		window:    p.Window,
		openFor:   p.OpenFor,
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
	cutoff := nowNS - b.window.Nanoseconds()
	kept := b.hits[key][:0]
	for _, ts := range b.hits[key] {
		if ts > cutoff {
			kept = append(kept, ts)
		}
	}
	kept = append(kept, nowNS)

	if len(kept) >= b.threshold {
		// Trip: open for b.openFor. The tripping request itself is rejected —
		// at the threshold, arrivals already exceed what this replica can serve.
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
				return false, b.openFor
			}
		}
		b.openUntil[key] = nowNS + b.openFor.Nanoseconds()
		return false, b.openFor
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
	cutoff := nowNS - b.window.Nanoseconds()
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
