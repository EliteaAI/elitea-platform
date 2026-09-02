package platformconfig

import "testing"

func TestBrandingFrom(t *testing.T) {
	t.Run("empty section is the zero overlay", func(t *testing.T) {
		if got := brandingFrom(Values{}); !got.IsZero() {
			t.Fatalf("brandingFrom(empty) = %+v, want zero", got)
		}
	})

	t.Run("strings are trimmed and numbers decoded", func(t *testing.T) {
		got := brandingFrom(Values{
			KeyBrandingProductName: "  Acme AI ",
			KeyBrandingHue:         "#FF6600",
			KeyBrandingBaseSize:    float64(15),
			KeyBrandingDensity:     "compact",
		})
		want := BrandingOverlay{ProductName: "Acme AI", Hue: "#FF6600", BaseSize: 15, Density: "compact"}
		if got != want {
			t.Fatalf("brandingFrom = %+v, want %+v", got, want)
		}
	})

	t.Run("a value of spaces is not set", func(t *testing.T) {
		got := brandingFrom(Values{KeyBrandingProductName: "   "})
		if !got.IsZero() {
			t.Fatalf("whitespace-only name should read as unset, got %+v", got)
		}
	})

	t.Run("a mistyped row reads as absent, never as a value", func(t *testing.T) {
		got := brandingFrom(Values{
			KeyBrandingProductName: 42,        // number where a string belongs
			KeyBrandingBaseSize:    "fifteen", // string where a number belongs
		})
		if !got.IsZero() {
			t.Fatalf("mistyped rows should read as unset, got %+v", got)
		}
	})
}
