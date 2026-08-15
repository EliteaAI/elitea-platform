// model_sections_test.go — proves the resolver reads EVERY configuration
// section that holds a model the gateway can dispatch, not the `llm` section
// alone.
//
// The defect these tests pin: mapModel gates every dialect against the resolved
// model set, and the set was built from `llm`/`llm_model` rows only. A project's
// `embedding`/`embedding_model` row was therefore invisible, so
// POST /llm/v1/embeddings answered 404 `model_not_found` for a model the project
// had configured and whose credential resolved. Measured on the standalone
// stack: the index plane's embedding hop could not dispatch at all.
//
// `image_generation` had the identical defect on /llm/v1/images/*. It is fixed
// by the same list, so it is asserted by the same table.
package llmproxy

import (
	"strings"
	"testing"
)

// sectionCase is one addressable configuration section, the route that
// dispatches its models, and a row shaped the way the platform writes it.
type sectionCase struct {
	name string
	// section/typ are the row's configuration coordinates.
	section string
	typ     string
	// path is the /llm route that carries a model of this kind.
	path string
	// body builds a minimal valid request for path.
	body func(model string) string
	// title is the row's elitea_title, wire is its data.name. They differ, which
	// is the normal shape: deploy/scripts/standalone-stack.sh seeds the embedding
	// row as elitea_title 'standalone-embedding' with data.name
	// 'vllm/E2E-MOCK-EMBEDDING'.
	title string
	wire  string
	// wantProvider/wantModel are the pair the provider must receive.
	wantProvider string
	wantModel    string
}

// addressableSectionCases covers every pair in addressableModelSections. Add a
// case here when you add a pair there — an untested pair is a section that can
// silently stop resolving.
func addressableSectionCases() []sectionCase {
	return []sectionCase{
		{
			name: "llm", section: "llm", typ: "llm_model",
			path: "/llm/v1/chat/completions",
			body: func(m string) string {
				return `{"model":"` + m + `","messages":[{"role":"user","content":"hi"}]}`
			},
			title: "Prod chat", wire: "vllm/E2E-MOCK-MODEL",
			wantProvider: "vllm", wantModel: "E2E-MOCK-MODEL",
		},
		{
			name: "embedding", section: "embedding", typ: "embedding_model",
			path: "/llm/v1/embeddings",
			body: func(m string) string { return `{"model":"` + m + `","input":"hi"}` },
			title: "standalone-embedding", wire: "vllm/E2E-MOCK-EMBEDDING",
			wantProvider: "vllm", wantModel: "E2E-MOCK-EMBEDDING",
		},
		{
			name: "image_generation", section: "image_generation", typ: "image_generation_model",
			path: "/llm/v1/images/generations",
			body: func(m string) string { return `{"model":"` + m + `","prompt":"a cat"}` },
			title: "Team images", wire: "openai/gpt-image-1",
			wantProvider: "openai", wantModel: "gpt-image-1",
		},
	}
}

// sectionRows returns one configured row per addressable section.
func sectionRows() []fakeModelRow {
	cases := addressableSectionCases()
	rows := make([]fakeModelRow, 0, len(cases))
	for _, c := range cases {
		rows = append(rows, fakeModelRow{
			title:   c.title,
			data:    []byte(`{"name":"` + c.wire + `"}`),
			section: c.section,
			typ:     c.typ,
		})
	}
	return rows
}

// TestModelSections_EveryAddressableSectionDispatchesOnItsRoute is the
// acceptance test for the defect. It sends the row's data.name, which is what
// every real caller sends: elitea-main resolves an embedding binding to
// data.name (repos.FindCurrentEmbeddingConfiguration) and posts that string.
//
// It asserts what the PROVIDER received, not the status code. A 404 from
// mapModel and a 200 from a provider that never saw the request are both
// failures, and only the dispatch record tells them apart.
func TestModelSections_EveryAddressableSectionDispatchesOnItsRoute(t *testing.T) {
	for _, c := range addressableSectionCases() {
		t.Run(c.name, func(t *testing.T) {
			h, spy := newMapHandler(t, sectionRows())
			rec := postAs(t, h, c.path, mapProjectID, c.body(c.wire))
			if rec.Code != 200 {
				t.Fatalf("POST %s: status = %d, want 200; body=%s", c.path, rec.Code, rec.Body.String())
			}
			got, ok := spy.last()
			if !ok {
				t.Fatalf("POST %s: the provider was never called", c.path)
			}
			if got.provider != c.wantProvider || got.model != c.wantModel {
				t.Fatalf("provider received (%q, %q), want (%q, %q)",
					got.provider, got.model, c.wantProvider, c.wantModel)
			}
		})
	}
}

// TestModelSections_EveryAddressableSectionResolvesItsAdvertisedTitle covers the
// other spelling. A caller that picks the model out of GET /llm/v1/models sends
// elitea_title, and the provider must still receive data.name.
func TestModelSections_EveryAddressableSectionResolvesItsAdvertisedTitle(t *testing.T) {
	for _, c := range addressableSectionCases() {
		t.Run(c.name, func(t *testing.T) {
			h, spy := newMapHandler(t, sectionRows())
			rec := postAs(t, h, c.path, mapProjectID, c.body(c.title))
			if rec.Code != 200 {
				t.Fatalf("POST %s with the advertised title: status = %d, want 200; body=%s",
					c.path, rec.Code, rec.Body.String())
			}
			got, _ := spy.last()
			if got.provider != c.wantProvider || got.model != c.wantModel {
				t.Fatalf("provider received (%q, %q), want (%q, %q)",
					got.provider, got.model, c.wantProvider, c.wantModel)
			}
		})
	}
}

// TestModelSections_ListAdvertisesEveryAddressableSection asserts the synthetic
// catalogue and the dispatch path stay one set. A model that resolves but is not
// advertised, or the reverse, breaks the invariant modelmap.go states: list and
// dispatch agree.
//
// The UI model picker is NOT affected by what this list holds. It reads
// elitea-main's catalogue (/configurations/models/{projectId}), which selects a
// single section per call (CurrentModelSectionLLM for the chat picker), so an
// embedding model advertised here never appears as a selectable chat model.
func TestModelSections_ListAdvertisesEveryAddressableSection(t *testing.T) {
	h, _ := newMapHandler(t, sectionRows())
	ids := listedIDs(t, h, mapProjectID)

	for _, c := range addressableSectionCases() {
		found := false
		for _, id := range ids {
			if id == c.title {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("GET /llm/v1/models = %v, missing the %s model %q", ids, c.name, c.title)
		}
	}
	if len(ids) != len(addressableSectionCases()) {
		t.Fatalf("GET /llm/v1/models = %v, want exactly one id per addressable section", ids)
	}
}

// TestModelSections_UnservedSectionIsNeitherListedNorDispatchable holds the
// line the other way. `asr` and `tts` are model sections elitea-main writes, but
// the gateway mounts no audio route for them, so admitting them would advertise
// a model no caller can reach. `vectorstorage` is not a model at all.
func TestModelSections_UnservedSectionIsNeitherListedNorDispatchable(t *testing.T) {
	rows := append(sectionRows(),
		fakeModelRow{title: "Voice in", data: []byte(`{"name":"whisper-1"}`), section: "asr", typ: "asr_model"},
		fakeModelRow{title: "Voice out", data: []byte(`{"name":"tts-1"}`), section: "tts", typ: "tts_model"},
		fakeModelRow{title: "elitea-pgvector", data: []byte(`{"name":"elitea-pgvector"}`), section: "vectorstorage", typ: "pgvector"},
	)
	h, spy := newMapHandler(t, rows)

	for _, id := range listedIDs(t, h, mapProjectID) {
		for _, unserved := range []string{"Voice in", "Voice out", "elitea-pgvector"} {
			if id == unserved {
				t.Fatalf("GET /llm/v1/models advertised %q, which no /llm route can dispatch", unserved)
			}
		}
	}

	before := spy.count()
	rec := postAs(t, h, "/llm/v1/chat/completions", mapProjectID,
		`{"model":"whisper-1","messages":[{"role":"user","content":"hi"}]}`)
	if rec.Code != 404 {
		t.Fatalf("chat with an asr model: status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
	if spy.count() != before {
		t.Fatalf("chat with an asr model reached the provider %d times, want 0", spy.count()-before)
	}
}

// TestModelSections_StatementBindsEveryPairInDeclaredOrder proves the section
// list is what actually reaches Postgres. addressableModelSections is the whole
// policy, and it travels as bind parameters, so nothing in the statement text
// names a section — this is the only place a test can see the pairs.
//
// It also pins the ordering contract. modelsSQL orders by the join's ORDINALITY
// before the row id, so the declared order is the precedence order: a model id
// two sections both carry resolves to the earlier section, and `llm` is first so
// the chat models keep the positions they held before the set grew.
func TestModelSections_StatementBindsEveryPairInDeclaredOrder(t *testing.T) {
	db := &fakeModelDB{rows: sectionRows()}
	resolver := NewModelResolver(ModelResolverConfig{DB: db})
	resolver.List(t.Context(), mapProjectID)

	if len(db.gotSQL) != 1 || len(db.gotArgs) != 1 {
		t.Fatalf("got %d statements, want 1", len(db.gotSQL))
	}
	sql := db.gotSQL[0]
	for _, want := range []string{"unnest($1::text[], $2::text[])", "WITH ORDINALITY", "ORDER BY s.ord, c.id"} {
		if !strings.Contains(sql, want) {
			t.Fatalf("statement is missing %q:\n%s", want, sql)
		}
	}

	args := db.gotArgs[0]
	if len(args) != 2 {
		t.Fatalf("statement bound %d arguments, want 2 (sections, types)", len(args))
	}
	sections, ok := args[0].([]string)
	if !ok {
		t.Fatalf("argument 1 is %T, want []string", args[0])
	}
	types, ok := args[1].([]string)
	if !ok {
		t.Fatalf("argument 2 is %T, want []string", args[1])
	}
	if len(sections) != len(addressableModelSections) || len(types) != len(addressableModelSections) {
		t.Fatalf("bound %d sections and %d types, want %d of each",
			len(sections), len(types), len(addressableModelSections))
	}
	for i, s := range addressableModelSections {
		if sections[i] != s.section || types[i] != s.typ {
			t.Fatalf("bound pair %d = (%q, %q), want (%q, %q): the declared order is the precedence order",
				i, sections[i], types[i], s.section, s.typ)
		}
	}
	// `llm` first is load-bearing, not alphabetical luck.
	if addressableModelSections[0].section != "llm" {
		t.Fatalf("section 0 = %q, want \"llm\": the chat models must keep their precedence",
			addressableModelSections[0].section)
	}
}
