package runtimecomposition

import (
	"context"
	"errors"
	"net/http"
	"time"

	configurationapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/configurations"
	executionapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/executions"
	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
)

type PublicRoutes struct {
	Validation      http.Handler
	ExecutionEvents http.Handler
}

// Phase one uses durable PostgreSQL replay without a notification sidecar.
// Polling every two seconds makes completion visibility explicitly bounded by
// roughly two seconds plus query time; each poll is also the SSE heartbeat and
// the maximum project-membership/suspension reauthorization interval.
const phaseOneReplayPollInterval = 2 * time.Second

type validationSubmitter interface {
	Submit(context.Context, configurationapp.SubmitValidationRequest) (executionapp.AdmissionOutcome, error)
}

func newPublicRoutes(authorizer *postgresPublicAuthorizer, submitter validationSubmitter, replay executionapi.EventRepository) (PublicRoutes, error) {
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
