package admin

// The guardrails section, now that it is served rather than withheld.

import (
	"strings"
	"testing"
)

func guardrailsSectionForTest(t *testing.T) configSection {
	t.Helper()
	section, ok := findConfigSection("guardrails")
	if !ok {
		t.Fatal("the guardrails section is not declared")
	}
	return section
}

// TestGuardrailsSectionIsAvailable is the assertion that this unit exists to
// make true. It is written against the SECTION rather than against a handler
// because `resolveWritableSection` answers 501 from exactly this member, so a
// reason reintroduced here would silently close the page again.
func TestGuardrailsSectionIsAvailable(t *testing.T) {
	section := guardrailsSectionForTest(t)
	if reason, _ := section.raw["unavailable_reason"].(string); reason != "" {
		t.Fatalf("guardrails is withheld: %q", reason)
	}
	for _, field := range section.fields {
		key, _ := field["key"].(string)
		if reason, _ := field["unavailable_reason"].(string); reason != "" {
			t.Fatalf("field %q is withheld: %q", key, reason)
		}
	}
}

// TestGuardrailsDeclaresEveryFieldItsConsumersRead pins the schema against the
// key constants the readers use.
//
// The two sides are declared in different packages — `config_schemas.go` here,
// `internal/platformconfig` there — and a rename on either side would otherwise
// produce a form that saves under one name and a consumer that reads another,
// which looks exactly like a setting that does not work.
//
// The constants are restated as literals rather than imported: importing
// platformconfig would make this test pass by construction, asserting only that
// a constant equals itself.
func TestGuardrailsDeclaresEveryFieldItsConsumersRead(t *testing.T) {
	wanted := map[string]string{
		"blocked_toolkits":                  "array",
		"blocked_tools":                     "object",
		"sensitive_tools":                   "object",
		"sensitive_action_company_name":     "string",
		"sensitive_action_message_template": "string",
	}
	declared := map[string]string{}
	for _, field := range guardrailsSectionForTest(t).fields {
		key, _ := field["key"].(string)
		fieldType, _ := field["type"].(string)
		declared[key] = fieldType
	}
	for key, fieldType := range wanted {
		got, present := declared[key]
		if !present {
			t.Errorf("guardrails does not declare %q", key)
			continue
		}
		if got != fieldType {
			t.Errorf("guardrails declares %q as %q, want %q", key, got, fieldType)
		}
	}
	if len(declared) != len(wanted) {
		t.Errorf("guardrails declares %d fields, want %d: %v", len(declared), len(wanted), declared)
	}
}

// TestGuardrailsMapFieldsDeclareTheirValueShape guards the write path's ability
// to check them at all: `validateObjectEntries` walks `additionalProperties`, and
// a field that declares none is accepted as any object.
func TestGuardrailsMapFieldsDeclareTheirValueShape(t *testing.T) {
	for _, field := range guardrailsSectionForTest(t).fields {
		key, _ := field["key"].(string)
		if fieldType, _ := field["type"].(string); fieldType != "object" {
			continue
		}
		additional, ok := field["additionalProperties"].(map[string]any)
		if !ok {
			t.Fatalf("%q declares no additionalProperties, so its values are unchecked", key)
		}
		if additional["type"] != "array" {
			t.Fatalf("%q values are %v, want array", key, additional["type"])
		}
		items, ok := additional["items"].(map[string]any)
		if !ok || items["type"] != "string" {
			t.Fatalf("%q items are %v, want string", key, additional["items"])
		}
	}
}

func TestGuardrailsWriteAcceptsTheShapeItsReadersExpect(t *testing.T) {
	section := guardrailsSectionForTest(t)
	reason := validateSectionValues(section, map[string]any{
		"blocked_toolkits":                  []any{"shell"},
		"blocked_tools":                     map[string]any{"github": []any{"create_issue"}},
		"sensitive_tools":                   map[string]any{"*": []any{"delete_file"}},
		"sensitive_action_company_name":     "Acme",
		"sensitive_action_message_template": "{company_name} says no",
	})
	if reason != "" {
		t.Fatalf("a well-formed guardrails write was refused: %s", reason)
	}
}

// TestGuardrailsWriteRefusesAMalformedMap is the defect this validation exists
// to prevent. `Values.StringLists` skips a value that is not an array, so
// `{"github": "create_issue"}` would be stored, echoed by the GET, rendered in
// the form — and read by nothing. The operator would believe the tool was
// blocked.
func TestGuardrailsWriteRefusesAMalformedMap(t *testing.T) {
	section := guardrailsSectionForTest(t)
	for name, values := range map[string]map[string]any{
		"a string where a list belongs": {"blocked_tools": map[string]any{"github": "create_issue"}},
		"a non-string element":          {"blocked_tools": map[string]any{"github": []any{42}}},
		"an array where a map belongs":  {"sensitive_tools": []any{"delete_file"}},
	} {
		t.Run(name, func(t *testing.T) {
			reason := validateSectionValues(section, values)
			if reason == "" {
				t.Fatal("accepted a value no consumer can read")
			}
			if !strings.Contains(reason, "blocked_tools") && !strings.Contains(reason, "sensitive_tools") {
				t.Errorf("the refusal does not name the field: %q", reason)
			}
		})
	}
}

func TestGuardrailsWriteIsBounded(t *testing.T) {
	section := guardrailsSectionForTest(t)

	tooManyKeys := map[string]any{}
	for index := 0; index <= maxConfigObjectKeys; index++ {
		tooManyKeys[string(rune('a'+index%26))+strings.Repeat("x", index)] = []any{"t"}
	}
	if reason := validateSectionValues(section, map[string]any{"blocked_tools": tooManyKeys}); reason == "" {
		t.Fatal("an unbounded map was accepted onto a per-request read path")
	}

	tooManyItems := make([]any, maxConfigObjectListItems+1)
	for index := range tooManyItems {
		tooManyItems[index] = "tool"
	}
	if reason := validateSectionValues(section, map[string]any{
		"blocked_tools": map[string]any{"github": tooManyItems},
	}); reason == "" {
		t.Fatal("an unbounded tool list was accepted")
	}
}
