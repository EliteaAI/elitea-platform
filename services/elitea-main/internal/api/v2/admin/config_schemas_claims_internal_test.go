package admin

// Guards on what the admin Configuration schema TELLS THE OPERATOR about LLM
// governance (#466, then #218).
//
// These are prose guards, not behaviour guards, and they exist because prose is
// the part of this surface with no other check on it. The sentence an operator
// reads decides whether they believe a limit is in force.
//
// The history is the reason the guards are shaped this way, and it runs in both
// directions:
//
//  1. `config_schemas.go` said in one place that the gateway reads
//     gateway.governance_config and enforces it, and 536 lines away that it does
//     not. The denial was right. The claim also sat in the section
//     `description`, which GET /admin/plugin_config_schemas/{mode} ships to the
//     page, so an operator authored a rule and believed a limit was in force
//     that nothing enforced. #466 removed it.
//  2. #218 then made the claim TRUE: the gateway reads every enabled row and
//     enforces it (elitea-llm-gateway internal/policy). The guards below flipped
//     with it.
//
// A guard that flips when the fact flips is only useful if the fact is checked
// somewhere. It is: TestGovernanceEnforcementClaimMatchesTheGateway reads the
// gateway's own source, so this file cannot start claiming enforcement again
// after somebody deletes the enforcement.
//
// This repository has produced the "reports work it did not do" class before —
// a moderation gate that answered `approved` to every caller (#216), a
// `plugin_config_restart` that reported `{"status":"ok"}` for a restart it never
// sent (#217) — and the thing that let each one survive was that no test can
// fail on a sentence. These do.

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// staleNotEnforcedPhrases are the ways the OLD, now-false statement is spelled.
// Each is matched case-insensitively over the whole serialised payload, so the
// statement moved from the section description into a field description, a
// title, or a new section is caught too.
var staleNotEnforcedPhrases = []string{
	"does not enforce them yet",
	"the gateway does not yet read gateway.governance_config",
	"the gateway does not read gateway.governance_config",
	"definitions are stored, but the gateway does not enforce",
	"saved through either surface are not enforced",
}

// gatewayPolicySource is the gateway file whose existence is the fact these
// prose guards assert. It is read, not imported: the gateway is a separate Go
// module and elitea-main does not depend on it.
const gatewayPolicySource = "../../../../../elitea-llm-gateway/internal/policy/policy.go"

// TestGovernanceSchemaDoesNotDenyEnforcement reads the payload the handler
// serves, not the source, because the payload is what the operator sees.
func TestGovernanceSchemaDoesNotDenyEnforcement(t *testing.T) {
	t.Parallel()

	payload, err := json.Marshal(configSections())
	if err != nil {
		t.Fatalf("failed to serialise the admin configuration schema: %v", err)
	}
	lowered := strings.ToLower(string(payload))
	for _, phrase := range staleNotEnforcedPhrases {
		if strings.Contains(lowered, phrase) {
			t.Errorf("the admin schema payload still tells the operator that governance definitions are not "+
				"enforced (%q). The gateway reads gateway.governance_config and enforces it (#218). "+
				"An operator reading this will not author a limit they now could.", phrase)
		}
	}
}

// TestGovernanceSchemaSaysDefinitionsAreEnforced is the other direction.
//
// Deleting the stale denial is not enough. A description that says nothing at
// all leaves the operator to guess, which is how the first defect did its
// damage. The section must state, positively, that the definitions take effect.
func TestGovernanceSchemaSaysDefinitionsAreEnforced(t *testing.T) {
	t.Parallel()

	section := governanceSection()

	description, _ := section["description"].(string)
	if description == "" {
		t.Fatal("the governance section has no description")
	}
	if !strings.Contains(strings.ToLower(description), "enforced") {
		t.Errorf("the governance section description does not tell the operator that the definitions are "+
			"enforced: %q", description)
	}

	// The section's own unavailable_reason reaches the same page in the same
	// response, so the two must agree. It must ALSO still explain why the
	// authoring happens elsewhere — an operator who is refused a form and told
	// nothing has nowhere to go.
	reason, _ := section["unavailable_reason"].(string)
	loweredReason := strings.ToLower(reason)
	if !strings.Contains(loweredReason, "are enforced") {
		t.Errorf("the governance unavailable_reason no longer agrees with the description about "+
			"enforcement: %q", reason)
	}
	if !strings.Contains(loweredReason, "/admin/gateway/governance") {
		t.Errorf("the governance unavailable_reason does not point the operator at the surface that "+
			"authors these definitions: %q", reason)
	}
}

// TestGovernanceEnforcementClaimMatchesTheGateway is what makes the two guards
// above safe to flip.
//
// Prose that asserts enforcement is only true while the enforcement exists. If
// the gateway's policy plane is deleted or renamed, this fails and the schema's
// claim has to be revisited rather than quietly becoming false again — the exact
// sequence that produced #466.
func TestGovernanceEnforcementClaimMatchesTheGateway(t *testing.T) {
	t.Parallel()

	source, err := os.ReadFile(gatewayPolicySource)
	if err != nil {
		t.Fatalf("the admin schema claims the gateway enforces gateway.governance_config, but the gateway's "+
			"policy plane could not be read at %s: %v\nEither the enforcement moved (update this path) or it "+
			"was removed (the schema's claim is now false and must be corrected).", gatewayPolicySource, err)
	}
	body := string(source)
	for _, needle := range []string{
		// The table it must read.
		"gateway.governance_config",
		// The three decisions the schema's description promises.
		"func (s *Snapshot) CheckModel(",
		"func (s *Snapshot) RateLimit(",
		"func (s *Snapshot) CheckMCP(",
	} {
		if !strings.Contains(body, needle) {
			t.Errorf("the gateway policy plane no longer contains %q, so the admin schema's enforcement "+
				"claim is no longer supported by it", needle)
		}
	}
}

// TestGovernanceCommentsAgreeWithTheSchema is the source-level half.
//
// The payload guards cannot see a comment, and #466's first defect WAS a
// comment: `config_schemas.go` asserted enforcement in a doc comment and denied
// it in a const doc comment in the same file. A reader who trusts the doc
// comment writes the next handler on a false premise.
//
// The assertion is narrower than the payload one on purpose. The file's own
// comments discuss the history, so they legitimately contain the old sentences
// as quotations; what must not survive is a CURRENT statement of them. The two
// live constants are the current statements, and they are checked above. Here
// we check only that the file has not re-acquired the exact stale sentence as
// its section description.
func TestGovernanceCommentsAgreeWithTheSchema(t *testing.T) {
	t.Parallel()

	source, err := os.ReadFile("config_schemas.go")
	if err != nil {
		t.Fatalf("failed to read config_schemas.go: %v", err)
	}
	if strings.Contains(string(source), `"description":         "Author LLM-gateway governance`) &&
		strings.Contains(strings.ToLower(string(source)), "does not enforce them yet") {
		t.Error("config_schemas.go carries the stale 'does not enforce them yet' description again (#218)")
	}
}
