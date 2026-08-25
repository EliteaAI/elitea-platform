package secrets_test

// ONE VAULT CREATOR (#399).
//
// This package is the only code in the service that may bring a project vault
// into being. It holds the only master key a deployment sets
// (SECRETS_MASTER_KEY), and it decides from that key whether the stored project
// key is wrapped. A second creator elsewhere derives its own key, so it writes
// vaults this package cannot open — and every creator is create-if-absent and
// idempotent, so two of them compose WITHOUT an error and leave a vault that one
// path cannot decrypt. Nothing reports the fault until a later read fails.
//
// That is exactly what happened: internal/infra/db/repos held a second creator
// keyed off ELITEA_VAULT_MASTER_KEY_FILE, which no file under deploy/ sets.
//
// A unit test cannot see this, because each creator is correct on its own. So
// this case asserts the STRUCTURAL rule instead: no file outside this package
// may insert a vault key row. It is deliberately a source search, because the
// defect is the existence of a second writer, not the behaviour of either one.

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// vaultKeyInsert is the statement that mints a vault. A vault is unopenable
// without its key row, so whoever writes that row chooses the master key rule
// for every later reader.
const vaultKeyInsert = "INSERT INTO centry.secrets_key"

// theOneCreator is the file allowed to carry that statement.
const theOneCreator = "internal/api/v2/secrets/handler.go"

func TestOnlyOneVaultCreatorRemains(t *testing.T) {
	t.Parallel()

	root := serviceRoot(t)
	var creators []string

	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			// testdata holds fixtures, not compiled creators.
			if name := entry.Name(); name == ".git" || name == "testdata" || name == "node_modules" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		content, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		if !strings.Contains(string(content), vaultKeyInsert) {
			return nil
		}
		relative, relErr := filepath.Rel(root, path)
		if relErr != nil {
			return relErr
		}
		creators = append(creators, filepath.ToSlash(relative))
		return nil
	})
	if err != nil {
		t.Fatalf("walk the service source: %v", err)
	}

	// Premise check. A search that found NOTHING would pass this case while
	// proving only that the search is broken — the same "nothing found, so OK"
	// trap that silently disabled a CI gate in this repository before.
	if len(creators) == 0 {
		t.Fatalf("no file under %s contains %q: the search cannot detect a second creator",
			root, vaultKeyInsert)
	}
	if len(creators) != 1 || creators[0] != theOneCreator {
		t.Fatalf("vault creators = %v, want exactly [%s].\n"+
			"A second creator derives its own master key, so it writes vaults the "+
			"secrets handler cannot open. Both are create-if-absent, so they compose "+
			"without an error and the mismatch only appears at a later decrypt.",
			creators, theOneCreator)
	}
}

// serviceRoot walks up to the directory that holds go.mod, so the test does not
// hard-code how deep this package sits.
func serviceRoot(t *testing.T) string {
	t.Helper()
	directory, err := os.Getwd()
	if err != nil {
		t.Fatalf("resolve the working directory: %v", err)
	}
	for {
		if _, err := os.Stat(filepath.Join(directory, "go.mod")); err == nil {
			return directory
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			t.Fatal("no go.mod above the test's working directory")
		}
		directory = parent
	}
}
