package admin

import (
	"encoding/json"
	"testing"
)

// TestLLMProxySectionShape pins the contract the client's editor registry keys
// on. The section must declare the managed surface the SPA recognises, keep an
// unavailable_reason (still true of the plugin-config value endpoints), and
// carry no fields — a field here would describe a control those endpoints
// cannot serve.
func TestLLMProxySectionShape(t *testing.T) {
	var found map[string]any
	for _, s := range configSections() {
		if s["id"] == "llm_proxy" {
			found = s
		}
		if s["id"] == "litellm" {
			t.Fatal("the retired litellm section is still served")
		}
	}
	if found == nil {
		t.Fatal("no llm_proxy section")
	}
	if found["managed_surface"] != "llm_proxy" {
		t.Errorf("managed_surface = %v; the SPA registry keys on this exact string", found["managed_surface"])
	}
	if reason, _ := found["unavailable_reason"].(string); reason == "" {
		t.Error("no unavailable_reason: a client that cannot render the managed surface would get a blank pane")
	}
	fields, _ := found["fields"].([]map[string]any)
	if len(fields) != 0 {
		t.Errorf("section declares %d field(s); the value endpoints cannot serve any of them", len(fields))
	}
	if _, err := json.Marshal(found); err != nil {
		t.Errorf("section is not JSON-encodable: %v", err)
	}
}
