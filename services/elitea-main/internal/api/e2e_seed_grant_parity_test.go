package api

import (
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
	"testing"
)

// The end-to-end seed and the three #496 gates must agree.
//
// # THE FAILURE THIS EXISTS FOR
//
// Gating a route is half the work. The other half is that the callers the
// product means to admit still get through, and on the end-to-end stack that is
// decided by a seed script rather than by the migration corpus.
//
// legacyrbac reads auth_core__project_role_permission FIRST. Project 1 of the
// end-to-end stack carries those rows, and their presence SUPPRESSES the central
// default-mode fallback that shared/0062 and shared/0072 seed. So a permission
// granted by the corpus does NOT reach project 1: it has to be listed in the
// seed as well, by name.
//
// When #496 gated the /configurations mount, the seed listed exactly two of the
// five strings — `update` and `delete` — because until then the routes checked
// nothing and the list had never had to be right. Adding the gate without
// adding the other three would have answered 403 to:
//
//   - the credential list the AI-configuration page reads,
//   - the model catalogue the chat model picker and the tokens page read,
//   - the credential save and the "Test connection" probe beside it,
//   - the edit dialog's own read.
//
// Every one of those reads as a broken page, not as a missing grant. That is the
// shape of #354, #359 and #402, moved from the migration corpus to the seed.
//
// # WHY A SOURCE CHECK AND NOT A JOURNEY
//
// A journey proves one path on one day. This proves the property for every route
// in the table, it runs on a machine with no PostgreSQL and no container
// runtime, and it names the missing string rather than a screenshot. The
// journeys still run; this is what tells a future author WHY a journey broke.
//
// # SCOPE
//
// The three surfaces #496 gates, and no more. Extending the check to every
// project-scoped gate in the router is worth doing and is a different change:
// the seed carries rows for surfaces this file knows nothing about, and a
// red-on-arrival gate gets switched off.

// e2eSeedScript is the seed the end-to-end stack applies.
const e2eSeedScript = "../../../../apps/elitea-web/scripts/e2e-stack.sh"

// projectOneGrantMarker starts the INSERT that grants project 1's per-project
// rows. It is matched as a whole line so a second INSERT into the same table —
// the personal-project block further down, which serves one persona — cannot be
// mistaken for it.
const projectOneGrantMarker = "SELECT 1, r.id, p.permission"

// seedGrantValue matches one `('permission'),` row of a VALUES list.
var seedGrantValue = regexp.MustCompile(`^\s*\('([a-z0-9_.]+)'\),?\s*$`)

// TestTheEndToEndSeedGrantsEveryStringTheThreeSurfacesGateOn is the check.
func TestTheEndToEndSeedGrantsEveryStringTheThreeSurfacesGateOn(t *testing.T) {
	t.Parallel()

	seeded := projectOneSeededPermissions(t)

	// Premise guard. A parser that finds nothing must fail, never pass quietly:
	// "no rows found, so nothing is missing" is how check-playwright-image-tag
	// stopped gating and nobody noticed.
	if len(seeded) < 40 {
		t.Fatalf("parsed %d permissions out of %s; the project-1 grant block has far more.\n"+
			"  The seed's shape changed and this check is no longer reading it.",
			len(seeded), e2eSeedScript)
	}

	var missing []string
	for _, permission := range allProjectSurfacePermissions {
		if !slices.Contains(seeded, permission) {
			missing = append(missing, permission)
		}
	}
	sort.Strings(missing)
	for _, permission := range missing {
		t.Errorf("the end-to-end seed does not grant %q to project 1, and a route of the "+
			"/configurations, /webhooks or /events group gates on it.\n"+
			"  Project 1 carries per-project rows, which SUPPRESS the central default-mode\n"+
			"  fallback, so the corpus grant does not reach it. Add the string to the\n"+
			"  project-1 VALUES list in %s.\n"+
			"  Without it the route answers 403 and the page reads as broken.",
			permission, e2eSeedScript)
	}
}

// The control. Without it, a parser that returned every string it could find —
// including strings from another block — would satisfy the test above for the
// wrong reason.
//
// `configuration.secrets.secret.unsecret` is in the project-1 block.
// `admin.auth.users` is deliberately NOT: the seed withholds it so the member
// persona is refused the global user list, and a parser that reached outside the
// block would pick it up from the administration-role INSERT above it.
func TestTheSeedParserReadsTheProjectOneBlockAndNoOther(t *testing.T) {
	t.Parallel()

	seeded := projectOneSeededPermissions(t)

	if !slices.Contains(seeded, "configuration.secrets.secret.unsecret") {
		t.Error("the parser missed a string that IS in the project-1 block; it is reading too little")
	}
	if slices.Contains(seeded, "admin.auth.users") {
		t.Error("the parser found a string that is NOT in the project-1 block; it is reading too much")
	}
}

// projectOneSeededPermissions returns the permissions the seed grants to
// project 1's three roles.
func projectOneSeededPermissions(t *testing.T) []string {
	t.Helper()

	raw, err := os.ReadFile(filepath.Clean(e2eSeedScript))
	if err != nil {
		t.Fatalf("read %s: %v.\n"+
			"  The seed moved. This check cannot be skipped: it is the only thing that keeps "+
			"the gates and the seed in step.", e2eSeedScript, err)
	}

	lines := strings.Split(string(raw), "\n")
	start := -1
	for i, line := range lines {
		if strings.TrimSpace(line) == projectOneGrantMarker {
			start = i
			break
		}
	}
	if start < 0 {
		t.Fatalf("%q is not in %s. The project-1 grant block changed shape and this check "+
			"is reading nothing.", projectOneGrantMarker, e2eSeedScript)
	}

	permissions := []string{}
	for _, line := range lines[start:] {
		if strings.HasPrefix(strings.TrimSpace(line), ") AS p(permission)") {
			break
		}
		if match := seedGrantValue.FindStringSubmatch(line); match != nil {
			permissions = append(permissions, match[1])
		}
	}
	slices.Sort(permissions)
	return slices.Compact(permissions)
}
