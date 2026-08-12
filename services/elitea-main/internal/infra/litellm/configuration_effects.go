package litellm

import (
	"context"
	"errors"
	"strconv"
	"strings"

	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
)

var (
	ErrInvalidCurrentConfigurationEffects = errors.New("litellm: invalid current configuration effects")
	ErrCurrentConfigurationEffectRejected = errors.New("litellm: current configuration effect rejected")
	ErrCurrentConfigurationEffectFailed   = errors.New("litellm: current configuration effect failed")
)

// CurrentConfigurationMaterializer expands configuration references and
// resolves hidden-secret references only for the duration of one outbound
// LiteLLM effect. Implementations must return an owned Configuration and must
// not persist, cache, or log the expanded result.
type CurrentConfigurationMaterializer interface {
	MaterializeCurrentLiteLLMConfiguration(
		context.Context,
		configurationapp.CurrentConfigurationLifecycleSnapshot,
	) (Configuration, error)
}

// CurrentConfigurationEffects implements the Configurations-owned lifecycle
// boundary for the six LiteLLM credential types and five model sections. It
// retains only non-secret transport dependencies and non-secret static model
// parameters. Durable retry and ordering remain owned by the lifecycle outbox.
type CurrentConfigurationEffects struct {
	client                 *Client
	materializer           CurrentConfigurationMaterializer
	additionalOpenAIParams map[string]any
}

var _ configurationapp.CurrentLiteLLMConfigurationEffects = (*CurrentConfigurationEffects)(nil)

func NewCurrentConfigurationEffects(
	client *Client,
	materializer CurrentConfigurationMaterializer,
	additionalOpenAIParams map[string]any,
) (*CurrentConfigurationEffects, error) {
	if client == nil || materializer == nil {
		return nil, ErrInvalidCurrentConfigurationEffects
	}
	return &CurrentConfigurationEffects{
		client:                 client,
		materializer:           materializer,
		additionalOpenAIParams: cloneJSONObject(additionalOpenAIParams),
	}, nil
}

func (e *CurrentConfigurationEffects) EnsureCurrentLiteLLMCredential(
	ctx context.Context,
	desired configurationapp.CurrentLiteLLMCredentialDesired,
) error {
	if !validCurrentCredentialDesired(ctx, e, desired) {
		return currentConfigurationInputError(ctx)
	}
	configuration, err := e.materialize(ctx, desired.Configuration, desired.ProjectID, desired.ConfigurationUUID)
	if err != nil {
		return err
	}
	credential, err := ProjectCredential(configuration)
	if err != nil || credential.CredentialName != desired.Name {
		return ErrCurrentConfigurationEffectRejected
	}

	existing, err := e.client.ListCredentials(ctx)
	if err != nil {
		return currentConfigurationDependencyError(ctx, err)
	}
	for _, candidate := range existing {
		if candidate.CredentialName != desired.Name {
			continue
		}
		if err := e.client.DeleteCredential(ctx, desired.Name); err != nil {
			return currentConfigurationDependencyError(ctx, err)
		}
	}
	if err := e.client.CreateCredential(ctx, credential); err != nil {
		return currentConfigurationDependencyError(ctx, err)
	}
	return nil
}

func (e *CurrentConfigurationEffects) RemoveCurrentLiteLLMCredential(
	ctx context.Context,
	target configurationapp.CurrentLiteLLMCredentialTarget,
) error {
	if !validCurrentCredentialTarget(ctx, e, target) {
		return currentConfigurationInputError(ctx)
	}
	existing, err := e.client.ListCredentials(ctx)
	if err != nil {
		return currentConfigurationDependencyError(ctx, err)
	}
	for _, candidate := range existing {
		if candidate.CredentialName != target.Name {
			continue
		}
		if err := e.client.DeleteCredential(ctx, target.Name); err != nil {
			return currentConfigurationDependencyError(ctx, err)
		}
	}
	return nil
}

func (e *CurrentConfigurationEffects) EnsureCurrentLiteLLMModel(
	ctx context.Context,
	desired configurationapp.CurrentLiteLLMModelDesired,
) error {
	if !validCurrentModelDesired(ctx, e, desired) {
		return currentConfigurationInputError(ctx)
	}
	configuration, err := e.materialize(ctx, desired.Configuration, desired.ProjectID, desired.ConfigurationUUID)
	if err != nil {
		return err
	}
	model, err := ProjectModel(configuration, e.additionalOpenAIParams)
	if err != nil {
		return ErrCurrentConfigurationEffectRejected
	}
	// Imported models have no ai_credentials projection and remain externally
	// managed. The application layer normally filters them; this nil handling
	// keeps the outbound boundary safe when called independently.
	if model == nil {
		return nil
	}
	if model.ModelName != desired.Name || currentModelConfigurationUUID(model.ModelInfo) != desired.ConfigurationUUID {
		return ErrCurrentConfigurationEffectRejected
	}
	if err := e.removeModels(ctx, desired.Name, desired.ConfigurationUUID); err != nil {
		return err
	}
	if err := e.client.CreateModel(ctx, *model); err != nil {
		return currentConfigurationDependencyError(ctx, err)
	}
	return nil
}

func (e *CurrentConfigurationEffects) RemoveCurrentLiteLLMModel(
	ctx context.Context,
	target configurationapp.CurrentLiteLLMModelTarget,
) error {
	if !validCurrentModelTarget(ctx, e, target) {
		return currentConfigurationInputError(ctx)
	}
	return e.removeModels(ctx, target.Name, target.ConfigurationUUID)
}

func (e *CurrentConfigurationEffects) materialize(
	ctx context.Context,
	snapshot configurationapp.CurrentConfigurationLifecycleSnapshot,
	projectID int32,
	configurationUUID string,
) (Configuration, error) {
	configuration, err := e.materializer.MaterializeCurrentLiteLLMConfiguration(
		ctx,
		cloneCurrentConfigurationSnapshot(snapshot),
	)
	if err != nil {
		return Configuration{}, currentConfigurationDependencyError(ctx, err)
	}
	if configuration.ProjectID != int64(projectID) || configuration.UUID != configurationUUID ||
		configuration.Type != snapshot.Type || configuration.Data == nil {
		return Configuration{}, ErrCurrentConfigurationEffectRejected
	}
	return configuration, nil
}

func (e *CurrentConfigurationEffects) removeModels(ctx context.Context, name, configurationUUID string) error {
	existing, err := e.client.ListModels(ctx)
	if err != nil {
		return currentConfigurationDependencyError(ctx, err)
	}
	for _, candidate := range existing {
		if candidate.ModelName != name || currentModelConfigurationUUID(candidate.ModelInfo) != configurationUUID {
			continue
		}
		modelID, ok := candidate.ModelInfo["id"].(string)
		if !ok || !validAdminIdentifier(modelID) {
			return ErrCurrentConfigurationEffectFailed
		}
		if err := e.client.DeleteModel(ctx, modelID); err != nil {
			return currentConfigurationDependencyError(ctx, err)
		}
	}
	return nil
}

func validCurrentCredentialDesired(
	ctx context.Context,
	effects *CurrentConfigurationEffects,
	desired configurationapp.CurrentLiteLLMCredentialDesired,
) bool {
	return validCurrentEffectsContext(ctx, effects) && validCurrentEffectIdentity(
		desired.EffectID, desired.Revision, desired.Name, desired.ProjectID, desired.ConfigurationUUID,
	) && desired.Name == currentCredentialName(desired.ProjectID, desired.ConfigurationUUID) &&
		validCurrentSnapshot(desired.Configuration, desired.ProjectID, desired.ConfigurationUUID) &&
		desired.Configuration.Section == "ai_credentials" && currentCredentialType(desired.Configuration.Type)
}

func validCurrentCredentialTarget(
	ctx context.Context,
	effects *CurrentConfigurationEffects,
	target configurationapp.CurrentLiteLLMCredentialTarget,
) bool {
	return validCurrentEffectsContext(ctx, effects) && validCurrentEffectIdentity(
		target.EffectID, target.Revision, target.Name, target.ProjectID, target.ConfigurationUUID,
	) && target.Name == currentCredentialName(target.ProjectID, target.ConfigurationUUID)
}

func validCurrentModelDesired(
	ctx context.Context,
	effects *CurrentConfigurationEffects,
	desired configurationapp.CurrentLiteLLMModelDesired,
) bool {
	if !validCurrentEffectsContext(ctx, effects) || !validCurrentEffectIdentity(
		desired.EffectID, desired.Revision, desired.Name, desired.ProjectID, desired.ConfigurationUUID,
	) || !currentModelSection(desired.Section) || desired.Configuration.Section != desired.Section ||
		!validCurrentSnapshot(desired.Configuration, desired.ProjectID, desired.ConfigurationUUID) {
		return false
	}
	name, ok := desired.Configuration.Data["name"].(string)
	return ok && strings.TrimSpace(name) != "" &&
		desired.Name == strconv.FormatInt(int64(desired.ProjectID), 10)+"_"+name
}

func validCurrentModelTarget(
	ctx context.Context,
	effects *CurrentConfigurationEffects,
	target configurationapp.CurrentLiteLLMModelTarget,
) bool {
	if !validCurrentEffectsContext(ctx, effects) || !validCurrentEffectIdentity(
		target.EffectID, target.Revision, target.Name, target.ProjectID, target.ConfigurationUUID,
	) || !currentModelSection(target.Section) {
		return false
	}
	prefix := strconv.FormatInt(int64(target.ProjectID), 10) + "_"
	return strings.HasPrefix(target.Name, prefix) && len(target.Name) > len(prefix)
}

func validCurrentEffectsContext(ctx context.Context, effects *CurrentConfigurationEffects) bool {
	return ctx != nil && effects != nil && effects.client != nil && effects.materializer != nil
}

func validCurrentEffectIdentity(effectID string, revision int64, name string, projectID int32, uuid string) bool {
	return strings.TrimSpace(effectID) != "" && revision > 0 && projectID > 0 &&
		strings.TrimSpace(uuid) != "" && validAdminIdentifier(name)
}

func validCurrentSnapshot(
	snapshot configurationapp.CurrentConfigurationLifecycleSnapshot,
	projectID int32,
	uuid string,
) bool {
	return snapshot.ID > 0 && snapshot.ProjectID == projectID && snapshot.UUID == uuid &&
		snapshot.Type != "" && snapshot.Section != "" && snapshot.Data != nil
}

func currentCredentialType(value string) bool {
	switch value {
	case CredentialTypeOpenAI, CredentialTypeAzureOpenAI, CredentialTypeAIDIAL,
		CredentialTypeAmazonBedrock, CredentialTypeVertexAI, CredentialTypeOllama:
		return true
	default:
		return false
	}
}

func currentModelSection(value string) bool {
	switch configurationapp.CurrentModelSection(value) {
	case configurationapp.CurrentModelSectionLLM,
		configurationapp.CurrentModelSectionEmbedding,
		configurationapp.CurrentModelSectionImageGeneration,
		configurationapp.CurrentModelSectionTTS,
		configurationapp.CurrentModelSectionASR:
		return true
	default:
		return false
	}
}

func currentCredentialName(projectID int32, uuid string) string {
	return strconv.FormatInt(int64(projectID), 10) + "_" + uuid
}

func currentModelConfigurationUUID(modelInfo map[string]any) string {
	value, _ := modelInfo["centry_configuration_uuid"].(string)
	return value
}

func currentConfigurationInputError(ctx context.Context) error {
	if ctx != nil {
		if err := ctx.Err(); err != nil {
			return err
		}
	}
	return ErrInvalidCurrentConfigurationEffects
}

func currentConfigurationDependencyError(ctx context.Context, err error) error {
	if ctx != nil {
		if contextErr := ctx.Err(); contextErr != nil {
			return contextErr
		}
	}
	if errors.Is(err, context.Canceled) {
		return context.Canceled
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return context.DeadlineExceeded
	}
	return ErrCurrentConfigurationEffectFailed
}

func cloneCurrentConfigurationSnapshot(
	snapshot configurationapp.CurrentConfigurationLifecycleSnapshot,
) configurationapp.CurrentConfigurationLifecycleSnapshot {
	clone := snapshot
	clone.Data = cloneJSONObject(snapshot.Data)
	if snapshot.Label != nil {
		value := *snapshot.Label
		clone.Label = &value
	}
	if snapshot.AuthorID != nil {
		value := *snapshot.AuthorID
		clone.AuthorID = &value
	}
	return clone
}

func cloneJSONObject(value map[string]any) map[string]any {
	if value == nil {
		return nil
	}
	clone := make(map[string]any, len(value))
	for key, item := range value {
		clone[key] = cloneJSONValue(item)
	}
	return clone
}
