package facade

import (
	"fmt"
	"net/http"
	"os"
	"strings"
)

// AdmissionHook is asked whether one request may reach a provider.
//
// `reason` is a STABLE CODE, not a sentence: it is what a client asserts on
// and what an operator greps a log for, and a message an operator could edit
// would make both of those change under them. The sentence a refusal carries
// is derived from the code where the refusal is written.
type AdmissionHook func(*http.Request) (allow bool, reason string)

// AdmissionPosture is what this deployment does with a provider that is
// recorded but not in force.
type AdmissionPosture string

const (
	// AdmissionRecord lets an `inactive` provider through. THE DEFAULT, and
	// it has to be: nothing in this deployment can reach `active`, because
	// activation requires a policy overlay no issuer exists for (migration
	// 0107's provider_admitted_revision_active_needs_overlay is a CHECK
	// constraint, not a branch anyone can edit). Defaulting to enforce would
	// therefore refuse every provider on every existing install the moment
	// this code shipped — a flag whose default breaks the feature it guards.
	AdmissionRecord AdmissionPosture = "record"
	// AdmissionEnforce refuses anything not admitted `active`. Useful once an
	// overlay issuer exists; before that it is a deliberate lockout, and an
	// operator who sets it today is asking for exactly that.
	AdmissionEnforce AdmissionPosture = "enforce"
)

// AdmissionPostureEnv names the setting. Spelled out rather than derived from
// a prefix, for the reason EnvNames gives: it is searched by the literal, in
// a chart and in an env-drift allowlist.
const AdmissionPostureEnv = "ELITEA_PROVIDER_ADMISSION"

// AdmissionPostureFromEnv reads the posture. Unset is record.
//
// AN UNRECOGNISED SPELLING IS A STARTUP ERROR, never a quiet fall back to the
// default. `ELITEA_PROVIDER_ADMISSION=enfroce` read as `record` would leave an
// operator who believes they are enforcing with a deployment that admits
// everything — the one failure mode a control like this must not have. It is
// the rule ELITEA_DEEPWIKI_ENABLED already follows, and the chart's own
// _helpers.tpl fails the render for the same class of typo.
func AdmissionPostureFromEnv(lookup func(string) (string, bool)) (AdmissionPosture, error) {
	if lookup == nil {
		lookup = os.LookupEnv
	}
	raw, _ := lookup(AdmissionPostureEnv)
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "":
		return AdmissionRecord, nil
	case string(AdmissionRecord):
		return AdmissionRecord, nil
	case string(AdmissionEnforce):
		return AdmissionEnforce, nil
	default:
		return "", fmt.Errorf("%w: %s must be %q or %q, not %q",
			ErrIncompleteConfig, AdmissionPostureEnv, AdmissionRecord, AdmissionEnforce, raw)
	}
}
