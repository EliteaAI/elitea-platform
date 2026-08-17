package admin

// Guards on what the admin Configuration schema TELLS THE OPERATOR (#466).
//
// These are prose guards, not behaviour guards, and they exist because prose is
// the part of this surface with no other check on it. `config_schemas.go` said
// in one place that the gateway reads gateway.governance_config and enforces it,
// and in another place, 536 lines away, that the gateway does not read it. The
// second one was right (#218). The first one was not a stale comment only: the
// same sentence sat in the section `description`, which
// `GET /admin/plugin_config_schemas/{mode}` ships to the admin page. An operator
// read it, authored a governance rule, saw it saved, and believed a limit was in
// force that nothing enforces.
//
// This repository has produced that class before — a moderation gate that
// answered `approved` to every caller (#216), a `plugin_config_restart` that
// reported `{"status":"ok"}` for a restart it never sent (#217) — and the thing
// that let each one survive was that no test can fail on a sentence. These do.

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// falseEnforcementSentence is the exact sentence #466 removed. It is written
// here once, in the assertion, so that restoring it anywhere in the payload
// fails by name rather than by a diff nobody reads.
const falseEnforcementSentence = "Definitions are read by the gateway for enforcement."

// enforcementClaimPhrases are the shorter forms the same claim takes when
// somebody rewords it. Each is matched case-insensitively over the WHOLE
// serialised payload, so a claim moved from the section description into a field
// description, a title, or a new section is caught too.
var enforcementClaimPhrases = []string{
	"read by the gateway for enforcement",
	"the gateway governancestore reads",
	"the gateway reads them at load",
	"the gateway reads gateway.governance_config",
	"the gateway enforces gateway.governance_config",
}

// TestGovernanceSchemaMakesNoEnforcementClaim reads the payload the handler
// serves, not the source, because the payload is what the operator sees.
func TestGovernanceSchemaMakesNoEnforcementClaim(t *testing.T) {
	t.Parallel()

	payload, err := json.Marshal(configSections())
	if err != nil {
		t.Fatalf("failed to serialise the admin configuration schema: %v", err)
	}
	if strings.Contains(string(payload), falseEnforcementSentence) {
		t.Fatalf("the admin schema payload carries the false sentence %q; "+
			"the gateway does not read gateway.governance_config (#218)", falseEnforcementSentence)
	}

	lowered := strings.ToLower(string(payload))
	for _, phrase := range enforcementClaimPhrases {
		if strings.Contains(lowered, phrase) {
			t.Errorf("the admin schema payload claims gateway enforcement with %q; "+
				"nothing reads gateway.governance_config (#218)", phrase)
		}
	}
}

// TestGovernanceSchemaSaysDefinitionsAreNotEnforced is the other direction.
//
// Deleting the false sentence is not enough: a description that says nothing at
// all leaves the operator to assume the rule works, which is the same outcome by
// a quieter route. The section must state the gap. This fails if the correction
// is dropped as well as if it is reversed.
func TestGovernanceSchemaSaysDefinitionsAreNotEnforced(t *testing.T) {
	t.Parallel()

	section := governanceSection()

	description, _ := section["description"].(string)
	if description == "" {
		t.Fatal("the governance section has no description")
	}
	if !strings.Contains(strings.ToLower(description), "does not enforce") {
		t.Errorf("the governance section description does not tell the operator that the definitions "+
			"are stored and not enforced: %q", description)
	}

	// The section's own unavailable_reason has said this since unit A14. The two
	// strings reach the same page in the same response, so they must agree.
	reason, _ := section["unavailable_reason"].(string)
	if !strings.Contains(strings.ToLower(reason), "not enforced") {
		t.Errorf("governanceElsewhereUnavailable no longer says the definitions are not enforced, "+
			"so it no longer agrees with the description: %q", reason)
	}
}

// TestGovernanceCommentsAgreeWithTheSchema is the source-level half.
//
// The payload guards above cannot see a comment, and #466's first defect WAS a
// comment: `config_schemas.go` asserted enforcement in a doc comment and denied
// it in a const doc comment in the same file. A reader who trusts the doc
// comment writes the next handler on a false premise. This reads the file the
// same way `router_nil_gate_test.go` reads router.go.
func TestGovernanceCommentsAgreeWithTheSchema(t *testing.T) {
	t.Parallel()

	source, err := os.ReadFile("config_schemas.go")
	if err != nil {
		t.Fatalf("failed to read config_schemas.go: %v", err)
	}
	lowered := strings.ToLower(string(source))

	// The phrases below are the assertions, so the file naturally contains them
	// inside the guard's own explanation. Only config_schemas.go is read, and
	// this test lives in a different file, so no self-match is possible.
	for _, phrase := range enforcementClaimPhrases {
		if strings.Contains(lowered, phrase) {
			t.Errorf("config_schemas.go asserts gateway enforcement with %q, which contradicts "+
				"governanceElsewhereUnavailable in the same file (#218/#466)", phrase)
		}
	}
	if strings.Contains(string(source), falseEnforcementSentence) {
		t.Errorf("config_schemas.go carries the false sentence %q again", falseEnforcementSentence)
	}
}
