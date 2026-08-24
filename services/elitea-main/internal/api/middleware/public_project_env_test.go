package middleware

// Which environment variable names the shared project.
//
// The two services disagreed: this one read AI_PROJECT_ID (default 1), the LLM
// gateway reads ELITEA_AI_PROJECT_ID (default OFF), and the gateway's config
// comment asserted they were the same variable. A deployment that set only the
// gateway's would publish platform providers into project 1 while the gateway
// resolved them out of another schema — silently, with every other signal on
// the admin screen still correct.

import "testing"

// TestTheGatewaysVariableWins — setting the gateway's variable alone must bring
// this service into line, because the gateway is the one that can be switched
// off and therefore the one an operator sets deliberately.
func TestTheGatewaysVariableWins(t *testing.T) {
	t.Setenv("ELITEA_AI_PROJECT_ID", "7")
	t.Setenv("AI_PROJECT_ID", "3")

	if got := PublicProjectID(); got != 7 {
		t.Errorf("PublicProjectID() = %d, want the gateway's 7", got)
	}
}

// TestTheLegacyVariableStillWorks — no existing deployment changes.
func TestTheLegacyVariableStillWorks(t *testing.T) {
	t.Setenv("ELITEA_AI_PROJECT_ID", "")
	t.Setenv("AI_PROJECT_ID", "3")

	if got := PublicProjectID(); got != 3 {
		t.Errorf("PublicProjectID() = %d, want 3", got)
	}
}

// TestAnUnparseableValueFallsThrough — a malformed gateway variable must not
// shadow a usable legacy one, and must not resolve to zero.
func TestAnUnparseableValueFallsThrough(t *testing.T) {
	t.Setenv("ELITEA_AI_PROJECT_ID", "not-a-number")
	t.Setenv("AI_PROJECT_ID", "3")
	if got := PublicProjectID(); got != 3 {
		t.Errorf("PublicProjectID() = %d, want the usable 3", got)
	}

	t.Setenv("AI_PROJECT_ID", "")
	if got := PublicProjectID(); got != defaultPublicProjectID {
		t.Errorf("PublicProjectID() = %d, want the default %d", got, defaultPublicProjectID)
	}
}
