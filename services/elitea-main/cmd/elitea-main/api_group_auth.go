package main

import (
	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/authcomposition"
)

// apiGroupAuthConfig composes the credential set that api.NewRouter applies to
// the WHOLE /api/v2 group.
//
// internal/api/router.go copies these four fields into one apimw.AuthConfig and
// installs it with r.Use on the group that wraps r.Route("/api/v2", ...). It is
// therefore the broadest AuthConfig in the composition root: every route in the
// group authenticates through it.
//
// Two deployment shapes reach it. With ELITEA_AUTH_CONFIG_FILE set, formGraph
// is the token validator and the production principal validator and forwarded
// identity verifier come with it. Without it — the OIDC-only shape, which is
// what the E2E stack and any SSO-only install run — the browser session cookie
// is the only credential the deployment issues, so the config carries
// SessionSecret instead.
//
// The OIDC-only branch must STILL carry a principal validator.
// apimw.validatePrincipal returns the session's user unchanged when the field
// is nil, so a deactivated or suspended user's unexpired cookie was accepted on
// EVERY /api/v2 route. The per-project permission gate in front of each handler
// does not help, because a deactivated user's RBAC rows survive deactivation.
// This is the defect #301 fixed on chat_config and #314 fixed on the project
// list and the notification event stream, at the scope of the whole group
// (#370). See chatConfigAuthConfig and oidcSessionAuthConfig.
//
// sessionPrincipals is a parameter rather than something this function builds,
// and formGraph stays a concrete *authcomposition.FormGraph rather than the
// apimw.TokenValidator interface, for the same reason: both make the nil
// handling visible at the call site. A nil *FormGraph assigned to an interface
// field yields a non-nil interface holding a nil pointer, and `!= nil`
// downstream then reads as "configured" (#86).
//
// The call site passes authsvc.NewPrincipalValidator(pool) for
// sessionPrincipals and NOT main.go's `principalValidator` variable: that
// variable is assigned only inside the `authEnabled` block, so it is nil in
// exactly the branch that needs it. Issue #314 records that trap.
//
// A deployment with neither credential plane gets the zero AuthConfig, which
// admits nothing.
func apiGroupAuthConfig(
	formGraph *authcomposition.FormGraph,
	principalValidator apimw.PrincipalValidator,
	forwardedIdentityVerifier apimw.ForwardedIdentityPeerVerifier,
	sessionPrincipals apimw.PrincipalValidator,
	sessionSecret string,
	oidcSessionEnabled bool,
) apimw.AuthConfig {
	if formGraph != nil {
		return apimw.AuthConfig{
			Validator:                 formGraph,
			PrincipalValidator:        principalValidator,
			ForwardedIdentityVerifier: forwardedIdentityVerifier,
			SessionSecret:             sessionSecret,
		}
	}
	if oidcSessionEnabled {
		return apimw.AuthConfig{
			SessionSecret:      sessionSecret,
			PrincipalValidator: sessionPrincipals,
		}
	}
	return apimw.AuthConfig{}
}
