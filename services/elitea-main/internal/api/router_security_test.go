package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/shadow"
	v2artifacts "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/artifacts"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/cutover"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage/filesystem"
)

func testArtifactS3Handler() *v2artifacts.S3Handler {
	return v2artifacts.NewS3Handler(filesystem.New(os.Getenv("ARTIFACTS_DATA_DIR")))
}

type artifactPermissionResolverFunc func(
	context.Context,
	auth.User,
	string,
	string,
) (auth.PermissionResolution, error)

func (f artifactPermissionResolverFunc) ResolvePermissions(
	ctx context.Context,
	principal auth.User,
	mode string,
	projectID string,
) (auth.PermissionResolution, error) {
	return f(ctx, principal, mode, projectID)
}

func TestArtifactS3RoutesRequireAuthentication(t *testing.T) {
	t.Setenv("AUTH_DEV_MODE", "false")
	t.Setenv("ARTIFACTS_DATA_DIR", t.TempDir())
	router := chi.NewRouter()
	mountArtifactS3Routes(
		router,
		testArtifactS3Handler(),
		middleware.Auth(middleware.AuthConfig{}),
		artifactPermissionResolverFunc(func(context.Context, auth.User, string, string) (auth.PermissionResolution, error) {
			t.Fatal("permission resolver must not run before authentication")
			return auth.PermissionResolution{}, nil
		}),
	)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/artifacts/s3/?project_id=7", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestLegacyS3CompatibilityRoutesAreNotProductionMounted(t *testing.T) {
	t.Setenv("AUTH_DEV_MODE", "false")
	router := NewRouter(RouterConfig{})

	for _, target := range []string{
		"/artifacts/s3/",
		"/artifacts/s3/project-bucket",
		"/artifacts/s3/project-bucket/object.txt",
	} {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
		if rec.Code != http.StatusNotFound {
			t.Fatalf("GET %s status = %d, want %d until SigV4 and bucket-grant parity", target, rec.Code, http.StatusNotFound)
		}
	}
}

func TestArtifactS3RoutesUseExactLegacyPermissionsAndQueryProject(t *testing.T) {
	root := t.TempDir()
	t.Setenv("ARTIFACTS_DATA_DIR", root)
	if err := os.MkdirAll(filepath.Join(root, "7", "bucket"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "7", "bucket", "object.txt"), []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}

	var granted string
	resolver := artifactPermissionResolverFunc(func(
		_ context.Context,
		principal auth.User,
		mode string,
		projectID string,
	) (auth.PermissionResolution, error) {
		if principal.UserID != "42" || mode != auth.PermissionModeDefault || projectID != "7" {
			t.Fatalf("unexpected resolution input: principal=%+v mode=%q project=%q", principal, mode, projectID)
		}
		return auth.PermissionResolution{UserID: 42, Permissions: []string{granted}}, nil
	})
	authenticate := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := auth.ContextWithAuthenticatedUser(r.Context(), auth.User{ID: "42", UserID: "42"}, auth.AuthenticationSourceToken)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
	router := chi.NewRouter()
	mountArtifactS3Routes(router, testArtifactS3Handler(), authenticate, resolver)

	for _, test := range []struct {
		name       string
		method     string
		target     string
		body       string
		permission string
		wantStatus int
	}{
		{
			name:       "list buckets view",
			method:     http.MethodGet,
			target:     "/artifacts/s3/?project_id=7&format=json",
			permission: "configuration.artifacts.artifacts.view",
			wantStatus: http.StatusOK,
		},
		{
			name:       "list objects view",
			method:     http.MethodGet,
			target:     "/artifacts/s3/bucket?project_id=7&format=json",
			permission: "configuration.artifacts.artifacts.view",
			wantStatus: http.StatusOK,
		},
		{
			name:       "get object view",
			method:     http.MethodGet,
			target:     "/artifacts/s3/bucket/object.txt?project_id=7",
			permission: "configuration.artifacts.artifacts.view",
			wantStatus: http.StatusOK,
		},
		{
			name:       "put object create",
			method:     http.MethodPut,
			target:     "/artifacts/s3/bucket/object.txt?project_id=7",
			body:       "new",
			permission: "configuration.artifacts.artifacts.create",
			wantStatus: http.StatusOK,
		},
		{
			name:       "delete object delete",
			method:     http.MethodDelete,
			target:     "/artifacts/s3/bucket/object.txt?project_id=7",
			permission: "configuration.artifacts.artifacts.delete",
			wantStatus: http.StatusNoContent,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			granted = test.permission
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(test.method, test.target, strings.NewReader(test.body))
			router.ServeHTTP(rec, req)
			if rec.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d: %s", rec.Code, test.wantStatus, rec.Body.String())
			}
		})
	}

	if err := os.WriteFile(filepath.Join(root, "7", "outside.txt"), []byte("must-not-leak"), 0o600); err != nil {
		t.Fatal(err)
	}
	granted = "configuration.artifacts.artifacts.view"
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(
		http.MethodGet,
		"/artifacts/s3/bucket/%2e%2e/outside.txt?project_id=7",
		nil,
	))
	if rec.Code == http.StatusOK || strings.Contains(rec.Body.String(), "must-not-leak") {
		t.Fatalf("encoded traversal escaped bucket: status=%d body=%q", rec.Code, rec.Body.String())
	}
}

func TestArtifactS3RoutesDoNotExpandPermissionPrefixes(t *testing.T) {
	t.Setenv("ARTIFACTS_DATA_DIR", t.TempDir())
	resolver := artifactPermissionResolverFunc(func(context.Context, auth.User, string, string) (auth.PermissionResolution, error) {
		return auth.PermissionResolution{
			UserID:      42,
			Permissions: []string{"configuration.artifacts.artifacts"},
		}, nil
	})
	authenticate := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r.WithContext(auth.ContextWithUser(r.Context(), auth.User{ID: "42", UserID: "42"})))
		})
	}
	router := chi.NewRouter()
	mountArtifactS3Routes(router, testArtifactS3Handler(), authenticate, resolver)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/artifacts/s3/?project_id=7", nil))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
	}
}

func TestArtifactS3RoutesRequireExplicitProjectQuery(t *testing.T) {
	t.Setenv("ARTIFACTS_DATA_DIR", t.TempDir())
	resolver := artifactPermissionResolverFunc(func(context.Context, auth.User, string, string) (auth.PermissionResolution, error) {
		t.Fatal("resolver must not run without an explicit positive project_id")
		return auth.PermissionResolution{}, nil
	})
	authenticate := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r.WithContext(auth.ContextWithUser(r.Context(), auth.User{ID: "42", UserID: "42"})))
		})
	}
	router := chi.NewRouter()
	mountArtifactS3Routes(router, testArtifactS3Handler(), authenticate, resolver)

	for _, target := range []string{
		"/artifacts/s3/",
		"/artifacts/s3/?project_id=0",
		"/artifacts/s3/?project_id=01",
		"/artifacts/s3/?project_id=-1",
	} {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
		if rec.Code != http.StatusForbidden {
			t.Fatalf("target %q status = %d, want %d", target, rec.Code, http.StatusForbidden)
		}
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
