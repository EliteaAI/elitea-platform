package configurations

import (
	"context"
	"errors"
	"strconv"
)

// Current baseline evidence for this reconciler:
//
//   - projects/centry/pylon_main/plugins/runtime_interface_litellm/methods/
//     configuration_entities.py:36-203 at revision
//     997ecd9c866d0ac048fffb01bbecd2197c3d7435 creates and deletes the six
//     credential types and the llm, embedding, image_generation, tts, and asr
//     model sections. It skips models whose ai_credentials value is empty.
//   - projects/centry/pylon_main/plugins/runtime_interface_litellm/methods/
//     configuration_transformations.py:38-115 at the same revision delegates
//     provider mapping after configuration expansion and unsecreting.
//   - projects/centry/pylon_main/plugins/runtime_interface_litellm/methods/
//     tools.py:97-111 at the same revision applies allow_project_own_llms while
//     always permitting the public project.
//   - projects/centry/pylon_main/plugins/elitea_core/events/configuration.py:
//     73-109 and methods/configuration.py:43-87 at revision
//     41321950099cd1c3a71a96cc5f9b8766ef5fc7cc repair renamed toolkit
//     references and application defaults after an LLM configuration delete.
//
// Generic configuration schemas remain owned by elitea-sdk. A configuration
// that is not one of the exact LiteLLM credential or model contracts below is
// deliberately passive here.

var ErrInvalidCurrentConfigurationLifecycleEffectsReconciler = errors.New(
	"invalid current configuration lifecycle effects reconciler",
)

const (
	currentLifecycleIntentInvalidCode      = "LIFECYCLE_INTENT_INVALID"
	currentLifecycleLiteLLMFailedCode      = "LITELLM_EFFECT_FAILED"
	currentLifecycleStatusFailedCode       = "STATUS_WRITE_FAILED"
	currentLifecycleRenameFailedCode       = "CONFIGURATION_RENAME_FAILED"
	currentLifecycleDeletedLLMFailedCode   = "DELETED_LLM_REPAIR_FAILED"
	currentLifecycleStatusReconcilingCode  = "LITELLM_RECONCILING"
	currentLifecycleStatusReconciledCode   = "LITELLM_RECONCILED"
	currentLifecycleEffectRemoveBefore     = "litellm:remove-before"
	currentLifecycleEffectEnsureAfter      = "litellm:ensure-after"
	currentLifecycleEffectStatusPending    = "status:pending"
	currentLifecycleEffectStatusHealthy    = "status:healthy"
	currentLifecycleEffectRename           = "dependents:rename"
	currentLifecycleEffectDeletedLLMRepair = "dependents:deleted-llm"
)

type currentConfigurationLifecycleEntityKind uint8

const (
	currentConfigurationLifecyclePassive currentConfigurationLifecycleEntityKind = iota
	currentConfigurationLifecycleLiteLLMCredential
	currentConfigurationLifecycleLiteLLMModel
)

// CurrentLiteLLMProjectPolicy preserves the baseline allow_project_own_llms
// behavior for project-bound configuration events. Administration entities
// without a project are outside this configuration lifecycle contract.
type CurrentLiteLLMProjectPolicy struct {
	AllowProjectOwnLLMs bool
	PublicProjectID     int32
}

// CurrentLiteLLMCredentialDesired is immutable input to an idempotent ensure
// operation. Configuration.Data contains hidden-secret references, not resolved
// credentials. The adapter owns bounded expansion/unsecreting at the LiteLLM
// boundary and must not mutate or log the snapshot.
type CurrentLiteLLMCredentialDesired struct {
	EffectID          string
	Revision          int64
	Name              string
	ProjectID         int32
	ConfigurationUUID string
	Configuration     CurrentConfigurationLifecycleSnapshot
}

// CurrentLiteLLMCredentialTarget identifies the one credential to remove.
type CurrentLiteLLMCredentialTarget struct {
	EffectID          string
	Revision          int64
	Name              string
	ProjectID         int32
	ConfigurationUUID string
}

// CurrentLiteLLMModelDesired is immutable input to an idempotent model ensure.
// The adapter expands ai_credentials and performs the six provider mappings.
type CurrentLiteLLMModelDesired struct {
	EffectID          string
	Revision          int64
	Name              string
	ProjectID         int32
	ConfigurationUUID string
	Section           string
	Configuration     CurrentConfigurationLifecycleSnapshot
}

// CurrentLiteLLMModelTarget fences removal by stable model name and the
// originating configuration UUID. An implementation must not remove another
// configuration's model when the names collide.
type CurrentLiteLLMModelTarget struct {
	EffectID          string
	Revision          int64
	Name              string
	ProjectID         int32
	ConfigurationUUID string
	Section           string
}

// CurrentLiteLLMConfigurationEffects owns idempotent, context-aware LiteLLM
// management operations. A retry with the same EffectID must be safe even when
// the preceding attempt may have completed remotely.
type CurrentLiteLLMConfigurationEffects interface {
	EnsureCurrentLiteLLMCredential(context.Context, CurrentLiteLLMCredentialDesired) error
	RemoveCurrentLiteLLMCredential(context.Context, CurrentLiteLLMCredentialTarget) error
	EnsureCurrentLiteLLMModel(context.Context, CurrentLiteLLMModelDesired) error
	RemoveCurrentLiteLLMModel(context.Context, CurrentLiteLLMModelTarget) error
}

type CurrentConfigurationLifecycleStatusUpdate struct {
	EffectID          string
	EventID           string
	Revision          int64
	ProjectID         int32
	ConfigurationID   int32
	ConfigurationUUID string
	StatusOK          bool
	SafeCode          string
}

// CurrentConfigurationLifecycleStatusWriter updates status internally and
// idempotently. Its implementation must not append another lifecycle event;
// otherwise status feedback creates an infinite reconciliation loop.
type CurrentConfigurationLifecycleStatusWriter interface {
	SetCurrentConfigurationLifecycleStatus(context.Context, CurrentConfigurationLifecycleStatusUpdate) error
}

type CurrentConfigurationRenameEffect struct {
	EffectID          string
	EventID           string
	Revision          int64
	ProjectID         int32
	ConfigurationUUID string
	Type              string
	BeforeTitle       string
	AfterTitle        string
}

// CurrentConfigurationRenameEffects repairs toolkit configuration references.
// Repeating an effect with the same EffectID must be safe.
type CurrentConfigurationRenameEffects interface {
	RenameCurrentConfigurationReferences(context.Context, CurrentConfigurationRenameEffect) error
}

type CurrentDeletedLLMEffect struct {
	EffectID  string
	EventID   string
	Revision  int64
	ProjectID int32
	ModelName string
}

// CurrentDeletedLLMEffects repairs application defaults after an LLM
// configuration is deleted. Repeating an effect with the same EffectID must be
// safe, including the public-project fan-out performed by its implementation.
type CurrentDeletedLLMEffects interface {
	RepairCurrentDeletedLLMReferences(context.Context, CurrentDeletedLLMEffect) error
}

// CurrentConfigurationLifecycleEffectsReconciler applies only externally
// observable lifecycle effects. Claiming, retries, leases, and ordering across
// revisions remain owned by CurrentConfigurationLifecycleProcessor and its
// PostgreSQL store.
type CurrentConfigurationLifecycleEffectsReconciler struct {
	litellm    CurrentLiteLLMConfigurationEffects
	status     CurrentConfigurationLifecycleStatusWriter
	renames    CurrentConfigurationRenameEffects
	deletedLLM CurrentDeletedLLMEffects
	policy     CurrentLiteLLMProjectPolicy
}

func NewCurrentConfigurationLifecycleEffectsReconciler(
	litellm CurrentLiteLLMConfigurationEffects,
	status CurrentConfigurationLifecycleStatusWriter,
	renames CurrentConfigurationRenameEffects,
	deletedLLM CurrentDeletedLLMEffects,
	policy CurrentLiteLLMProjectPolicy,
) (*CurrentConfigurationLifecycleEffectsReconciler, error) {
	if litellm == nil || status == nil || renames == nil || deletedLLM == nil || policy.PublicProjectID <= 0 {
		return nil, ErrInvalidCurrentConfigurationLifecycleEffectsReconciler
	}
	return &CurrentConfigurationLifecycleEffectsReconciler{
		litellm: litellm, status: status, renames: renames, deletedLLM: deletedLLM, policy: policy,
	}, nil
}

func (r *CurrentConfigurationLifecycleEffectsReconciler) ReconcileCurrentConfigurationLifecycle(
	ctx context.Context,
	event CurrentConfigurationLifecycleEvent,
	intent CurrentConfigurationLifecycleIntent,
) (CurrentConfigurationLifecycleReconcileResult, error) {
	if ctx == nil || r == nil || r.litellm == nil || r.status == nil || r.renames == nil || r.deletedLLM == nil {
		return currentConfigurationLifecycleDeadResult(currentLifecycleIntentInvalidCode), nil
	}
	if err := ctx.Err(); err != nil {
		return CurrentConfigurationLifecycleReconcileResult{}, err
	}
	if !validCurrentConfigurationLifecycleEffectsIntent(event, intent) {
		return currentConfigurationLifecycleDeadResult(currentLifecycleIntentInvalidCode), nil
	}

	switch intent.Operation {
	case CurrentConfigurationCreated:
		return r.reconcileCurrentConfigurationCreated(ctx, event, *intent.After)
	case CurrentConfigurationUpdated:
		return r.reconcileCurrentConfigurationUpdated(ctx, event, *intent.Before, *intent.After)
	case CurrentConfigurationDeleted:
		return r.reconcileCurrentConfigurationDeleted(ctx, event, *intent.Before)
	default:
		return currentConfigurationLifecycleDeadResult(currentLifecycleIntentInvalidCode), nil
	}
}

func (r *CurrentConfigurationLifecycleEffectsReconciler) reconcileCurrentConfigurationCreated(
	ctx context.Context,
	event CurrentConfigurationLifecycleEvent,
	after CurrentConfigurationLifecycleSnapshot,
) (CurrentConfigurationLifecycleReconcileResult, error) {
	if !currentConfigurationNeedsLiteLLM(after) {
		return currentConfigurationLifecycleSuccessResult(), nil
	}
	if result, err, failed := r.setCurrentConfigurationLifecycleStatus(
		ctx, event, after, false, currentLifecycleEffectStatusPending, currentLifecycleStatusReconcilingCode,
	); failed {
		return result, err
	}
	if !r.currentLiteLLMAllowed(after.ProjectID) {
		return currentConfigurationLifecycleSuccessResult(), nil
	}
	if result, err, failed := r.ensureCurrentConfigurationLiteLLM(ctx, event, after); failed {
		return result, err
	}
	if result, err, failed := r.setCurrentConfigurationLifecycleStatus(
		ctx, event, after, true, currentLifecycleEffectStatusHealthy, currentLifecycleStatusReconciledCode,
	); failed {
		return result, err
	}
	return currentConfigurationLifecycleSuccessResult(), nil
}

func (r *CurrentConfigurationLifecycleEffectsReconciler) reconcileCurrentConfigurationUpdated(
	ctx context.Context,
	event CurrentConfigurationLifecycleEvent,
	before CurrentConfigurationLifecycleSnapshot,
	after CurrentConfigurationLifecycleSnapshot,
) (CurrentConfigurationLifecycleReconcileResult, error) {
	beforeManaged := currentConfigurationNeedsLiteLLM(before)
	afterManaged := currentConfigurationNeedsLiteLLM(after)
	if beforeManaged || afterManaged {
		if result, err, failed := r.setCurrentConfigurationLifecycleStatus(
			ctx, event, after, false, currentLifecycleEffectStatusPending, currentLifecycleStatusReconcilingCode,
		); failed {
			return result, err
		}
	}
	if beforeManaged {
		if result, err, failed := r.removeCurrentConfigurationLiteLLM(ctx, event, before); failed {
			return result, err
		}
	}
	ensuredAfter := false
	if afterManaged && r.currentLiteLLMAllowed(after.ProjectID) {
		if result, err, failed := r.ensureCurrentConfigurationLiteLLM(ctx, event, after); failed {
			return result, err
		}
		ensuredAfter = true
	}
	if before.EliteaTitle != after.EliteaTitle {
		effect := CurrentConfigurationRenameEffect{
			EffectID: currentConfigurationLifecycleEffectID(event.EventID, currentLifecycleEffectRename),
			EventID:  event.EventID, Revision: event.Revision, ProjectID: after.ProjectID,
			ConfigurationUUID: after.UUID, Type: after.Type,
			BeforeTitle: before.EliteaTitle, AfterTitle: after.EliteaTitle,
		}
		if result, err, failed := currentConfigurationLifecycleEffectFailure(
			ctx,
			r.renames.RenameCurrentConfigurationReferences(ctx, effect),
			currentLifecycleRenameFailedCode,
		); failed {
			return result, err
		}
	}
	if ensuredAfter {
		if result, err, failed := r.setCurrentConfigurationLifecycleStatus(
			ctx, event, after, true, currentLifecycleEffectStatusHealthy, currentLifecycleStatusReconciledCode,
		); failed {
			return result, err
		}
	}
	return currentConfigurationLifecycleSuccessResult(), nil
}

func (r *CurrentConfigurationLifecycleEffectsReconciler) reconcileCurrentConfigurationDeleted(
	ctx context.Context,
	event CurrentConfigurationLifecycleEvent,
	before CurrentConfigurationLifecycleSnapshot,
) (CurrentConfigurationLifecycleReconcileResult, error) {
	if currentConfigurationNeedsLiteLLM(before) {
		if result, err, failed := r.removeCurrentConfigurationLiteLLM(ctx, event, before); failed {
			return result, err
		}
	}
	if before.Section == string(CurrentModelSectionLLM) {
		modelName, ok := currentConfigurationLifecycleModelSourceName(before)
		if !ok {
			return currentConfigurationLifecycleDeadResult(currentLifecycleIntentInvalidCode), nil
		}
		effect := CurrentDeletedLLMEffect{
			EffectID: currentConfigurationLifecycleEffectID(event.EventID, currentLifecycleEffectDeletedLLMRepair),
			EventID:  event.EventID, Revision: event.Revision, ProjectID: before.ProjectID,
			ModelName: modelName,
		}
		if result, err, failed := currentConfigurationLifecycleEffectFailure(
			ctx,
			r.deletedLLM.RepairCurrentDeletedLLMReferences(ctx, effect),
			currentLifecycleDeletedLLMFailedCode,
		); failed {
			return result, err
		}
	}
	return currentConfigurationLifecycleSuccessResult(), nil
}

func (r *CurrentConfigurationLifecycleEffectsReconciler) ensureCurrentConfigurationLiteLLM(
	ctx context.Context,
	event CurrentConfigurationLifecycleEvent,
	configuration CurrentConfigurationLifecycleSnapshot,
) (CurrentConfigurationLifecycleReconcileResult, error, bool) {
	switch currentConfigurationLifecycleKind(configuration) {
	case currentConfigurationLifecycleLiteLLMCredential:
		desired := CurrentLiteLLMCredentialDesired{
			EffectID:          currentConfigurationLifecycleEffectID(event.EventID, currentLifecycleEffectEnsureAfter),
			Revision:          event.Revision,
			Name:              currentConfigurationLifecycleCredentialName(configuration),
			ProjectID:         configuration.ProjectID,
			ConfigurationUUID: configuration.UUID,
			Configuration:     configuration,
		}
		return currentConfigurationLifecycleEffectFailure(
			ctx, r.litellm.EnsureCurrentLiteLLMCredential(ctx, desired), currentLifecycleLiteLLMFailedCode,
		)
	case currentConfigurationLifecycleLiteLLMModel:
		name, ok := currentConfigurationLifecycleModelName(configuration)
		if !ok {
			return currentConfigurationLifecycleDeadResult(currentLifecycleIntentInvalidCode), nil, true
		}
		desired := CurrentLiteLLMModelDesired{
			EffectID: currentConfigurationLifecycleEffectID(event.EventID, currentLifecycleEffectEnsureAfter),
			Revision: event.Revision, Name: name, ProjectID: configuration.ProjectID,
			ConfigurationUUID: configuration.UUID, Section: configuration.Section,
			Configuration: configuration,
		}
		return currentConfigurationLifecycleEffectFailure(
			ctx, r.litellm.EnsureCurrentLiteLLMModel(ctx, desired), currentLifecycleLiteLLMFailedCode,
		)
	default:
		return currentConfigurationLifecycleSuccessResult(), nil, false
	}
}

func (r *CurrentConfigurationLifecycleEffectsReconciler) removeCurrentConfigurationLiteLLM(
	ctx context.Context,
	event CurrentConfigurationLifecycleEvent,
	configuration CurrentConfigurationLifecycleSnapshot,
) (CurrentConfigurationLifecycleReconcileResult, error, bool) {
	switch currentConfigurationLifecycleKind(configuration) {
	case currentConfigurationLifecycleLiteLLMCredential:
		target := CurrentLiteLLMCredentialTarget{
			EffectID:          currentConfigurationLifecycleEffectID(event.EventID, currentLifecycleEffectRemoveBefore),
			Revision:          event.Revision,
			Name:              currentConfigurationLifecycleCredentialName(configuration),
			ProjectID:         configuration.ProjectID,
			ConfigurationUUID: configuration.UUID,
		}
		return currentConfigurationLifecycleEffectFailure(
			ctx, r.litellm.RemoveCurrentLiteLLMCredential(ctx, target), currentLifecycleLiteLLMFailedCode,
		)
	case currentConfigurationLifecycleLiteLLMModel:
		name, ok := currentConfigurationLifecycleModelName(configuration)
		if !ok {
			return currentConfigurationLifecycleDeadResult(currentLifecycleIntentInvalidCode), nil, true
		}
		target := CurrentLiteLLMModelTarget{
			EffectID: currentConfigurationLifecycleEffectID(event.EventID, currentLifecycleEffectRemoveBefore),
			Revision: event.Revision, Name: name, ProjectID: configuration.ProjectID,
			ConfigurationUUID: configuration.UUID, Section: configuration.Section,
		}
		return currentConfigurationLifecycleEffectFailure(
			ctx, r.litellm.RemoveCurrentLiteLLMModel(ctx, target), currentLifecycleLiteLLMFailedCode,
		)
	default:
		return currentConfigurationLifecycleSuccessResult(), nil, false
	}
}

func (r *CurrentConfigurationLifecycleEffectsReconciler) setCurrentConfigurationLifecycleStatus(
	ctx context.Context,
	event CurrentConfigurationLifecycleEvent,
	configuration CurrentConfigurationLifecycleSnapshot,
	statusOK bool,
	effectSuffix string,
	safeCode string,
) (CurrentConfigurationLifecycleReconcileResult, error, bool) {
	update := CurrentConfigurationLifecycleStatusUpdate{
		EffectID: currentConfigurationLifecycleEffectID(event.EventID, effectSuffix),
		EventID:  event.EventID, Revision: event.Revision,
		ProjectID: configuration.ProjectID, ConfigurationID: configuration.ID,
		ConfigurationUUID: configuration.UUID, StatusOK: statusOK, SafeCode: safeCode,
	}
	return currentConfigurationLifecycleEffectFailure(
		ctx, r.status.SetCurrentConfigurationLifecycleStatus(ctx, update), currentLifecycleStatusFailedCode,
	)
}

func (r *CurrentConfigurationLifecycleEffectsReconciler) currentLiteLLMAllowed(projectID int32) bool {
	return r.policy.AllowProjectOwnLLMs || projectID == r.policy.PublicProjectID
}

func currentConfigurationLifecycleKind(
	configuration CurrentConfigurationLifecycleSnapshot,
) currentConfigurationLifecycleEntityKind {
	if configuration.Section == "ai_credentials" && currentLiteLLMCredentialType(configuration.Type) {
		return currentConfigurationLifecycleLiteLLMCredential
	}
	if currentConfigurationLifecycleModelSection(configuration.Section) {
		return currentConfigurationLifecycleLiteLLMModel
	}
	return currentConfigurationLifecyclePassive
}

func currentConfigurationLifecycleModelSection(section string) bool {
	switch section {
	case string(CurrentModelSectionLLM), string(CurrentModelSectionEmbedding),
		string(CurrentModelSectionImageGeneration), string(CurrentModelSectionTTS), string(CurrentModelSectionASR):
		return true
	default:
		return false
	}
}

func currentConfigurationNeedsLiteLLM(configuration CurrentConfigurationLifecycleSnapshot) bool {
	switch currentConfigurationLifecycleKind(configuration) {
	case currentConfigurationLifecycleLiteLLMCredential:
		return true
	case currentConfigurationLifecycleLiteLLMModel:
		return currentConfigurationLifecycleTruthy(configuration.Data["ai_credentials"])
	default:
		return false
	}
}

func currentConfigurationLifecycleTruthy(value any) bool {
	switch typed := value.(type) {
	case nil:
		return false
	case bool:
		return typed
	case string:
		return typed != ""
	case map[string]any:
		return len(typed) != 0
	case []any:
		return len(typed) != 0
	case float64:
		return typed != 0
	default:
		return true
	}
}

func currentConfigurationLifecycleCredentialName(configuration CurrentConfigurationLifecycleSnapshot) string {
	return strconv.FormatInt(int64(configuration.ProjectID), 10) + "_" + configuration.UUID
}

func currentConfigurationLifecycleModelName(
	configuration CurrentConfigurationLifecycleSnapshot,
) (string, bool) {
	name, ok := currentConfigurationLifecycleModelSourceName(configuration)
	if !ok {
		return "", false
	}
	return strconv.FormatInt(int64(configuration.ProjectID), 10) + "_" + name, true
}

func currentConfigurationLifecycleModelSourceName(
	configuration CurrentConfigurationLifecycleSnapshot,
) (string, bool) {
	name, ok := configuration.Data["name"].(string)
	return name, ok && name != ""
}

func currentConfigurationLifecycleEffectID(eventID, suffix string) string {
	return eventID + ":" + suffix
}

func currentConfigurationLifecycleEffectFailure(
	ctx context.Context,
	effectErr error,
	safeCode string,
) (CurrentConfigurationLifecycleReconcileResult, error, bool) {
	if ctxErr := ctx.Err(); ctxErr != nil {
		return CurrentConfigurationLifecycleReconcileResult{}, ctxErr, true
	}
	if effectErr == nil {
		return currentConfigurationLifecycleSuccessResult(), nil, false
	}
	if errors.Is(effectErr, context.Canceled) {
		return CurrentConfigurationLifecycleReconcileResult{}, context.Canceled, true
	}
	if errors.Is(effectErr, context.DeadlineExceeded) {
		return CurrentConfigurationLifecycleReconcileResult{}, context.DeadlineExceeded, true
	}
	return CurrentConfigurationLifecycleReconcileResult{
		Disposition: CurrentConfigurationLifecycleRetry,
		ErrorCode:   safeCode,
	}, nil, true
}

func currentConfigurationLifecycleSuccessResult() CurrentConfigurationLifecycleReconcileResult {
	return CurrentConfigurationLifecycleReconcileResult{Disposition: CurrentConfigurationLifecycleReconciled}
}

func currentConfigurationLifecycleDeadResult(code string) CurrentConfigurationLifecycleReconcileResult {
	return CurrentConfigurationLifecycleReconcileResult{
		Disposition: CurrentConfigurationLifecycleDead,
		ErrorCode:   code,
	}
}

func validCurrentConfigurationLifecycleEffectsIntent(
	event CurrentConfigurationLifecycleEvent,
	intent CurrentConfigurationLifecycleIntent,
) bool {
	if event.EventID == "" || intent.ID != event.EventID || intent.Operation != event.Operation ||
		event.ProjectID <= 0 || event.ConfigurationUUID == "" || event.Revision <= 0 {
		return false
	}
	validSnapshot := func(snapshot *CurrentConfigurationLifecycleSnapshot) bool {
		return snapshot != nil && snapshot.ID > 0 && snapshot.ProjectID == event.ProjectID &&
			snapshot.UUID == event.ConfigurationUUID && snapshot.Type != "" && snapshot.Section != ""
	}
	switch intent.Operation {
	case CurrentConfigurationCreated:
		return intent.Before == nil && validSnapshot(intent.After)
	case CurrentConfigurationDeleted:
		return validSnapshot(intent.Before) && intent.After == nil
	case CurrentConfigurationUpdated:
		if !validSnapshot(intent.Before) || !validSnapshot(intent.After) {
			return false
		}
		return intent.Before.ID == intent.After.ID && intent.Before.UUID == intent.After.UUID &&
			intent.Before.ProjectID == intent.After.ProjectID && intent.Before.Type == intent.After.Type &&
			intent.Before.Section == intent.After.Section
	default:
		return false
	}
}

var _ CurrentConfigurationLifecycleReconciler = (*CurrentConfigurationLifecycleEffectsReconciler)(nil)
