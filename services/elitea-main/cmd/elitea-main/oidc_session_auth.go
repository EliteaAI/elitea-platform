package main

import (
	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
)

// oidcSessionAuthConfig composes the credential set for a route that an
// OIDC-only deployment reaches with a browser session cookie and nothing else.
//
// Two routes take this shape: the project list and the notification event
// stream. Both are also composed inside main.go's `authEnabled` block, where
// formGraph supplies a token validator, the production principal validator and
// the forwarded identity verifier. When ELITEA_AUTH_CONFIG_FILE is absent —
// the OIDC-only shape, which is what the E2E stack and any SSO-only install
// run — that block does not run, so a second composition supplies the session
// cookie instead.
//
// The session branch must STILL carry a principal validator.
// apimw.validatePrincipal returns the session's user unchanged when the field
// is nil, so a deactivated or suspended user's unexpired cookie was accepted
// on GET /api/v2/projects/project/default/1 and on GET
// /api/v2/notifications/events/prompt_lib/{projectID} (#314). The per-project
// permission gate in front of each handler does not help, because a
// deactivated user's RBAC rows survive deactivation. This is the same defect
// #301 fixed on chat_config; see chatConfigAuthConfig.
//
// sessionPrincipals is a parameter rather than something this function builds,
// so the nil handling stays visible at the call site. Both call sites pass
// authsvc.NewPrincipalValidator(pool) and NOT main.go's `principalValidator`
// variable: that variable is assigned only inside the `authEnabled` block, so
// it is nil in exactly the branch that needs it.
func oidcSessionAuthConfig(
	sessionPrincipals apimw.PrincipalValidator,
	sessionSecret string,
) apimw.AuthConfig {
	return apimw.AuthConfig{
		SessionSecret:      sessionSecret,
		PrincipalValidator: sessionPrincipals,
	}
}
