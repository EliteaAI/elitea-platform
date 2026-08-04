package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/shadow"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/cutover"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/applications"
)

// TestObjectDownloadRejectsRawTraversalKey proves the new artifact API
// rejects a raw ".." path segment before it ever reaches the metadata
// repository. It follows the same lazy-pgxpool pattern as
// TestArtifactBucketRoutesWireToRealHandlerWhenConfigured and
// TestArtifactBucketRoutesStayStubbedWithoutObjectStore in
// artifact_stub_routes_test.go: pgxpool.New against an address nothing
// listens on succeeds without dialing (pgx v5 connects lazily), so only
// checks that happen before any repository/store round-trip can be asserted
// this way. That's exactly what this test needs — DownloadObject must
// validate the key (storage.NewObjectRef) and reject it with InvalidKey
// ahead of the requireBucket lookup that would otherwise hang or 500
// against the unreachable pool.
func TestObjectDownloadRejectsRawTraversalKey(t *testing.T) {
	t.Setenv("AUTH_DEV_MODE", "true")

	pool, err := pgxpool.New(context.Background(), "postgres://nouser:nopass@127.0.0.1:1/nodb")
	if err != nil {
		t.Fatalf("pgxpool.New (lazy, must not dial): %v", err)
	}
	defer pool.Close()

	router := NewRouter(RouterConfig{
		AppsRepo:    struct{ applications.Repository }{},
		Pool:        pool,
		ObjectStore: noopObjectStore{},
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v2/artifacts/objects/1/reports/../escape.txt", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}

	var envelope struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("response body is not the typed error envelope: %v (body=%s)", err, rec.Body.String())
	}
	if envelope.Error.Code != "InvalidKey" {
		t.Fatalf("error.code = %q, want InvalidKey; body=%s", envelope.Error.Code, rec.Body.String())
	}
}

func TestInternalAdminRoutesRemainProductionUnmountedForEveryTokenStrength(t *testing.T) {
	comparator := shadow.NewComparator(shadow.Config{Timeout: time.Second})
	metrics := shadow.NewMetrics(10)
	tracker := cutover.NewTracker(nil)

	for _, token := range []string{"", "short", strings.Repeat("i", middleware.MinimumInternalAdminTokenBytes)} {
		router := NewRouter(RouterConfig{
			Shadow:             comparator,
			ShadowMetrics:      metrics,
			CutoverTracker:     tracker,
			InternalAdminToken: token,
		})
		for _, target := range []string{"/internal/shadow/config", "/internal/cutover/"} {
			for _, present := range []bool{false, true} {
				req := httptest.NewRequest(http.MethodGet, target, nil)
				if present {
					req.Header.Set("Authorization", "Bearer "+token)
				}
				rec := httptest.NewRecorder()
				router.ServeHTTP(rec, req)
				if rec.Code != http.StatusNotFound {
					t.Fatalf("token length %d present=%t target %q status = %d, want %d", len(token), present, target, rec.Code, http.StatusNotFound)
				}
			}
		}
	}
}
