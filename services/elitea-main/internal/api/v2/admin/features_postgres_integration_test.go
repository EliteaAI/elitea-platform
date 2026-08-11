package admin_test

// Unit A14 acceptance for the admin FEATURES page's write surface (issue #200).
//
// This is the page's own end. The consumer end — that these rows change what the
// platform does — is
// `internal/api/v2/eliteacore/platform_flags_postgres_integration_test.go`, and
// the two are deliberately not allowed to share a helper: a single round-trip
// helper spanning both would pass on a page that writes rows nothing reads,
// which is the exact failure this unit exists to remove.
//
// Every write below is checked through the product's own GET *and* by SQL
// against `centry.platform_config`, for the reason the sibling file's header
// gives: this endpoint's broken predecessor answered 200 without decoding its
// body, so a status code proves nothing here.
//
// The harness (`configDo`, `newConfigPool`, `storedValueSQL`, `configRouter`)
// is the one `config_values_postgres_integration_test.go` already builds.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func saveSection(t *testing.T, router chi.Router, section string, values map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	return configDo(t, router, http.MethodPut,
		"/admin/plugin_config_values/administration/"+section,
		map[string]any{"values": values})
}

func readSection(t *testing.T, router chi.Router, section string) configValuesBody {
	t.Helper()
	recorder := configDo(t, router, http.MethodGet,
		"/admin/plugin_config_values/administration/"+section, nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("GET %s = %d (body %s)", section, recorder.Code, recorder.Body.String())
	}
	return decodeConfigBody(t, recorder)
}

/* ── MCP Configuration ─────────────────────────────────────────────────── */

func TestMCPConfigurationSectionIsWritableAndPersists(t *testing.T) {
	pool, router := newConfigEnvironment(t)

	// Fresh: the schema's defaults, both true.
	body := readSection(t, router, "mcp_configuration")
	if body.Values["mcp_enabled"] != true || body.Values["mcp_in_menu"] != true {
		t.Fatalf("defaults = %v, want both true", body.Values)
	}

	recorder := saveSection(t, router, "mcp_configuration", map[string]any{"mcp_enabled": false})
	if recorder.Code != http.StatusOK {
		t.Fatalf("PUT = %d (body %s)", recorder.Code, recorder.Body.String())
	}

	// Through the product's own read…
	if got := readSection(t, router, "mcp_configuration").Values["mcp_enabled"]; got != false {
		t.Errorf("re-read mcp_enabled = %v, want false", got)
	}
	// …and as a row.
	raw, ok := storedValueSQL(t, pool, "mcp_configuration", "mcp_enabled")
	if !ok || raw != "false" {
		t.Errorf("stored row = %q (present=%v), want false", raw, ok)
	}
	// The key it was NOT given keeps its default rather than being blanked.
	if got := readSection(t, router, "mcp_configuration").Values["mcp_in_menu"]; got != true {
		t.Errorf("mcp_in_menu = %v after saving only mcp_enabled, want its default true", got)
	}
}

// TestMCPConfigurationRefusesANonBoolean — the guardrail against a row the
// consumer would silently read as its fallback.
func TestMCPConfigurationRefusesANonBoolean(t *testing.T) {
	pool, router := newConfigEnvironment(t)

	recorder := saveSection(t, router, "mcp_configuration", map[string]any{"mcp_enabled": "false"})
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("PUT string \"false\" = %d, want 400", recorder.Code)
	}
	if got := decodeConfigBody(t, recorder).Error; !strings.Contains(got, "mcp_enabled") {
		t.Errorf("error %q does not name the field", got)
	}
	if _, ok := storedValueSQL(t, pool, "mcp_configuration", "mcp_enabled"); ok {
		t.Error("a refused value was written anyway")
	}
}

/* ── Agent Publishing ──────────────────────────────────────────────────── */

func TestAgentPublishingSectionIsWritableAndPersists(t *testing.T) {
	pool, router := newConfigEnvironment(t)

	recorder := saveSection(t, router, "agent_publishing", map[string]any{
		"is_publish_blocked":            true,
		"publish_whitelist_project_ids": []any{4, 9},
		"agent_categories":              []any{"Security Review"},
	})
	if recorder.Code != http.StatusOK {
		t.Fatalf("PUT = %d (body %s)", recorder.Code, recorder.Body.String())
	}

	values := readSection(t, router, "agent_publishing").Values
	if values["is_publish_blocked"] != true {
		t.Errorf("is_publish_blocked = %v", values["is_publish_blocked"])
	}
	raw, ok := storedValueSQL(t, pool, "agent_publishing", "publish_whitelist_project_ids")
	if !ok || raw != "[4, 9]" {
		t.Errorf("stored whitelist = %q (present=%v)", raw, ok)
	}
	raw, ok = storedValueSQL(t, pool, "agent_publishing", "agent_categories")
	if !ok || raw != `["Security Review"]` {
		t.Errorf("stored categories = %q (present=%v)", raw, ok)
	}
}

// TestArrayElementTypesAreEnforced.
//
// Both consumers type-assert their elements and SKIP what does not match
// (`AgentCategories` takes `e.(string)`, the guardrail takes `float64`), so an
// element of the wrong type is accepted, persisted, echoed by the GET, rendered
// in the form — and ignored. That is "saves into a void" one level down, and the
// operator has every reason to believe the category exists.
func TestArrayElementTypesAreEnforced(t *testing.T) {
	pool, router := newConfigEnvironment(t)

	cases := []struct {
		name  string
		key   string
		value any
	}{
		{"a category that is not a string", "agent_categories", []any{map[string]any{"name": "x"}}},
		{"a project id that is not a number", "publish_whitelist_project_ids", []any{"4"}},
		{"a project id that is not integral", "publish_whitelist_project_ids", []any{4.5}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			recorder := saveSection(t, router, "agent_publishing", map[string]any{testCase.key: testCase.value})
			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("PUT = %d, want 400 (body %s)", recorder.Code, recorder.Body.String())
			}
			if got := decodeConfigBody(t, recorder).Error; !strings.Contains(got, testCase.key) {
				t.Errorf("error %q does not name the field", got)
			}
			if _, ok := storedValueSQL(t, pool, "agent_publishing", testCase.key); ok {
				t.Error("a refused value was written anyway")
			}
		})
	}
}

// TestAnIntegerWhitelistEntryIsAccepted — the refusal above must not have made
// the field unusable. A validator that rejects everything passes every "is it
// refused" test and none of these.
func TestAnIntegerWhitelistEntryIsAccepted(t *testing.T) {
	_, router := newConfigEnvironment(t)
	// 4.0 is what a JSON integer decodes to; it must be accepted, not caught by
	// the integrality check.
	recorder := saveSection(t, router, "agent_publishing", map[string]any{
		"publish_whitelist_project_ids": []any{4.0, 0},
	})
	if recorder.Code != http.StatusOK {
		t.Fatalf("PUT = %d, want 200 (body %s)", recorder.Code, recorder.Body.String())
	}
	// And an empty array — the "block everyone" state — is a legitimate value.
	if got := saveSection(t, router, "agent_publishing", map[string]any{
		"publish_whitelist_project_ids": []any{},
	}).Code; got != http.StatusOK {
		t.Errorf("empty whitelist = %d, want 200", got)
	}
}

/* ── Voice Features ────────────────────────────────────────────────────── */

func TestVoiceFeaturesSectionIsWritableAndPersists(t *testing.T) {
	pool, router := newConfigEnvironment(t)

	values := readSection(t, router, "voice_features").Values
	if values["vite_voice_features_enabled"] != true ||
		values["vite_voice_features_temporarily_disabled"] != false {
		t.Fatalf("defaults = %v", values)
	}

	if got := saveSection(t, router, "voice_features", map[string]any{
		"vite_voice_features_temporarily_disabled": true,
	}).Code; got != http.StatusOK {
		t.Fatalf("PUT = %d", got)
	}

	if got := readSection(t, router, "voice_features").Values["vite_voice_features_temporarily_disabled"]; got != true {
		t.Errorf("re-read = %v, want true", got)
	}
	raw, ok := storedValueSQL(t, pool, "voice_features", "vite_voice_features_temporarily_disabled")
	if !ok || raw != "true" {
		t.Errorf("stored row = %q (present=%v)", raw, ok)
	}
}

/* ── field-level unavailability ────────────────────────────────────────── */

// TestAnUnavailableFieldInAnAvailableSectionIsRefusedByName.
//
// `agent_publishing` is live; `publish_validation_rules` inside it is not,
// because publish validation here is deterministic and has no evaluator for a
// custom prompt to reach. Withholding the whole section would have taken away
// three working controls to disclose one broken one; accepting the field would
// have stored a prompt nothing runs.
func TestAnUnavailableFieldInAnAvailableSectionIsRefusedByName(t *testing.T) {
	pool, router := newConfigEnvironment(t)

	recorder := saveSection(t, router, "agent_publishing", map[string]any{
		"publish_validation_rules": "reject anything mentioning production",
	})
	// 400, not 501: the SECTION is implemented, so "not implemented" would be
	// the wrong thing to say about the request. What is wrong is the field.
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("PUT = %d, want 400 (body %s)", recorder.Code, recorder.Body.String())
	}
	reason := decodeConfigBody(t, recorder).Error
	if !strings.Contains(reason, "publish_validation_rules") {
		t.Errorf("error %q does not name the field", reason)
	}
	if !strings.Contains(reason, "deterministic") {
		t.Errorf("error %q does not carry the server's reason", reason)
	}
	if _, ok := storedValueSQL(t, pool, "agent_publishing", "publish_validation_rules"); ok {
		t.Error("the refused field was written anyway")
	}
	// The sibling fields in the same section are unaffected.
	if got := saveSection(t, router, "agent_publishing",
		map[string]any{"is_publish_blocked": true}).Code; got != http.StatusOK {
		t.Errorf("a working field in the same section = %d, want 200", got)
	}
}

// TestTheUnavailableFieldIsStillDECLARED — the page renders it read-only with
// the reason. Dropping it from the schema would make the control vanish
// relative to the reference, which reads as a page that lost a feature.
func TestTheUnavailableFieldIsStillDECLARED(t *testing.T) {
	_, router := newConfigEnvironment(t)
	recorder := configDo(t, router, http.MethodGet, "/admin/plugin_config_schemas/administration", nil)
	var schema struct {
		Sections []struct {
			ID     string `json:"id"`
			Fields []struct {
				Key               string `json:"key"`
				UnavailableReason string `json:"unavailable_reason"`
			} `json:"fields"`
		} `json:"sections"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &schema); err != nil {
		t.Fatalf("decode: %v", err)
	}
	for _, section := range schema.Sections {
		if section.ID != "agent_publishing" {
			continue
		}
		for _, field := range section.Fields {
			if field.Key == "publish_validation_rules" {
				if field.UnavailableReason == "" {
					t.Error("publish_validation_rules is declared with no reason; the page would render it editable")
				}
				return
			}
		}
		t.Fatal("publish_validation_rules is not declared at all")
	}
	t.Fatal("agent_publishing section missing")
}

/* ── the sections that stay unavailable ────────────────────────────────── */

// TestFeaturesSectionsWithNoConsumerRefuseBothVerbs, with the reason naming why.
func TestFeaturesSectionsWithNoConsumerRefuseBothVerbs(t *testing.T) {
	_, router := newConfigEnvironment(t)

	cases := map[string]string{
		// No skill publish endpoint, no skill catalog, no categories surface.
		"skill_publishing": "skill publishing is not implemented",
		// The wire exists; the widget at the other end has no render site.
		"support_assistant": "not mounted in this application",
	}
	for section, fragment := range cases {
		t.Run(section, func(t *testing.T) {
			for _, method := range []string{http.MethodGet, http.MethodPut} {
				var body any
				if method == http.MethodPut {
					body = map[string]any{"values": map[string]any{}}
				}
				recorder := configDo(t, router, method,
					"/admin/plugin_config_values/administration/"+section, body)
				if recorder.Code != http.StatusNotImplemented {
					t.Errorf("%s = %d, want 501 (body %s)", method, recorder.Code, recorder.Body.String())
				}
				if got := decodeConfigBody(t, recorder).Error; !strings.Contains(got, fragment) {
					t.Errorf("%s reason %q does not contain %q", method, got, fragment)
				}
			}
		})
	}
}

/* ── the move ──────────────────────────────────────────────────────────── */

// TestResourcesStillServesTheHelpCenterAfterMovingToFeatures.
//
// This is the assertion that makes the move safe. #217 built `resources` on the
// Configuration page and wired `/help-center` to it; moving the section to
// Features must not touch that read, because the Help Center calls a SEPARATE
// route (`prompt_lib`) that has no notion of which admin page authored the row.
// Proved by writing through the admin PUT and reading back through the public
// route, rather than by inspecting that the code was not edited.
func TestResourcesStillServesTheHelpCenterAfterMovingToFeatures(t *testing.T) {
	_, router := newConfigEnvironment(t)

	recorder := saveSection(t, router, "resources", map[string]any{
		"resources_documentation_links": []any{
			map[string]any{"title": "Handbook", "url": "https://docs.example.com/handbook"},
		},
	})
	if recorder.Code != http.StatusOK {
		t.Fatalf("save = %d (body %s)", recorder.Code, recorder.Body.String())
	}

	public := configDo(t, router, http.MethodGet, "/admin/plugin_config_values/prompt_lib/resources", nil)
	if public.Code != http.StatusOK {
		t.Fatalf("public read = %d (body %s)", public.Code, public.Body.String())
	}
	links, ok := decodeConfigBody(t, public).Values["resources_documentation_links"].([]any)
	if !ok || len(links) != 1 {
		t.Fatalf("Help Center read lost the links: %v", decodeConfigBody(t, public).Values["resources_documentation_links"])
	}
	entry, _ := links[0].(map[string]any)
	if entry["url"] != "https://docs.example.com/handbook" {
		t.Errorf("link url = %v", entry["url"])
	}
}
