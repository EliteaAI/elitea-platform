package main

// governance_status.go — GET /governance/status.
//
// An operator authors a governance definition in the admin UI and then has to
// answer one question: is the gateway enforcing it? Before this route the only
// answer was a log line on whichever pod happened to load the row, which is
// unavailable the moment that pod is replaced.
//
// The route reports what the gateway HOLDS, not what the table contains — the
// admin surface can already read the table. The difference between the two is
// the whole point: a row that was rejected, a row that is inert, and a snapshot
// that is stale because refreshes are failing are each invisible from the
// authoring side.
//
// It sits on the same internal listener as /metrics and /readyz. That listener
// is a ClusterIP Service behind mutual TLS and the edge proxies only /llm, so
// this is reachable from inside the cluster and not from a tenant. It carries
// no secret material: row ids, names, types and reasons only.

import (
	"encoding/json"
	"net/http"

	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/policy"
)

// governanceStatusBody is the response shape.
type governanceStatusBody struct {
	// Enabled is false when this gateway reads no definitions at all — no
	// database pool. Every other field is then empty, and an operator reading
	// "enabled": false knows the answer without interpreting a zero count.
	Enabled bool `json:"enabled"`
	// RateLimitsEnforceable is false when the gateway has no NATS counter. An
	// authored rate limit then loads and does nothing, and this is the only
	// place that says so.
	RateLimitsEnforceable bool               `json:"rate_limits_enforceable"`
	Store                 policy.Status      `json:"store"`
	Definitions           policy.Diagnostics `json:"definitions"`
	RateLimiter           *rateLimiterCounts `json:"rate_limiter,omitempty"`
}

// rateLimiterCounts reports how often the limiter refused and how often it
// could not enforce. Degraded is the number that matters: it is the count of
// requests admitted WITHOUT their authored ceiling applied, because the counter
// was unreachable. A non-zero value there means the limits are not being kept.
type rateLimiterCounts struct {
	Refused  int64 `json:"refused"`
	Degraded int64 `json:"degraded"`
}

// makeGovernanceStatusHandler builds the route. A nil store reports disabled
// rather than erroring: a gateway without a database is a supported posture,
// not a fault.
func makeGovernanceStatusHandler(store *policy.Store, limiter *policy.Limiter) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body := governanceStatusBody{
			Enabled:               store != nil,
			RateLimitsEnforceable: limiter.Enabled(),
		}
		if store != nil {
			body.Store = store.Status()
			body.Definitions = store.Current().Diagnostics()
		} else {
			body.Definitions = policy.Empty.Diagnostics()
		}
		if limiter.Enabled() {
			body.RateLimiter = &rateLimiterCounts{Refused: limiter.Refused(), Degraded: limiter.Degraded()}
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(body)
	}
}
