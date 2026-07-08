package api

import (
	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/health"
	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
)

// NewRouter builds and returns the root chi router with the full middleware stack.
func NewRouter() chi.Router {
	r := chi.NewRouter()

	// --- observability / infra middleware ---
	r.Use(apimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(apimw.OtelMiddleware)
	r.Use(apimw.Recover)

	// --- application middleware ---
	r.Use(apimw.RateLimit)

	// --- health probes (unauthenticated) ---
	r.Mount("/", health.Routes())

	// --- authenticated API surface ---
	r.Group(func(r chi.Router) {
		r.Use(apimw.Auth)
		r.Use(apimw.Project)
		r.Use(apimw.RBAC)

		// TODO: mount domain routers here
		// r.Mount("/api/v1/applications", applications.Routes())
	})

	return r
}
