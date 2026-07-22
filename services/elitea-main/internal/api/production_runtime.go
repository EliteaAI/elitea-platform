package api

import (
	"errors"
	"net/http"

	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

var ErrInvalidProductionRuntimeRoutes = errors.New("invalid production runtime routes")

// ProductionRuntimeRoutes is an opaque route pair. Construction binds both
// runtime handlers to the existing trusted-peer and active-principal checks so
// production routing cannot mount either handler without that verification.
type ProductionRuntimeRoutes struct {
	validation      http.Handler
	executionEvents http.Handler
}

func NewProductionRuntimeRoutes(
	validation http.Handler,
	executionEvents http.Handler,
	principalValidator apimw.PrincipalValidator,
	forwardedIdentityVerifier apimw.ForwardedIdentityPeerVerifier,
) (*ProductionRuntimeRoutes, error) {
	if validation == nil || executionEvents == nil || principalValidator == nil || forwardedIdentityVerifier == nil {
		return nil, ErrInvalidProductionRuntimeRoutes
	}

	authenticate := apimw.Auth(apimw.AuthConfig{
		PrincipalValidator:        principalValidator,
		ForwardedIdentityVerifier: forwardedIdentityVerifier,
	})
	return &ProductionRuntimeRoutes{
		validation:      authenticate(requireRuntimePrincipal(validation)),
		executionEvents: authenticate(requireRuntimePrincipal(executionEvents)),
	}, nil
}

func requireRuntimePrincipal(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if _, ok := auth.RuntimePrincipalFromContext(request.Context()); !ok {
			http.Error(writer, `{"error":"runtime authentication required"}`, http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(writer, request)
	})
}
