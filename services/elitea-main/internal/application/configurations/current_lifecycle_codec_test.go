package configurations

import (
	"bytes"
	"reflect"
	"strings"
	"testing"
)

func TestCurrentConfigurationLifecycleCodecRoundTripsDurableEnvelope(t *testing.T) {
	label := "PoV GitHub"
	authorID := int32(3)
	want := CurrentConfigurationLifecycleIntent{
		ID:        "9dab84e3-0da8-4efc-a33f-d6768a2eeed2",
		Operation: CurrentConfigurationCreated,
		ActorID:   authorID,
		After: &CurrentConfigurationLifecycleSnapshot{
			ID:          13,
			UUID:        "761da3f9-8aee-41ea-a9a5-dcaf09cb433f",
			ProjectID:   2,
			EliteaTitle: "pov_go_github",
			Type:        "github",
			Section:     "credentials",
			Label:       &label,
			Source:      CurrentConfigurationSourceUser,
			AuthorID:    &authorID,
			Data:        map[string]any{"base_url": "https://api.github.com", "marker": "<&>"},
		},
	}

	encoded, err := EncodeCurrentConfigurationLifecycleIntent(want)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(encoded, []byte(`"schema_version":1`)) ||
		!bytes.Contains(encoded, []byte(`"data_available":true`)) ||
		bytes.Contains(encoded, []byte(`\u003c`)) {
		t.Fatalf("durable envelope=%s", encoded)
	}

	got, err := decodeCurrentConfigurationLifecycleIntent(encoded, want.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("decoded=%#v want=%#v", got, want)
	}
}

func TestCurrentConfigurationLifecycleCodecRejectsContractDrift(t *testing.T) {
	valid := `{"schema_version":1,"operation":"configuration_created","actor_id":3,"after":{"id":13,"uuid":"761da3f9-8aee-41ea-a9a5-dcaf09cb433f","project_id":2,"elitea_title":"title","type":"github","section":"credentials","label":null,"shared":false,"status_ok":false,"source":"user","author_id":3,"data_available":true,"data":{}}}`
	tests := map[string]string{
		"unknown version": strings.Replace(valid, `"schema_version":1`, `"schema_version":2`, 1),
		"missing data":    strings.Replace(valid, `,"data":{}`, ``, 1),
		"unexpected data": strings.Replace(valid, `"data_available":true`, `"data_available":false`, 1),
		"unknown field":   strings.Replace(valid, `"schema_version":1`, `"schema_version":1,"id":"event"`, 1),
		"trailing value":  valid + `{}`,
	}
	for name, encoded := range tests {
		t.Run(name, func(t *testing.T) {
			if _, err := decodeCurrentConfigurationLifecycleIntent([]byte(encoded), "event"); err == nil {
				t.Fatal("decode error = nil")
			}
		})
	}
}

func TestCurrentConfigurationLifecycleCodecPreservesDataAvailability(t *testing.T) {
	for name, data := range map[string]map[string]any{
		"unavailable": nil,
		"empty":       {},
	} {
		t.Run(name, func(t *testing.T) {
			intent := CurrentConfigurationLifecycleIntent{
				ID:        "event",
				Operation: CurrentConfigurationCreated,
				ActorID:   3,
				After: &CurrentConfigurationLifecycleSnapshot{
					ID: 13, UUID: "configuration", ProjectID: 2,
					EliteaTitle: "title", Type: "github", Section: "credentials",
					Source: CurrentConfigurationSourceUser, Data: data,
				},
			}
			encoded, err := EncodeCurrentConfigurationLifecycleIntent(intent)
			if err != nil {
				t.Fatal(err)
			}
			decoded, err := decodeCurrentConfigurationLifecycleIntent(encoded, intent.ID)
			if err != nil {
				t.Fatal(err)
			}
			if (decoded.After.Data == nil) != (data == nil) {
				t.Fatalf("encoded=%s decoded data=%#v", encoded, decoded.After.Data)
			}
		})
	}
}
