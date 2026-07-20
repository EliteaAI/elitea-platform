package browserauth

import (
	"context"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth/browserflow"
)

const OIDCPKCEChallengeS256 = "S256"

// OIDCAuthorization is generated before server-side state is allocated. Nonce
// and PKCE verifier are then persisted only in the one-time transaction.
type OIDCAuthorization struct {
	Correlation         browserflow.ProtocolCorrelation
	ProviderState       browserflow.ProviderState
	PKCEChallengeMethod string
}

// OIDCProtocol is the source-only composition seam for OpenID Connect. A
// production implementation generates CSPRNG values, uses S256 PKCE, exchanges
// only an authorization code, and verifies the ID token's signature, issuer,
// audience, expiry, not-before value, and nonce. Provider dependency failures
// wrap ErrAssertionVerifierUnavailable; invalid codes, tokens, or claims do
// not.
type OIDCProtocol interface {
	NewAuthorization(context.Context) (OIDCAuthorization, error)
	AuthorizationURL(string, OIDCAuthorization) (string, error)
	NewVerifier(code string) AssertionVerifier
}
