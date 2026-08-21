package configurations

import "testing"

// TestCreatedMetadataColumnNeverStoresJSONNull pins the value a create writes
// into the `meta` column when the client does not send the key.
//
// The UI never sends it. The statement used to encode `json.Marshal(body["meta"])`,
// which is the four bytes `null` for an absent key, so every configuration
// created through this route stored `meta = 'null'::jsonb`. The create still
// answered 201; the typed list read of that section then answered 500 —
// "decode current configuration metadata: JSON object is required" — for every
// member of the project, and kept answering it, because nothing repairs the
// row. One saved credential took out the whole credentials screen.
func TestCreatedMetadataColumnNeverStoresJSONNull(t *testing.T) {
	for _, test := range []struct {
		name string
		body map[string]any
		want string
	}{
		{name: "absent", body: map[string]any{"type": "jira"}, want: "{}"},
		{name: "explicit null", body: map[string]any{"meta": nil}, want: "{}"},
		{name: "empty object", body: map[string]any{"meta": map[string]any{}}, want: "{}"},
		{
			name: "carried through",
			body: map[string]any{"meta": map[string]any{"pinned": true}},
			want: `{"pinned":true}`,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			encoded, reason := createdMetadataColumn(test.body)
			if reason != "" {
				t.Fatalf("reason=%q", reason)
			}
			if string(encoded) != test.want {
				t.Fatalf("meta=%q want %q", encoded, test.want)
			}
		})
	}
}

// A present `meta` of the wrong JSON type is refused rather than silently
// defaulted, so a malformed body cannot store a value no reader accepts.
func TestCreatedMetadataColumnRefusesANonObject(t *testing.T) {
	if _, reason := createdMetadataColumn(map[string]any{"meta": "oops"}); reason == "" {
		t.Fatal("a string metadata must be refused")
	}
}
