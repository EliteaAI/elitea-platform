// Package litellm contains the narrow translation boundary between current
// Configurations records and LiteLLM's administrative API.
package litellm

import (
	"encoding/json"
	"errors"
	"strconv"
	"strings"
)

var (
	ErrInvalidProjection     = errors.New("invalid LiteLLM projection")
	ErrUnsupportedCredential = errors.New("unsupported LiteLLM credential type")
)

const (
	CredentialTypeOpenAI        = "open_ai"
	CredentialTypeAzureOpenAI   = "azure_open_ai"
	CredentialTypeAIDIAL        = "ai_dial"
	CredentialTypeAmazonBedrock = "amazon_bedrock"
	CredentialTypeVertexAI      = "vertex_ai"
	CredentialTypeOllama        = "ollama"
)

// Configuration is the already validated and lifecycle-expanded current
// configuration projection used to reconcile LiteLLM. This adapter never
// loads configuration rows or secrets itself and is not part of worker claim
// materialization.
type Configuration struct {
	UUID      string
	ProjectID int64
	Type      string
	Data      map[string]any
}

type CredentialProjection struct {
	CredentialName   string         `json:"credential_name"`
	CredentialValues map[string]any `json:"credential_values"`
	CredentialInfo   map[string]any `json:"credential_info"`
}

type ModelProjection struct {
	ModelName     string         `json:"model_name"`
	LiteLLMParams map[string]any `json:"litellm_params"`
	ModelInfo     map[string]any `json:"model_info"`
}

// ProjectCredential preserves the six configuration-to-LiteLLM credential
// mappings in runtime_interface_litellm. Provider-specific knowledge is
// intentionally confined to this outbound adapter; Configurations remains
// registry-driven and provider-neutral.
func ProjectCredential(configuration Configuration) (CredentialProjection, error) {
	if err := validateConfigurationIdentity(configuration); err != nil {
		return CredentialProjection{}, err
	}

	values := make(map[string]any, 3)
	provider := ""
	switch configuration.Type {
	case CredentialTypeOpenAI:
		apiBase, err := requiredString(configuration.Data, "api_base")
		if err != nil {
			return CredentialProjection{}, err
		}
		values["api_base"] = apiBase
		if err := copyOptionalNonDashString(values, configuration.Data, "api_key"); err != nil {
			return CredentialProjection{}, err
		}
		provider = "OpenAI"
	case CredentialTypeAzureOpenAI, CredentialTypeAIDIAL:
		apiBase, err := requiredString(configuration.Data, "api_base")
		if err != nil {
			return CredentialProjection{}, err
		}
		values["api_base"] = apiBase
		if err := copyOptionalNonDashString(values, configuration.Data, "api_key"); err != nil {
			return CredentialProjection{}, err
		}
		if err := copyOptionalNonDashString(values, configuration.Data, "api_version"); err != nil {
			return CredentialProjection{}, err
		}
		provider = "Azure"
	case CredentialTypeAmazonBedrock:
		for _, field := range []string{"aws_access_key_id", "aws_secret_access_key", "aws_region_name"} {
			if err := copyOptionalNonDashString(values, configuration.Data, field); err != nil {
				return CredentialProjection{}, err
			}
		}
		provider = "Bedrock"
	case CredentialTypeVertexAI:
		for _, field := range []string{"vertex_project", "vertex_location", "vertex_credentials"} {
			value, err := requiredString(configuration.Data, field)
			if err != nil {
				return CredentialProjection{}, err
			}
			values[field] = value
		}
		provider = "Vertex_AI"
	case CredentialTypeOllama:
		apiBase, err := requiredString(configuration.Data, "api_base")
		if err != nil {
			return CredentialProjection{}, err
		}
		values["api_base"] = apiBase
		provider = "Ollama"
	default:
		return CredentialProjection{}, ErrUnsupportedCredential
	}

	return CredentialProjection{
		CredentialName:   credentialName(configuration.ProjectID, configuration.UUID),
		CredentialValues: values,
		CredentialInfo:   map[string]any{"custom_llm_provider": provider},
	}, nil
}

// ProjectModel maps one model configuration whose ai_credentials reference has
// already been generically expanded by Configurations. Imported models without
// ai_credentials are intentionally reported as unmanaged.
func ProjectModel(configuration Configuration, additionalOpenAIParams map[string]any) (*ModelProjection, error) {
	if err := validateConfigurationIdentity(configuration); err != nil {
		return nil, err
	}
	modelName, err := requiredNonEmptyString(configuration.Data, "name")
	if err != nil {
		return nil, err
	}
	credentialValue, present := configuration.Data["ai_credentials"]
	if !present || credentialValue == nil {
		return nil, nil
	}
	credential, ok := credentialValue.(map[string]any)
	if !ok {
		return nil, ErrInvalidProjection
	}
	credentialType, err := requiredNonEmptyString(credential, "configuration_type")
	if err != nil {
		return nil, err
	}
	credentialUUID, err := requiredNonEmptyString(credential, "configuration_uuid")
	if err != nil {
		return nil, err
	}
	credentialProject, err := positiveIntegerText(credential["configuration_project_id"])
	if err != nil {
		return nil, err
	}

	provider, err := modelProvider(credentialType)
	if err != nil {
		return nil, err
	}
	params := map[string]any{
		"custom_llm_provider":     provider,
		"litellm_credential_name": credentialProject + "_" + credentialUUID,
	}
	if credentialType == CredentialTypeOpenAI {
		for key, value := range additionalOpenAIParams {
			params[key] = cloneJSONValue(value)
		}
	}

	projectedModelName := modelName
	if credentialType == CredentialTypeAzureOpenAI {
		lower := strings.ToLower(modelName)
		if (strings.Contains(lower, "whisper") || strings.Contains(lower, "transcribe")) && !strings.HasPrefix(modelName, "azure/") {
			projectedModelName = "azure/" + modelName
		}
	}
	// Current mapping applies model last, so a configured additional parameter
	// cannot silently replace the selected model name.
	params["model"] = projectedModelName

	return &ModelProjection{
		ModelName:     strconv.FormatInt(configuration.ProjectID, 10) + "_" + modelName,
		LiteLLMParams: params,
		ModelInfo:     map[string]any{"centry_configuration_uuid": configuration.UUID},
	}, nil
}

func CredentialIdentity(configuration Configuration) (string, error) {
	if err := validateConfigurationIdentity(configuration); err != nil {
		return "", err
	}
	return credentialName(configuration.ProjectID, configuration.UUID), nil
}

func ModelIdentity(configuration Configuration) (modelName, configurationUUID string, err error) {
	if err := validateConfigurationIdentity(configuration); err != nil {
		return "", "", err
	}
	name, err := requiredNonEmptyString(configuration.Data, "name")
	if err != nil {
		return "", "", err
	}
	return strconv.FormatInt(configuration.ProjectID, 10) + "_" + name, configuration.UUID, nil
}

func modelProvider(credentialType string) (string, error) {
	switch credentialType {
	case CredentialTypeOpenAI:
		return "openai", nil
	case CredentialTypeAzureOpenAI, CredentialTypeAIDIAL:
		return "azure", nil
	case CredentialTypeAmazonBedrock:
		return "bedrock", nil
	case CredentialTypeVertexAI:
		return "vertex_ai", nil
	case CredentialTypeOllama:
		return "ollama", nil
	default:
		return "", ErrUnsupportedCredential
	}
}

func validateConfigurationIdentity(configuration Configuration) error {
	if configuration.ProjectID <= 0 || strings.TrimSpace(configuration.UUID) == "" || configuration.Data == nil {
		return ErrInvalidProjection
	}
	return nil
}

func credentialName(projectID int64, uuid string) string {
	return strconv.FormatInt(projectID, 10) + "_" + uuid
}

func requiredString(data map[string]any, field string) (string, error) {
	value, ok := data[field].(string)
	if !ok {
		return "", ErrInvalidProjection
	}
	return value, nil
}

func requiredNonEmptyString(data map[string]any, field string) (string, error) {
	value, err := requiredString(data, field)
	if err != nil || strings.TrimSpace(value) == "" {
		return "", ErrInvalidProjection
	}
	return value, nil
}

func copyOptionalNonDashString(target, source map[string]any, field string) error {
	raw, present := source[field]
	if !present || raw == nil {
		return nil
	}
	value, ok := raw.(string)
	if !ok {
		return ErrInvalidProjection
	}
	if value != "" && value != "-" {
		target[field] = value
	}
	return nil
}

func positiveIntegerText(value any) (string, error) {
	switch typed := value.(type) {
	case int:
		if typed > 0 {
			return strconv.Itoa(typed), nil
		}
	case int32:
		if typed > 0 {
			return strconv.FormatInt(int64(typed), 10), nil
		}
	case int64:
		if typed > 0 {
			return strconv.FormatInt(typed, 10), nil
		}
	case json.Number:
		integer, err := typed.Int64()
		if err == nil && integer > 0 {
			return strconv.FormatInt(integer, 10), nil
		}
	case float64:
		integer := int64(typed)
		if typed == float64(integer) && integer > 0 {
			return strconv.FormatInt(integer, 10), nil
		}
	case string:
		integer, err := strconv.ParseInt(typed, 10, 64)
		if err == nil && integer > 0 && strconv.FormatInt(integer, 10) == typed {
			return typed, nil
		}
	}
	return "", ErrInvalidProjection
}

func cloneJSONValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		copyValue := make(map[string]any, len(typed))
		for key, child := range typed {
			copyValue[key] = cloneJSONValue(child)
		}
		return copyValue
	case []any:
		copyValue := make([]any, len(typed))
		for index, child := range typed {
			copyValue[index] = cloneJSONValue(child)
		}
		return copyValue
	default:
		return value
	}
}
