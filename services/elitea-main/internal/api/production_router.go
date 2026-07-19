package api

import (
	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/health"
	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
)

// NewRouter exposes only routes whose production authorization contract is
// explicit. Unclassified prototype handlers stay compiled in
// newPrototypeCompatibilityRouter, but cannot be enabled by configuration.
func NewRouter(cfg RouterConfig) chi.Router {
	r := chi.NewRouter()

	r.Use(apimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(apimw.OtelMiddleware)
	r.Use(apimw.Recover)

	// Public, non-product-data routes.
	r.Mount("/", health.RoutesWithDeps(cfg.HealthDeps))

	return r
}
