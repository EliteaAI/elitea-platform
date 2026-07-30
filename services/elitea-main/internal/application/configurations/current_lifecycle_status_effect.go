package configurations

import "context"

// CurrentConfigurationLifecycleStatusTarget is the exact row fence for an
// internal status mutation. ProjectID is trusted tenant identity; UUID prevents
// a delayed lifecycle event from changing a replacement row that reused an ID.
type CurrentConfigurationLifecycleStatusTarget struct {
	ProjectID         int32
	ConfigurationID   int32
	ConfigurationUUID string
	StatusOK          bool
}

// CurrentConfigurationLifecycleStatusRepository changes only configuration.status_ok.
// It must use the exact project/id/uuid fence, return false when that row no
// longer exists, and must not append a lifecycle/outbox event. A false result is
// an idempotent stale-event success, not an error.
type CurrentConfigurationLifecycleStatusRepository interface {
	SetCurrentConfigurationLifecycleStatus(
		context.Context,
		CurrentConfigurationLifecycleStatusTarget,
	) (bool, error)
}

// CurrentConfigurationLifecycleStatusEffect adapts the internal repository to
// CurrentConfigurationLifecycleStatusWriter.
type CurrentConfigurationLifecycleStatusEffect struct {
	repository CurrentConfigurationLifecycleStatusRepository
}

func NewCurrentConfigurationLifecycleStatusEffect(
	repository CurrentConfigurationLifecycleStatusRepository,
) (*CurrentConfigurationLifecycleStatusEffect, error) {
	if repository == nil {
		return nil, ErrInvalidCurrentConfigurationLifecycleInternalEffect
	}
	return &CurrentConfigurationLifecycleStatusEffect{repository: repository}, nil
}

func (e *CurrentConfigurationLifecycleStatusEffect) SetCurrentConfigurationLifecycleStatus(
	ctx context.Context,
	update CurrentConfigurationLifecycleStatusUpdate,
) error {
	if ctx == nil || e == nil || e.repository == nil ||
		!validCurrentConfigurationLifecycleIdentity(update.EffectID) ||
		!validCurrentConfigurationLifecycleIdentity(update.EventID) ||
		update.Revision <= 0 || update.ProjectID <= 0 || update.ConfigurationID <= 0 ||
		!validCurrentConfigurationLifecycleIdentity(update.ConfigurationUUID) ||
		!validCurrentConfigurationLifecycleErrorCode(update.SafeCode) {
		return ErrInvalidCurrentConfigurationLifecycleInternalEffect
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	_, err := e.repository.SetCurrentConfigurationLifecycleStatus(ctx, CurrentConfigurationLifecycleStatusTarget{
		ProjectID:         update.ProjectID,
		ConfigurationID:   update.ConfigurationID,
		ConfigurationUUID: update.ConfigurationUUID,
		StatusOK:          update.StatusOK,
	})
	if err != nil {
		return currentConfigurationLifecycleInternalDependencyError(ctx, err)
	}
	return nil
}

var _ CurrentConfigurationLifecycleStatusWriter = (*CurrentConfigurationLifecycleStatusEffect)(nil)
