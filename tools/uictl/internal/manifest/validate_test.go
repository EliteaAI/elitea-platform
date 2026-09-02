package manifest

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// validItem returns a fully valid item anchored to the test fixture baseline.
func validItem() Item {
	return Item{
		ID:       "TEST-001",
		Domain:   "chat",
		Kind:     "route",
		Priority: "must",
		Title:    "Route `/chat` renders ChatWrapper",
		Source:   []string{"apps/elitea-ui/src/routes.js:3"},
		Acceptance: []string{
			"GIVEN an authenticated user",
			"WHEN the browser navigates to /chat",
			"THEN the chat screen is displayed",
		},
		Verify:   Verify{Type: "vitest", Command: "npm run test:unit -- chat", TestID: "chat > route"},
		Unit:     "R1",
		Status:   "todo",
		Coverage: Coverage{File: "app/router.tsx", Min: 90},
		Waiver:   nil,
	}
}

func validManifest(items ...Item) *Manifest {
	return &Manifest{
		Schema:  "./manifest.schema.json",
		Version: 1,
		GeneratedFrom: GeneratedFrom{
			Repo:   "apps/elitea-ui",
			Commit: "a55f36cfb5ecb3834bb00bbc8d9cd9a1393168af",
			Date:   "2026-07-26",
		},
		Items: items,
	}
}

// fixtureBaseline writes a minimal baseline tree with a known line count.
func fixtureBaseline(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	if err := os.MkdirAll(src, 0o755); err != nil {
		t.Fatal(err)
	}
	// exactly 5 lines
	if err := os.WriteFile(filepath.Join(src, "routes.js"), []byte("l1\nl2\nl3\nl4\nl5\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestValidate_GreenFixturePasses(t *testing.T) {
	base := fixtureBaseline(t)
	problems := Validate(validManifest(validItem()), base)
	if len(problems) != 0 {
		t.Fatalf("expected valid manifest, got problems: %v", problems)
	}
}

// TestValidate_RedGreenMutations is the RED/GREEN mutation proof required by
// unit P1: each mutation breaks exactly one validator rule and must FAIL,
// while the untouched fixture PASSES (asserted above and re-asserted per case).
func TestValidate_RedGreenMutations(t *testing.T) {
	base := fixtureBaseline(t)
	cases := []struct {
		name    string
		mutate  func(*Item)
		wantSub string
	}{
		{"id regex — lowercase", func(i *Item) { i.ID = "test-001" }, "does not match"},
		{"id regex — two letters (spec's own QP-001 shape)", func(i *Item) { i.ID = "QP-001" }, "does not match"},
		{"id regex — letter suffix (spec's own ROUTE-069b shape)", func(i *Item) { i.ID = "ROUTE-06B" }, "does not match"},
		{"unknown domain", func(i *Item) { i.Domain = "sparkles" }, "unknown domain"},
		{"unknown kind", func(i *Item) { i.Kind = "vibe" }, "unknown kind"},
		{"unknown priority", func(i *Item) { i.Priority = "later" }, "unknown priority"},
		{"empty source rejected (no-evidence guard)", func(i *Item) { i.Source = nil }, "no evidence"},
		{"source outside baseline prefix", func(i *Item) { i.Source = []string{"src/routes.js:1"} }, "not apps/elitea-ui"},
		{"source file missing", func(i *Item) { i.Source = []string{"apps/elitea-ui/src/nope.js:1"} }, "does not exist"},
		{"source line beyond EOF", func(i *Item) { i.Source = []string{"apps/elitea-ui/src/routes.js:99"} }, "out of range"},
		{"source range inverted", func(i *Item) { i.Source = []string{"apps/elitea-ui/src/routes.js:4-2"} }, "out of range"},
		{"acceptance too short", func(i *Item) { i.Acceptance = i.Acceptance[:2] }, "need >=3"},
		{"acceptance missing GIVEN start", func(i *Item) { i.Acceptance[0] = "WHEN it begins wrong" }, "start with a GIVEN"},
		{"acceptance line without keyword", func(i *Item) { i.Acceptance[2] = "the screen shows" }, "does not start with"},
		{"acceptance missing THEN", func(i *Item) {
			i.Acceptance = []string{"GIVEN a", "WHEN b", "AND c"}
		}, "WHEN line and a THEN line"},
		{"acceptance smuggles implementation detail", func(i *Item) {
			i.Acceptance[2] = "THEN src/pages/NewChat.jsx renders"
		}, "implementation detail"},
		{"unknown verify type", func(i *Item) { i.Verify.Type = "jest" }, "verify.type"},
		{"missing verify testId", func(i *Item) { i.Verify.TestID = "" }, "testId missing"},
		{"unknown unit", func(i *Item) { i.Unit = "Z9" }, "unknown unit"},
		{"unknown status", func(i *Item) { i.Status = "done" }, "unknown status"},
		{"coverage out of range", func(i *Item) { i.Coverage.Min = 120 }, "out of range"},
		{"waived without waiver", func(i *Item) { i.Priority = "waived" }, "requires a non-null waiver"},
		{"waiver on non-waived item", func(i *Item) {
			i.Waiver = &Waiver{Reason: "r", DecidedBy: "d", Date: "2026-07-26", ReplacesBehaviour: "b"}
		}, "must be null unless"},
		{"incomplete waiver object", func(i *Item) {
			i.Priority = "waived"
			i.Waiver = &Waiver{Reason: "ship dormant feature", Date: "2026-07-26"}
		}, "waiver object incomplete"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// GREEN: pristine fixture passes
			if p := Validate(validManifest(validItem()), base); len(p) != 0 {
				t.Fatalf("pristine fixture must pass, got %v", p)
			}
			// RED: mutated fixture fails with the expected rule
			it := validItem()
			tc.mutate(&it)
			problems := Validate(validManifest(it), base)
			if len(problems) == 0 {
				t.Fatalf("mutation %q must fail validation", tc.name)
			}
			found := false
			for _, p := range problems {
				if strings.Contains(p, tc.wantSub) {
					found = true
				}
			}
			if !found {
				t.Fatalf("mutation %q: expected a problem containing %q, got %v", tc.name, tc.wantSub, problems)
			}
		})
	}
}

func TestValidate_DuplicateIDs(t *testing.T) {
	base := fixtureBaseline(t)
	a, b := validItem(), validItem()
	problems := Validate(validManifest(a, b), base)
	if len(problems) == 0 || !strings.Contains(strings.Join(problems, "\n"), "duplicate id") {
		t.Fatalf("expected duplicate id problem, got %v", problems)
	}
}

func TestValidate_WaivedItemWithFullWaiverPasses(t *testing.T) {
	base := fixtureBaseline(t)
	it := validItem()
	it.Priority = "waived"
	it.Status = "waived"
	it.Waiver = &Waiver{
		Reason:            "ship dormant feature",
		DecidedBy:         "Alexander Kharkevich",
		Date:              "2026-07-26",
		ReplacesBehaviour: "dialog hidden (commented out of sidebar)",
	}
	if p := Validate(validManifest(it), base); len(p) != 0 {
		t.Fatalf("waived item with full waiver must pass, got %v", p)
	}
}

func TestValidate_HeaderRules(t *testing.T) {
	base := fixtureBaseline(t)
	m := validManifest(validItem())
	m.GeneratedFrom.Commit = "abc"
	if p := Validate(m, base); len(p) == 0 || !strings.Contains(p[0], "40-char sha") {
		t.Fatalf("expected commit sha problem, got %v", p)
	}
}

func TestUnverifiedMust(t *testing.T) {
	a := validItem()
	b := validItem()
	b.ID = "TEST-002"
	b.Status = "verified"
	c := validItem()
	c.ID = "TEST-003"
	c.Priority = "should"
	got := UnverifiedMust(validManifest(a, b, c), "")
	if len(got) != 1 || got[0] != "TEST-001" {
		t.Fatalf("expected [TEST-001], got %v", got)
	}
}

func TestUnverifiedMust_DomainScopesTheAudit(t *testing.T) {
	a := validItem() // unverified, in validItem's domain
	other := validItem()
	other.ID = "TEST-002"
	other.Domain = "deepwiki"
	other.Status = "verified"
	m := validManifest(a, other)
	if got := UnverifiedMust(m, "deepwiki"); len(got) != 0 {
		t.Fatalf("deepwiki has nothing unverified, got %v", got)
	}
	if got := UnverifiedMust(m, a.Domain); len(got) != 1 || got[0] != "TEST-001" {
		t.Fatalf("expected [TEST-001] in %s, got %v", a.Domain, got)
	}
	if !HasDomain(m, "deepwiki") || HasDomain(m, "no-such-domain") {
		t.Fatal("HasDomain must answer for exactly the domains items carry")
	}
}

// The DeepWiki bundle was deleted at the end of its port; its anchors resolve
// through the pinned commit. Proved on a throwaway repository: the file is
// committed, deleted from the tree, and still measured through the pin.
func TestValidate_DeepWikiUIAnchorsResolveThroughThePin(t *testing.T) {
	dir := t.TempDir()
	run := func(args ...string) string {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
		return strings.TrimSpace(string(out))
	}
	run("init", "-q")
	src := filepath.Join(dir, "apps", "deepwiki-ui", "src")
	if err := os.MkdirAll(src, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "App.jsx"), []byte("a\nb\nc\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	run("add", "-A")
	run("commit", "-q", "-m", "vendored")
	commit := run("rev-parse", "HEAD")
	if err := os.RemoveAll(filepath.Join(dir, "apps", "deepwiki-ui")); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "apps", "elitea-web", "parity"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Chdir(dir)
	baseline := fixtureBaseline(t)

	item := validItem()
	item.Domain = "deepwiki"
	item.Source = []string{"apps/deepwiki-ui/src/App.jsx:1-3"}

	// Without the pin the anchor is unresolvable — reported, not waved through.
	if problems := Validate(validManifest(item), baseline); len(problems) == 0 {
		t.Fatal("expected a problem with no pin and no tree")
	}
	if err := os.WriteFile(deepwikiUIPin, []byte(commit+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if problems := Validate(validManifest(item), baseline); len(problems) != 0 {
		t.Fatalf("expected the pinned tree to resolve the anchor, got %v", problems)
	}
	item.Source = []string{"apps/deepwiki-ui/src/App.jsx:1-9"}
	if problems := Validate(validManifest(item), baseline); len(problems) == 0 {
		t.Fatal("a range past the pinned file's end must still be out of range")
	}
}
