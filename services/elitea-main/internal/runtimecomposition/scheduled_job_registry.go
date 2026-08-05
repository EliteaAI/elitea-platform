package runtimecomposition

import (
	"time"

	schedulingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/scheduling"
)

// scheduledJobs builds the schedulingapp.Job values New() registers — the
// current index scan and the S14 artifact retention sweep. Extracted from
// New()'s inline construction so a composition-level test can call this
// exact function (the same one New() calls) and assert both jobs are
// present via Registry.RegisteredJobs(), without needing New()'s full
// dependency graph (Redis, gRPC TLS, signing keys, five Postgres pools).
// This is what catches a Handler that's correctly implemented and
// unit-tested but never reaches the registry — the failure mode S14's plan
// text calls out explicitly (see artifact_retention_sweep.go's package
// doc) — provided New() keeps calling this function rather than
// reconstructing the job list inline again.
func scheduledJobs(
	indexHandler schedulingapp.Handler,
	retentionHandler schedulingapp.Handler,
	indexSchedule schedulingapp.Schedule,
	retentionSchedule schedulingapp.Schedule,
) []schedulingapp.Job {
	return []schedulingapp.Job{
		{
			ID:       currentIndexScheduleCapability,
			Revision: currentIndexScheduleRevision,
			Mode:     schedulingapp.ModeDurableAdmission,
			Schedule: indexSchedule,
			Timeout:  currentIndexScheduleHandlerTimeout,
			Handler:  indexHandler,
		},
		{
			ID:       artifactRetentionSweepCapability,
			Revision: artifactRetentionSweepRevision,
			Mode:     schedulingapp.ModeLocalBounded,
			Schedule: retentionSchedule,
			Timeout:  artifactRetentionSweepHandlerTimeout,
			Handler:  retentionHandler,
		},
	}
}

// scheduledJobRegistry is a one-line indirection over
// schedulingapp.NewRegistry so the composition-level test (above) and New()
// go through an identical call shape.
func scheduledJobRegistry(leaseDuration time.Duration, jobs ...schedulingapp.Job) (*schedulingapp.Registry, error) {
	return schedulingapp.NewRegistry(leaseDuration, jobs...)
}
