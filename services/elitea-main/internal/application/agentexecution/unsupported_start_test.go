package agentexecution

import (
	"errors"
	"strings"
	"testing"
)

// The admission gate refuses turns from many places and used to return the bare
// sentinel from every one of them, so a deployment log could not distinguish a
// malformed tool entry from an unresolvable model (#288). Attribution must not
// come at the cost of the matching the HTTP layer depends on: the route maps
// this to 422 with errors.Is, and an attributed error that stopped matching
// would turn every refusal into a 500.
func TestUnsupportedCurrentAgentStartStaysMatchable(t *testing.T) {
	t.Parallel()

	t.Run("reason only", func(t *testing.T) {
		err := unsupportedStart("the turn carries no llm_settings object")

		if !errors.Is(err, ErrUnsupportedCurrentAgentStart) {
			t.Fatal("attributed refusal no longer matches the sentinel; the route would answer 500 instead of 422")
		}
		if !strings.Contains(err.Error(), "no llm_settings object") {
			t.Fatalf("error does not name its reason: %q", err)
		}
		// The sentence the sentinel carries is what operators grep for; keeping
		// it as the prefix means existing runbooks still find these lines.
		if !strings.HasPrefix(err.Error(), ErrUnsupportedCurrentAgentStart.Error()) {
			t.Fatalf("error no longer starts with the sentinel text: %q", err)
		}
	})

	t.Run("reason with a cause", func(t *testing.T) {
		cause := errors.New("list public model configurations: relation \"p_99.configuration\" does not exist")
		err := unsupportedStartBecause("model resolution", cause)

		if !errors.Is(err, ErrUnsupportedCurrentAgentStart) {
			t.Fatal("attributed refusal with a cause no longer matches the sentinel")
		}
		// The dependency's own error is the whole point: swallowing it is what
		// made these refusals undiagnosable in the first place.
		if !errors.Is(err, cause) {
			t.Fatal("the cause is not reachable through errors.Is")
		}
		if !strings.Contains(err.Error(), "p_99.configuration") {
			t.Fatalf("the cause did not survive into the message: %q", err)
		}
	})

	t.Run("distinct reasons are distinguishable", func(t *testing.T) {
		first := unsupportedStart("version tools is not an array")
		second := unsupportedStart("a tool entry has no settings object")

		if first.Error() == second.Error() {
			t.Fatal("two different refusals produced the same message, which is the bug this fixes")
		}
	})
}
