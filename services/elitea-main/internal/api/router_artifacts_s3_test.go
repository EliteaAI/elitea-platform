package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/applications"

	v2artifacts "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/artifacts"
)

// The S3-shaped bucket listing is the one artifact route that names its
// project in a QUERY parameter rather than a path segment, because that is
// the SDK's fixed wire format. A query parameter is caller-controlled input,
// so the danger is specific and worth its own tests: that this route becomes
// a way to read another tenant's artifacts by editing a query string.
//
// Route shape and RBAC-tier coverage live in router_security_test.go, where
// this route is a row in artifactRoutePermissions (401 unauthenticated, 403
// without the view permission) and in artifactSuccessCases (a genuine 200 at
// its real path). What follows is the cross-tenant guarantee those tables
// cannot express, because they only ever name one project.

func newS3ListingRouter(resolver fakePermissionResolver) http.Handler {
	return NewRouter(RouterConfig{
		AuthValidator:              testTokenValidator{user: authenticatedTestUser()},
		AppsRepo:                   struct{ applications.Repository }{},
		ArtifactHandler:            v2artifacts.NewHandler(alwaysSucceedsArtifactRepo{}, alwaysSucceedsArtifactStore{}),
		ArtifactPermissionResolver: resolver,
	})
}

// TestS3ListingRefusesAnotherProjectsBucket is the central authorization
// claim. The principal is genuinely entitled to project 7 and holds the exact
// permission the route requires — the only thing that changes between the two
// subtests is the project_id in the query string.
//
// alwaysSucceedsArtifactRepo answers GetBucket for ANY project id, so the
// handler itself would happily list project 8's bucket. That is deliberate:
// it means a 403 here can only come from the RBAC gate in front of the
// handler, and if that gate were dropped or given a path-based extractor
// (which would find no {projectID} param and fall through), this test would
// see a 200 instead. A repo that refused project 8 on its own would make the
// test pass without proving anything about authorization.
func TestS3ListingRefusesAnotherProjectsBucket(t *testing.T) {
	// forProject scopes the grant to project 7 exactly as the real
	// legacyrbac resolver does: its projectPermissions query keys on
	// (project_id, user_id) in auth_core__project_user_role, so a user with
	// no role assignment in the named project resolves to zero permissions.
	resolver := fakePermissionResolver{granted: []string{artifactPermissionView}, forProject: "7"}
	router := newS3ListingRouter(resolver)

	t.Run("own project is allowed", func(t *testing.T) {
		req := testAuthHeader(httptest.NewRequest(http.MethodGet, "/artifacts/s3/reports?project_id=7&list-type=2", nil))
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 for the caller's own project; body=%s", rec.Code, rec.Body.String())
		}
	})

	t.Run("another project is refused", func(t *testing.T) {
		req := testAuthHeader(httptest.NewRequest(http.MethodGet, "/artifacts/s3/reports?project_id=8&list-type=2", nil))
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want 403 — the query parameter must not be trusted as an authorization claim; body=%s",
				rec.Code, rec.Body.String())
		}
	})
}

// TestS3ListingRejectsMalformedProjectID proves the query extractor fails
// closed. ProjectIDFromQuery accepts only a canonical positive integer, so
// each of these is refused before the handler runs — an extractor that
// coerced or ignored a malformed value could otherwise resolve permissions
// against a different project than the handler later reads.
func TestS3ListingRejectsMalformedProjectID(t *testing.T) {
	// The resolver grants view unconditionally here, so a 403 can only come
	// from the extractor rejecting the value, never from a missing grant.
	router := newS3ListingRouter(fakePermissionResolver{granted: []string{artifactPermissionView}})

	for _, query := range []string{
		"",                       // absent entirely
		"?project_id=",           // present but empty
		"?project_id=0",          // not positive
		"?project_id=-1",         // negative
		"?project_id=1.5",        // not an integer
		"?project_id=+1",         // non-canonical
		"?project_id=01",         // non-canonical leading zero
		"?project_id=1%20OR%201", // injection-shaped
		"?project_id=abc",        // not a number
	} {
		t.Run("project_id="+query, func(t *testing.T) {
			req := testAuthHeader(httptest.NewRequest(http.MethodGet, "/artifacts/s3/reports"+query, nil))
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			if rec.Code != http.StatusForbidden {
				t.Fatalf("status = %d, want 403 for a malformed project id; body=%s", rec.Code, rec.Body.String())
			}
		})
	}
}

// TestS3ListingIsMountedAtRootNotUnderAPIV2 pins the prefix, which is the
// one thing that cannot be got wrong quietly: the SDK builds this URL from a
// bare origin with no /api/v2 segment (elitea-sdk client.py:115 — every
// sibling URL on the surrounding lines DOES include it), and the platform
// edge forwards the path verbatim. A route mounted one prefix off produces a
// 404 that the SDK swallows into an empty listing, which is indistinguishable
// from the original defect: an index run that reports success having indexed
// nothing.
func TestS3ListingIsMountedAtRootNotUnderAPIV2(t *testing.T) {
	router := newS3ListingRouter(fakePermissionResolver{granted: []string{artifactPermissionView}})

	t.Run("root path serves the listing", func(t *testing.T) {
		req := testAuthHeader(httptest.NewRequest(http.MethodGet, "/artifacts/s3/reports?project_id=1", nil))
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 at the path the SDK actually requests; body=%s", rec.Code, rec.Body.String())
		}
		// Prove it is the listing and not some catch-all that happens to
		// 200 — the catch-all mount at "/" is a real possibility here.
		var body map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("body is not JSON: %v (body=%s)", err, rec.Body.String())
		}
		if _, ok := body["contents"]; !ok {
			t.Fatalf(`body is not an S3 listing (no "contents" key); body=%s`, rec.Body.String())
		}
	})

	t.Run("api/v2 path does not serve it", func(t *testing.T) {
		req := testAuthHeader(httptest.NewRequest(http.MethodGet, "/api/v2/artifacts/s3/reports?project_id=1", nil))
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code == http.StatusOK {
			t.Fatalf("the listing answered under /api/v2, where the SDK never looks; body=%s", rec.Body.String())
		}
	})
}
