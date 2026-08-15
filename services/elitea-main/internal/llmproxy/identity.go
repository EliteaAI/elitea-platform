// Package llmproxy is elitea-main's lightweight /llm gateway role: a streaming
// reverse proxy that authenticates at the edge, resolves the caller's project,
// injects signed identity headers, and byte-streams /llm to
// elitea-llm-gateway-svc over mTLS (design §2, ADR-0015 Option E). It does NOT
// import bifrost/core, translate wire dialects, or run governance.
package llmproxy

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strconv"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/tenant"
)

// Signed internal identity headers forwarded to the gateway. The gateway trusts
// these only because the hop is mTLS-internal (design §2, §6.1); the HMAC
// signature is defense-in-depth so a header that leaks onto the internal network
// without the shared secret cannot forge a project identity.
const (
	HeaderProjectID = "X-Elitea-Project-Id"
	HeaderUserID    = "X-Elitea-User-Id"
	HeaderTenantID  = "X-Elitea-Tenant-Id"
	// HeaderSignature carries "sha256=<hex>" over the canonical identity tuple.
	HeaderSignature = "X-Elitea-Identity-Signature"
)

// signatureVersion prefixes the canonical signing string so the scheme can be
// rotated without ambiguity.
const signatureVersion = "v1"

// identity is the resolved edge identity forwarded to the gateway. The
// projectID is the resolved, non-secret handle used as the Bifrost virtual-key
// value at the gateway — never the raw Elitea key (design §2, §6.1).
type identity struct {
	projectID string
	userID    string
	tenantID  string
}

// identityFromContext derives the forwarded identity from the request context
// populated by the auth, project-resolution, and tenant middleware. Any field
// that cannot be resolved is left empty; the proxy still forwards, and the
// gateway decides whether a missing project is fatal (IsVkMandatory).
func identityFromContext(ctx context.Context) identity {
	var id identity

	if pc, ok := middleware.ProjectFromContext(ctx); ok && pc.ProjectID > 0 {
		id.projectID = strconv.Itoa(pc.ProjectID)
	}
	if u, ok := auth.UserFromContext(ctx); ok {
		id.userID = u.ID
	}
	if t, ok := tenant.TenantFromContext(ctx); ok {
		id.tenantID = t
	}
	return id
}

// canonical returns the deterministic string signed by the HMAC. Newline
// separation with a version prefix prevents field-concatenation ambiguity
// (e.g. project "1"+user "2" colliding with project "12").
func (id identity) canonical() string {
	return signatureVersion + "\n" + id.projectID + "\n" + id.userID + "\n" + id.tenantID
}

// sign returns the "sha256=<hex>" signature of the identity under secret.
func (id identity) sign(secret []byte) string {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(id.canonical()))
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

// stripIdentityHeaders removes any caller-supplied authentication and identity
// headers before the request is forwarded to the gateway. The gateway must only
// ever see the signed X-Elitea-* identity that this edge process injects; it
// must never see client-supplied authentication material.
//
// Stripped headers:
//   - X-Elitea-* (signed identity injected below; strip first to avoid leaking
//     any client-spoofed value)
//   - X-Auth-Type / X-Auth-Id / X-Auth-Reference (Traefik forward-auth headers)
//   - Authorization, X-Api-Key (bearer / API-key credentials)
//   - Cookie (session cookies; must not reach the downstream gateway)
//   - X-Project-Id / OpenAI-Organization (the edge project selector; the edge
//     consumes it and speaks the result as signed identity)
//   - OpenAI-Project (never a selector, but it must not travel onward either)
func stripIdentityHeaders(h http.Header) {
	// Signed edge identity headers — re-injected after stripping.
	h.Del(HeaderProjectID)
	h.Del(HeaderUserID)
	h.Del(HeaderTenantID)
	h.Del(HeaderSignature)

	// The project headers are edge control headers (issue #318). The edge
	// already read the selector, checked the caller's membership, and expressed
	// the result as X-Elitea-Project-Id. Forwarding any of them would send an
	// Elitea project id onward under a name a real provider reads: OpenAI
	// rejects a request whose OpenAI-Organization names an organization the key
	// cannot use. OpenAI-Project is stripped as well, although the edge never
	// reads it as a selector, because it carries an Elitea project id too.
	for _, name := range middleware.ProjectHeadersStrippedOutbound() {
		h.Del(name)
	}

	// Traefik forward-auth headers that the auth middleware reads; remove so the
	// gateway never sees inbound authentication context.
	h.Del("X-Auth-Type")
	h.Del("X-Auth-Id")
	h.Del("X-Auth-Reference")

	// Standard HTTP authentication material.
	h.Del("Authorization")
	h.Del("X-Api-Key")
	h.Del("Cookie")
}

// injectIdentity strips any client-supplied identity headers on out, then sets
// the edge-resolved identity. When secret is non-empty and a project is present
// it also attaches the HMAC signature.
func injectIdentity(ctx context.Context, out http.Header, secret []byte) {
	stripIdentityHeaders(out)

	id := identityFromContext(ctx)
	if id.projectID != "" {
		out.Set(HeaderProjectID, id.projectID)
	}
	if id.userID != "" {
		out.Set(HeaderUserID, id.userID)
	}
	if id.tenantID != "" {
		out.Set(HeaderTenantID, id.tenantID)
	}

	// Sign only when we have both a secret and a project identity to bind; an
	// unsigned request over the mTLS-internal network is still authenticated by
	// the transport, but a signature lets the gateway reject stray traffic.
	if len(secret) > 0 && id.projectID != "" {
		out.Set(HeaderSignature, id.sign(secret))
	}
}

// SignIdentityHeaders sets the signed X-Elitea-* identity headers on out from
// explicit project/user/tenant values, using the identical HMAC scheme
// injectIdentity uses. It exists for elitea-main callers that resolve their
// own project identity from something other than the request-scoped
// middleware context injectIdentity reads — e.g. the configurations
// check-connection client (internal/api/v2/configurations), whose project id
// is a URL path parameter, not a *middleware.ProjectContext the /configurations
// mount never populates. Mirrors the gateway's own exported
// SignIdentityHeaders (elitea-llm-gateway/internal/llmproxy/identity.go) so
// the two sides cannot silently diverge on the signing scheme.
func SignIdentityHeaders(out http.Header, secret []byte, projectID, userID, tenantID string) {
	stripIdentityHeaders(out)
	id := identity{projectID: projectID, userID: userID, tenantID: tenantID}
	if id.projectID != "" {
		out.Set(HeaderProjectID, id.projectID)
	}
	if id.userID != "" {
		out.Set(HeaderUserID, id.userID)
	}
	if id.tenantID != "" {
		out.Set(HeaderTenantID, id.tenantID)
	}
	if len(secret) > 0 && id.projectID != "" {
		out.Set(HeaderSignature, id.sign(secret))
	}
}

// verifyIdentitySignature reports whether the identity headers on h carry a
// valid signature under secret. It is used by tests here and is safe for the
// gateway side to mirror. Returns false if the signature header is absent.
func verifyIdentitySignature(h http.Header, secret []byte) bool {
	got := h.Get(HeaderSignature)
	if got == "" {
		return false
	}
	id := identity{
		projectID: h.Get(HeaderProjectID),
		userID:    h.Get(HeaderUserID),
		tenantID:  h.Get(HeaderTenantID),
	}
	want := id.sign(secret)
	return hmac.Equal([]byte(got), []byte(want))
}
