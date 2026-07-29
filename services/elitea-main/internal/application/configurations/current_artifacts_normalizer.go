package configurations

import "context"

// CurrentArtifactsDataNormalizer ports the current create-time Pydantic rules
// for the s3 and s3_api_credentials definitions owned by the Artifacts plugin.
// Updates are delegated because the current update contract does not rerun the
// owning Pydantic model.
type CurrentArtifactsDataNormalizer struct {
	fallback CurrentConfigurationDataNormalizer
}

// NewCurrentArtifactsDataNormalizer composes the Artifacts create rules in
// front of another normalizer. A nil fallback leaves unhandled requests
// incomplete.
func NewCurrentArtifactsDataNormalizer(fallback CurrentConfigurationDataNormalizer) *CurrentArtifactsDataNormalizer {
	return &CurrentArtifactsDataNormalizer{fallback: fallback}
}

func (n *CurrentArtifactsDataNormalizer) Normalize(
	ctx context.Context,
	request CurrentConfigurationNormalizationRequest,
) (CurrentConfigurationNormalizationResult, error) {
	if ctx == nil {
		return CurrentConfigurationNormalizationResult{}, ErrInvalidCurrentConfigurationMutation
	}
	if err := ctx.Err(); err != nil {
		return CurrentConfigurationNormalizationResult{}, err
	}
	if request.Operation == CurrentConfigurationNormalizationCreate && currentArtifactsConfigurationType(request.Type) {
		data, err := normalizeCurrentArtifactsCreate(request.Type, request.Data)
		return CurrentConfigurationNormalizationResult{Data: data, Complete: err == nil}, err
	}
	if n != nil && n.fallback != nil {
		return n.fallback.Normalize(ctx, request)
	}
	return CurrentConfigurationNormalizationResult{Complete: false}, nil
}

func currentArtifactsConfigurationType(typeName string) bool {
	switch typeName {
	case "s3", "s3_api_credentials":
		return true
	default:
		return false
	}
}

func normalizeCurrentArtifactsCreate(typeName string, data map[string]any) (map[string]any, error) {
	switch typeName {
	case "s3":
		return normalizeCurrentArtifactsS3(data)
	case "s3_api_credentials":
		return normalizeCurrentArtifactsS3APICredentials(data)
	default:
		return nil, currentMutationFieldError(CurrentConfigurationMutationNormalizationRequired, "data")
	}
}

func normalizeCurrentArtifactsS3(data map[string]any) (map[string]any, error) {
	accessKey, err := currentArtifactsOptionalString(data, "access_key")
	if err != nil {
		return nil, err
	}
	secretAccessKey, err := currentArtifactsOptionalString(data, "secret_access_key")
	if err != nil {
		return nil, err
	}
	regionName, err := currentArtifactsRequiredString(data, "region_name")
	if err != nil {
		return nil, err
	}
	useCompatibleStorage, err := currentArtifactsBooleanField(data, "use_compatible_storage", false)
	if err != nil {
		return nil, err
	}
	storageURL, err := currentArtifactsRequiredString(data, "storage_url")
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"access_key":             accessKey,
		"secret_access_key":      secretAccessKey,
		"region_name":            regionName,
		"use_compatible_storage": useCompatibleStorage,
		"storage_url":            storageURL,
	}, nil
}

func normalizeCurrentArtifactsS3APICredentials(data map[string]any) (map[string]any, error) {
	accessKeyID, err := currentArtifactsRequiredString(data, "access_key_id")
	if err != nil {
		return nil, err
	}
	secretAccessKey, err := currentArtifactsOptionalString(data, "secret_access_key")
	if err != nil {
		return nil, err
	}
	userIDRaw, present := data["user_id"]
	if !present || userIDRaw == nil {
		return nil, currentArtifactsInvalidField("user_id")
	}
	userID, ok := currentLocalPydanticInteger(userIDRaw)
	if !ok {
		return nil, currentArtifactsInvalidField("user_id")
	}
	expiresAt, err := currentArtifactsOptionalString(data, "expires_at")
	if err != nil {
		return nil, err
	}
	permissions, err := currentArtifactsStringListField(data, "permissions")
	if err != nil {
		return nil, err
	}
	bucketPermissions, err := currentArtifactsBucketPermissions(data)
	if err != nil {
		return nil, err
	}
	isActive, err := currentArtifactsBooleanField(data, "is_active", true)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"access_key_id":      accessKeyID,
		"secret_access_key":  secretAccessKey,
		"user_id":            userID,
		"expires_at":         expiresAt,
		"permissions":        permissions,
		"bucket_permissions": bucketPermissions,
		"is_active":          isActive,
	}, nil
}

func currentArtifactsRequiredString(data map[string]any, field string) (string, error) {
	raw, present := data[field]
	if !present {
		return "", currentArtifactsInvalidField(field)
	}
	value, ok := raw.(string)
	if !ok {
		return "", currentArtifactsInvalidField(field)
	}
	return value, nil
}

func currentArtifactsOptionalString(data map[string]any, field string) (any, error) {
	raw, present := data[field]
	if !present || raw == nil {
		return nil, nil
	}
	value, ok := raw.(string)
	if !ok {
		return nil, currentArtifactsInvalidField(field)
	}
	return value, nil
}

func currentArtifactsBooleanField(data map[string]any, field string, defaultValue bool) (bool, error) {
	raw, present := data[field]
	if !present {
		return defaultValue, nil
	}
	if raw == nil {
		return false, currentArtifactsInvalidField(field)
	}
	value, ok := currentLocalPydanticBoolean(raw)
	if !ok {
		return false, currentArtifactsInvalidField(field)
	}
	return value, nil
}

func currentArtifactsStringListField(data map[string]any, field string) ([]any, error) {
	raw, present := data[field]
	if !present {
		return []any{}, nil
	}
	value, ok := currentArtifactsStringList(raw)
	if !ok {
		return nil, currentArtifactsInvalidField(field)
	}
	return value, nil
}

func currentArtifactsStringList(raw any) ([]any, bool) {
	switch values := raw.(type) {
	case []any:
		result := make([]any, len(values))
		for index, rawValue := range values {
			value, ok := rawValue.(string)
			if !ok {
				return nil, false
			}
			result[index] = value
		}
		return result, true
	case []string:
		result := make([]any, len(values))
		for index, value := range values {
			result[index] = value
		}
		return result, true
	default:
		return nil, false
	}
}

func currentArtifactsBucketPermissions(data map[string]any) (map[string]any, error) {
	raw, present := data["bucket_permissions"]
	if !present {
		return map[string]any{}, nil
	}
	permissions, ok := raw.(map[string]any)
	if !ok || permissions == nil {
		return nil, currentArtifactsInvalidField("bucket_permissions")
	}
	result := make(map[string]any, len(permissions))
	for bucket, rawValues := range permissions {
		values, ok := currentArtifactsStringList(rawValues)
		if !ok {
			return nil, currentArtifactsInvalidField("bucket_permissions")
		}
		result[bucket] = values
	}
	return result, nil
}

func currentArtifactsInvalidField(field string) error {
	return currentMutationFieldError(CurrentConfigurationMutationInvalid, "data."+field)
}
