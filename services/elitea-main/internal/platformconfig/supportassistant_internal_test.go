package platformconfig

import "testing"

// A STORED ZERO IS NOT AN ABSENT KEY. This is the distinction `Values.Int` exists
// to preserve, and the one that decides whether the assistant refuses or aims a
// support turn at whatever row id 0 resolves to.
func TestStoredZeroDoesNotReadAsAConfiguredAgent(t *testing.T) {
	settings := Values{
		KeySupportAssistantEnabled: true,
		KeySupportProjectID:        float64(7),
		KeySupportAgentID:          float64(0),
	}.SupportAssistant()

	if settings.AgentID != 0 {
		t.Fatalf("AgentID = %d, want 0", settings.AgentID)
	}
	if settings.Ready() {
		t.Fatal("Ready() is true with agent id 0; a support turn would be aimed at no agent")
	}
}

// Enabled alone is not enough, and each missing piece is enough to refuse.
func TestReadyRequiresTheSwitchTheProjectAndTheAgent(t *testing.T) {
	for name, settings := range map[string]SupportAssistant{
		"switch off":     {Enabled: false, ProjectID: 7, AgentID: 9},
		"no project":     {Enabled: true, ProjectID: 0, AgentID: 9},
		"no agent":       {Enabled: true, ProjectID: 7, AgentID: 0},
		"nothing at all": {},
	} {
		t.Run(name, func(t *testing.T) {
			if settings.Ready() {
				t.Fatal("Ready() is true; the widget would render and fail on send")
			}
		})
	}
	if !(SupportAssistant{Enabled: true, ProjectID: 7, AgentID: 9}).Ready() {
		t.Fatal("a fully configured assistant is not Ready()")
	}
}

// `agent_project_id` falls back to the support project — `sio/support.py`'s
// `agent_project_id or support_project_id`.
func TestAgentProjectFallsBackToTheSupportProject(t *testing.T) {
	if got := (SupportAssistant{ProjectID: 7}).AgentProject(); got != 7 {
		t.Fatalf("AgentProject() = %d, want the support project 7", got)
	}
	if got := (SupportAssistant{ProjectID: 7, AgentProjectID: 42}).AgentProject(); got != 42 {
		t.Fatalf("AgentProject() = %d, want the chosen agent project 42", got)
	}
}

// An operator who has typed nothing still gets the reference's strings, so the
// widget never renders an empty title or greeting.
func TestUnconfiguredStringsFallBackToTheReferenceDefaults(t *testing.T) {
	settings := Values{}.SupportAssistant()
	if settings.Name != DefaultSupportAssistantName {
		t.Errorf("Name = %q, want %q", settings.Name, DefaultSupportAssistantName)
	}
	if settings.WelcomeMessage != DefaultSupportWelcome {
		t.Errorf("WelcomeMessage = %q, want %q", settings.WelcomeMessage, DefaultSupportWelcome)
	}
	if settings.Placeholder != DefaultSupportPlaceholder {
		t.Errorf("Placeholder = %q, want %q", settings.Placeholder, DefaultSupportPlaceholder)
	}
}

// A row of the wrong type is ABSENT, not false — Bool's own rule, restated here
// because this is the switch that turns a platform-wide feature off.
func TestAMistypedSwitchDoesNotDisableTheAssistant(t *testing.T) {
	settings := Values{KeySupportAssistantEnabled: "true"}.SupportAssistant()
	if settings.Enabled {
		t.Fatal("a string row read as enabled")
	}
	// The fallback is `false`, so the assertion above is weak on its own; the
	// point is that the value was not COERCED. A stored `1` must not enable it
	// either.
	if (Values{KeySupportAssistantEnabled: float64(1)}).SupportAssistant().Enabled {
		t.Fatal("a numeric row read as enabled")
	}
}
