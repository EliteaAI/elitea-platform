package configurations

import (
	"context"
	"errors"
)

// CurrentProviderAdmission answers one question for one written configuration
// row: may a runtime use it? The answer is the row's status_ok column.
//
// status_ok is not a record that an operator proved the credential works.
// Nothing in this decision contacts a provider. The baseline platform set the
// column from its own events, never from a live provider call:
//
//   - runtime_interface_litellm/methods/configuration_entities.py:36-128 wrote
//     status_ok = true after it expanded the row's references and registered
//     the result locally.
//   - configurations/events/configuration_created.py:9 wrote status_ok = true
//     for pgvector, asr_model and tts_model the moment the row was created,
//     with no provider contact at all.
//
// The live provider round trip is a separate, user-started action
// (POST /configurations/check_connection, issue #319). It stores nothing.
//
// So status_ok means "the platform accepted this row: its declared references
// expand, its hidden secrets redeem, and policy admits the project to own it".
// This type holds that decision in one place, so the write routes and the
// configuration lifecycle cannot drift apart.
type CurrentProviderAdmission struct {
	resolver CurrentProviderConfigurationResolver
	policy   CurrentProviderProjectPolicy
}

var ErrInvalidCurrentProviderAdmission = errors.New("invalid current provider admission")

func NewCurrentProviderAdmission(
	resolver CurrentProviderConfigurationResolver,
	policy CurrentProviderProjectPolicy,
) (*CurrentProviderAdmission, error) {
	if resolver == nil || policy.PublicProjectID <= 0 {
		return nil, ErrInvalidCurrentProviderAdmission
	}
	return &CurrentProviderAdmission{resolver: resolver, policy: policy}, nil
}

// CurrentProviderAdmissionDecision reports what a writer must store.
//
// Managed is false for a row this decision does not own. A generic SDK
// configuration and an imported model (a model row with no ai_credentials) are
// both unmanaged: they declare no references and hold no secrets, so there is
// nothing to resolve and the writer keeps its own value. The lifecycle
// reconciler makes the same distinction, in
// currentConfigurationNeedsProviderResolution.
type CurrentProviderAdmissionDecision struct {
	Managed  bool
	StatusOK bool
}

// AdmitCurrentProviderConfiguration decides the status_ok value for one row.
//
// A failed resolution is not an error to the caller. It is the answer: the row
// is stored, and it is stored as not usable. The row stays visible in the
// configuration list with status_ok = false, which is what the product shows
// the user. Only a cancelled or expired context is returned as an error,
// because in that case no answer was reached.
func (admission *CurrentProviderAdmission) AdmitCurrentProviderConfiguration(
	ctx context.Context,
	snapshot CurrentConfigurationLifecycleSnapshot,
) (CurrentProviderAdmissionDecision, error) {
	if ctx == nil || admission == nil || admission.resolver == nil {
		return CurrentProviderAdmissionDecision{}, ErrInvalidCurrentProviderAdmission
	}
	if err := ctx.Err(); err != nil {
		return CurrentProviderAdmissionDecision{}, err
	}
	if !currentConfigurationNeedsProviderResolution(snapshot) {
		return CurrentProviderAdmissionDecision{}, nil
	}
	// A project the policy does not admit stops here. The row is stored and
	// stays at status_ok = false, which is the whole enforcement of
	// ELITEA_ALLOW_PROJECT_OWN_LLMS: every reader of a provider row selects on
	// status_ok = true.
	if !admission.policy.admits(snapshot.ProjectID) {
		return CurrentProviderAdmissionDecision{Managed: true}, nil
	}
	// A managed model with no data.name is unusable and always was: the model
	// catalog keys on that name. Treat it as a row that does not resolve.
	if currentConfigurationLifecycleKind(snapshot) == currentConfigurationLifecycleProviderModel {
		if _, ok := currentConfigurationLifecycleModelSourceName(snapshot); !ok {
			return CurrentProviderAdmissionDecision{Managed: true}, nil
		}
	}
	err := admission.resolver.ResolveCurrentProviderConfiguration(ctx, CurrentProviderConfigurationResolution{
		EffectID:          currentProviderAdmissionEffectID(snapshot),
		Revision:          1,
		ProjectID:         snapshot.ProjectID,
		ConfigurationUUID: snapshot.UUID,
		Section:           snapshot.Section,
		Configuration:     snapshot,
	})
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return CurrentProviderAdmissionDecision{}, ctxErr
		}
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return CurrentProviderAdmissionDecision{}, err
		}
		return CurrentProviderAdmissionDecision{Managed: true}, nil
	}
	return CurrentProviderAdmissionDecision{Managed: true, StatusOK: true}, nil
}

// currentProviderAdmissionEffectID keeps the resolver's read-only retry
// contract. The resolution is read-only, so any two calls for the same row are
// interchangeable.
func currentProviderAdmissionEffectID(snapshot CurrentConfigurationLifecycleSnapshot) string {
	return "admission:" + snapshot.UUID + ":" + currentLifecycleEffectProviderResolve
}
