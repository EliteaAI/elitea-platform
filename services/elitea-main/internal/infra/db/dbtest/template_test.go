package dbtest

// The template is a cache. A cache that does not notice a changed input is a
// silent lie: the suite would keep testing an old schema while a deployment
// applies a new one. The fingerprint is the whole guard, and these tests need
// no database, so they run in every environment.

import (
	"fmt"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

func newCorpus(sharedSQL, tenantSQL string) fstest.MapFS {
	return fstest.MapFS{
		"shared/0001_base.sql": &fstest.MapFile{Data: []byte(sharedSQL)},
		"tenant/0001_base.sql": &fstest.MapFile{Data: []byte(tenantSQL)},
	}
}

func fingerprint(t *testing.T, spec Spec) string {
	t.Helper()
	value, err := spec.Fingerprint()
	if err != nil {
		t.Fatalf("fingerprint: %v", err)
	}
	return value
}

func TestFingerprintIsStableForTheSameInputs(t *testing.T) {
	spec := Spec{
		Files:   newCorpus("CREATE TABLE a (id INTEGER);", "CREATE TABLE b (id INTEGER);"),
		Seed:    "CREATE SCHEMA seed;",
		Tenants: []int64{1},
	}
	if first, second := fingerprint(t, spec), fingerprint(t, spec); first != second {
		t.Fatalf("fingerprint is not stable: %s then %s", first, second)
	}
}

func TestFingerprintChangesWithEveryInput(t *testing.T) {
	base := Spec{
		Files:   newCorpus("CREATE TABLE a (id INTEGER);", "CREATE TABLE b (id INTEGER);"),
		Seed:    "CREATE SCHEMA seed;",
		Tenants: []int64{1},
	}
	reference := fingerprint(t, base)

	cases := []struct {
		name string
		spec Spec
	}{
		{
			name: "an edited shared migration",
			spec: Spec{
				Files:   newCorpus("CREATE TABLE a (id BIGINT);", "CREATE TABLE b (id INTEGER);"),
				Seed:    base.Seed,
				Tenants: base.Tenants,
			},
		},
		{
			name: "an edited tenant migration",
			spec: Spec{
				Files:   newCorpus("CREATE TABLE a (id INTEGER);", "CREATE TABLE b (id BIGINT);"),
				Seed:    base.Seed,
				Tenants: base.Tenants,
			},
		},
		{
			name: "an added migration",
			spec: Spec{
				Files: fstest.MapFS{
					"shared/0001_base.sql":  &fstest.MapFile{Data: []byte("CREATE TABLE a (id INTEGER);")},
					"shared/0002_extra.sql": &fstest.MapFile{Data: []byte("CREATE TABLE c (id INTEGER);")},
					"tenant/0001_base.sql":  &fstest.MapFile{Data: []byte("CREATE TABLE b (id INTEGER);")},
				},
				Seed:    base.Seed,
				Tenants: base.Tenants,
			},
		},
		{
			name: "an edited seed",
			spec: Spec{
				Files:   base.Files,
				Seed:    "CREATE SCHEMA other_seed;",
				Tenants: base.Tenants,
			},
		},
		{
			name: "another tenant",
			spec: Spec{
				Files:   base.Files,
				Seed:    base.Seed,
				Tenants: []int64{1, 2},
			},
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if changed := fingerprint(t, testCase.spec); changed == reference {
				t.Fatalf("fingerprint did not change: %s", changed)
			}
		})
	}
}

func TestFingerprintIgnoresTenantOrder(t *testing.T) {
	files := newCorpus("CREATE TABLE a (id INTEGER);", "CREATE TABLE b (id INTEGER);")
	ascending := fingerprint(t, Spec{Files: files, Seed: "x", Tenants: []int64{1, 2}})
	descending := fingerprint(t, Spec{Files: files, Seed: "x", Tenants: []int64{2, 1}})
	if ascending != descending {
		t.Fatalf("tenant order changed the fingerprint: %s and %s", ascending, descending)
	}
}

func TestTemplateNameCarriesThePrefixAndTheFingerprint(t *testing.T) {
	spec := Spec{
		Files:   newCorpus("CREATE TABLE a (id INTEGER);", "CREATE TABLE b (id INTEGER);"),
		Seed:    "CREATE SCHEMA seed;",
		Tenants: []int64{1},
	}
	name, err := spec.TemplateName()
	if err != nil {
		t.Fatalf("template name: %v", err)
	}
	if !strings.HasPrefix(name, namePrefix) {
		t.Fatalf("template name %q has no %q prefix", name, namePrefix)
	}
	if !strings.HasSuffix(name, fingerprint(t, spec)) {
		t.Fatalf("template name %q does not end with the fingerprint", name)
	}
	// PostgreSQL truncates an identifier at 63 bytes. A truncated name would
	// make two different corpora share one template.
	if len(name) > 63 {
		t.Fatalf("template name %q is %d bytes, over the PostgreSQL limit", name, len(name))
	}
}

func TestFingerprintRejectsAnInvalidCorpus(t *testing.T) {
	spec := Spec{Files: fstest.MapFS{}, Seed: "x", Tenants: []int64{1}}
	if _, err := spec.Fingerprint(); err == nil {
		t.Fatalf("fingerprint accepted a corpus with no shared history")
	}
}

// The scratch sweep drops databases. A wrong answer here drops the scratch
// database of a build that still runs, which fails that build.
func TestScratchCreatedAtReadsOnlyOwnNames(t *testing.T) {
	name := fmt.Sprintf("%s%d_%d", buildPrefix, 4242, 1787000000000000000)
	created, ok := scratchCreatedAt(name)
	if !ok {
		t.Fatalf("scratchCreatedAt rejected %q", name)
	}
	if created != 1787000000000000000 {
		t.Fatalf("scratchCreatedAt(%q) = %d", name, created)
	}

	foreign := []string{
		"postgres",
		"elitea_tmpl_f4089bcf7619a94713075eb1",
		"elitea_it_1_2",
		buildPrefix + "nonumber",
		buildPrefix + "1234",
	}
	for _, candidate := range foreign {
		if _, ok := scratchCreatedAt(candidate); ok {
			t.Errorf("scratchCreatedAt claimed %q", candidate)
		}
	}
}

func TestAFreshScratchNameIsNotStale(t *testing.T) {
	name := fmt.Sprintf("%s%d_%d", buildPrefix, 1, time.Now().UnixNano())
	created, ok := scratchCreatedAt(name)
	if !ok {
		t.Fatalf("scratchCreatedAt rejected %q", name)
	}
	if created <= time.Now().Add(-staleScratchAge).UnixNano() {
		t.Fatalf("a name made now already counts as stale")
	}
	// A build cannot outlive its own deadline, so the sweep must never reach it.
	if staleScratchAge <= buildDeadline {
		t.Fatalf("staleScratchAge %v is not above buildDeadline %v", staleScratchAge, buildDeadline)
	}
}
