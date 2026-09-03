package admin

// The admin surface of the BRAND PACK's database layer (ADR-0024, decision 5).
//
// Two routes, `GET` and `PUT /admin/branding/administration`, read and write
// the `branding` section of `centry.platform_config` — the same rows the
// generic Configuration page reaches through `plugin_config_values`, with the
// same schema (config_schemas.go's brandingSection) and the same validation.
// What the typed routes add is what the generic form cannot show: which LAYERS
// contribute to the pack a user actually sees (the mounted file, the database
// rows), the EFFECTIVE pack after the merge, and its ETag — the facts the
// admin Branding page needs to render a preview and a "file versus database"
// diff. The asset uploads land beside these routes in a later unit.
//
// # Validation is one function, reached from both paths
//
// The generic writer type-checks against the schema; validateBrandingValues
// adds the field rules the schema cannot express — a hue is six hex digits, a
// link is an absolute http(s) URL, an asset is a same-origin path. It runs on
// BOTH the typed PUT and the generic save (config_values.go), so an operator
// cannot store through one door what the other refuses. The rules exist for
// the stored-XSS reason config_values.go's own link check exists: an asset
// path is rendered into `<img src>` and `<link rel="icon">` on every page.
//
// # A save is visible on the next request
//
// The resolver caches the merged pack for a short TTL. The write handler
// invalidates it after the transaction commits, so on this replica the next
// bootstrap.js carries the new brand; another replica sees it within the TTL.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"

	v2branding "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/branding"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/platformconfig"
)

// BrandingResolver is the seam to the pack resolver: the current merged
// snapshot, and the invalidation a save triggers.
type BrandingResolver interface {
	Current(ctx context.Context) v2branding.Snapshot
	Invalidate()
}

// WithBranding supplies the resolver. Without it the typed routes still read
// and write the rows, and report no effective pack — the composition root has
// not wired the bootstrap route, so there is no pack to describe.
func WithBranding(resolver BrandingResolver) Option {
	return func(h *Handler) {
		if resolver == nil {
			return
		}
		h.branding = resolver
	}
}

// brandingResponse is the wire shape of both routes.
type brandingResponse struct {
	// Values is the section's declared keys with the stored values overlaid on
	// the schema defaults — the generic form's shape, so the two editors agree.
	Values map[string]any `json:"values"`
	// Layers says which operator-controlled layers contribute to the served
	// pack: the mounted file, the database rows.
	Layers v2branding.Layers `json:"layers"`
	// Effective is the merged pack the bootstrap route serves right now, or
	// null when nothing is served (no file, no rows) — the UI then renders its
	// compiled default.
	Effective *v2branding.Pack `json:"effective"`
	// ETag is the unquoted content hash of the served bootstrap body; a page
	// that has just saved can wait for it to change.
	ETag  string `json:"etag,omitempty"`
	Saved bool   `json:"saved,omitempty"`
}

// BrandingRead serves `GET /admin/branding/administration`.
func (h *Handler) BrandingRead(w http.ResponseWriter, r *http.Request) {
	section, ok := findConfigSection(platformconfig.SectionBranding)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "branding section missing"})
		return
	}
	h.writeBrandingState(w, r, section, false)
}

// BrandingSave serves `PUT /admin/branding/administration`. The body is the
// generic save's `{"values": {...}}` so a form can move between the two
// editors without a translation layer.
func (h *Handler) BrandingSave(w http.ResponseWriter, r *http.Request) {
	section, ok := findConfigSection(platformconfig.SectionBranding)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "branding section missing"})
		return
	}

	var body configSaveBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid request body"})
		return
	}
	if body.Values == nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "values is required"})
		return
	}
	if reason := validateSectionValues(section, body.Values); reason != "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": reason})
		return
	}
	if reason := validateBrandingValues(body.Values); reason != "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": reason})
		return
	}

	principal, _ := auth.UserFromContext(r.Context())
	author := principal.Email
	if author == "" {
		author = principal.ID
	}
	if err := h.storeSectionValues(r, section.id, body.Values, author); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "could not write the platform configuration store",
		})
		return
	}
	h.invalidateBranding()
	h.writeBrandingState(w, r, section, true)
}

// invalidateBranding drops the resolver's cache after a write to the branding
// section, from either editor.
func (h *Handler) invalidateBranding() {
	if h.branding != nil {
		h.branding.Invalidate()
	}
}

// writeBrandingState re-READS the rows (never echoes the request — a write
// that silently failed must look different from one that landed) and
// describes the resolved pack beside them.
func (h *Handler) writeBrandingState(w http.ResponseWriter, r *http.Request, section configSection, saved bool) {
	stored, err := h.loadSectionValues(r, section.id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "could not read the platform configuration store",
		})
		return
	}
	response := brandingResponse{
		Values: mergeSectionValues(section, stored),
		Saved:  saved,
	}
	if h.branding != nil {
		snap := h.branding.Current(r.Context())
		response.Layers = snap.Layers
		response.Effective = snap.Pack
		response.ETag = snap.ETagValue
	}
	writeJSON(w, http.StatusOK, response)
}

// ---------------------------------------------------------------------------
// field rules
// ---------------------------------------------------------------------------

var hexColourPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// Bounds. The typography bounds are the brand-pack schema's own
// (branding/pack.go); the text bounds are generous against any real product
// name and tight enough that a paste cannot turn the document title or the
// login heading into a paragraph.
const (
	maxBrandingNameRunes    = 80
	maxBrandingTaglineRunes = 200
	maxBrandingFontRunes    = 200
	maxBrandingPathRunes    = 512
	minBrandingBaseSize     = 12
	maxBrandingBaseSize     = 18
	minBrandingScale        = 1.05
	maxBrandingScale        = 1.5
	maxBrandingRadius       = 9999
)

// validateBrandingValues returns "" when the values may be stored, or the
// sentence the operator is shown. An empty string or a zero number is always
// accepted: it means "inherit from the layer below" (platformconfig/branding.go).
// Keys are visited in sorted order so the first refusal is deterministic.
func validateBrandingValues(values map[string]any) string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	for _, key := range keys {
		var reason string
		switch key {
		case platformconfig.KeyBrandingHue, platformconfig.KeyBrandingOnBrand:
			reason = validateHexColour(key, values[key])
		case platformconfig.KeyBrandingDocsURL, platformconfig.KeyBrandingSupportURL:
			reason = validateAbsoluteHTTPURL(key, values[key])
		case platformconfig.KeyBrandingLogoFull, platformconfig.KeyBrandingLogoMark,
			platformconfig.KeyBrandingFavicon, platformconfig.KeyBrandingLoginArt:
			reason = validateSameOriginPath(key, values[key])
		case platformconfig.KeyBrandingProductName, platformconfig.KeyBrandingProductShortName:
			reason = validateRuneBound(key, values[key], maxBrandingNameRunes)
		case platformconfig.KeyBrandingProductTagline:
			reason = validateRuneBound(key, values[key], maxBrandingTaglineRunes)
		case platformconfig.KeyBrandingFontFamily, platformconfig.KeyBrandingFontFamilyMono:
			reason = validateRuneBound(key, values[key], maxBrandingFontRunes)
		case platformconfig.KeyBrandingBaseSize:
			reason = validateNumberInRange(key, values[key], minBrandingBaseSize, maxBrandingBaseSize)
		case platformconfig.KeyBrandingScale:
			reason = validateNumberInRange(key, values[key], minBrandingScale, maxBrandingScale)
		case platformconfig.KeyBrandingRadiusSm, platformconfig.KeyBrandingRadiusMd,
			platformconfig.KeyBrandingRadiusLg, platformconfig.KeyBrandingRadiusPill:
			reason = validateNumberInRange(key, values[key], 0, maxBrandingRadius)
		case platformconfig.KeyBrandingDensity:
			reason = validateDensity(key, values[key])
		}
		if reason != "" {
			return reason
		}
	}
	return ""
}

func stringValue(value any) (string, bool) {
	text, ok := value.(string)
	return strings.TrimSpace(text), ok
}

func validateHexColour(key string, value any) string {
	text, ok := stringValue(value)
	if !ok || text == "" {
		return ""
	}
	if !hexColourPattern.MatchString(text) {
		return fmt.Sprintf("%q must be a six-digit hex colour such as #1A73E8", key)
	}
	return ""
}

func validateAbsoluteHTTPURL(key string, value any) string {
	text, ok := stringValue(value)
	if !ok || text == "" {
		return ""
	}
	parsed, err := url.Parse(text)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return fmt.Sprintf("%q must be an absolute http or https URL", key)
	}
	return ""
}

// validateSameOriginPath admits only a root-relative path on this origin:
// one leading slash, no scheme, no authority, no whitespace or control
// characters. That excludes `javascript:`, `data:` and protocol-relative
// `//host` forms by construction rather than by denylist. The uploaded-asset
// route of a later unit hands out exactly this shape.
func validateSameOriginPath(key string, value any) string {
	text, ok := stringValue(value)
	if !ok || text == "" {
		return ""
	}
	if utf8.RuneCountInString(text) > maxBrandingPathRunes {
		return fmt.Sprintf("%q is too long", key)
	}
	if !strings.HasPrefix(text, "/") || strings.HasPrefix(text, "//") || strings.HasPrefix(text, "/\\") {
		return fmt.Sprintf("%q must be a path on this origin, starting with a single /", key)
	}
	for _, r := range text {
		if r <= ' ' || r == 0x7f {
			return fmt.Sprintf("%q must not contain whitespace or control characters", key)
		}
	}
	if parsed, err := url.Parse(text); err != nil || parsed.Scheme != "" || parsed.Host != "" {
		return fmt.Sprintf("%q must be a path on this origin, starting with a single /", key)
	}
	return ""
}

func validateRuneBound(key string, value any, max int) string {
	text, ok := stringValue(value)
	if !ok {
		return ""
	}
	if utf8.RuneCountInString(text) > max {
		return fmt.Sprintf("%q must be at most %d characters", key, max)
	}
	return ""
}

func validateNumberInRange(key string, value any, min, max float64) string {
	number, ok := value.(float64)
	if !ok || number == 0 {
		return ""
	}
	if number < min || number > max {
		return fmt.Sprintf("%q must be between %v and %v, or 0 to inherit", key, min, max)
	}
	return ""
}

func validateDensity(key string, value any) string {
	text, ok := stringValue(value)
	if !ok || text == "" || text == "comfortable" || text == "compact" {
		return ""
	}
	return fmt.Sprintf("%q must be \"comfortable\", \"compact\" or empty to inherit", key)
}
