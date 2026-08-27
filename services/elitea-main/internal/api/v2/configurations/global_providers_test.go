package configurations

// The platform provider surface's GUARDS, without a database.
//
// Every test here pins a refusal or a rewrite, because those are what stand
// between one central permission and the public project's whole configuration
// table — a schema every tenant on the platform reads.
//
// The delegated write paths themselves (vault sealing, the self-referential
// guard, provider admission, partial-update semantics) are covered where they
// live. Re-asserting them here would only prove that delegation happens, which
// is what these tests establish by construction.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

// providerHandler builds a handler carrying the REAL pinned catalogue, because
// the catalogue is what decides which types this surface admits.
func providerHandler() *Handler {
	return NewHandler(nil, WithPublicProjectID(1))
}

// providerRequest builds a request carrying a chi route context, as the router
// would. Without one, `pinPublicProject` has nowhere to write the project id.
func providerRequest(method, target, body string) *http.Request {
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	ctx := context.WithValue(request.Context(), chi.RouteCtxKey, chi.NewRouteContext())
	return request.WithContext(ctx)
}

// fakeProviderRows stands in for one result row, so the redaction rules are
// exercised without a database.
type fakeProviderRows struct{ data []byte }

func (f *fakeProviderRows) Scan(targets ...any) error {
	if len(targets) != 10 {
		return errors.New("column count mismatch")
	}
	*(targets[0].(*int)) = 1
	*(targets[1].(*string)) = "uuid-1"
	*(targets[2].(*string)) = "label"
	*(targets[3].(*string)) = "platform-openai"
	*(targets[4].(*string)) = "open_ai"
	*(targets[5].(*[]byte)) = f.data
	*(targets[6].(*bool)) = true
	*(targets[7].(*string)) = ""
	*(targets[8].(*time.Time)) = time.Unix(1_700_000_000, 0).UTC()
	*(targets[9].(*time.Time)) = time.Unix(1_700_000_000, 0).UTC()
	return nil
}

// TestASurfaceWithNoPublicProjectRefusesRatherThanGuessing.
//
// Defaulting to project 1 would publish a credential into a schema this
// deployment's gateway may never read, and report success for it. The operator
// then has a platform provider that resolves for nobody and no way to see why.
func TestASurfaceWithNoPublicProjectRefusesRatherThanGuessing(t *testing.T) {
	handler := &Handler{}
	recorder := httptest.NewRecorder()
	request := providerRequest(http.MethodGet, "/", "")

	handler.ListGlobalProviders(recorder, request)

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 when no public project is configured", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), "AI_PROJECT_ID") {
		t.Errorf("body %s does not say how to fix it", recorder.Body.String())
	}
}

// TestOnlyAProviderCredentialTypeMayBePublished is the security property.
//
// Without it this route writes ANY row into the public project's configuration
// table — a toolkit credential, a model, a project context — every one of them
// readable or usable by every tenant, under a permission granted for governance.
func TestOnlyAProviderCredentialTypeMayBePublished(t *testing.T) {
	for _, configType := range []string{"github", "jira", "llm_model", "project_context", ""} {
		recorder := httptest.NewRecorder()
		body := `{"elitea_title":"x","type":"` + configType + `"}`
		if configType == "" {
			body = `{"elitea_title":"x"}`
		}
		request := providerRequest(http.MethodPost, "/", body)

		if _, ok := providerHandler().rewriteGlobalProviderBody(recorder, request, true); ok {
			t.Errorf("type %q was admitted as a platform provider", configType)
			continue
		}
		if recorder.Code != http.StatusBadRequest {
			t.Errorf("type %q: status = %d, want 400", configType, recorder.Code)
		}
	}
}

// TestTheCataloguedProviderTypesAreAdmitted — the other direction. A refusal
// list that also refuses the real providers is a surface nobody can use, and it
// would look identical in the test above.
func TestTheCataloguedProviderTypesAreAdmitted(t *testing.T) {
	for _, configType := range []string{
		"open_ai", "azure_open_ai", "ai_dial", "ollama", "amazon_bedrock", "vertex_ai",
	} {
		recorder := httptest.NewRecorder()
		request := providerRequest(http.MethodPost, "/",
			`{"elitea_title":"x","type":"`+configType+`"}`)

		if _, ok := providerHandler().rewriteGlobalProviderBody(recorder, request, true); !ok {
			t.Errorf("provider type %q was refused (status %d, body %s)",
				configType, recorder.Code, recorder.Body.String())
		}
	}
}

// TestAGatewayTypeTheCatalogueDoesNotDescribeIsRefused.
//
// THE BUG THIS PREVENTS. `CurrentProviderCredentialType` admits nine types; the
// pinned catalogue describes six. For the other three the catalogue lookup
// misses TWICE, and both misses are silent:
//
//   - `sectionFor` returns "", so the row is stored with `section = ”` and the
//     gateway's `WHERE section = 'ai_credentials'` never sees it;
//   - `sealConfigurationSecrets` keeps the data verbatim, so the api_key is
//     written into the row IN PLAINTEXT — in the public project's schema, the
//     one schema every tenant on the platform can read.
//
// The result would be an inert credential with a leaked key, and every signal
// on the admin screen still reading healthy.
func TestAGatewayTypeTheCatalogueDoesNotDescribeIsRefused(t *testing.T) {
	for _, configType := range []string{"open_ai_azure", "anthropic", "vllm"} {
		recorder := httptest.NewRecorder()
		request := providerRequest(http.MethodPost, "/",
			`{"elitea_title":"x","type":"`+configType+`"}`)

		if _, ok := providerHandler().rewriteGlobalProviderBody(recorder, request, true); ok {
			t.Errorf("type %q was published: the catalogue cannot place or seal it", configType)
			continue
		}
		// The message names the admitted set. The refusal an operator most often
		// hits here is a type the GATEWAY supports and this deployment's
		// catalogue does not describe, and "unsupported" would send them looking
		// in the wrong place.
		if !strings.Contains(recorder.Body.String(), "open_ai") {
			t.Errorf("type %q: the refusal does not name what IS admitted: %s",
				configType, recorder.Body.String())
		}
	}
}

// TestEveryAdmittedTypeCanBeBothPlacedAndSealed is the invariant behind the
// list above, checked against the catalogue rather than against a copy of it —
// so adding a type to the registry snapshot without a data schema fails here
// instead of in production.
func TestEveryAdmittedTypeCanBeBothPlacedAndSealed(t *testing.T) {
	handler := providerHandler()
	admitted := handler.admittedGlobalProviderTypes()
	if len(admitted) == 0 {
		t.Fatal("no provider type is admitted; the catalogue or the section name changed")
	}

	for _, configType := range admitted {
		if section := handler.sectionFor(configType, ""); section != GlobalProviderSection {
			t.Errorf("type %q resolves to section %q, not %q — the row would be invisible "+
				"to the gateway", configType, section, GlobalProviderSection)
		}
		if _, ok := handler.configurationDataProperties(configType); !ok {
			t.Errorf("type %q has no data schema, so its secret would be stored in plaintext",
				configType)
		}
	}
}

// TestAPlatformProviderIsAlwaysShared — the rewrite that makes it global at all.
func TestAPlatformProviderIsAlwaysShared(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := providerRequest(http.MethodPost, "/", `{"elitea_title":"x","type":"open_ai"}`)

	rewritten, ok := providerHandler().rewriteGlobalProviderBody(recorder, request, true)
	if !ok {
		t.Fatalf("refused: %d %s", recorder.Code, recorder.Body.String())
	}
	var body map[string]any
	raw, _ := io.ReadAll(rewritten.Body)
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("decode rewritten body: %v", err)
	}
	if body["shared"] != true {
		t.Errorf("shared = %v, want true — an unshared platform credential is invisible to every project",
			body["shared"])
	}
	// The Content-Length must follow the body, or the delegated handler's
	// bounded decoder reads a truncated object.
	if rewritten.ContentLength != int64(len(raw)) {
		t.Errorf("ContentLength = %d, want %d", rewritten.ContentLength, len(raw))
	}
}

// TestAnExplicitlyUnsharedWriteIsRefusedRatherThanOverridden.
//
// The two differ for the operator. An override reports success for the opposite
// of what they asked and hands back a row saying `shared: true` with no
// explanation of where their value went.
func TestAnExplicitlyUnsharedWriteIsRefusedRatherThanOverridden(t *testing.T) {
	for _, shared := range []string{"false", `"yes"`, "0"} {
		recorder := httptest.NewRecorder()
		request := providerRequest(http.MethodPost, "/",
			`{"elitea_title":"x","type":"open_ai","shared":`+shared+`}`)

		if _, ok := providerHandler().rewriteGlobalProviderBody(recorder, request, true); ok {
			t.Errorf("shared:%s was silently overridden rather than refused", shared)
		}
		if recorder.Code != http.StatusBadRequest {
			t.Errorf("shared:%s: status = %d, want 400", shared, recorder.Code)
		}
	}
}

// TestAnUpdateMayOmitTheType — the delegated Update applies a PARTIAL change,
// so requiring a type here would make it impossible to rename a credential
// without restating what it is.
func TestAnUpdateMayOmitTheType(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := providerRequest(http.MethodPut, "/7", `{"elitea_title":"renamed"}`)

	if _, ok := providerHandler().rewriteGlobalProviderBody(recorder, request, false); !ok {
		t.Fatalf("a partial update was refused: %d %s", recorder.Code, recorder.Body.String())
	}
}

// TestAnUpdateMayNotChangeTheTypeToANonProvider — the type is optional on an
// update and CHECKED when present, so a row cannot be edited out of the provider
// set and left behind on a surface that no longer admits it.
func TestAnUpdateMayNotChangeTheTypeToANonProvider(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := providerRequest(http.MethodPut, "/7", `{"type":"github"}`)

	if _, ok := providerHandler().rewriteGlobalProviderBody(recorder, request, false); ok {
		t.Error("an update retyped a platform provider to a toolkit credential")
	}
}

// TestAnOversizedBodyIsRefusedByTheRewriteToo.
//
// The rewrite buffers the body, so it is a second entry point with its own
// bound. If that bound were looser than the delegated handler's, this router
// would be the place an operator could push a body the rest of the service
// refuses; if it had none, the buffer would be unbounded.
func TestAnOversizedBodyIsRefusedByTheRewrite(t *testing.T) {
	oversized := `{"elitea_title":"` + strings.Repeat("x", maxGlobalProviderBodyBytes) + `"}`
	recorder := httptest.NewRecorder()
	request := providerRequest(http.MethodPost, "/", oversized)

	if _, ok := providerHandler().rewriteGlobalProviderBody(recorder, request, true); ok {
		t.Fatal("an oversized body was buffered and admitted")
	}
	if recorder.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("status = %d, want 413", recorder.Code)
	}
}

// TestTheListingNeverEmitsSecretMaterial.
//
// Sealing means a row written by this platform holds `{{secret.NAME}}` and not
// an api_key — but the listing must not DEPEND on that. A row imported from a
// legacy deployment can hold a literal, and this screen is where it would reach
// a browser. The scan reports whether each secret is SET and whether it is
// SEALED, and never what it is.
func TestTheListingNeverEmitsSecretMaterial(t *testing.T) {
	data := []byte(`{
		"api_base": "https://api.openai.com/v1",
		"api_key": "sk-LITERAL-SECRET-VALUE",
		"aws_secret_access_key": "{{secret.abc123}}",
		"api_version": "2024-02-01"
	}`)
	item, err := scanGlobalProvider((&fakeProviderRows{data: data}).Scan)
	if err != nil {
		t.Fatalf("scan: %v", err)
	}

	encoded, err := json.Marshal(item)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if bytes.Contains(encoded, []byte("sk-LITERAL-SECRET-VALUE")) {
		t.Fatalf("the listing emitted a literal api_key: %s", encoded)
	}
	if bytes.Contains(encoded, []byte("{{secret.")) {
		// Even the reference name is withheld: it names a row in the public
		// project's vault, and the listing has no use for it.
		t.Errorf("the listing emitted a secret reference name: %s", encoded)
	}

	if item.Endpoint != "https://api.openai.com/v1" {
		t.Errorf("endpoint = %q, want the non-secret api_base", item.Endpoint)
	}
	if item.Settings["api_version"] != "2024-02-01" {
		t.Errorf("settings = %v, want api_version published", item.Settings)
	}

	sealed := map[string]bool{}
	for _, secret := range item.Secrets {
		if !secret.Set {
			t.Errorf("secret %q reported as unset while the row holds a value", secret.Field)
		}
		sealed[secret.Field] = secret.Sealed
	}
	// The literal is reported as UNSEALED. That is a finding an operator can
	// act on — the value is readable by every holder of the project-scoped
	// configuration permissions on the public project — and it is invisible
	// anywhere else.
	if sealed["api_key"] {
		t.Error("a literal api_key was reported as sealed")
	}
	if !sealed["aws_secret_access_key"] {
		t.Error("a {{secret.NAME}} reference was reported as unsealed")
	}
}

// TestACorruptDataColumnDoesNotBreakTheWholeListing — one bad row must not make
// the platform's provider screen unreachable. That is the exact shape of the
// `meta = 'null'` defect Create's header records, where a single row made a
// project's whole credentials page answer 500 permanently.
func TestACorruptDataColumnDoesNotBreakTheWholeListing(t *testing.T) {
	item, err := scanGlobalProvider((&fakeProviderRows{data: []byte(`not json`)}).Scan)
	if err != nil {
		t.Fatalf("scan refused a corrupt data column: %v", err)
	}
	if len(item.Secrets) != 0 || len(item.Settings) != 0 || item.Endpoint != "" {
		t.Errorf("item = %+v, want an empty report rather than invented fields", item)
	}
}

// TestANonStringSecretIsNotStringifiedOnItsWayOut — a secret stored as a number
// or an object must not be rendered into a string here. Reporting it as "not
// set" is the safe error.
func TestANonStringSecretIsNotStringifiedOnItsWayOut(t *testing.T) {
	item, err := scanGlobalProvider((&fakeProviderRows{
		data: []byte(`{"api_key": {"nested": "sk-SECRET"}}`),
	}).Scan)
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	encoded, _ := json.Marshal(item)
	if bytes.Contains(encoded, []byte("sk-SECRET")) {
		t.Fatalf("a non-string secret reached the response: %s", encoded)
	}
	if len(item.Secrets) != 0 {
		t.Errorf("secrets = %v, want a non-string value reported as absent", item.Secrets)
	}
}

// TestTheMountedSurfaceAnswersThePathsTheClientCalls.
//
// The admin client calls `/admin/gateway/providers` with NO trailing slash,
// while the router's pinned pattern is `/providers/` — chi's Mount registers
// both, but that is a property of chi rather than of anything in this file, and
// a future refactor from Mount to Route would change it silently. A 404 here
// would be a Providers tab that renders its empty state forever on a deployment
// where everything else is correct.
//
// 503 is the PASS condition, not 200: the handler under test has no database
// pool, so a routed request refuses for want of one. That makes the two answers
// discriminate exactly what this test is about — 404 means the path never
// reached the handler, 503 means it did.
func TestTheMountedSurfaceAnswersThePathsTheClientCalls(t *testing.T) {
	handler := &Handler{publicProjectID: 1}

	root := chi.NewRouter()
	root.Route("/gateway", func(r chi.Router) {
		r.Mount("/providers", handler.GlobalProviderRoutes())
	})

	for _, probe := range []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/gateway/providers"},
		{http.MethodGet, "/gateway/providers/"},
		{http.MethodPost, "/gateway/providers"},
		{http.MethodPut, "/gateway/providers/4"},
		{http.MethodDelete, "/gateway/providers/4"},
	} {
		recorder := httptest.NewRecorder()
		root.ServeHTTP(recorder, httptest.NewRequest(probe.method, probe.path, nil))

		if recorder.Code == http.StatusNotFound {
			t.Errorf("%s %s answered 404; the path never reached the handler",
				probe.method, probe.path)
			continue
		}
		if recorder.Code != http.StatusServiceUnavailable {
			t.Errorf("%s %s = %d, want 503 (routed, then refused for want of a pool)",
				probe.method, probe.path, recorder.Code)
		}
	}
}

// TestTheConfigIDReachesTheDelegatedHandler — the mount must bind `{configID}`,
// or an edit and a delete would address whatever row the handler defaulted to.
func TestTheConfigIDReachesTheDelegatedHandler(t *testing.T) {
	var seen string
	root := chi.NewRouter()
	sub := chi.NewRouter()
	sub.Delete("/{configID}", func(_ http.ResponseWriter, r *http.Request) {
		seen = chi.URLParam(r, "configID")
	})
	root.Route("/gateway", func(r chi.Router) { r.Mount("/providers", sub) })

	root.ServeHTTP(httptest.NewRecorder(),
		httptest.NewRequest(http.MethodDelete, "/gateway/providers/4", nil))

	if seen != "4" {
		t.Errorf("configID = %q, want %q", seen, "4")
	}
}

// TestAProviderWriteCannotChooseItsSection.
//
// `sectionFor` returns a caller-supplied `section` verbatim, so before this was
// forced a body carrying `"section": "llm"` stored a CREDENTIAL row outside
// `ai_credentials`. The row is then invisible to this listing (filtered on the
// section) AND to the gateway's credential read (same predicate) — a 201, an
// empty list, and an orphan row holding a sealed key.
func TestAProviderWriteCannotChooseItsSection(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := providerRequest(http.MethodPost, "/",
		`{"elitea_title":"x","type":"open_ai","section":"llm"}`)

	rewritten, ok := providerHandler().rewriteGlobalProviderBody(recorder, request, true)
	if !ok {
		t.Fatalf("refused: %d %s", recorder.Code, recorder.Body.String())
	}
	var body map[string]any
	raw, _ := io.ReadAll(rewritten.Body)
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["section"] != GlobalProviderSection {
		t.Errorf("section = %v, want the forced %q", body["section"], GlobalProviderSection)
	}
}

// TestAWriteVerbRefusesARowFromAnotherSection.
//
// The delegated Update and Delete address a row by id alone — no section
// predicate — so each surface could write the whole table. `DELETE
// /providers/{id}` given a MODEL's id deleted that model; `DELETE
// /platform_models/{id}` deleted a credential; a PUT carrying only `data`
// passed the type check (type is optional on an update) and overwrote a
// project_context row.
//
// The check runs against a fake row source, so what is pinned is the DECISION
// rather than the query: a section on the list passes, one off it answers 404.
func TestAWriteVerbRefusesARowFromAnotherSection(t *testing.T) {
	for section, wantAdmitted := range map[string]bool{
		"ai_credentials":   true,
		"llm":              false,
		"project_settings": false,
		"credentials":      false,
	} {
		if got := sectionAdmitted(section, GlobalProviderSection); got != wantAdmitted {
			t.Errorf("section %q admitted = %v, want %v", section, got, wantAdmitted)
		}
	}

	// And the model surface admits every model section and no credential.
	for _, section := range globalModelSectionNames() {
		if !sectionAdmitted(section, globalModelSectionNames()...) {
			t.Errorf("model section %q was refused by the model surface", section)
		}
	}
	if sectionAdmitted(GlobalProviderSection, globalModelSectionNames()...) {
		t.Error("the model surface admitted a credential row")
	}
}

// sectionAdmitted mirrors requireGlobalRowSection's membership decision.
func sectionAdmitted(section string, allowed ...string) bool {
	for _, want := range allowed {
		if section == want {
			return true
		}
	}
	return false
}
