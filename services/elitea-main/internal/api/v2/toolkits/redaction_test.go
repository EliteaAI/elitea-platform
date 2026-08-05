package toolkits

import "testing"

func TestRedactSettingsRemovesSensitiveValuesRecursively(t *testing.T) {
	got := redactSettings(map[string]any{
		"repository":   "EliteaAI/elitea-platform",
		"access_token": "must-not-leak",
		"nested": map[string]any{
			"client_secret": "must-not-leak",
			"visible":       true,
		},
		"items": []any{map[string]any{"password": "must-not-leak", "name": "safe"}},
	}).(map[string]any)

	if _, ok := got["access_token"]; ok {
		t.Fatal("access_token was not redacted")
	}
	if got["repository"] != "EliteaAI/elitea-platform" {
		t.Fatal("non-sensitive value was changed")
	}
	nested := got["nested"].(map[string]any)
	if _, ok := nested["client_secret"]; ok || nested["visible"] != true {
		t.Fatalf("nested redaction incorrect: %#v", nested)
	}
	item := got["items"].([]any)[0].(map[string]any)
	if _, ok := item["password"]; ok || item["name"] != "safe" {
		t.Fatalf("array redaction incorrect: %#v", item)
	}
}
