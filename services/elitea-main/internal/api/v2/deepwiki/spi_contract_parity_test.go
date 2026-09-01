package deepwiki

// The SPI is spelled in three places, and this fails when any one of them
// drifts.
//
// THE THREE SPELLINGS:
//
//   1. conformance/provider/spi/contract.json — the frozen contract, which
//      belongs to no provider.
//   2. the path builders in proxy.go — what elitea-main actually sends to a
//      provider on the wire.
//   3. services/elitea-main/api/openapi/v2.yaml — the facade routes this
//      platform publishes, one per SPI path it proxies.
//
// WHY THIS GATE EXISTS. A provider contract that is generic in intention and
// re-typed in three files is generic until the first person edits one of them.
// Nothing else in this repository compares the three: the OpenAPI document is
// checked for shape, the Go builders are covered by tests that assert what
// they produce, and the contract file is data nobody reads. Each is
// self-consistent while all three disagree.
//
// WHAT IT DELIBERATELY DOES NOT REQUIRE. That all three carry all five paths.
// The facade proxies three; /descriptor and /health are consumed by planes
// that answer 501 today. The contract records that as `facade: null`, and this
// test holds BOTH directions of it — a path that gains a Go builder without
// gaining a facade entry fails here, and so does a `facade` route the OpenAPI
// document does not declare.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type spiContract struct {
	Version string `json:"version"`
	Paths   []struct {
		Path    string   `json:"path"`
		Methods []string `json:"methods"`
		Facade  *string  `json:"facade"`
	} `json:"paths"`
}

// repoRelative resolves a path from this package up to the repository root.
//
// Four levels reach services/elitea-main, and two more the workspace root. A
// literal "../../../../../.." is easy to get wrong by one and the failure is a
// missing file, which this test treats as fatal rather than as "nothing to
// check".
func repoRelative(t *testing.T, parts ...string) string {
	t.Helper()
	root := filepath.Join("..", "..", "..", "..", "..", "..")
	return filepath.Join(append([]string{root}, parts...)...)
}

func loadContract(t *testing.T) spiContract {
	t.Helper()
	path := repoRelative(t, "conformance", "provider", "spi", "contract.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading the frozen SPI contract at %s: %v\n\n"+
			"This file is the contract, not a convenience. Its absence means "+
			"this gate cannot compare anything, and a gate that cannot run "+
			"must not report success.", path, err)
	}
	var contract spiContract
	if err := json.Unmarshal(raw, &contract); err != nil {
		t.Fatalf("parsing %s: %v", path, err)
	}
	// A floor. A reshaped or emptied document would otherwise satisfy every
	// loop below by iterating over nothing.
	const minimumPaths = 5
	if len(contract.Paths) < minimumPaths {
		t.Fatalf("the contract declares %d path(s), expected at least %d; "+
			"an emptied list makes every comparison below vacuous",
			len(contract.Paths), minimumPaths)
	}
	return contract
}

// TestTheGoBuildersProduceOnlyContractPaths checks spelling 2 against 1.
//
// The builders take arguments, so the test substitutes placeholders back in:
// what is compared is the SHAPE the provider receives, which is what the
// contract describes.
func TestTheGoBuildersProduceOnlyContractPaths(t *testing.T) {
	contract := loadContract(t)
	declared := map[string]bool{}
	for _, p := range contract.Paths {
		declared[p.Path] = true
	}

	// Each entry is a path this package can send to a provider, with its
	// arguments replaced by the contract's own parameter names.
	built := map[string]string{
		providerSlotsPath: "providerSlotsPath",
		strings.NewReplacer("%7Btoolkit_name%7D", "{toolkit_name}", "%7Btool_name%7D", "{tool_name}").
			Replace(providerInvokePath("{toolkit_name}", "{tool_name}")): "providerInvokePath",
		strings.NewReplacer("%7Btoolkit_name%7D", "{toolkit_name}", "%7Btool_name%7D", "{tool_name}", "%7Binvocation_id%7D", "{invocation_id}").
			Replace(providerInvocationPath("{toolkit_name}", "{tool_name}", "{invocation_id}")): "providerInvocationPath",
	}

	for path, builder := range built {
		if !declared[path] {
			t.Errorf("%s produces %q, which the frozen SPI contract does not declare.\n"+
				"Either the builder is wrong, or the contract has to grow the path "+
				"deliberately — adding a path to the wire without adding it to the "+
				"published contract is how a 'generic' SPI stops being one.",
				builder, path)
		}
	}
}

// TestEveryFacadeRouteInTheContractIsPublished checks spelling 1 against 3.
//
// A contract entry that names a facade route the OpenAPI document does not
// declare is the quiet failure: the contract says this platform exposes the
// SPI path, and no caller can reach it.
func TestEveryFacadeRouteInTheContractIsPublished(t *testing.T) {
	contract := loadContract(t)
	specPath := repoRelative(t, "services", "elitea-main", "api", "openapi", "v2.yaml")
	raw, err := os.ReadFile(specPath)
	if err != nil {
		t.Fatalf("reading %s: %v", specPath, err)
	}
	spec := string(raw)

	facades := 0
	for _, p := range contract.Paths {
		if p.Facade == nil {
			continue
		}
		facades++
		// The path key as it appears in an OpenAPI document: two spaces of
		// indentation, the path, a colon. Anchored, so a path that only occurs
		// inside a description does not count as declared.
		if !strings.Contains(spec, "\n  "+*p.Facade+":\n") {
			t.Errorf("the contract says SPI path %q is reachable at %q, and "+
				"v2.yaml declares no such route.\n"+
				"A contract entry claiming a route nobody can call is worse "+
				"than an absent one: it reads as shipped.",
				p.Path, *p.Facade)
		}
	}
	if facades == 0 {
		t.Fatal("no contract entry names a facade route, so this test compared nothing")
	}
}

// TestTheUnservedPathsAreExactlyTheOnesWeKnowAbout pins the subset.
//
// Without this, a path could quietly become `facade: null` — and the two tests
// above would both pass, because neither asks why a path has no facade. The
// list here is the one place that has to change when the admission or health
// plane lands, which is the point.
func TestTheUnservedPathsAreExactlyTheOnesWeKnowAbout(t *testing.T) {
	contract := loadContract(t)
	expected := map[string]string{
		"/descriptor": "consumed by the admission plane, which answers 501 today",
		"/health":     "consumed by the health projection, which does not exist yet",
	}
	for _, p := range contract.Paths {
		if p.Facade != nil {
			if _, unserved := expected[p.Path]; unserved {
				t.Errorf("%q now has a facade route but is still listed here as "+
					"unserved; remove it from this test's list", p.Path)
			}
			continue
		}
		if _, known := expected[p.Path]; !known {
			t.Errorf("%q has no facade route and is not one of the two paths "+
				"known to be unserved.\n"+
				"A path silently losing its facade entry is invisible to every "+
				"other check here, because none of them asks WHY a path has none.",
				p.Path)
		}
		delete(expected, p.Path)
	}
	for path, reason := range expected {
		t.Errorf("%q is listed here as unserved (%s) but the contract no longer "+
			"declares it at all", path, reason)
	}
}
