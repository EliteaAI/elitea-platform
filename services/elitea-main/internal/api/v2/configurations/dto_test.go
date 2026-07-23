package configurations

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
)

func TestCurrentConfigurationDTOUsesExactCurrentNamesAndNulls(t *testing.T) {
	createdAt := time.Date(2026, time.July, 22, 10, 0, 0, 0, time.UTC)
	dto := newCurrentConfigurationDTO(configurationapp.CurrentConfiguration{
		ID: 9, UUID: "00000000-0000-4000-8000-000000000009", ProjectID: 7,
		EliteaTitle: "elitea-pgvector", Type: "pgvector", Section: "vectorstorage",
		CreatedAt: createdAt, Source: "system",
	})
	payload, err := json.Marshal(dto)
	if err != nil {
		t.Fatal(err)
	}
	text := string(payload)
	for _, field := range []string{
		`"id":9`, `"uuid":"00000000-0000-4000-8000-000000000009"`,
		`"project_id":7`, `"elitea_title":"elitea-pgvector"`, `"label":null`,
		`"data":{}`, `"meta":{}`, `"status_logs":null`, `"author_id":null`,
		`"created_at":"2026-07-22T10:00:00"`, `"updated_at":null`,
		`"is_pinned":false`,
	} {
		if !strings.Contains(text, field) {
			t.Fatalf("payload %s does not contain %s", text, field)
		}
	}
	if strings.Contains(text, `"name"`) || strings.Contains(text, `"options"`) {
		t.Fatalf("payload contains prototype or absent optional fields: %s", text)
	}
}

func TestCurrentConfigurationDTOUsesNaivePythonMicrosecondTimestampContract(t *testing.T) {
	createdAt := time.Date(2026, time.July, 22, 10, 0, 0, 123000000, time.UTC)
	updatedAt := time.Date(2026, time.July, 22, 10, 1, 2, 4000, time.UTC)
	payload, err := json.Marshal(newCurrentConfigurationDTO(configurationapp.CurrentConfiguration{
		CreatedAt: createdAt,
		UpdatedAt: &updatedAt,
	}))
	if err != nil {
		t.Fatal(err)
	}
	text := string(payload)
	for _, expected := range []string{
		`"created_at":"2026-07-22T10:00:00.123000"`,
		`"updated_at":"2026-07-22T10:01:02.000004"`,
	} {
		if !strings.Contains(text, expected) {
			t.Fatalf("payload %s does not contain %s", text, expected)
		}
	}
	if strings.Contains(text, "Z") || strings.Contains(text, "+00:00") {
		t.Fatalf("timestamp gained a synthetic timezone: %s", text)
	}
}

func TestCurrentConfigurationDTOCanRepresentPresentEmptyOptions(t *testing.T) {
	options := map[string]any{}
	payload, err := json.Marshal(newCurrentConfigurationDTO(configurationapp.CurrentConfiguration{
		Data: map[string]any{}, Meta: map[string]any{}, Options: &options,
	}))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(payload), `"options":{}`) {
		t.Fatalf("present empty options were omitted: %s", payload)
	}
}

func TestCurrentConfigurationListDTOOmitsUnrequestedSharedAndUsesArrays(t *testing.T) {
	withoutShared, err := json.Marshal(newCurrentConfigurationListDTO(configurationapp.CurrentConfigurationListResult{
		CurrentConfigurationPage: configurationapp.CurrentConfigurationPage{Limit: 20},
	}))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(withoutShared), `"shared"`) || !strings.Contains(string(withoutShared), `"items":[]`) {
		t.Fatalf("unrequested shared or null items in %s", withoutShared)
	}

	withShared, err := json.Marshal(newCurrentConfigurationListDTO(configurationapp.CurrentConfigurationListResult{
		CurrentConfigurationPage: configurationapp.CurrentConfigurationPage{Limit: 20},
		Shared:                   &configurationapp.CurrentConfigurationPage{Limit: 10, Offset: 3},
	}))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(withShared), `"shared":{"total":0,"items":[],"offset":3,"limit":10}`) {
		t.Fatalf("shared page shape changed: %s", withShared)
	}
}
