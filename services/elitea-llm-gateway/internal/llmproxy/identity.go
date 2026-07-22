package llmproxy

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
)

// Signed internal identity headers forwarded by elitea-main. The gateway trusts
// these only because the hop is mTLS-internal (design §2, §6.1); the HMAC
// signature is defense-in-depth so a header that leaks onto the internal
// network without the shared secret cannot forge a project identity. These
// mirror elitea-main/internal/llmproxy/identity.go (a separate module).
const (
	headerProjectID = "X-Elitea-Project-Id"
	headerUserID    = "X-Elitea-User-Id"
	headerTenantID  = "X-Elitea-Tenant-Id"
	// headerSignature carries "sha256=<hex>" over the canonical identity tuple.
	headerSignature = "X-Elitea-Identity-Signature"
)

// signatureVersion prefixes the canonical signing string so the scheme can be
// rotated without ambiguity. MUST match the edge's constant.
const signatureVersion = "v1"

// identity is the resolved edge identity carried on an inbound gateway request.
// projectID is the Bifrost virtual-key value (a resolved, non-secret handle —
// never the raw Elitea key; design §2, §6.1).
type identity struct {
	projectID string
	userID    string
	tenantID  string
}

// identityFromHeaders reads the forwarded identity headers off an inbound
// request. It does not validate the signature; callers use verifySignature for
// that.
func identityFromHeaders(h http.Header) identity {
	return identity{
		projectID: h.Get(headerProjectID),
		userID:    h.Get(headerUserID),
		tenantID:  h.Get(headerTenantID),
	}
}

// canonical returns the deterministic string signed by the HMAC. Newline
// separation with a version prefix prevents field-concatenation ambiguity
// (e.g. project "1"+user "2" colliding with project "12"). MUST match the edge.
func (id identity) canonical() string {
	return signatureVersion + "\n" + id.projectID + "\n" + id.userID + "\n" + id.tenantID
}

// sign returns the "sha256=<hex>" signature of the identity under secret.
func (id identity) sign(secret []byte) string {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(id.canonical()))
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

// verifySignature reports whether the identity headers on h carry a valid
// signature under secret. An empty secret disables verification (the mTLS
// transport still authenticates the hop); this matches the edge, which only
// signs when a secret is configured. Returns false when a secret is configured
// but the signature header is absent or does not match.
func verifySignature(h http.Header, secret []byte) bool {
	if len(secret) == 0 {
		return true
	}
	got := h.Get(headerSignature)
	if got == "" {
		return false
	}
	want := identityFromHeaders(h).sign(secret)
	return hmac.Equal([]byte(got), []byte(want))
}
