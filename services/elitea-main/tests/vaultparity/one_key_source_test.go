// The deployment side of issue #418: one stack, one centry vault key.
//
// The round trip in pylon_vault_roundtrip_test.go proves the two services agree
// WHEN they are given the same key. These cases prove the manifests give it to
// them. They are separate checks because they fail for separate reasons, and a
// stack can satisfy either one alone and still be broken.
//
// The cases read the real files under deploy/ and services/pylon-indexer/. They
// live outside this Go module, so the test cache cannot see an edit to them —
// run this package with -count=1, as tests/deployedge does.
package vaultparity_test

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

// vaultServices are the compose services that read centry.secrets_key. Two
// services in one stack that answer "is this row wrapped?" differently write
// two row formats into one table.
var vaultServices = []string{"elitea-main", "pylon-indexer"}

// fernetKeyPattern matches a Fernet key at rest: 43 URL-safe base64 characters
// and the "=" that pads 32 bytes. It is deliberately not anchored to the whole
// line, so a key hidden inside a longer expression is still found.
var fernetKeyPattern = regexp.MustCompile(`[A-Za-z0-9_-]{43}=`)

func repoPath(t *testing.T, parts ...string) string {
	t.Helper()
	return filepath.Join(append([]string{repoRoot(t)}, parts...)...)
}

// A committed key is not fixed by deleting one line. It has to be absent from
// every config the service ships.
func TestPylonIndexerConfigsCarryNoFernetKey(t *testing.T) {
	dir := repoPath(t, "services", "pylon-indexer", "configs")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read %s: %v", dir, err)
	}
	if len(entries) == 0 {
		t.Fatal("no config files found; a search that finds nothing is not a clean result")
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			t.Fatalf("read %s: %v", entry.Name(), err)
		}
		if match := fernetKeyPattern.Find(raw); match != nil {
			t.Errorf("%s carries a %d-character Fernet key; it must come from the environment",
				entry.Name(), len(match))
		}
	}
}

// The setting must have exactly one source, and that source is the environment.
// A default value is a second source whatever it holds.
func TestPylonIndexerTakesTheMasterKeyOnlyFromTheEnvironment(t *testing.T) {
	path := repoPath(t, "services", "pylon-indexer", "configs", "shared.yml")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}

	var parsed struct {
		Settings map[string]any `yaml:"settings"`
	}
	if err := yaml.Unmarshal(raw, &parsed); err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	value, ok := parsed.Settings["secrets_master_key"]
	if !ok {
		t.Fatal("shared.yml sets no secrets_master_key; pylon-indexer would store project keys unwrapped " +
			"while elitea-main wraps them")
	}
	text, ok := value.(string)
	if !ok {
		t.Fatalf("secrets_master_key is %T; want a string", value)
	}
	if text != "${SECRETS_MASTER_KEY}" {
		t.Errorf("secrets_master_key is %q; want exactly ${SECRETS_MASTER_KEY}. "+
			"Pylon's default syntax is ${VAR:default}, and any default is a second key source", text)
	}
}

// Pylon reads this file's bytes, expands them and THEN parses the YAML. A
// substitution that resolves to an empty value leaves a bare "-" or a missing
// scalar on the line, the parse fails, and pylon drops the whole file. Every
// setting reverts to a built-in default, secrets_master_key included, and
// pylon-indexer silently stops wrapping. Quoting each substituted scalar keeps
// the file parseable whatever the environment holds.
func TestPylonIndexerConfigsQuoteEverySubstitution(t *testing.T) {
	dir := repoPath(t, "services", "pylon-indexer", "configs")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read %s: %v", dir, err)
	}

	// A mapping value that starts with an unquoted "${".
	unquoted := regexp.MustCompile(`^\s*[A-Za-z0-9_]+:\s+\$\{`)

	sharedFound := false
	for _, entry := range entries {
		if entry.IsDir() || entry.Name() != "shared.yml" {
			continue
		}
		sharedFound = true
		raw, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			t.Fatalf("read %s: %v", entry.Name(), err)
		}
		for number, line := range strings.Split(string(raw), "\n") {
			if unquoted.MatchString(line) {
				t.Errorf("%s:%d substitutes into an unquoted scalar: %s",
					entry.Name(), number+1, strings.TrimSpace(line))
			}
		}
	}
	if !sharedFound {
		t.Fatal("shared.yml not found; a search that finds nothing is not a clean result")
	}
}

// composeFile is the part of a compose model these cases read.
type composeFile struct {
	Services map[string]struct {
		Environment map[string]string `yaml:"environment"`
	} `yaml:"services"`
}

func readCompose(t *testing.T, name string) composeFile {
	t.Helper()
	path := repoPath(t, "deploy", name)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	var model composeFile
	if err := yaml.Unmarshal(raw, &model); err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	return model
}

// The base compose model is the one every other compose file overlays. Both
// vault services must take the key there, from the environment, by the same
// expression.
func TestBaseComposeGivesBothServicesOneKeyFromTheEnvironment(t *testing.T) {
	model := readCompose(t, "docker-compose.yml")

	expressions := map[string]string{}
	for _, name := range vaultServices {
		service, ok := model.Services[name]
		if !ok {
			t.Fatalf("deploy/docker-compose.yml has no %s service", name)
		}
		value, ok := service.Environment["SECRETS_MASTER_KEY"]
		if !ok {
			t.Fatalf("%s does not set SECRETS_MASTER_KEY; it would disagree with the other service "+
				"about wrapping", name)
		}
		if !strings.Contains(value, "${SECRETS_MASTER_KEY") {
			t.Errorf("%s sets SECRETS_MASTER_KEY to a literal; it must come from the environment", name)
		}
		if fernetKeyPattern.MatchString(value) {
			t.Errorf("%s carries a Fernet key in the compose file", name)
		}
		expressions[name] = value
	}

	first := expressions[vaultServices[0]]
	for _, name := range vaultServices[1:] {
		if expressions[name] != first {
			t.Errorf("%s resolves SECRETS_MASTER_KEY as %q and %s as %q; one stack must use one key",
				vaultServices[0], first, name, expressions[name])
		}
	}
}

// A compose file beside the base one may restate the key, but it must never
// give a DIFFERENT value to the two vault services. That asymmetry is the
// deployment shape issue #418 found: elitea-main had the key in
// deploy/docker-compose.staging.yml and pylon-indexer did not.
//
// The files here are of two kinds, and the check suits both. An OVERLAY
// (docker-compose.staging.yml) is applied on top of docker-compose.yml, and
// compose merges an `environment` mapping key by key, so a service the overlay
// does not name still receives the base value. A STANDALONE file
// (docker-compose.standalone-full.yml) is applied on its own and runs no
// pylon-indexer, so a single vault service in it is self-consistent. Either
// way, two named services with two different expressions are the fault.
func TestNoComposeOverlayGivesTheKeyToOnlyOneService(t *testing.T) {
	entries, err := os.ReadDir(repoPath(t, "deploy"))
	if err != nil {
		t.Fatalf("read deploy/: %v", err)
	}

	checked := 0
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasPrefix(name, "docker-compose.") ||
			!strings.HasSuffix(name, ".yml") || name == "docker-compose.yml" {
			continue
		}
		model := readCompose(t, name)

		setters := map[string]string{}
		for _, service := range vaultServices {
			definition, ok := model.Services[service]
			if !ok {
				continue
			}
			if value, ok := definition.Environment["SECRETS_MASTER_KEY"]; ok {
				setters[service] = value
			}
		}
		checked++

		if len(setters) == 0 {
			// This file names neither service, or names them without touching
			// the key. An overlay then inherits the base value for both, and a
			// standalone file has no vault service to disagree with.
			continue
		}
		for service, value := range setters {
			if fernetKeyPattern.MatchString(value) {
				t.Errorf("%s: %s carries a Fernet key", name, service)
			}
			if !strings.Contains(value, "${SECRETS_MASTER_KEY") {
				t.Errorf("%s: %s sets SECRETS_MASTER_KEY to a literal", name, service)
			}
		}
		// Two named services must carry the same expression. One named service
		// is not a fault: an overlay inherits the base value for the other,
		// and a standalone file runs no second vault service.
		for service, value := range setters {
			for otherService, otherValue := range setters {
				if service != otherService && value != otherValue {
					t.Errorf("%s: %s uses %q and %s uses %q; one stack must use one key",
						name, service, value, otherService, otherValue)
				}
			}
		}
	}

	if checked == 0 {
		t.Fatal("no compose overlays found; a search that finds nothing is not a clean result")
	}
}

// TestPylonIndexerChartRequiresTheMasterKey WAS HERE, and it is gone with its
// subject: deploy/helm/pylon-indexer no longer exists, because the platform
// installs from one chart and Kubernetes never ran the Python indexer — the
// Go runtime plane serves index ingest through the agent worker, on the same
// stream and consumer group as agent execution.
//
// The invariant it guarded is NOT dropped where it still applies. pylon-indexer
// remains a live service in deploy/docker-compose.yml and its image is still
// built and published, so the compose path still has to hand both services ONE
// key from the environment — which is exactly what
// TestBaseComposeGivesBothServicesOneKeyFromTheEnvironment and
// TestNoComposeOverlayGivesTheKeyToOnlyOneService above assert. An absent key
// there is not a downgrade; it is a second row format in the vault.
//
// If a Kubernetes deployment of pylon-indexer is ever wanted again, restore it
// as a component of deploy/helm/elitea and restore this assertion with it: an
// image that ships with no way to deploy it is how the agent worker's chart
// ended up maintained outside this repository in the first place.
