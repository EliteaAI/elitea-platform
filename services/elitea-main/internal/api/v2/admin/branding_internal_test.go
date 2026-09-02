package admin

import (
	"strings"
	"testing"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/platformconfig"
)

func TestValidateBrandingValues(t *testing.T) {
	tests := []struct {
		name   string
		values map[string]any
		want   string // "" = accepted; otherwise a substring of the refusal
	}{
		{name: "empty body", values: map[string]any{}},
		{name: "every field empty inherits", values: map[string]any{
			platformconfig.KeyBrandingProductName: "", platformconfig.KeyBrandingHue: "",
			platformconfig.KeyBrandingBaseSize: float64(0), platformconfig.KeyBrandingLogoFull: "",
			platformconfig.KeyBrandingDensity: "",
		}},
		{name: "a complete valid overlay", values: map[string]any{
			platformconfig.KeyBrandingProductName: "Acme AI",
			platformconfig.KeyBrandingHue:         "#1a73e8",
			platformconfig.KeyBrandingDocsURL:     "https://docs.acme.example/elitea",
			platformconfig.KeyBrandingFontFamily:  `"Inter", Arial, sans-serif`,
			platformconfig.KeyBrandingBaseSize:    float64(15),
			platformconfig.KeyBrandingScale:       1.25,
			platformconfig.KeyBrandingRadiusPill:  float64(9999),
			platformconfig.KeyBrandingDensity:     "compact",
			platformconfig.KeyBrandingLogoFull:    "/branding/assets/logo-full/abc123.svg",
		}},

		{name: "hue without hash", values: map[string]any{platformconfig.KeyBrandingHue: "1a73e8"}, want: "six-digit hex"},
		{name: "hue short form", values: map[string]any{platformconfig.KeyBrandingHue: "#fff"}, want: "six-digit hex"},
		{name: "on-brand colour is checked too", values: map[string]any{platformconfig.KeyBrandingOnBrand: "white"}, want: "six-digit hex"},

		{name: "docs url relative", values: map[string]any{platformconfig.KeyBrandingDocsURL: "/docs"}, want: "absolute http"},
		{name: "support url javascript", values: map[string]any{platformconfig.KeyBrandingSupportURL: "javascript:alert(1)"}, want: "absolute http"},

		{name: "logo with a scheme", values: map[string]any{platformconfig.KeyBrandingLogoFull: "https://cdn.example/logo.svg"}, want: "path on this origin"},
		{name: "logo as data uri", values: map[string]any{platformconfig.KeyBrandingLogoMark: "data:image/svg+xml;base64,AAAA"}, want: "path on this origin"},
		{name: "logo javascript", values: map[string]any{platformconfig.KeyBrandingFavicon: "javascript:alert(1)"}, want: "path on this origin"},
		{name: "logo protocol-relative", values: map[string]any{platformconfig.KeyBrandingLoginArt: "//evil.example/x.png"}, want: "path on this origin"},
		{name: "logo with whitespace", values: map[string]any{platformconfig.KeyBrandingLogoFull: "/brand/my logo.svg"}, want: "whitespace"},
		{name: "logo with a newline", values: map[string]any{platformconfig.KeyBrandingLogoFull: "/brand/a.svg\n<script>"}, want: "whitespace"},

		{name: "name too long", values: map[string]any{platformconfig.KeyBrandingProductName: strings.Repeat("x", 81)}, want: "at most 80"},
		{name: "base size out of range", values: map[string]any{platformconfig.KeyBrandingBaseSize: float64(24)}, want: "between 12 and 18"},
		{name: "scale out of range", values: map[string]any{platformconfig.KeyBrandingScale: float64(2)}, want: "between 1.05 and 1.5"},
		{name: "negative radius", values: map[string]any{platformconfig.KeyBrandingRadiusSm: float64(-1)}, want: "between 0 and 9999"},
		{name: "density typo", values: map[string]any{platformconfig.KeyBrandingDensity: "cosy"}, want: "comfortable"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := validateBrandingValues(tc.values)
			if tc.want == "" && got != "" {
				t.Fatalf("refused: %s", got)
			}
			if tc.want != "" && !strings.Contains(got, tc.want) {
				t.Fatalf("got %q, want a refusal containing %q", got, tc.want)
			}
		})
	}
}

// TestBrandingSection_DeclaresEveryOverlayKey pins the schema to the reader:
// a key the resolver reads but the form does not declare could never be set,
// and a key the form declares but nothing reads is the defect the section
// registry's "live only once read" rule exists to stop.
func TestBrandingSection_DeclaresEveryOverlayKey(t *testing.T) {
	section, ok := findConfigSection(platformconfig.SectionBranding)
	if !ok {
		t.Fatal("branding section is not registered")
	}
	if perm, _ := section.raw["required_permission"].(string); perm != "configuration.branding" {
		t.Fatalf("required_permission = %q, want configuration.branding", perm)
	}
	if reason, _ := section.raw["unavailable_reason"].(string); reason != "" {
		t.Fatalf("branding section must be live, has unavailable_reason %q", reason)
	}

	declared := map[string]bool{}
	for _, field := range section.fields {
		key, _ := field["key"].(string)
		declared[key] = true
		if format, _ := field["format"].(string); format == "password" {
			t.Errorf("field %q is a credential; the section must not carry one", key)
		}
	}
	for _, key := range []string{
		platformconfig.KeyBrandingProductName, platformconfig.KeyBrandingProductShortName,
		platformconfig.KeyBrandingProductTagline, platformconfig.KeyBrandingDocsURL,
		platformconfig.KeyBrandingSupportURL, platformconfig.KeyBrandingHue,
		platformconfig.KeyBrandingOnBrand, platformconfig.KeyBrandingFontFamily,
		platformconfig.KeyBrandingFontFamilyMono, platformconfig.KeyBrandingBaseSize,
		platformconfig.KeyBrandingScale, platformconfig.KeyBrandingRadiusSm,
		platformconfig.KeyBrandingRadiusMd, platformconfig.KeyBrandingRadiusLg,
		platformconfig.KeyBrandingRadiusPill, platformconfig.KeyBrandingDensity,
		platformconfig.KeyBrandingLogoFull, platformconfig.KeyBrandingLogoMark,
		platformconfig.KeyBrandingFavicon, platformconfig.KeyBrandingLoginArt,
	} {
		if !declared[key] {
			t.Errorf("overlay key %q is read by platformconfig but not declared by the section", key)
		}
		delete(declared, key)
	}
	for key := range declared {
		t.Errorf("section declares %q, which no reader consumes", key)
	}
}
