package main

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/providerhost/facade"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/providerhost/registrar"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/providerhub"
)

// providerRegistrationInterval is how often a facade re-probes its
// provider's descriptor and health for the admission plane.
const providerRegistrationInterval = time.Minute

// startProviderRegistrar makes a composed facade's provider known to the
// admission plane (ADR-0023 decision 6): its descriptor is registered under
// the public project at boot and its health projection kept current. It
// returns false, with the reason logged, when there is nothing to register
// with — no database, no public project, or a database the admission
// migration (0107) has not reached — so a deployment without the plane
// keeps serving the provider exactly as before.
func startProviderRegistrar(
	ctx context.Context,
	logger *slog.Logger,
	pool *pgxpool.Pool,
	publicProjectID int32,
	name string,
	cfg facade.Config,
	envName string,
) bool {
	if logger == nil {
		logger = slog.Default()
	}
	log := logger.With("provider", name)
	switch {
	case pool == nil:
		log.Info("provider registration skipped: no database")
		return false
	case publicProjectID <= 0:
		log.Info("provider registration skipped: no public project (ELITEA_AI_PROJECT_ID)")
		return false
	case !providerhub.Present(ctx, pool):
		log.Info("provider registration skipped: the admission plane is not migrated (0107)")
		return false
	}
	reg, err := registrar.New(cfg, envName, registrar.PoolStore{Pool: pool}, registrar.Options{
		ProjectID: int64(publicProjectID),
		Actor:     "facade:" + name,
		Interval:  providerRegistrationInterval,
	}, log)
	if err != nil {
		log.Error("provider registration not started", "error", err)
		return false
	}
	go reg.Run(ctx)
	log.Info("provider registration started", "origin", reg.Origin(), "project", publicProjectID,
		"interval", providerRegistrationInterval.String())
	return true
}
