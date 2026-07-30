package configurations

import "context"

// CurrentLiteLLMDataNormalizer ports the current create-time Pydantic rules
// for the six credential definitions owned by runtime_interface_litellm.
// Updates are intentionally delegated because the current update contract
// applies only shallow numeric coercion.
type CurrentLiteLLMDataNormalizer struct {
	fallback CurrentConfigurationDataNormalizer
}

// NewCurrentLiteLLMDataNormalizer composes the LiteLLM credential create rules
// in front of another normalizer. A nil fallback leaves unhandled requests
// incomplete.
func NewCurrentLiteLLMDataNormalizer(fallback CurrentConfigurationDataNormalizer) *CurrentLiteLLMDataNormalizer {
	return &CurrentLiteLLMDataNormalizer{fallback: fallback}
}

func (n *CurrentLiteLLMDataNormalizer) Normalize(
	ctx context.Context,
	request CurrentConfigurationNormalizationRequest,
) (CurrentConfigurationNormalizationResult, error) {
	if ctx == nil {
		return CurrentConfigurationNormalizationResult{}, ErrInvalidCurrentConfigurationMutation
	}
	if err := ctx.Err(); err != nil {
		return CurrentConfigurationNormalizationResult{}, err
	}
	if request.Operation == CurrentConfigurationNormalizationCreate && currentLiteLLMCredentialType(request.Type) {
		data, err := normalizeCurrentLiteLLMCredentialCreate(request.Type, request.Data)
		return CurrentConfigurationNormalizationResult{Data: data, Complete: err == nil}, err
	}
	if n != nil && n.fallback != nil {
		return n.fallback.Normalize(ctx, request)
	}
	return CurrentConfigurationNormalizationResult{Complete: false}, nil
}

func currentLiteLLMCredentialType(typeName string) bool {
	switch typeName {
	case "open_ai", "azure_open_ai", "ai_dial", "amazon_bedrock", "vertex_ai", "ollama":
		return true
	default:
		return false
	}
}

func normalizeCurrentLiteLLMCredentialCreate(typeName string, data map[string]any) (map[string]any, error) {
	switch typeName {
	case "open_ai":
		return normalizeCurrentOpenAICredential(data)
	case "azure_open_ai", "ai_dial":
		return normalizeCurrentAzureCredential(data)
	case "amazon_bedrock":
		return normalizeCurrentAmazonBedrockCredential(data)
	case "vertex_ai":
		return normalizeCurrentVertexAICredential(data)
	case "ollama":
		return normalizeCurrentOllamaCredential(data)
	default:
		return nil, currentMutationFieldError(CurrentConfigurationMutationNormalizationRequired, "data")
	}
}

func normalizeCurrentOpenAICredential(data map[string]any) (map[string]any, error) {
	apiBase, err := currentLiteLLMRequiredString(data, "api_base")
	if err != nil {
		return nil, err
	}
	apiKey, err := currentLiteLLMOptionalString(data, "api_key")
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"api_base": apiBase,
		"api_key":  apiKey,
	}, nil
}

func normalizeCurrentAzureCredential(data map[string]any) (map[string]any, error) {
	apiBase, err := currentLiteLLMRequiredString(data, "api_base")
	if err != nil {
		return nil, err
	}
	apiKey, err := currentLiteLLMOptionalString(data, "api_key")
	if err != nil {
		return nil, err
	}
	apiVersion, err := currentLiteLLMOptionalString(data, "api_version")
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"api_base":    apiBase,
		"api_key":     apiKey,
		"api_version": apiVersion,
	}, nil
}

func normalizeCurrentAmazonBedrockCredential(data map[string]any) (map[string]any, error) {
	accessKey, err := currentLiteLLMOptionalString(data, "aws_access_key_id")
	if err != nil {
		return nil, err
	}
	secretKey, err := currentLiteLLMOptionalString(data, "aws_secret_access_key")
	if err != nil {
		return nil, err
	}
	region, err := currentLiteLLMOptionalString(data, "aws_region_name")
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"aws_access_key_id":     accessKey,
		"aws_secret_access_key": secretKey,
		"aws_region_name":       region,
	}, nil
}

func normalizeCurrentVertexAICredential(data map[string]any) (map[string]any, error) {
	project, err := currentLiteLLMRequiredString(data, "vertex_project")
	if err != nil {
		return nil, err
	}
	location, err := currentLiteLLMRequiredString(data, "vertex_location")
	if err != nil {
		return nil, err
	}
	credentials, err := currentLiteLLMRequiredString(data, "vertex_credentials")
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"vertex_project":     project,
		"vertex_location":    location,
		"vertex_credentials": credentials,
	}, nil
}

func normalizeCurrentOllamaCredential(data map[string]any) (map[string]any, error) {
	apiBase, err := currentLiteLLMRequiredString(data, "api_base")
	if err != nil {
		return nil, err
	}
	return map[string]any{"api_base": apiBase}, nil
}

func currentLiteLLMRequiredString(data map[string]any, field string) (string, error) {
	raw, present := data[field]
	if !present {
		return "", currentLiteLLMInvalidField(field)
	}
	value, ok := raw.(string)
	if !ok {
		return "", currentLiteLLMInvalidField(field)
	}
	return value, nil
}

func currentLiteLLMOptionalString(data map[string]any, field string) (any, error) {
	raw, present := data[field]
	if !present || raw == nil {
		return nil, nil
	}
	value, ok := raw.(string)
	if !ok {
		return nil, currentLiteLLMInvalidField(field)
	}
	return value, nil
}

func currentLiteLLMInvalidField(field string) error {
	return currentMutationFieldError(CurrentConfigurationMutationInvalid, "data."+field)
}
