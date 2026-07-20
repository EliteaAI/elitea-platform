package securefile

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadRejectsRelativeSymlinkAndBroadPrivatePermissions(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	privatePath := filepath.Join(root, "private.pem")
	if err := os.WriteFile(privatePath, []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Read(privatePath, 64, PrivateMaterial); err != nil {
		t.Fatal(err)
	}
	if _, err := Read("private.pem", 64, PrivateMaterial); err == nil {
		t.Fatal("relative path was accepted")
	}

	symlinkPath := filepath.Join(root, "private-link.pem")
	if err := os.Symlink(privatePath, symlinkPath); err != nil {
		t.Fatal(err)
	}
	if _, err := Read(symlinkPath, 64, PrivateMaterial); err == nil {
		t.Fatal("symlink was accepted")
	}

	if err := os.Chmod(privatePath, 0o640); err != nil {
		t.Fatal(err)
	}
	if _, err := Read(privatePath, 64, PrivateMaterial); err == nil {
		t.Fatal("group-readable private file was accepted")
	}
}

func TestReadAllowsReadOnlyPublicMaterialButRejectsGroupWrite(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "ca.pem")
	if err := os.WriteFile(path, []byte("certificate"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Read(path, 64, PublicMaterial); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0o664); err != nil {
		t.Fatal(err)
	}
	if _, err := Read(path, 64, PublicMaterial); err == nil {
		t.Fatal("group-writable trust file was accepted")
	}
}

func TestReadSnapshotRetainsOpenedIdentityWithoutConflatingEqualContent(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	firstPath := filepath.Join(root, "first")
	aliasPath := filepath.Join(root, "alias")
	distinctPath := filepath.Join(root, "distinct")
	for _, path := range []string{firstPath, distinctPath} {
		if err := os.WriteFile(path, []byte("same bytes"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Link(firstPath, aliasPath); err != nil {
		t.Fatal(err)
	}

	first, err := ReadSnapshot(firstPath, 64, PrivateMaterial)
	if err != nil {
		t.Fatal(err)
	}
	alias, err := ReadSnapshot(aliasPath, 64, PrivateMaterial)
	if err != nil {
		t.Fatal(err)
	}
	distinct, err := ReadSnapshot(distinctPath, 64, PrivateMaterial)
	if err != nil {
		t.Fatal(err)
	}
	if string(first.Contents) != "same bytes" || !first.SameFile(alias) || alias.SameFile(distinct) ||
		first.SameFile(Snapshot{}) {
		t.Fatalf("unexpected snapshot identity: first=%v alias=%v distinct=%v", first.identity, alias.identity, distinct.identity)
	}
}
