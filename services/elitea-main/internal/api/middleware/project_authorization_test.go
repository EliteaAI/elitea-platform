package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

func TestRequireProjectAccess(t *testing.T) {
	tests := []struct {
		name string
		user auth.User
		row  fakeRow
		want int
	}{
		{name: "member allowed", user: auth.User{ID: "7"}, row: fakeRow{vals: []any{true}}, want: http.StatusNoContent},
		{name: "non member forbidden", user: auth.User{ID: "7"}, row: fakeRow{vals: []any{false}}, want: http.StatusForbidden},
		{name: "missing identity unauthorized", want: http.StatusUnauthorized},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			querier := &fakeQuerier{handler: func(string, ...any) pgx.Row { return tc.row }}
			r := chi.NewRouter()
			r.With(requireProjectAccess(querier)).Get("/projects/{projectID}", func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusNoContent)
			})
			req := httptest.NewRequest(http.MethodGet, "/projects/12", nil)
			if tc.user.ID != "" {
				req = req.WithContext(auth.ContextWithUser(req.Context(), tc.user))
			}
			res := httptest.NewRecorder()
			r.ServeHTTP(res, req)
			if res.Code != tc.want {
				t.Fatalf("status = %d, want %d", res.Code, tc.want)
			}
		})
	}
}

// TestRequireProjectAccess_NilPool guards against a nil *pgxpool.Pool being
// boxed into the projectAccessQuerier interface, which would produce a
// non-nil interface value and panic inside pgxpool's Acquire instead of
// returning the intended 503.
func TestRequireProjectAccess_NilPool(t *testing.T) {
	var nilPool *pgxpool.Pool

	r := chi.NewRouter()
	r.With(RequireProjectAccess(nilPool)).Get("/projects/{projectID}", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	req := httptest.NewRequest(http.MethodGet, "/projects/12", nil)
	req = req.WithContext(auth.ContextWithUser(req.Context(), auth.User{ID: "7"}))
	res := httptest.NewRecorder()

	r.ServeHTTP(res, req)

	if res.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusServiceUnavailable)
	}
}
