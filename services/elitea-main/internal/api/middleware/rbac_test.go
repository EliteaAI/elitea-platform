package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

func TestExpandPermissions(t *testing.T) {
	tests := []struct {
		name     string
		perms    []string
		expected []string
	}{
		{
			name:     "single segment",
			perms:    []string{"admin"},
			expected: []string{"admin"},
		},
		{
			name:     "multi segment",
			perms:    []string{"a.b.c.view"},
			expected: []string{"a", "a.b", "a.b.c", "a.b.c.view"},
		},
		{
			name:     "multiple permissions",
			perms:    []string{"apps.edit", "users.view"},
			expected: []string{"apps", "apps.edit", "users", "users.view"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			expanded := middleware.ExpandPermissions(tt.perms)
			for _, exp := range tt.expected {
				if _, ok := expanded[exp]; !ok {
					t.Errorf("expected %q in expanded set", exp)
				}
			}
		})
	}
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

func TestRequirePermissions_ParentExpansion(t *testing.T) {
	// User has "a.b.c.view" → expanded to {a, a.b, a.b.c, a.b.c.view}
	// Requiring "a.b" should pass via expansion
	handler := middleware.RequirePermissions("a.b")(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
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

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 (parent expansion), got %d", rec.Code)
	}
}

func TestRequirePermissions_NoFalsePrefix(t *testing.T) {
	// User has "apps.edit" → expanded to {apps, apps.edit}
	// Requiring "apps.editor" should fail — NOT prefix matching
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
