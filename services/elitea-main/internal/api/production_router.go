package api

import (
	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/health"
	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
)

// NewRouter exposes only routes whose production authorization contract is
// explicit. Unclassified prototype handlers stay compiled in
// newPrototypeCompatibilityRouter, but cannot be enabled by configuration.
func NewRouter(cfg RouterConfig) chi.Router {
	r := chi.NewRouter()

	r.Use(apimw.RequestID)
	// Preserve the socket peer in Request.RemoteAddr. A generic RealIP
	// middleware trusts caller-controlled forwarding headers before route-level
	// proxy policy can validate the peer. TrustedProxyResolver performs the one
	// authoritative forwarded-chain resolution for ForwardAuth and rate limits.
	r.Use(apimw.OtelMiddleware)
	r.Use(apimw.Recover)

	// Public, non-product-data routes.
	r.Mount("/", health.RoutesWithDeps(cfg.HealthDeps))

	return r
}
