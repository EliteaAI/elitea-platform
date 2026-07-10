package cutover

import (
	"crypto/rand"
	"math/big"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
)

type RouterConfig struct {
	Tracker      *Tracker
	LegacyURL    string
	CanaryWeight float64 // 0.0-1.0: fraction of traffic to send to Go in canary state
}

type Router struct {
	tracker      *Tracker
	legacyProxy  *httputil.ReverseProxy
	canaryWeight float64
	mu           sync.RWMutex
}

func NewRouter(cfg RouterConfig) *Router {
	target, _ := url.Parse(cfg.LegacyURL)
	proxy := httputil.NewSingleHostReverseProxy(target)

	weight := cfg.CanaryWeight
	if weight <= 0 {
		weight = 0.1
	}
	if weight > 1 {
		weight = 1.0
	}

	return &Router{
		tracker:      cfg.Tracker,
		legacyProxy:  proxy,
		canaryWeight: weight,
	}
}

func (rt *Router) SetCanaryWeight(w float64) {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	if w < 0 {
		w = 0
	}
	if w > 1 {
		w = 1
	}
	rt.canaryWeight = w
}

func (rt *Router) CanaryWeight() float64 {
	rt.mu.RLock()
	defer rt.mu.RUnlock()
	return rt.canaryWeight
}

func (rt *Router) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		endpoint := normalizeEndpoint(r.URL.Path)

		state, err := rt.tracker.Get(r.Context(), endpoint)
		if err != nil {
			next.ServeHTTP(w, r)
			return
		}

		switch state.Backend {
		case StateGo:
			next.ServeHTTP(w, r)
		case StateLegacy:
			rt.legacyProxy.ServeHTTP(w, r)
		case StateShadow:
			// Shadow: serve from legacy, Go runs async (handled by shadow middleware)
			// But if shadow middleware is not active, just proxy to legacy
			next.ServeHTTP(w, r)
		case StateCanary:
			if rt.shouldServeGo() {
				next.ServeHTTP(w, r)
			} else {
				rt.legacyProxy.ServeHTTP(w, r)
			}
		default:
			rt.legacyProxy.ServeHTTP(w, r)
		}
	})
}

func (rt *Router) shouldServeGo() bool {
	rt.mu.RLock()
	weight := rt.canaryWeight
	rt.mu.RUnlock()

	if weight >= 1.0 {
		return true
	}
	if weight <= 0 {
		return false
	}

	n, err := rand.Int(rand.Reader, big.NewInt(1000))
	if err != nil {
		return false
	}
	threshold := int64(weight * 1000)
	return n.Int64() < threshold
}

// normalizeEndpoint extracts a canonical endpoint pattern from a request path.
// /api/v2/projects/abc123/applications/def456 → /api/v2/projects/{projectID}/applications/{id}
func normalizeEndpoint(path string) string {
	parts := strings.Split(strings.TrimSuffix(path, "/"), "/")
	normalized := make([]string, 0, len(parts))

	for i, part := range parts {
		if part == "" {
			continue
		}
		if i > 0 && isID(parts[i-1], part) {
			normalized = append(normalized, "{id}")
		} else {
			normalized = append(normalized, part)
		}
	}

	result := "/" + strings.Join(normalized, "/")
	// Normalize known project ID position
	result = strings.Replace(result, "/projects/{id}/", "/projects/{projectID}/", 1)
	return result
}

func isID(prevSegment, segment string) bool {
	if len(segment) == 36 && strings.Count(segment, "-") == 4 {
		return true // UUID
	}
	if len(segment) == 24 && isHex(segment) {
		return true // MongoDB ObjectID
	}
	// After known collection segments, the next segment is usually an ID
	switch prevSegment {
	case "projects", "applications", "skills", "folders", "conversations",
		"pipelines", "webhooks", "tags", "analytics":
		if len(segment) > 8 {
			return true
		}
	}
	return false
}

func isHex(s string) bool {
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}
