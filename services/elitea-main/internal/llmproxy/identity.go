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
func stripIdentityHeaders(h http.Header) {
	// Signed edge identity headers — re-injected after stripping.
	h.Del(HeaderProjectID)
	h.Del(HeaderUserID)
	h.Del(HeaderTenantID)
	h.Del(HeaderSignature)

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
