package browserauth

// The BRAND on the login page (ADR-0024 WP5).
//
// The login page is Go-served HTML behind the strictest CSP on the platform
// (`default-src 'none'`, one hash-pinned stylesheet). It is also the first
// thing a customer's users see, so it is the one surface a rebrand must
// reach that the web app's BrandThemeProvider cannot. This file derives what
// the page shows from the same resolved pack the bootstrap route serves —
// the product name, tagline, logo, favicon, login artwork, brand colour,
// radius and font — and renders it under the same CSP discipline:
//
//   - Every value passes through a narrow allowlist before it becomes HTML
//     or CSS. A hue is six hex digits or nothing; an asset is a root-relative
//     path with no quote, bracket, backslash, angle bracket or whitespace, or
//     nothing; a font family is letters, digits, spaces, commas, hyphens and
//     quotes, or nothing. The values were validated on the way in
//     (admin/branding.go) — the allowlist here is what makes that a
//     defence in depth rather than the only line.
//   - The brand rules go in a SECOND <style> element whose SHA-256 joins the
//     static stylesheet's hash in `style-src`. No 'unsafe-inline', ever.
//   - `img-src 'self'` and `font-src 'self'` admit the same-origin assets and
//     nothing else; a served pack cannot point the login page at another
//     origin because the allowlist above already dropped the value.
//
// Without a brand source, or with nothing served, the page renders exactly
// as before with the product name "Elitea".

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"html/template"
	"regexp"
	"strings"

	v2branding "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/branding"
)

// BrandSource is the seam to the resolved brand pack. The bootstrap route's
// resolver satisfies it; nil means "no brand, render the default".
type BrandSource interface {
	Current(ctx context.Context) v2branding.Snapshot
}

// DefaultProductName is what the page says when no pack names a product.
const DefaultProductName = "Elitea"

// loginBrand is what the template renders.
type loginBrand struct {
	ProductName string
	Tagline     string
	LogoURL     string
	FaviconURL  string
	// Style is the brand's own rules; empty when the pack states nothing the
	// page renders. StyleSource is its CSP hash source, "" when Style is empty.
	Style       template.CSS
	StyleSource string
}

func (h *Handler) loginBrand(ctx context.Context) loginBrand {
	if h.brand == nil {
		return loginBrand{ProductName: DefaultProductName}
	}
	snapshot := h.brand.Current(ctx)
	if snapshot.Pack == nil {
		return loginBrand{ProductName: DefaultProductName}
	}
	return loginBrandFromPack(snapshot.Pack)
}

var (
	hexColourPattern  = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
	fontFamilyPattern = regexp.MustCompile(`^[A-Za-z0-9 ,'"_-]{1,200}$`)
	fontWeightPattern = regexp.MustCompile(`^(?:normal|bold|[1-9][0-9]{0,2}(?: [1-9][0-9]{0,2})?)$`)
)

// loginBrandFromPack derives the page's brand from a resolved pack. Every
// field degrades to "nothing" on its own; a pack with a good name and a bad
// logo path shows the name and no logo.
func loginBrandFromPack(pack *v2branding.Pack) loginBrand {
	brand := loginBrand{ProductName: DefaultProductName}
	if name := strings.TrimSpace(pack.Product.Name); name != "" {
		brand.ProductName = name
	}
	if pack.Product.Tagline != nil {
		brand.Tagline = strings.TrimSpace(*pack.Product.Tagline)
	}
	brand.LogoURL = cssSafeAssetPath(pack.Assets.LogoFull)
	brand.FaviconURL = cssSafeAssetPath(pack.Assets.Favicon)

	var css strings.Builder
	if hue := cssHexColour(pack.Brand.Hue); hue != "" {
		onBrand := "#ffffff"
		if pack.Brand.OnBrand != nil {
			if v := cssHexColour(*pack.Brand.OnBrand); v != "" {
				onBrand = v
			}
		}
		fmt.Fprintf(&css,
			".sign-in-button{background:%s;border-color:%s;color:%s}"+
				".sign-in-button:hover{background:%s;border-color:%s;filter:brightness(0.92)}"+
				".form-control:focus{border-color:%s;outline-color:%s}",
			hue, hue, onBrand, hue, hue, hue, hue)
	}
	for _, face := range pack.Typography.FontFaces {
		family := cssFontFamily(face.Family)
		path := cssSafeAssetPath(face.URL)
		if family == "" || path == "" {
			continue
		}
		// One quoted family name: a face declares one family, and the quotes
		// make a name with a space or a digit unambiguous.
		fmt.Fprintf(&css, "@font-face{font-family:%q;src:url(%q) format(\"woff2\");font-display:swap",
			strings.Trim(family, `"'`), path)
		if face.Weight != nil && fontWeightPattern.MatchString(*face.Weight) {
			fmt.Fprintf(&css, ";font-weight:%s", *face.Weight)
		}
		if face.Style != nil && (*face.Style == "normal" || *face.Style == "italic") {
			fmt.Fprintf(&css, ";font-style:%s", *face.Style)
		}
		css.WriteString("}")
	}
	if family := cssFontFamily(pack.Typography.FontFamily); family != "" {
		fmt.Fprintf(&css, ":root{font-family:%s}", family)
	}
	if radius := pack.Shape.RadiusMd; radius >= 0 && radius <= 9999 {
		fmt.Fprintf(&css, ".card-signin{border-radius:%gpx}", radius)
	}
	if pack.Assets.LoginArt != nil {
		if art := cssSafeAssetPath(*pack.Assets.LoginArt); art != "" {
			fmt.Fprintf(&css, "body{background-image:url(%q);background-size:cover;background-position:center}", art)
		}
	}
	if css.Len() > 0 {
		brand.Style = template.CSS(css.String()) //nolint:gosec // every value passed an allowlist above
		digest := sha256.Sum256([]byte(css.String()))
		brand.StyleSource = "'sha256-" + base64.StdEncoding.EncodeToString(digest[:]) + "'"
	}
	return brand
}

// cssHexColour admits exactly #RRGGBB, lower-cased.
func cssHexColour(value string) string {
	value = strings.TrimSpace(value)
	if !hexColourPattern.MatchString(value) {
		return ""
	}
	return strings.ToLower(value)
}

// cssFontFamily admits a plain family list. Quotes are kept (a family with a
// space needs them); every character that could close a rule or a string
// context is outside the class.
func cssFontFamily(value string) string {
	value = strings.TrimSpace(value)
	if !fontFamilyPattern.MatchString(value) {
		return ""
	}
	return value
}

// cssSafeAssetPath admits a root-relative same-origin path — one leading
// slash, no `//`, no whitespace or control characters, none of the
// characters that end a CSS url() or an HTML attribute early.
func cssSafeAssetPath(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 512 || !strings.HasPrefix(value, "/") || strings.HasPrefix(value, "//") {
		return ""
	}
	for _, r := range value {
		if r <= ' ' || r == 0x7f || strings.ContainsRune(`"'()\<>`, r) {
			return ""
		}
	}
	return value
}

// loginContentSecurityPolicy is the form page's CSP: the static stylesheet
// hash, the brand stylesheet hash when there is one, and same-origin images
// and fonts for the brand assets.
func loginContentSecurityPolicy(brandStyleSource string) string {
	styleSources := loginStyleCSPSource
	if brandStyleSource != "" {
		styleSources += " " + brandStyleSource
	}
	return "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; " +
		"img-src 'self'; font-src 'self'; style-src " + styleSources
}
