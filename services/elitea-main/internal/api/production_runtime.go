package api

import (
	"errors"
	"net/http"

	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
)

var ErrInvalidProductionRuntimeRoutes = errors.New("invalid production runtime routes")

// ProductionRuntimeRoutes is an opaque route pair. Construction binds both
// runtime handlers to the existing trusted-peer and active-principal checks so
// production routing cannot mount either handler without that verification.
type ProductionRuntimeRoutes struct {
	validation      http.Handler
	executionEvents http.Handler
}

// sessionSecret is the browser's credential for these routes, and it is
// optional: a deployment that reaches them only through a forward-auth edge
// passes "" and behaves exactly as before.
//
// It exists because the chat surface reads the execution-events stream with an
// EventSource, which can send a cookie and nothing else — no bearer, no
// forwarded identity (#93). Composing these routes with forwarded identity
// alone made that stream unreadable by the product's own UI while every
// server-side hop worked, which is the shape #248's audit kept finding.
//
// Accepting a session here does not widen what a caller may SEE. The routes
// still require a runtime principal, and auth.RuntimePrincipalFromContext
// already admits AuthenticationSourceSession alongside forwarded/token/API-key
// — a session-authenticated user was always a valid runtime principal, it just
// had no way to prove it here. The events handler then authorizes per request
// against the execution's project and capability
// (runtimecomposition.postgresPublicAuthorizer.AuthorizeExecutionEvents), so
// membership and permission checks are unchanged.
func NewProductionRuntimeRoutes(
	validation http.Handler,
	executionEvents http.Handler,
	principalValidator apimw.PrincipalValidator,
	forwardedIdentityVerifier apimw.ForwardedIdentityPeerVerifier,
	sessionSecret string,
) (*ProductionRuntimeRoutes, error) {
	if validation == nil || executionEvents == nil || principalValidator == nil || forwardedIdentityVerifier == nil {
		return nil, ErrInvalidProductionRuntimeRoutes
	}

	authenticate := apimw.Auth(apimw.AuthConfig{
		PrincipalValidator:        principalValidator,
		ForwardedIdentityVerifier: forwardedIdentityVerifier,
		SessionSecret:             sessionSecret,
	})
	return &ProductionRuntimeRoutes{
		validation:      authenticate(requireRuntimePrincipal(validation)),
		executionEvents: authenticate(requireRuntimePrincipal(executionEvents)),
	}, nil
}

func requireRuntimePrincipal(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if _, ok := auth.RuntimePrincipalFromContext(request.Context()); !ok {
			apierr.WriteStatus(writer, http.StatusUnauthorized, "runtime authentication required")
			return
		}
		next.ServeHTTP(writer, request)
	})
}
