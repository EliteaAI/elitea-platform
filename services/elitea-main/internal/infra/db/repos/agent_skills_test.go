package repos

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestDecodeCurrentAgentInvokedSkillsPersistsOnlyCompactContract(t *testing.T) {
	skills, err := decodeCurrentAgentInvokedSkills(json.RawMessage(`[
  {"skill_id":11,"name":"Deploy","icon_meta":{"name":"rocket"},"instructions":"worker only","version_id":91},
  {"skill_id":12,"name":"deploy","icon_meta":null}
]`))
	if err != nil {
		t.Fatal(err)
	}
	if len(skills) != 1 || skills[0].SkillID != 11 || skills[0].Name != "Deploy" ||
		string(skills[0].IconMeta) != `{"name":"rocket"}` {
		t.Fatalf("compact skills = %#v", skills)
	}
	encoded, err := json.Marshal(skills)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "instructions") || strings.Contains(string(encoded), "version_id") {
		t.Fatalf("worker-only skill data reached persistence: %s", encoded)
	}
}

func TestMergeCurrentAgentInvokedSkillsUsesNewFirstCurrentSemantics(t *testing.T) {
	merged, err := mergeCurrentAgentInvokedSkills(
		json.RawMessage(`[
  {"skill_id":1,"name":"existing","icon_meta":null},
  {"skill_id":2,"name":"replaced","icon_meta":{"old":true}}
]`),
		json.RawMessage(`[
  {"skill_id":3,"name":"REPLACED","icon_meta":{"new":true}},
  {"skill_id":4,"name":"new","icon_meta":null}
]`),
	)
	if err != nil {
		t.Fatal(err)
	}
	var skills []currentAgentInvokedSkill
	if err := json.Unmarshal(merged, &skills); err != nil {
		t.Fatal(err)
	}
	if len(skills) != 3 || skills[0].SkillID != 3 || skills[1].SkillID != 4 || skills[2].SkillID != 1 {
		t.Fatalf("merged skills = %#v", skills)
	}
}

func TestMergeCurrentAgentInvokedSkillsRetainsExistingWhenContinuationEmitsNone(t *testing.T) {
	existing := json.RawMessage(`[{"skill_id":1,"name":"existing","icon_meta":{"name":"book"}}]`)
	merged, err := mergeCurrentAgentInvokedSkills(existing, json.RawMessage(`[]`))
	if err != nil {
		t.Fatal(err)
	}
	if string(merged) != string(existing) {
		t.Fatalf("merged skills = %s, want %s", merged, existing)
	}
}

func TestDecodeCurrentAgentInvokedSkillsRejectsUnsafeContract(t *testing.T) {
	for name, raw := range map[string]string{
		"non-array":        `{"skill_id":1}`,
		"missing-id":       `[{"name":"skill","icon_meta":null}]`,
		"fractional-id":    `[{"skill_id":1.5,"name":"skill","icon_meta":null}]`,
		"invalid-icon":     `[{"skill_id":1,"name":"skill","icon_meta":[]}]`,
		"trailing-content": `[{"skill_id":1,"name":"skill","icon_meta":null}] true`,
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := decodeCurrentAgentInvokedSkills(json.RawMessage(raw)); err == nil {
				t.Fatalf("unsafe invoked-skills contract was accepted: %s", raw)
			}
		})
	}
}
