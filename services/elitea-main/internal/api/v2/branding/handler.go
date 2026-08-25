package branding

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
)

// Cache-Control values per spec §4.3 channel C:
//
//   - bare URL (no ?v=): the reference index.html holds before it knows the
//     current version — must revalidate every time, hence no-cache + ETag.
//   - versioned URL (?v= matches the current ETag): content-addressed, safe
//     to cache forever.
const (
	cacheRevalidate = "no-cache"
	cacheImmutable  = "public, max-age=31536000, immutable"
)

// Config carries the handler's wiring inputs.
type Config struct {
	// PackPath is the deployment-level brand pack file (BRAND_PACK_PATH env
	// var; Q5 v1 = deployment-level pack only). Empty means "not configured":
	// the built-in default pack is served.
	PackPath string
}

// Handler serves GET /api/v2/branding/bootstrap.js.
//
// The pack is resolved once at construction: a deployment-level pack can
// only change with a redeploy/restart (Q5 v1), so loading at startup gives a
// stable body, a stable strong ETag, and zero per-request filesystem I/O.
type Handler struct {
	body      []byte
	etag      string // strong quoted form sent in the ETag header: "<hex>"
	etagValue string // unquoted hex — the ?v= token
}

// NewHandler resolves the pack per Config and precomputes the bootstrap
// body. It never fails: every degradation path lands on the built-in
// default pack and is logged.
func NewHandler(cfg Config) *Handler {
	var pack *Pack
	if cfg.PackPath == "" {
		slog.Info("branding: BRAND_PACK_PATH not set; publishing no pack so the UI renders its compiled-in default")
	} else if loaded, err := LoadPack(cfg.PackPath); err != nil {
		slog.Warn("branding: degrading to the UI's compiled-in default brand pack",
			"path", cfg.PackPath, "reason", err.Error())
	} else {
		pack = loaded
		slog.Info("branding: serving deployment brand pack",
			"path", cfg.PackPath, "pack_id", pack.ID, "pack_version", pack.Version)
	}

	body := renderBootstrapJS(pack)
	sum := sha256.Sum256(body)
	etagValue := hex.EncodeToString(sum[:])
	return &Handler{
		body:      body,
		etag:      `"` + etagValue + `"`,
		etagValue: etagValue,
	}
}

// noPackBody is what the endpoint serves when this deployment has no brand
// pack of its own. It deliberately leaves `window.elitea_brand` UNSET.
//
// The alternative — serving DefaultPack() — is what this endpoint used to do,
// and it was a whole-app visual regression rather than a harmless floor.
// Channel C WINS over the UI's compiled-in pack whenever the global is set
// (`shared/brand/channelC.ts`), and DefaultPack states zero scheme tokens, so
// `resolveScheme` derives all 362 ids per scheme by rotating the reference
// ramp onto `brand.hue`. With the placeholder hue (#C428DD) that rotated the
// dark scheme's cyan accent and navy surfaces ~105 degrees into magenta and
// purple-black, and swapped Montserrat for Roboto, on EVERY screen — the
// running app never looked like the product default it was supposed to fall
// back to. DefaultPack() is kept as the schema/validation reference and for
// the tests that pin its shape; it is just no longer published.
//
// A 200 with an inert body rather than a 404: `index.html` loads this as a
// blocking classic script, and an unset global is the documented
// "channel C absent" path, so this degrades exactly as intended without
// putting a network error in every user's console.
const noPackBody = "/* elitea: no deployment brand pack configured */\n"

// renderBootstrapJS serialises the pack as `window.elitea_brand = {...};`,
// or the inert body above when there is no pack to publish.
// json.Marshal HTML-escapes <, >, & (and escapes U+2028/U+2029), so the JSON
// is safe to embed in a <script> element and is a valid JS expression.
func renderBootstrapJS(p *Pack) []byte {
	if p == nil {
		return []byte(noPackBody)
	}
	data, err := json.Marshal(p)
	if err != nil {
		// Unreachable for Pack (plain data, no cycles, no custom marshalers);
		// if it ever happens, publish nothing rather than letting the
		// branding path fail — the UI then renders its own default pack.
		return []byte(noPackBody)
	}
	return append(append([]byte("window.elitea_brand = "), data...), ';')
}

// ETag returns the strong quoted entity tag of the current body (test hook
// and the value index.html templating would embed as ?v=, unquoted).
func (h *Handler) ETag() string { return h.etag }

// Bootstrap handles GET /api/v2/branding/bootstrap.js per spec §4.3 C.
//
// Header matrix:
//
//	bare URL                  → 200, ETag, Cache-Control: no-cache
//	?v= matches current ETag  → 200, ETag, Cache-Control: public, max-age=31536000, immutable
//	?v= mismatch              → 302 to ?v=<current>, Cache-Control: no-cache
//	If-None-Match matches     → 304, ETag + the same Cache-Control as the 200
//
// Mismatch policy: 302 redirect (not "serve current under the stale URL").
// A versioned URL is a content address served with an immutable cache
// policy; answering a stale ?v with different bytes would let any cache that
// holds that URL keep the old body forever while new clients see new bytes
// under the same address. The redirect keeps every ?v= URL's content stable
// and lands the client on the correct immutable URL in one hop. The redirect
// itself is marked no-cache so a recovered version token is never masked.
func (h *Handler) Bootstrap(w http.ResponseWriter, r *http.Request) {
	v := r.URL.Query().Get("v")
	if v != "" && v != h.etagValue {
		w.Header().Set("Cache-Control", cacheRevalidate)
		http.Redirect(w, r, r.URL.Path+"?v="+h.etagValue, http.StatusFound)
		return
	}

	cacheControl := cacheRevalidate
	if v != "" { // v == h.etagValue: content-addressed URL
		cacheControl = cacheImmutable
	}
	w.Header().Set("ETag", h.etag)
	w.Header().Set("Cache-Control", cacheControl)

	if etagMatches(r.Header.Get("If-None-Match"), h.etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Length", strconv.Itoa(len(h.body)))
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodHead {
		// HEAD carries the exact GET headers (including Content-Length of
		// the would-be body) with no body (RFC 9110 §9.3.2) — CDN and
		// monitoring probes expect this instead of a 401/405.
		return
	}
	_, _ = w.Write(h.body)
}

// etagMatches implements If-None-Match evaluation (RFC 9110 §13.1.2) against
// one current entity tag: a list of entity-tags or "*", weak comparison (a
// W/ prefix on the client's copy still matches — permitted for GET 304
// revalidation).
//
// Tokenization follows RFC 9110 §8.8.3: an entity-tag is a quoted string, so
// list splitting happens only on commas OUTSIDE quotes — the single
// entity-tag `"abc,*,def"` is one (non-matching) tag, not three candidates.
// "*" is only valid as the ENTIRE field value, never as a list member.
func etagMatches(ifNoneMatch, etag string) bool {
	if ifNoneMatch == "" {
		return false
	}
	if strings.TrimSpace(ifNoneMatch) == "*" {
		return true
	}
	for _, candidate := range splitETagList(ifNoneMatch) {
		candidate = strings.TrimPrefix(strings.TrimSpace(candidate), "W/")
		if candidate == etag {
			return true
		}
	}
	return false
}

// splitETagList splits an If-None-Match field value on commas that sit
// outside quoted strings. Entity-tags cannot contain a DQUOTE (etagc
// excludes it, RFC 9110 §8.8.3), so a plain quote toggle is exact — there is
// no escaping to worry about.
func splitETagList(v string) []string {
	var out []string
	inQuote := false
	start := 0
	for i := 0; i < len(v); i++ {
		switch v[i] {
		case '"':
			inQuote = !inQuote
		case ',':
			if !inQuote {
				out = append(out, v[start:i])
				start = i + 1
			}
		}
	}
	return append(out, v[start:])
}
