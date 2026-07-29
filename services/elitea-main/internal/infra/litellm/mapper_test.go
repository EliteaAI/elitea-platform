package litellm

import (
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
)

func TestProjectCredentialPreservesCurrentSixMappings(t *testing.T) {
	tests := []struct {
		name     string
		typeName string
		data     map[string]any
		provider string
		values   map[string]any
	}{
		{
			name: "open ai", typeName: CredentialTypeOpenAI, provider: "OpenAI",
			data:   map[string]any{"api_base": "https://openai.invalid", "api_key": "openai-secret"},
			values: map[string]any{"api_base": "https://openai.invalid", "api_key": "openai-secret"},
		},
		{
			name: "azure open ai", typeName: CredentialTypeAzureOpenAI, provider: "Azure",
			data:   map[string]any{"api_base": "https://azure.invalid", "api_key": "-", "api_version": "2026-01-01"},
			values: map[string]any{"api_base": "https://azure.invalid", "api_version": "2026-01-01"},
		},
		{
			name: "ai dial", typeName: CredentialTypeAIDIAL, provider: "Azure",
			data:   map[string]any{"api_base": "https://dial.invalid", "api_key": "dial-secret", "api_version": ""},
			values: map[string]any{"api_base": "https://dial.invalid", "api_key": "dial-secret"},
		},
		{
			name: "amazon bedrock", typeName: CredentialTypeAmazonBedrock, provider: "Bedrock",
			data: map[string]any{
				"aws_access_key_id": "access", "aws_secret_access_key": "bedrock-secret", "aws_region_name": "eu-west-1",
			},
			values: map[string]any{
				"aws_access_key_id": "access", "aws_secret_access_key": "bedrock-secret", "aws_region_name": "eu-west-1",
			},
		},
		{
			name: "vertex ai", typeName: CredentialTypeVertexAI, provider: "Vertex_AI",
			data: map[string]any{
				"vertex_project": "project", "vertex_location": "us-central1", "vertex_credentials": "vertex-secret",
			},
			values: map[string]any{
				"vertex_project": "project", "vertex_location": "us-central1", "vertex_credentials": "vertex-secret",
			},
		},
		{
			name: "ollama", typeName: CredentialTypeOllama, provider: "Ollama",
			data:   map[string]any{"api_base": "https://ollama.invalid"},
			values: map[string]any{"api_base": "https://ollama.invalid"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			projection, err := ProjectCredential(Configuration{
				UUID: "00000000-0000-0000-0000-000000000011", ProjectID: 7, Type: test.typeName, Data: test.data,
			})
			if err != nil {
				t.Fatal(err)
			}
			if projection.CredentialName != "7_00000000-0000-0000-0000-000000000011" ||
				projection.CredentialInfo["custom_llm_provider"] != test.provider ||
				!reflect.DeepEqual(projection.CredentialValues, test.values) {
				t.Fatalf("projection=%#v", projection)
			}
		})
	}
}

func TestProjectModelPreservesProviderMappingsAndImportedModels(t *testing.T) {
	providers := map[string]string{
		CredentialTypeOpenAI:        "openai",
		CredentialTypeAzureOpenAI:   "azure",
		CredentialTypeAIDIAL:        "azure",
		CredentialTypeAmazonBedrock: "bedrock",
		CredentialTypeVertexAI:      "vertex_ai",
		CredentialTypeOllama:        "ollama",
	}
	for credentialType, expectedProvider := range providers {
		t.Run(credentialType, func(t *testing.T) {
			configuration := modelConfiguration(credentialType, "model-a")
			projection, err := ProjectModel(configuration, map[string]any{"drop_params": true})
			if err != nil {
				t.Fatal(err)
			}
			if projection.ModelName != "7_model-a" || projection.LiteLLMParams["custom_llm_provider"] != expectedProvider ||
				projection.LiteLLMParams["litellm_credential_name"] != "1_credential-uuid" ||
				projection.LiteLLMParams["model"] != "model-a" ||
				projection.ModelInfo["centry_configuration_uuid"] != configuration.UUID {
				t.Fatalf("projection=%#v", projection)
			}
			_, hasOpenAIOption := projection.LiteLLMParams["drop_params"]
			if hasOpenAIOption != (credentialType == CredentialTypeOpenAI) {
				t.Fatalf("additional OpenAI option presence=%v params=%#v", hasOpenAIOption, projection.LiteLLMParams)
			}
		})
	}

	configuration := modelConfiguration(CredentialTypeOpenAI, "external")
	delete(configuration.Data, "ai_credentials")
	projection, err := ProjectModel(configuration, nil)
	if err != nil || projection != nil {
		t.Fatalf("imported projection=%#v err=%v", projection, err)
	}
}

func TestProjectModelPreservesAzureTranscriptionRoutingAndOpenAIMergeOrder(t *testing.T) {
	azure := modelConfiguration(CredentialTypeAzureOpenAI, "whisper-large")
	projection, err := ProjectModel(azure, nil)
	if err != nil {
		t.Fatal(err)
	}
	if projection.ModelName != "7_whisper-large" || projection.LiteLLMParams["model"] != "azure/whisper-large" {
		t.Fatalf("azure transcription projection=%#v", projection)
	}

	alreadyPrefixed := modelConfiguration(CredentialTypeAzureOpenAI, "azure/gpt-4o-transcribe")
	projection, err = ProjectModel(alreadyPrefixed, nil)
	if err != nil || projection.LiteLLMParams["model"] != "azure/gpt-4o-transcribe" {
		t.Fatalf("prefixed transcription projection=%#v err=%v", projection, err)
	}

	openAI := modelConfiguration(CredentialTypeOpenAI, "gpt-current")
	additional := map[string]any{
		"custom_llm_provider": "configured-provider",
		"model":               "must-not-win",
		"nested":              map[string]any{"value": "original"},
	}
	projection, err = ProjectModel(openAI, additional)
	if err != nil {
		t.Fatal(err)
	}
	if projection.LiteLLMParams["custom_llm_provider"] != "configured-provider" || projection.LiteLLMParams["model"] != "gpt-current" {
		t.Fatalf("openai merge projection=%#v", projection)
	}
	projection.LiteLLMParams["nested"].(map[string]any)["value"] = "mutated"
	if additional["nested"].(map[string]any)["value"] != "original" {
		t.Fatal("projection aliases additional configuration")
	}
}

func TestProjectionRejectsUnsupportedAndMalformedInputsWithoutLeakingValues(t *testing.T) {
	secret := "must-not-appear"
	tests := []struct {
		name string
		run  func() error
		want error
	}{
		{
			name: "unsupported credential",
			run: func() error {
				_, err := ProjectCredential(Configuration{UUID: "uuid", ProjectID: 1, Type: "github", Data: map[string]any{"token": secret}})
				return err
			},
			want: ErrUnsupportedCredential,
		},
		{
			name: "malformed provider value",
			run: func() error {
				_, err := ProjectCredential(Configuration{UUID: "uuid", ProjectID: 1, Type: CredentialTypeOpenAI, Data: map[string]any{"api_base": 7, "api_key": secret}})
				return err
			},
			want: ErrInvalidProjection,
		},
		{
			name: "bad credential project",
			run: func() error {
				configuration := modelConfiguration(CredentialTypeOpenAI, "gpt")
				configuration.Data["ai_credentials"].(map[string]any)["configuration_project_id"] = json.Number("1.5")
				_, err := ProjectModel(configuration, nil)
				return err
			},
			want: ErrInvalidProjection,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := test.run()
			if !errors.Is(err, test.want) {
				t.Fatalf("error=%v want=%v", err, test.want)
			}
			if err != nil && strings.Contains(err.Error(), secret) {
				t.Fatalf("error leaked secret: %v", err)
			}
		})
	}
}

func TestProjectionIdentitiesMatchCurrentDeletionKeys(t *testing.T) {
	configuration := modelConfiguration(CredentialTypeOpenAI, "gpt-current")
	credential, err := CredentialIdentity(configuration)
	if err != nil || credential != "7_model-uuid" {
		t.Fatalf("credential identity=%q err=%v", credential, err)
	}
	model, uuid, err := ModelIdentity(configuration)
	if err != nil || model != "7_gpt-current" || uuid != "model-uuid" {
		t.Fatalf("model identity=%q uuid=%q err=%v", model, uuid, err)
	}
}

func modelConfiguration(credentialType, modelName string) Configuration {
	return Configuration{
		UUID:      "model-uuid",
		ProjectID: 7,
		Type:      "llm_model",
		Data: map[string]any{
			"name": modelName,
			"ai_credentials": map[string]any{
				"configuration_type":       credentialType,
				"configuration_uuid":       "credential-uuid",
				"configuration_project_id": json.Number("1"),
			},
		},
	}
}
