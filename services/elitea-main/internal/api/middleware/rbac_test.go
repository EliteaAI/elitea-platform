package middleware_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/go-chi/chi/v5"
)

type permissionResolverFunc func(
	context.Context,
	auth.User,
	string,
	string,
) (auth.PermissionResolution, error)

func (f permissionResolverFunc) ResolvePermissions(
	ctx context.Context,
	principal auth.User,
	mode string,
	projectID string,
) (auth.PermissionResolution, error) {
	return f(ctx, principal, mode, projectID)
}

func TestRequirePermissions_NoUser(t *testing.T) {
	handler := middleware.RequirePermissions("admin")(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Fatal("handler should not be called")
		}),
	)

	req := httptest.NewRequest("GET", "/", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
}

func TestRequirePermissions_InsufficientPerms(t *testing.T) {
	handler := middleware.RequirePermissions("admin.users.delete")(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Fatal("handler should not be called")
		}),
	)

	req := httptest.NewRequest("GET", "/", nil)
	ctx := auth.ContextWithUser(req.Context(), auth.User{
		ID:          "user-1",
		Permissions: []string{"apps.view"},
	})
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rec.Code)
	}
}

func TestRequirePermissions_ExactMatch(t *testing.T) {
	handler := middleware.RequirePermissions("apps.edit")(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
	)

	req := httptest.NewRequest("GET", "/", nil)
	ctx := auth.ContextWithUser(req.Context(), auth.User{
		ID:          "user-1",
		Permissions: []string{"apps.edit"},
	})
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}

func TestRequirePermissions_ParentPermissionDoesNotMatch(t *testing.T) {
	// Legacy has_access uses exact set intersection. A stored child permission
	// does not implicitly grant a parent permission.
	handler := middleware.RequirePermissions("a.b")(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Fatal("handler should not be called")
		}),
	)

	req := httptest.NewRequest("GET", "/", nil)
	ctx := auth.ContextWithUser(req.Context(), auth.User{
		ID:          "user-1",
		Permissions: []string{"a.b.c.view"},
	})
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403 (exact permission matching), got %d", rec.Code)
	}
}

func TestRequirePermissions_NoFalsePrefix(t *testing.T) {
	// Requiring a similar prefix still fails exact matching.
	handler := middleware.RequirePermissions("apps.editor")(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Fatal("handler should not be called")
		}),
	)

	req := httptest.NewRequest("GET", "/", nil)
	ctx := auth.ContextWithUser(req.Context(), auth.User{
		ID:          "user-1",
		Permissions: []string{"apps.edit"},
	})
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403 (no prefix matching), got %d", rec.Code)
	}
}

func TestRequirePermissions_MultipleRequired_OneMatches(t *testing.T) {
	// set intersection: ANY match is sufficient
	handler := middleware.RequirePermissions("admin.delete", "apps.view")(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
	)

	req := httptest.NewRequest("GET", "/", nil)
	ctx := auth.ContextWithUser(req.Context(), auth.User{
		ID:          "user-1",
		Permissions: []string{"apps.view"},
	})
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 (intersection has apps.view), got %d", rec.Code)
	}
}

func TestRequireResolvedPermissionsUsesDatabaseResolutionAndPropagatesOwner(t *testing.T) {
	resolver := permissionResolverFunc(func(
		_ context.Context,
		principal auth.User,
		mode string,
		projectID string,
	) (auth.PermissionResolution, error) {
		if principal.TokenID != "900" || mode != auth.PermissionModeDefault || projectID != "7" {
			t.Fatalf("unexpected resolution input: principal=%+v mode=%q project=%q", principal, mode, projectID)
		}
		return auth.PermissionResolution{
			UserID:      42,
			Permissions: []string{"configurations.configuration.create"},
		}, nil
	})

	router := chi.NewRouter()
	router.With(middleware.RequireResolvedPermissions(
		resolver,
		auth.PermissionModeDefault,
		"configurations.configuration.create",
	)).Post("/{projectID}", func(w http.ResponseWriter, r *http.Request) {
		user, ok := auth.UserFromContext(r.Context())
		if !ok {
			t.Fatal("resolved user missing from context")
		}
		ownerID, ok := user.OwningUserID()
		if !ok || ownerID != 42 {
			t.Fatalf("resolved owner = (%d, %v), want (42, true)", ownerID, ok)
		}
		w.WriteHeader(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodPost, "/7", nil)
	req = req.WithContext(auth.ContextWithUser(req.Context(), auth.User{
		ID:       "900",
		TokenID:  "900",
		AuthType: "token",
	}))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNoContent)
	}
}

func TestRequireResolvedPermissionsFailsClosed(t *testing.T) {
	for _, test := range []struct {
		name       string
		resolver   auth.PermissionResolver
		withUser   bool
		wantStatus int
	}{
		{
			name: "missing authenticated user",
			resolver: permissionResolverFunc(func(context.Context, auth.User, string, string) (auth.PermissionResolution, error) {
				return auth.PermissionResolution{}, nil
			}),
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "missing resolver",
			withUser:   true,
			wantStatus: http.StatusForbidden,
		},
		{
			name:     "resolver failure",
			withUser: true,
			resolver: permissionResolverFunc(func(context.Context, auth.User, string, string) (auth.PermissionResolution, error) {
				return auth.PermissionResolution{}, errors.New("database unavailable")
			}),
			wantStatus: http.StatusForbidden,
		},
		{
			name:     "exact permission missing",
			withUser: true,
			resolver: permissionResolverFunc(func(context.Context, auth.User, string, string) (auth.PermissionResolution, error) {
				return auth.PermissionResolution{UserID: 1, Permissions: []string{"configurations.configuration.details"}}, nil
			}),
			wantStatus: http.StatusForbidden,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			handler := middleware.RequireResolvedPermissions(
				test.resolver,
				auth.PermissionModeDefault,
				"configurations.configuration.create",
			)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
				t.Fatal("protected handler should not run")
			}))
			req := httptest.NewRequest(http.MethodPost, "/", nil)
			if test.withUser {
				req = req.WithContext(auth.ContextWithUser(req.Context(), auth.User{ID: "1"}))
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, test.wantStatus)
			}
		})
	}
}
