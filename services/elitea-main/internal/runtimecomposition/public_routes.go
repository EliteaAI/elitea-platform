package runtimecomposition

import (
	"context"
	"errors"
	"net/http"
	"time"

	configurationapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/configurations"
	executionapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/executions"
	indexingapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/indexing"
	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
)

type PublicRoutes struct {
	Validation      http.Handler
	ExecutionEvents http.Handler
	// IndexStart is composed only when the complete index control/data plane is
	// enabled. Main binds it to the current route's existing authentication and
	// project-RBAC middleware before mounting it.
	IndexStart indexingapi.StartUseCase
	// IndexMeta reads the current raw-array UI contract from the project-owned
	// PgVector target resolved through the saved toolkit and Configurations.
	IndexMeta indexingapi.CurrentIndexMetaReader
}

// Phase one uses durable PostgreSQL replay without a notification sidecar.
// Polling every two seconds makes completion visibility explicitly bounded by
// roughly two seconds plus query time; each poll is also the SSE heartbeat and
// the maximum project-membership/suspension reauthorization interval.
const phaseOneReplayPollInterval = 2 * time.Second

type validationSubmitter interface {
	Submit(context.Context, configurationapp.SubmitValidationRequest) (executionapp.AdmissionOutcome, error)
}

func newPublicRoutes(authorizer *postgresPublicAuthorizer, submitter validationSubmitter, replay executionapi.EventRepository, indexStart indexingapi.StartUseCase) (PublicRoutes, error) {
	validation, err := configurationapi.NewValidationHandler(authorizer, submitter)
	if err != nil {
		return PublicRoutes{}, err
	}
	events, err := executionapi.NewEventHandler(authorizer, replay, pollingReplayWaiter{interval: phaseOneReplayPollInterval})
	if err != nil {
		return PublicRoutes{}, err
	}
	return PublicRoutes{
		Validation:      http.HandlerFunc(validation.Submit),
		ExecutionEvents: http.HandlerFunc(events.Stream),
		IndexStart:      indexStart,
	}, nil
}

type pollingReplayWaiter struct {
	interval time.Duration
}

func (w pollingReplayWaiter) Wait(ctx context.Context, _, _ string, _ uint64) (bool, error) {
	if w.interval <= 0 {
		return false, errors.New("runtime replay polling interval is invalid")
	}
	timer := time.NewTimer(w.interval)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false, ctx.Err()
	case <-timer.C:
		return true, nil
	}
}
