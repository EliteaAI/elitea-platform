package cutover

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNormalizeEndpoint(t *testing.T) {
	tests := []struct {
		path     string
		expected string
	}{
		{"/api/v2/projects/abc123def456/applications", "/api/v2/projects/{projectID}/applications"},
		{"/api/v2/projects/abc123def456/applications/550e8400-e29b-41d4-a716-446655440000", "/api/v2/projects/{projectID}/applications/{id}"},
		{"/api/v2/projects/abc123def456/skills", "/api/v2/projects/{projectID}/skills"},
		{"/healthz", "/healthz"},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			got := normalizeEndpoint(tt.path)
			assert.Equal(t, tt.expected, got)
		})
	}
}

func TestRouterMiddleware_GoState(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	tracker := NewTracker(rdb)

	require.NoError(t, tracker.Set(context.Background(), "/api/v2/projects/{projectID}/applications", StateGo, "test"))

	legacy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("legacy"))
	}))
	defer legacy.Close()

	goHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("go"))
	})

	router := NewRouter(RouterConfig{
		Tracker:      tracker,
		LegacyURL:    legacy.URL,
		CanaryWeight: 0.5,
	})

	handler := router.Middleware(goHandler)
	req := httptest.NewRequest("GET", "/api/v2/projects/abc123def456/applications", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assert.Equal(t, "go", rec.Body.String())
}

func TestRouterMiddleware_LegacyState(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	tracker := NewTracker(rdb)

	require.NoError(t, tracker.Set(context.Background(), "/api/v2/projects/{projectID}/applications", StateLegacy, "test"))

	legacy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("legacy"))
	}))
	defer legacy.Close()

	goHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("go"))
	})

	router := NewRouter(RouterConfig{
		Tracker:      tracker,
		LegacyURL:    legacy.URL,
		CanaryWeight: 0.5,
	})

	handler := router.Middleware(goHandler)
	req := httptest.NewRequest("GET", "/api/v2/projects/abc123def456/applications", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assert.Equal(t, "legacy", rec.Body.String())
}

// TestRouterMiddleware_CanaryState_AllGo verifies that canary state with weight=1.0
// sends ALL requests to the Go handler — a deterministic boundary assertion that
// confirms the canary wiring without relying on random sampling.
func TestRouterMiddleware_CanaryState_AllGo(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	tracker := NewTracker(rdb)

	require.NoError(t, tracker.Set(context.Background(), "/api/v2/projects/{projectID}/applications", StateCanary, "test"))

	legacyHits := 0
	legacy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		legacyHits++
		_, _ = w.Write([]byte("legacy"))
	}))
	defer legacy.Close()

	goHits := 0
	goHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		goHits++
		_, _ = w.Write([]byte("go"))
	})

	router := NewRouter(RouterConfig{
		Tracker:      tracker,
		LegacyURL:    legacy.URL,
		CanaryWeight: 1.0, // 100% → deterministic: every request must go to Go
	})

	handler := router.Middleware(goHandler)

	const n = 20
	for i := 0; i < n; i++ {
		req := httptest.NewRequest("GET", "/api/v2/projects/abc123def456/applications", nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
	}

	assert.Equal(t, n, goHits, "weight=1.0 must route ALL canary requests to Go")
	assert.Equal(t, 0, legacyHits, "weight=1.0 must route NO canary requests to legacy")
}

// TestRouterMiddleware_CanaryState_AllLegacy verifies that canary state with weight=0.0
// sends ALL requests to the legacy handler — the opposite deterministic boundary.
func TestRouterMiddleware_CanaryState_AllLegacy(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	tracker := NewTracker(rdb)

	require.NoError(t, tracker.Set(context.Background(), "/api/v2/projects/{projectID}/applications", StateCanary, "test"))

	legacyHits := 0
	legacy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		legacyHits++
		_, _ = w.Write([]byte("legacy"))
	}))
	defer legacy.Close()

	goHits := 0
	goHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		goHits++
		_, _ = w.Write([]byte("go"))
	})

	router := NewRouter(RouterConfig{
		Tracker:      tracker,
		LegacyURL:    legacy.URL,
		CanaryWeight: 0.001, // effectively 0% in the 1000-bucket scheme; clamp to 0 via SetCanaryWeight
	})
	// Force weight to exactly 0 so the deterministic branch (weight <= 0 → false) fires.
	router.SetCanaryWeight(0)

	handler := router.Middleware(goHandler)

	const n = 20
	for i := 0; i < n; i++ {
		req := httptest.NewRequest("GET", "/api/v2/projects/abc123def456/applications", nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
	}

	assert.Equal(t, 0, goHits, "weight=0.0 must route NO canary requests to Go")
	assert.Equal(t, n, legacyHits, "weight=0.0 must route ALL canary requests to legacy")
}

// TestShouldServeGo_BoundaryWeights directly tests the shouldServeGo deterministic
// short-circuits (weight>=1.0 and weight<=0) so the split mechanism is exercised
// without any reliance on random sampling.
func TestShouldServeGo_BoundaryWeights(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	tracker := NewTracker(rdb)

	router := NewRouter(RouterConfig{
		Tracker:      tracker,
		LegacyURL:    "http://localhost:1",
		CanaryWeight: 1.0,
	})

	// weight >= 1.0 → must always return true (no RNG involved)
	for i := 0; i < 20; i++ {
		if !router.shouldServeGo() {
			t.Errorf("shouldServeGo() = false with weight=1.0, want true (iteration %d)", i)
		}
	}

	// weight <= 0 → must always return false (no RNG involved)
	router.SetCanaryWeight(0)
	for i := 0; i < 20; i++ {
		if router.shouldServeGo() {
			t.Errorf("shouldServeGo() = true with weight=0.0, want false (iteration %d)", i)
		}
	}
}

func TestSetCanaryWeight(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	tracker := NewTracker(rdb)

	router := NewRouter(RouterConfig{
		Tracker:      tracker,
		LegacyURL:    "http://localhost:8000",
		CanaryWeight: 0.1,
	})

	assert.InDelta(t, 0.1, router.CanaryWeight(), 0.001)

	router.SetCanaryWeight(0.75)
	assert.InDelta(t, 0.75, router.CanaryWeight(), 0.001)

	router.SetCanaryWeight(-1)
	assert.InDelta(t, 0.0, router.CanaryWeight(), 0.001)

	router.SetCanaryWeight(5.0)
	assert.InDelta(t, 1.0, router.CanaryWeight(), 0.001)
}
