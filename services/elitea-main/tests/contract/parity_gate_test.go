package contract

// The gate on the gate (issue #309, Gate 1).
//
// ci-contract.yml's parity job ran four consecutive weeks, skipped every
// fixture because CONTRACT_AUTH_TOKEN was empty, and reported success each
// time. Nothing in the repository could notice, because "all tests skipped" and
// "all tests passed" are the same exit code.
//
// These cases pin the one distinction that fixes it: with the job's own
// CONTRACT_REQUIRE_PARITY marker set, an absent token must FAIL. Revert
// decideParityGate to an unconditional skip and the parityFail cases below go
// red — which is the property a neutered gate has to have.
//
// This file runs on every PR (ci-contract.yml's compile job and `task test`),
// unlike the credential-gated fixtures it protects.

import "testing"

func TestDecideParityGate(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name        string
		authToken   string
		requireFlag string
		want        parityDecision
	}{
		// The defect, exactly as it ran: the job sets the marker, the secret
		// resolves to the empty string, and the fixtures must not go quiet.
		{name: "required but token empty", authToken: "", requireFlag: "1", want: parityFail},
		{name: "required, token empty, flag=true", authToken: "", requireFlag: "true", want: parityFail},
		{name: "required, token empty, flag=yes", authToken: "", requireFlag: "yes", want: parityFail},
		// A secret that resolves to whitespace is still an absent secret — GitHub
		// substitutes the empty string for an undefined secret, and a stray space
		// in the workflow would otherwise read as "present".
		{name: "required, whitespace flag reads as unset", authToken: "", requireFlag: "   ", want: paritySkip},

		// Every ordinary caller: no credentials were promised, so skipping is
		// the honest outcome and must stay available. Removing this behaviour
		// would turn every PR and every `task test` red.
		{name: "not required, token empty", authToken: "", requireFlag: "", want: paritySkip},
		{name: "explicitly not required", authToken: "", requireFlag: "0", want: paritySkip},
		{name: "explicitly not required, false", authToken: "", requireFlag: "false", want: paritySkip},

		// Credentials present: run, whatever the marker says. The marker only
		// ever decides what an ABSENT token means.
		{name: "token present, no marker", authToken: "tok", requireFlag: "", want: parityRun},
		{name: "token present, marker set", authToken: "tok", requireFlag: "1", want: parityRun},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := decideParityGate(tc.authToken, tc.requireFlag); got != tc.want {
				t.Fatalf("decideParityGate(%q, %q) = %v, want %v",
					tc.authToken, tc.requireFlag, got, tc.want)
			}
		})
	}
}

// A skip and a fail must not be the same value, or the switch in
// requireLegacyParityCredentials could conflate them and this file's other test
// would still pass.
func TestParityDecisionsAreDistinct(t *testing.T) {
	t.Parallel()
	if parityRun == paritySkip || paritySkip == parityFail || parityRun == parityFail {
		t.Fatal("parity decisions collapse into each other")
	}
}
