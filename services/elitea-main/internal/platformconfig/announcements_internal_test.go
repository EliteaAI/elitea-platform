package platformconfig

// The announcement resolvers' normalisation rules, which are the parts a client
// would otherwise have to reimplement and could get wrong.

import "testing"

// TestBannerNeedsAMessage — an enabled banner with nothing to say is not a
// banner. Resolving that here rather than in the renderer means every client
// agrees, and it means the admin form's "enabled" switch cannot produce an empty
// bar across the top of the product.
func TestBannerNeedsAMessage(t *testing.T) {
	values := Values{KeyBannerEnabled: true, KeyBannerMessage: "   "}
	banner := bannerFrom(values)
	if banner.Enabled {
		t.Error("an enabled banner whose message is whitespace resolved as enabled")
	}

	values[KeyBannerMessage] = "  Scheduled upgrade tonight.  "
	banner = bannerFrom(values)
	if !banner.Enabled {
		t.Fatal("an enabled banner with a message resolved as disabled")
	}
	if banner.Message != "Scheduled upgrade tonight." {
		t.Errorf("message = %q, want it trimmed", banner.Message)
	}
}

// TestBannerTokensFoldOntoTheEnum reproduces the legacy normaliser: a value that
// is not one of the two known tokens degrades to `info` rather than to a broken
// render. Rows written through the legacy admin page are the rows a migrating
// deployment already holds, so this is not a hypothetical input.
func TestBannerTokensFoldOntoTheEnum(t *testing.T) {
	for raw, want := range map[string]string{
		"warning":    BannerStyleWarning,
		"  WARNING":  BannerStyleWarning,
		"info":       BannerStyleInfo,
		"":           BannerStyleInfo,
		"chartreuse": BannerStyleInfo,
	} {
		if got := normaliseBannerToken(raw); got != want {
			t.Errorf("normaliseBannerToken(%q) = %q, want %q", raw, got, want)
		}
	}
}

// TestMaintenanceStaysOnWithoutCopy — the asymmetry with Banner.Enabled, stated
// in the package doc. A window with no explanation is a worse experience, not a
// cancelled one, and the default copy fills the gap.
func TestMaintenanceStaysOnWithoutCopy(t *testing.T) {
	state := maintenanceFrom(Values{KeyMaintenanceEnabled: true})
	if !state.Enabled {
		t.Fatal("maintenance with no message resolved as disabled")
	}
	if state.Title != DefaultMaintenanceTitle || state.Message != DefaultMaintenanceMessage {
		t.Errorf("state = %+v, want the default copy filled in", state)
	}

	authored := maintenanceFrom(Values{
		KeyMaintenanceEnabled: true,
		KeyMaintenanceTitle:   " Upgrading ",
		KeyMaintenanceMessage: " Back at 14:00 UTC. ",
	})
	if authored.Title != "Upgrading" || authored.Message != "Back at 14:00 UTC." {
		t.Errorf("state = %+v, want the operator's own trimmed copy", authored)
	}
}
