package platformconfig

// The DATABASE layer of the brand pack (ADR-0024, decision 1).
//
// The brand pack a deployment serves to the web app resolves from three layers,
// lowest first: the product default compiled into the UI, the file an operator
// mounts at BRAND_PACK_PATH, and the rows an administrator saves from the admin
// Branding section into `centry.platform_config`. This file is the read side of
// that third layer; `internal/api/v2/branding` merges the three and serves the
// result as `window.elitea_brand`.
//
// # Why rows, not a document
//
// The section is a flat set of scalar keys rather than one JSON document for
// the same reason every other section on the Configuration page is: the admin
// writer validates, merges defaults and persists per KEY, so an operator who
// sets only the hue gets only the hue overridden and everything else keeps
// coming from the layer below. A whole-document row would force the form to
// echo every field on every save, and "not set" would collapse into "set to
// the default" — the distinction that makes a layered resolution work at all.
//
// # "Absent" is the zero value, deliberately
//
// Every key is optional. An empty string or a zero number means "this layer
// says nothing about that field" and the resolver inherits from below. No brand
// field has an empty string or zero as a legitimate value (a base size of 0 is
// not a font size; an empty product name is not a product), so the sentinel
// costs nothing and spares the form a tri-state control per field.
//
// # Failure is permissive
//
// An unreadable store yields the zero overlay and the error. The resolver then
// serves the layers it CAN read — the file pack or the product default — rather
// than nothing: a database hiccup must not strip the product of its brand on
// every page load, and the resolver keeps its last good answer for exactly that
// window (see branding.Resolver).

import (
	"context"
	"reflect"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Field keys of SectionBranding. Declared next to the section they belong to,
// and mirrored by the admin schema in `internal/api/v2/admin/config_schemas.go`
// (brandingSection) — a rename breaks the build here rather than silently
// orphaning a row.
const (
	KeyBrandingProductName      = "product_name"
	KeyBrandingProductShortName = "product_short_name"
	KeyBrandingProductTagline   = "product_tagline"
	KeyBrandingDocsURL          = "docs_url"
	KeyBrandingSupportURL       = "support_url"
	KeyBrandingHue              = "brand_hue"
	KeyBrandingOnBrand          = "brand_on_brand"
	KeyBrandingFontFamily       = "font_family"
	KeyBrandingFontFamilyMono   = "font_family_mono"
	KeyBrandingBaseSize         = "base_size"
	KeyBrandingScale            = "scale"
	KeyBrandingRadiusSm         = "radius_sm"
	KeyBrandingRadiusMd         = "radius_md"
	KeyBrandingRadiusLg         = "radius_lg"
	KeyBrandingRadiusPill       = "radius_pill"
	KeyBrandingDensity          = "density"
	KeyBrandingLogoFull         = "logo_full"
	KeyBrandingLogoMark         = "logo_mark"
	KeyBrandingFavicon          = "favicon"
	KeyBrandingLoginArt         = "login_art"
	// KeyBrandingFontFaces holds an array of {family, url, weight?, style?}
	// objects — the self-hosted faces uploaded through the asset route.
	KeyBrandingFontFaces = "font_faces"
)

// FontFaceOverlay is one self-hosted face the database layer declares.
type FontFaceOverlay struct {
	Family string
	URL    string
	Weight string
	Style  string
}

// BrandingOverlay is the database layer, decoded. A zero field is "not set";
// see the file doc.
type BrandingOverlay struct {
	ProductName      string
	ProductShortName string
	ProductTagline   string
	DocsURL          string
	SupportURL       string
	Hue              string
	OnBrand          string
	FontFamily       string
	FontFamilyMono   string
	BaseSize         float64
	Scale            float64
	RadiusSm         float64
	RadiusMd         float64
	RadiusLg         float64
	RadiusPill       float64
	Density          string
	LogoFull         string
	LogoMark         string
	Favicon          string
	LoginArt         string
	FontFaces        []FontFaceOverlay
}

// IsZero reports whether the layer says nothing at all — the case in which the
// resolver must not manufacture a pack out of the product default, because an
// unset global is the documented "channel C absent" path the UI already handles
// (branding.noPackBody).
func (o BrandingOverlay) IsZero() bool {
	if len(o.FontFaces) > 0 {
		return false
	}
	o.FontFaces = nil
	return reflect.DeepEqual(o, BrandingOverlay{})
}

// LoadBranding resolves the database layer. A read error yields the zero
// overlay and the error; the caller decides what an unreadable store means.
func LoadBranding(ctx context.Context, pool *pgxpool.Pool) (BrandingOverlay, error) {
	values, err := Load(ctx, pool, SectionBranding)
	if err != nil {
		return BrandingOverlay{}, err
	}
	return brandingFrom(values), nil
}

// brandingFrom is the decode, split from the read so it is testable without a
// database. Strings are trimmed: a value of spaces is "not set", not a name of
// spaces. Numbers use Float, which treats a non-number as absent for the same
// reason Bool does — a mistyped row can only have arrived by hand.
func brandingFrom(values Values) BrandingOverlay {
	return BrandingOverlay{
		ProductName:      values.trimmed(KeyBrandingProductName),
		ProductShortName: values.trimmed(KeyBrandingProductShortName),
		ProductTagline:   values.trimmed(KeyBrandingProductTagline),
		DocsURL:          values.trimmed(KeyBrandingDocsURL),
		SupportURL:       values.trimmed(KeyBrandingSupportURL),
		Hue:              values.trimmed(KeyBrandingHue),
		OnBrand:          values.trimmed(KeyBrandingOnBrand),
		FontFamily:       values.trimmed(KeyBrandingFontFamily),
		FontFamilyMono:   values.trimmed(KeyBrandingFontFamilyMono),
		BaseSize:         values.Float(KeyBrandingBaseSize),
		Scale:            values.Float(KeyBrandingScale),
		RadiusSm:         values.Float(KeyBrandingRadiusSm),
		RadiusMd:         values.Float(KeyBrandingRadiusMd),
		RadiusLg:         values.Float(KeyBrandingRadiusLg),
		RadiusPill:       values.Float(KeyBrandingRadiusPill),
		Density:          values.trimmed(KeyBrandingDensity),
		LogoFull:         values.trimmed(KeyBrandingLogoFull),
		LogoMark:         values.trimmed(KeyBrandingLogoMark),
		Favicon:          values.trimmed(KeyBrandingFavicon),
		LoginArt:         values.trimmed(KeyBrandingLoginArt),
		FontFaces:        fontFacesFrom(values[KeyBrandingFontFaces]),
	}
}

// fontFacesFrom decodes the font_faces array. An entry that is not an object
// with a non-empty family and url is skipped rather than kept as a half
// face: the web app would declare an @font-face with no src, which is a
// silent no-op there and a puzzle for the operator here.
func fontFacesFrom(raw any) []FontFaceOverlay {
	entries, ok := raw.([]any)
	if !ok {
		return nil
	}
	faces := make([]FontFaceOverlay, 0, len(entries))
	for _, entry := range entries {
		object, ok := entry.(map[string]any)
		if !ok {
			continue
		}
		face := FontFaceOverlay{
			Family: strings.TrimSpace(stringOf(object["family"])),
			URL:    strings.TrimSpace(stringOf(object["url"])),
			Weight: strings.TrimSpace(stringOf(object["weight"])),
			Style:  strings.TrimSpace(stringOf(object["style"])),
		}
		if face.Family == "" || face.URL == "" {
			continue
		}
		faces = append(faces, face)
	}
	if len(faces) == 0 {
		return nil
	}
	return faces
}

func stringOf(v any) string {
	s, _ := v.(string)
	return s
}
