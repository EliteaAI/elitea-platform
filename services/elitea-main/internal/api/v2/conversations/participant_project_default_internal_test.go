package conversations

// DEFECT: AddParticipant passed the request body to the repository unchanged.
//
// The repository keys a participant's identity on entity_meta.id AND
// entity_meta.project_id, the same subset legacy matches on. Legacy fills the
// project id from the request path first
// (`entity_meta['project_id'] = entity_meta.get('project_id', project_id)` in
// legacy/plugins/elitea_core/api/v2/participants.py). Without that default the
// same agent, posted once with project_id and once without, is two different
// participants in one conversation.

import "testing"

func TestDefaultEntityProjectIDFillsTheMissingProjectID(t *testing.T) {
	body := map[string]any{
		"entity_name": "application",
		"entity_meta": map[string]any{"id": 42, "name": "Foo"},
	}

	defaultEntityProjectID(body, "7")

	meta, _ := body["entity_meta"].(map[string]any)
	if got := meta["project_id"]; got != 7 {
		t.Fatalf("project_id = %v, want 7", got)
	}
}

func TestDefaultEntityProjectIDKeepsTheCallersValue(t *testing.T) {
	body := map[string]any{
		"entity_name": "application",
		"entity_meta": map[string]any{"id": 42, "project_id": 3},
	}

	defaultEntityProjectID(body, "7")

	meta, _ := body["entity_meta"].(map[string]any)
	if got := meta["project_id"]; got != 3 {
		t.Fatalf("project_id = %v, want the caller's 3", got)
	}
}

// A model participant carries no project id at all, so nothing is added: an
// invented key would change its identity.
func TestDefaultEntityProjectIDLeavesAModelParticipantAlone(t *testing.T) {
	body := map[string]any{
		"entity_name": "llm",
		"entity_meta": map[string]any{"integration_uid": "u", "model_name": "gpt-4o"},
	}

	defaultEntityProjectID(body, "7")

	meta, _ := body["entity_meta"].(map[string]any)
	if _, present := meta["project_id"]; present {
		t.Fatalf("a model participant gained a project_id: %v", meta)
	}
}
