package configurations

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

func TestCurrentLiteLLMDataNormalizerCredentialCreateParity(t *testing.T) {
	tests := []struct {
		name     string
		typeName string
		data     map[string]any
		want     map[string]any
	}{
		{
			name: "OpenAI defaults optional secret and ignores extra", typeName: "open_ai",
			data: map[string]any{"api_base": "https://api.openai.com", "extra": "ignored"},
			want: map[string]any{"api_base": "https://api.openai.com", "api_key": nil},
		},
		{
			name: "Azure OpenAI", typeName: "azure_open_ai",
			data: map[string]any{"api_base": "https://azure.example", "api_key": "secret", "api_version": "2025-01-01"},
			want: map[string]any{"api_base": "https://azure.example", "api_key": "secret", "api_version": "2025-01-01"},
		},
		{
			name: "AI DIAL shares Azure shape", typeName: "ai_dial",
			data: map[string]any{"api_base": "https://dial.example", "api_key": nil},
			want: map[string]any{"api_base": "https://dial.example", "api_key": nil, "api_version": nil},
		},
		{
			name: "Amazon Bedrock permits empty payload", typeName: "amazon_bedrock",
			data: map[string]any{},
			want: map[string]any{"aws_access_key_id": nil, "aws_secret_access_key": nil, "aws_region_name": nil},
		},
		{
			name: "Vertex AI requires all values", typeName: "vertex_ai",
			data: map[string]any{"vertex_project": "project", "vertex_location": "us-central1", "vertex_credentials": "json"},
			want: map[string]any{"vertex_project": "project", "vertex_location": "us-central1", "vertex_credentials": "json"},
		},
		{
			name: "Ollama", typeName: "ollama",
			data: map[string]any{"api_base": "http://ollama:11434"},
			want: map[string]any{"api_base": "http://ollama:11434"},
		},
	}

	normalizer := NewCurrentLiteLLMDataNormalizer(nil)
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			result, err := normalizer.Normalize(context.Background(), CurrentConfigurationNormalizationRequest{
				Operation: CurrentConfigurationNormalizationCreate,
				Type:      test.typeName,
				Data:      test.data,
			})
			if err != nil {
				t.Fatal(err)
			}
			if !result.Complete || !reflect.DeepEqual(result.Data, test.want) {
				t.Fatalf("result = %#v, want %#v", result, test.want)
			}
		})
	}
}

func TestCurrentLiteLLMDataNormalizerRejectsInvalidCredentialCreateData(t *testing.T) {
	tests := []struct {
		name     string
		typeName string
		data     map[string]any
		field    string
	}{
		{name: "OpenAI api base required", typeName: "open_ai", data: map[string]any{}, field: "data.api_base"},
		{name: "OpenAI api base is not coerced", typeName: "open_ai", data: map[string]any{"api_base": 7}, field: "data.api_base"},
		{name: "OpenAI secret must be string", typeName: "open_ai", data: map[string]any{"api_base": "url", "api_key": 7}, field: "data.api_key"},
		{name: "Azure version must be string", typeName: "azure_open_ai", data: map[string]any{"api_base": "url", "api_version": 7}, field: "data.api_version"},
		{name: "Vertex project required", typeName: "vertex_ai", data: map[string]any{"vertex_location": "l", "vertex_credentials": "c"}, field: "data.vertex_project"},
		{name: "Vertex location required", typeName: "vertex_ai", data: map[string]any{"vertex_project": "p", "vertex_credentials": "c"}, field: "data.vertex_location"},
		{name: "Vertex credentials required", typeName: "vertex_ai", data: map[string]any{"vertex_project": "p", "vertex_location": "l"}, field: "data.vertex_credentials"},
		{name: "Ollama api base required", typeName: "ollama", data: map[string]any{}, field: "data.api_base"},
	}

	normalizer := NewCurrentLiteLLMDataNormalizer(nil)
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			result, err := normalizer.Normalize(context.Background(), CurrentConfigurationNormalizationRequest{
				Operation: CurrentConfigurationNormalizationCreate,
				Type:      test.typeName,
				Data:      test.data,
			})
			if !errors.Is(err, ErrInvalidCurrentConfigurationMutation) || result.Complete || result.Data != nil {
				t.Fatalf("result=%#v error=%v", result, err)
			}
			var fieldError *CurrentConfigurationMutationError
			if !errors.As(err, &fieldError) || fieldError.Field != test.field || fieldError.Code != CurrentConfigurationMutationInvalid {
				t.Fatalf("field error=%#v, want field %q", fieldError, test.field)
			}
		})
	}
}

func TestCurrentLiteLLMDataNormalizerDelegatesNonCredentialCreateRequests(t *testing.T) {
	fallback := &currentLiteLLMNormalizerFallback{}
	normalizer := NewCurrentLiteLLMDataNormalizer(fallback)
	requests := []CurrentConfigurationNormalizationRequest{
		{Operation: CurrentConfigurationNormalizationUpdate, Type: "open_ai", Data: map[string]any{"api_base": "updated"}},
		{Operation: CurrentConfigurationNormalizationCreate, Type: "llm_model", Data: map[string]any{"name": "model"}},
	}
	for _, request := range requests {
		result, err := normalizer.Normalize(context.Background(), request)
		if err != nil || !result.Complete || result.Data["delegated"] != true {
			t.Fatalf("delegated result=%#v error=%v", result, err)
		}
	}
	if !reflect.DeepEqual(fallback.requests, requests) {
		t.Fatalf("fallback requests=%#v, want %#v", fallback.requests, requests)
	}

	result, err := NewCurrentLiteLLMDataNormalizer(nil).Normalize(context.Background(), requests[1])
	if err != nil || result.Complete || result.Data != nil {
		t.Fatalf("unhandled result=%#v error=%v", result, err)
	}
}

func TestCurrentLiteLLMDataNormalizerHonorsContext(t *testing.T) {
	normalizer := NewCurrentLiteLLMDataNormalizer(nil)
	if _, err := normalizer.Normalize(nil, CurrentConfigurationNormalizationRequest{}); !errors.Is(err, ErrInvalidCurrentConfigurationMutation) {
		t.Fatalf("nil context error=%v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := normalizer.Normalize(ctx, CurrentConfigurationNormalizationRequest{}); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled context error=%v", err)
	}
}

type currentLiteLLMNormalizerFallback struct {
	requests []CurrentConfigurationNormalizationRequest
}

func (f *currentLiteLLMNormalizerFallback) Normalize(
	_ context.Context,
	request CurrentConfigurationNormalizationRequest,
) (CurrentConfigurationNormalizationResult, error) {
	f.requests = append(f.requests, request)
	return CurrentConfigurationNormalizationResult{Data: map[string]any{"delegated": true}, Complete: true}, nil
}
