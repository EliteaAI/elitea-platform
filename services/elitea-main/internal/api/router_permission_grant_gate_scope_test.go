package api_test

import (
	"go/ast"
	"go/token"
	"os"
	"path/filepath"
	"testing"
)

// TestGateHelperDiscoveryCrossesFilesInTheSamePackage pins the scope of the
// helper search that TestEveryGatedPermissionHasAGrant depends on.
//
// DEFECT: gatesIn built its helper table with forEachFunction(file, ...) —
// only the file it was walking. Go resolves an unqualified name across every
// file of its package, so a gate helper declared in one file and called from
// another was never in the table. helperName then returned false at those
// call sites, and every gate behind that helper was dropped from the
// required-versus-granted matrix WITHOUT a report: the walk returns before
// the unresolved-argument path, so the gates did not even count as
// unreadable.
//
// The consequence was a green check over a broken surface.
// internal/api/v2/secrets declares adminGate in admin.go and calls it six
// times from handler.go. Those six administration-mode gates were invisible,
// no migration granted their permissions in that mode, and every one of the
// six routes answered 403 to every principal — the #354/#359 failure this
// file exists to catch. The count went from 182 sites to 188 when the scope
// was widened.
//
// This test uses a synthetic package rather than the real tree, so it keeps
// failing if the real defect is ever fixed a second way, and it does not
// break when a real package is refactored.
func TestGateHelperDiscoveryCrossesFilesInTheSamePackage(t *testing.T) {
	root := t.TempDir()
	packageDir := filepath.Join(root, "internal", "synthetic")
	if err := os.MkdirAll(packageDir, 0o755); err != nil {
		t.Fatalf("create the synthetic package: %v", err)
	}

	// The helper lives in one file...
	write(t, filepath.Join(packageDir, "admin.go"), `package synthetic

const modeAdministration = "administration"

func adminGate(permission string) func() {
	return RequireCentralPermissions(nil, modeAdministration, permission)
}

func RequireCentralPermissions(_ any, _ string, _ ...string) func() { return nil }
`)

	// ...and every call site lives in another.
	write(t, filepath.Join(packageDir, "handler.go"), `package synthetic

const secretViewPermission = "configuration.secrets.secret.view"

func Routes() []func() {
	return []func(){adminGate(secretViewPermission)}
}
`)

	index := &sourceIndex{
		fileSet:     token.NewFileSet(),
		root:        root,
		constants:   map[string]map[string]constantDefinition{},
		files:       map[string][]*ast.File{},
		imports:     map[*ast.File]map[string]string{},
		helperCache: map[string]map[string]helperSignature{},
	}
	if err := index.load(filepath.Join(root, "internal")); err != nil {
		t.Fatalf("parse the synthetic package: %v", err)
	}

	var found []gate
	for dir, files := range index.files {
		for _, file := range files {
			gates, unreadable := index.gatesIn(dir, file)
			if len(unreadable) != 0 {
				t.Fatalf("unreadable permission arguments: %v", unreadable)
			}
			found = append(found, gates...)
		}
	}

	var adminGates []gate
	for _, g := range found {
		if g.helper == "adminGate" {
			adminGates = append(adminGates, g)
		}
	}
	if len(adminGates) != 1 {
		t.Fatalf("adminGate call sites found = %d, want 1; a helper called from another file of the same package is invisible", len(adminGates))
	}
	got := adminGates[0]
	if len(got.permissions) != 1 || got.permissions[0] != "configuration.secrets.secret.view" {
		t.Errorf("permissions = %v, want [configuration.secrets.secret.view]", got.permissions)
	}
	// The mode comes from the middleware call inside the helper's own file.
	// Resolving it against the CALLING file's imports would lose it.
	if got.mode != "administration" {
		t.Errorf("mode = %q, want %q", got.mode, "administration")
	}
}

func write(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}
