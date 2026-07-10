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
		w.Write([]byte("legacy"))
	}))
	defer legacy.Close()

	goHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("go"))
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
		w.Write([]byte("legacy"))
	}))
	defer legacy.Close()

	goHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("go"))
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

func TestRouterMiddleware_CanaryState(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	tracker := NewTracker(rdb)

	require.NoError(t, tracker.Set(context.Background(), "/api/v2/projects/{projectID}/applications", StateCanary, "test"))

	legacyHits := 0
	legacy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		legacyHits++
		w.Write([]byte("legacy"))
	}))
	defer legacy.Close()

	goHits := 0
	goHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		goHits++
		w.Write([]byte("go"))
	})

	router := NewRouter(RouterConfig{
		Tracker:      tracker,
		LegacyURL:    legacy.URL,
		CanaryWeight: 0.5,
	})

	handler := router.Middleware(goHandler)

	for i := 0; i < 100; i++ {
		req := httptest.NewRequest("GET", "/api/v2/projects/abc123def456/applications", nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
	}

	// With 50% weight and 100 requests, both should get significant traffic
	assert.Greater(t, goHits, 20, "Go should receive meaningful traffic at 50%% weight")
	assert.Greater(t, legacyHits, 20, "Legacy should receive meaningful traffic at 50%% weight")
	assert.Equal(t, 100, goHits+legacyHits)
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
