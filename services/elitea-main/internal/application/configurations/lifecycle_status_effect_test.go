package configurations

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestCurrentConfigurationLifecycleStatusEffectUsesExactFenceAndTreatsMissingAsSuccess(t *testing.T) {
	repository := &currentLifecycleStatusRepositoryStub{updated: false}
	effect, err := NewCurrentConfigurationLifecycleStatusEffect(repository)
	if err != nil {
		t.Fatalf("NewCurrentConfigurationLifecycleStatusEffect() error = %v", err)
	}

	err = effect.SetCurrentConfigurationLifecycleStatus(context.Background(), currentLifecycleStatusTestUpdate())
	if err != nil {
		t.Fatalf("SetCurrentConfigurationLifecycleStatus() error = %v", err)
	}
	if repository.calls != 1 || repository.target != (CurrentConfigurationLifecycleStatusTarget{
		ProjectID:         7,
		ConfigurationID:   19,
		ConfigurationUUID: "configuration-uuid",
		StatusOK:          true,
	}) {
		t.Fatalf("repository call = %d, target = %#v", repository.calls, repository.target)
	}
}

func TestCurrentConfigurationLifecycleStatusEffectRedactsDependencyAndPreservesCancellation(t *testing.T) {
	secretFailure := errors.New("sql failed for token=must-not-leak")
	repository := &currentLifecycleStatusRepositoryStub{err: secretFailure}
	effect, err := NewCurrentConfigurationLifecycleStatusEffect(repository)
	if err != nil {
		t.Fatalf("NewCurrentConfigurationLifecycleStatusEffect() error = %v", err)
	}

	err = effect.SetCurrentConfigurationLifecycleStatus(context.Background(), currentLifecycleStatusTestUpdate())
	if !errors.Is(err, ErrCurrentConfigurationLifecycleInternalUnavailable) || strings.Contains(err.Error(), "must-not-leak") {
		t.Fatalf("dependency error = %v", err)
	}

	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	err = effect.SetCurrentConfigurationLifecycleStatus(cancelled, currentLifecycleStatusTestUpdate())
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation error = %v", err)
	}
}

func TestCurrentConfigurationLifecycleStatusEffectRejectsInvalidDependenciesAndUpdates(t *testing.T) {
	if _, err := NewCurrentConfigurationLifecycleStatusEffect(nil); !errors.Is(err, ErrInvalidCurrentConfigurationLifecycleInternalEffect) {
		t.Fatalf("constructor error = %v", err)
	}

	repository := &currentLifecycleStatusRepositoryStub{}
	effect, err := NewCurrentConfigurationLifecycleStatusEffect(repository)
	if err != nil {
		t.Fatalf("NewCurrentConfigurationLifecycleStatusEffect() error = %v", err)
	}
	invalid := currentLifecycleStatusTestUpdate()
	invalid.ConfigurationUUID = ""
	if err := effect.SetCurrentConfigurationLifecycleStatus(context.Background(), invalid); !errors.Is(err, ErrInvalidCurrentConfigurationLifecycleInternalEffect) {
		t.Fatalf("invalid update error = %v", err)
	}
	if repository.calls != 0 {
		t.Fatalf("repository calls = %d", repository.calls)
	}
}

func currentLifecycleStatusTestUpdate() CurrentConfigurationLifecycleStatusUpdate {
	return CurrentConfigurationLifecycleStatusUpdate{
		EffectID:          "event-1:status:healthy",
		EventID:           "event-1",
		Revision:          4,
		ProjectID:         7,
		ConfigurationID:   19,
		ConfigurationUUID: "configuration-uuid",
		StatusOK:          true,
		SafeCode:          "LITELLM_RECONCILED",
	}
}

type currentLifecycleStatusRepositoryStub struct {
	target  CurrentConfigurationLifecycleStatusTarget
	updated bool
	err     error
	calls   int
}

func (s *currentLifecycleStatusRepositoryStub) SetCurrentConfigurationLifecycleStatus(
	_ context.Context,
	target CurrentConfigurationLifecycleStatusTarget,
) (bool, error) {
	s.calls++
	s.target = target
	return s.updated, s.err
}
