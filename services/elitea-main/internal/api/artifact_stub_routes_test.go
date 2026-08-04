package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/applications"
)

// TestArtifactStubRoutesReturn501WithTypedEnvelope verifies S7's own
// acceptance criterion — every one of the 13 new artifact paths resolves to
// notImplementedArtifact and returns 501 with the typed error envelope
// (components/schemas/Error in api/openapi/v2.yaml), not a bare 404 or an
// untyped body. TestSpecRouterConformance (internal/api/oapiserver) already
// proves each spec operationId *resolves* to some route; this proves the
// route it resolves to actually behaves like the stub, end to end through
// the real mounted router.
func TestArtifactStubRoutesReturn501WithTypedEnvelope(t *testing.T) {
	// AppsRepo alone is enough to satisfy prototypeCompatibilityRequested
	// and take the newPrototypeCompatibilityRouter branch — production
	// composition never sets any of these fields, so it never mounts these
	// paths at all (by design; see newPrototypeCompatibilityRouter's doc
	// comment). AUTH_DEV_MODE bypasses the Auth middleware in front of this
	// route group (middleware/auth.go) — without it every request 401s
	// before reaching notImplementedArtifact.
	t.Setenv("AUTH_DEV_MODE", "true")
	router := NewRouter(RouterConfig{
		AppsRepo: struct{ applications.Repository }{},
	})

	cases := []struct {
		method, path string
	}{
		{http.MethodGet, "/api/v2/artifacts/buckets/1"},
		{http.MethodPost, "/api/v2/artifacts/buckets/1"},
		{http.MethodGet, "/api/v2/artifacts/buckets/1/reports"},
		{http.MethodPatch, "/api/v2/artifacts/buckets/1/reports"},
		{http.MethodDelete, "/api/v2/artifacts/buckets/1/reports"},
		{http.MethodGet, "/api/v2/artifacts/objects/1/reports"},
		{http.MethodPost, "/api/v2/artifacts/objects/1/reports"},
		{http.MethodPost, "/api/v2/artifacts/objects/1/reports:batchDelete"},
		{http.MethodGet, "/api/v2/artifacts/objects/1/reports/a/b/c.png"},
		{http.MethodHead, "/api/v2/artifacts/objects/1/reports/a/b/c.png"},
		{http.MethodDelete, "/api/v2/artifacts/objects/1/reports/a/b/c.png"},
		{http.MethodPost, "/api/v2/artifacts/grants/1/reports"},
		{http.MethodPost, "/api/v2/artifacts/grants/1/abc123:commit"},
	}

	for _, tc := range cases {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, nil)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)

			if rec.Code != http.StatusNotImplemented {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusNotImplemented, rec.Body.String())
			}
			if tc.method == http.MethodHead {
				// HEAD responses must not carry a body per net/http semantics.
				return
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
			if envelope.Error.Code != "NotImplemented" {
				t.Fatalf("error.code = %q, want NotImplemented", envelope.Error.Code)
			}
		})
	}
}
