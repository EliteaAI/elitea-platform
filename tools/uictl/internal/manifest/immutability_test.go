package manifest

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// gitFixture creates a temp git repo containing a committed manifest and
// returns the manifest path plus a write-and-check helper.
func gitFixture(t *testing.T, committed *Manifest) string {
	t.Helper()
	dir := t.TempDir()
	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t",
			"GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t",
		)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run("init", "-q")
	path := filepath.Join(dir, "manifest.json")
	writeManifest(t, path, committed)
	run("add", "manifest.json")
	run("-c", "commit.gpgsign=false", "commit", "-q", "-m", "seed manifest")
	return path
}

func writeManifest(t *testing.T, path string, m *Manifest) {
	t.Helper()
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestImmutability_UnchangedPasses(t *testing.T) {
	m := validManifest(validItem())
	path := gitFixture(t, m)
	if p := CheckImmutability(m, path); len(p) != 0 {
		t.Fatalf("unchanged manifest must pass, got %v", p)
	}
}

func TestImmutability_AcceptanceEditWithoutWaiverFails(t *testing.T) {
	committed := validManifest(validItem())
	path := gitFixture(t, committed)

	edited := validManifest(validItem())
	edited.Items[0].Acceptance[2] = "THEN something conveniently easier is displayed"
	writeManifest(t, path, edited)

	p := CheckImmutability(edited, path)
	if len(p) != 1 || !strings.Contains(p[0], "acceptance text changed") {
		t.Fatalf("expected acceptance-immutability failure, got %v", p)
	}
}

func TestImmutability_AcceptanceEditWithWaiverPasses(t *testing.T) {
	committed := validManifest(validItem())
	path := gitFixture(t, committed)

	edited := validManifest(validItem())
	edited.Items[0].Acceptance[2] = "THEN the waived replacement behaviour is displayed"
	edited.Items[0].Priority = "waived"
	edited.Items[0].Waiver = &Waiver{
		Reason: "r", DecidedBy: "d", Date: "2026-07-26", ReplacesBehaviour: "b",
	}
	writeManifest(t, path, edited)

	if p := CheckImmutability(edited, path); len(p) != 0 {
		t.Fatalf("acceptance edit under a waiver must pass, got %v", p)
	}
}

func TestImmutability_DeletedIDFails(t *testing.T) {
	a := validItem()
	b := validItem()
	b.ID = "TEST-002"
	committed := validManifest(a, b)
	path := gitFixture(t, committed)

	edited := validManifest(a) // TEST-002 deleted
	writeManifest(t, path, edited)

	p := CheckImmutability(edited, path)
	if len(p) != 1 || !strings.Contains(p[0], "ids are immutable") {
		t.Fatalf("expected id-immutability failure, got %v", p)
	}
}

func TestImmutability_NewIDsAllowed(t *testing.T) {
	committed := validManifest(validItem())
	path := gitFixture(t, committed)

	extra := validItem()
	extra.ID = "TEST-099"
	edited := validManifest(validItem(), extra)
	writeManifest(t, path, edited)

	if p := CheckImmutability(edited, path); len(p) != 0 {
		t.Fatalf("appending new ids must pass, got %v", p)
	}
}

func TestImmutability_UntrackedManifestSkips(t *testing.T) {
	// no git repo at all
	dir := t.TempDir()
	path := filepath.Join(dir, "manifest.json")
	m := validManifest(validItem())
	writeManifest(t, path, m)
	if p := CheckImmutability(m, path); len(p) != 0 {
		t.Fatalf("untracked manifest must skip the check, got %v", p)
	}
}
