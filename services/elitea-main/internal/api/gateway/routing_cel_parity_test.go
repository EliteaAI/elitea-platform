package gateway

// Cross-module parity guards for the governance CEL contract.
//
// elitea-main compiles a routing rule on WRITE; elitea-llm-gateway compiles the
// same rule on LOAD. The gateway is a separate Go module that elitea-main does
// not import, so the two declarations are separate source. That is the setup
// where a rule passes validation, gets saved, reaches the gateway, and is
// rejected there — an operator sees "saved" and the gateway enforces nothing,
// which is the failure mode issue #218 was opened about in the first place.
//
// These tests read the gateway's source as data. That is deliberate: an
// assertion that both files "should" agree, written in prose, is what let the
// original claim drift for two releases.

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// gatewayRoutingSource is the gateway file that declares the enforcement-side
// CEL environment.
const gatewayRoutingSource = "../../../../elitea-llm-gateway/internal/policy/routing.go"

func readGatewaySource(t *testing.T, rel string) string {
	t.Helper()
	path := filepath.Clean(rel)
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read the gateway source at %s: %v\n"+
			"This guard compares elitea-main's CEL contract against the gateway's. If the gateway module "+
			"moved, update the path — do not delete the guard.", path, err)
	}
	return string(body)
}

var celVariableRe = regexp.MustCompile(`cel\.Variable\("([a-z_]+)"`)

// TestCELVariableSetsMatchTheGateway pins the two environments together.
//
// A variable declared on one side only is the drift that matters most: a rule
// using it type-checks where it was authored and fails to compile where it is
// enforced, so the row loads as REJECTED and silently governs nothing.
func TestCELVariableSetsMatchTheGateway(t *testing.T) {
	t.Parallel()

	local := celVariableNames(t, readLocalSource(t, "routing_cel.go"))
	remote := celVariableNames(t, readGatewaySource(t, gatewayRoutingSource))

	if len(local) == 0 {
		t.Fatal("no cel.Variable declarations found in routing_cel.go")
	}
	if strings.Join(local, ",") != strings.Join(remote, ",") {
		t.Errorf("the governance CEL variable sets have drifted.\n  elitea-main: %v\n  gateway:     %v\n"+
			"A rule that type-checks on one side and not the other is saved and then not enforced.",
			local, remote)
	}
}

// TestUnevaluableCELVariablesMatchTheGateway pins the refusal list.
//
// This one drifts in the OTHER direction: a variable the gateway starts
// supplying, but which elitea-main still refuses, makes a legitimate rule
// unsaveable. A variable the gateway stops supplying, but which elitea-main
// still accepts, makes a rule that never matches.
func TestUnevaluableCELVariablesMatchTheGateway(t *testing.T) {
	t.Parallel()

	remote := unevaluableNamesFromGateway(t, readGatewaySource(t, gatewayRoutingSource))
	local := UnevaluableCELVariableNames()

	if len(remote) == 0 {
		t.Fatal("no entries parsed from the gateway's UnevaluableCELVariables map")
	}
	if strings.Join(local, ",") != strings.Join(remote, ",") {
		t.Errorf("the unevaluable-CEL-variable lists have drifted.\n  elitea-main: %v\n  gateway:     %v",
			local, remote)
	}
}

// TestEveryUnevaluableVariableIsDeclared keeps the two lists coherent: a
// variable can only be refused if it is declared, or the refusal is a rule
// about a name nobody could have written.
func TestEveryUnevaluableVariableIsDeclared(t *testing.T) {
	t.Parallel()

	declared := map[string]bool{}
	for _, name := range celVariableNames(t, readLocalSource(t, "routing_cel.go")) {
		declared[name] = true
	}
	for _, name := range UnevaluableCELVariableNames() {
		if !declared[name] {
			t.Errorf("%q is refused as unevaluable but is not declared in the CEL environment; "+
				"the refusal can never fire", name)
		}
		if UnevaluableCELVariableReason(name) == "" {
			t.Errorf("%q is refused with no reason; the operator is told what they may not do and not why", name)
		}
	}
}

func readLocalSource(t *testing.T, name string) string {
	t.Helper()
	body, err := os.ReadFile(name)
	if err != nil {
		t.Fatalf("failed to read %s: %v", name, err)
	}
	return string(body)
}

func celVariableNames(t *testing.T, source string) []string {
	t.Helper()
	var out []string
	for _, m := range celVariableRe.FindAllStringSubmatch(source, -1) {
		out = append(out, m[1])
	}
	sort.Strings(out)
	return out
}

// unevaluableNamesFromGateway parses the keys of the gateway's
// UnevaluableCELVariables map literal. It reads the block between the map's
// opening brace and its closing brace so a key spelled in a comment elsewhere
// in the file is not counted.
func unevaluableNamesFromGateway(t *testing.T, source string) []string {
	t.Helper()
	const marker = "var UnevaluableCELVariables = map[string]string{"
	start := strings.Index(source, marker)
	if start < 0 {
		t.Fatalf("the gateway no longer declares UnevaluableCELVariables; this guard cannot compare the lists")
	}
	body := source[start+len(marker):]
	end := strings.Index(body, "\n}")
	if end < 0 {
		t.Fatal("could not find the end of the gateway's UnevaluableCELVariables map literal")
	}
	keyRe := regexp.MustCompile(`(?m)^\s*"([a-z_]+)":`)
	var out []string
	for _, m := range keyRe.FindAllStringSubmatch(body[:end], -1) {
		out = append(out, m[1])
	}
	sort.Strings(out)
	return out
}
