package middleware

import (
	"context"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

// projectAccessQuerier is deliberately small so the authorization decision can
// be exercised without a live database.
type projectAccessQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// ProjectAccessQuerier is the one query this middleware runs, exposed so a
// router-level test can supply an answer without a live database. The
// membership decision is the whole point of the middleware, so a test that
// cannot control it can only ever observe the nil-pool 503 — which proves
// nothing about cross-tenant refusal (#302).
type ProjectAccessQuerier = projectAccessQuerier

// RequireProjectAccess rejects requests whose project path parameter does not
// belong to the authenticated user. Authentication establishes identity; this
// middleware establishes tenant scope before a handler may select p_<id> data.
func RequireProjectAccess(pool *pgxpool.Pool) func(http.Handler) http.Handler {
	if pool == nil {
		return unavailableProjectAccess
	}
	return requireProjectAccess(pool)
}

// RequireProjectAccessWith is RequireProjectAccess over an injected querier.
// It takes the interface rather than *pgxpool.Pool, so — unlike the exported
// constructor above — it cannot perform the nil-pool guard: a nil pool boxed
// into an interface is non-nil. Callers pass a real querier or nothing.
func RequireProjectAccessWith(querier ProjectAccessQuerier) func(http.Handler) http.Handler {
	if querier == nil {
		return unavailableProjectAccess
	}
	return requireProjectAccess(querier)
}

// unavailableProjectAccess fails closed with 503 when no pool is configured.
// A nil *pgxpool.Pool boxed into the projectAccessQuerier interface would
// otherwise compare non-nil, bypassing the nil guard inside
// requireProjectAccess and panicking on the subsequent QueryRow call.
func unavailableProjectAccess(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := authenticatedUser(r); !ok {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		http.Error(w, `{"error":"project authorization unavailable"}`, http.StatusServiceUnavailable)
	})
}

// authenticatedUser returns the request's authenticated user, or false if
// the request carries no valid identity.
func authenticatedUser(r *http.Request) (auth.User, bool) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok || user.ID == "" {
		return auth.User{}, false
	}
	return user, true
}

func requireProjectAccess(pool projectAccessQuerier) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, ok := authenticatedUser(r)
			if !ok {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}

			projectID, err := strconv.Atoi(chi.URLParam(r, "projectID"))
			if err != nil || projectID <= 0 {
				http.Error(w, `{"error":"invalid project id"}`, http.StatusBadRequest)
				return
			}
			userID, err := strconv.Atoi(user.ID)
			if err != nil || userID <= 0 {
				http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
				return
			}
			if pool == nil {
				http.Error(w, `{"error":"project authorization unavailable"}`, http.StatusServiceUnavailable)
				return
			}

			var allowed bool
			err = pool.QueryRow(r.Context(), `
				SELECT EXISTS (
					SELECT 1 FROM auth_core__project_user_role
					WHERE project_id = $1 AND user_id = $2
					UNION ALL
					SELECT 1
					FROM auth_core__user_role ur
					JOIN auth_core__role role ON role.id = ur.role_id
					WHERE ur.user_id = $2 AND role.name = 'super_admin'
				)`, projectID, userID).Scan(&allowed)
			if err != nil {
				http.Error(w, `{"error":"project authorization unavailable"}`, http.StatusServiceUnavailable)
				return
			}
			if !allowed {
				http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
